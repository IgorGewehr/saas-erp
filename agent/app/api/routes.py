"""Public HTTP endpoints.

GET  /health                — liveness probe
POST /process               — main agent entrypoint (HMAC-authed)
"""

from __future__ import annotations

import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import verify_inbound
from ..config import get_settings
from ..graph.evaluators import evaluate_groundedness, should_sample
from ..graph.graph import run_agent
from ..graph.state import AgentRunResult
from ..logging_config import get_logger
from ..schemas import ProcessRequest, ProcessResponse
from ..store.runs import persist_run
from ..tools.client import call_tool, send_final_message

router = APIRouter()
log = get_logger("api")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "servicepro-agent"}


async def _update_client_memory(business_id: str, result: AgentRunResult) -> None:
    """If the run referenced a client, append a short summary to Client.aiSummary.

    We only update when there's something worth remembering: a tool created/
    modified an order, appointment, or client record. Pure Q&A doesn't change
    the memory — keeps tokens bounded.
    """
    client_id: str | None = None
    noteworthy = False
    for t in (result.tool_calls or []):
        name = t.get("name", "")
        args = t.get("arguments") or {}
        if name in ("orders_create", "agenda_book", "clients_create", "agenda_update", "agenda_cancel", "orders_cancel", "orders_update_items", "clients_update"):
            noteworthy = True
            # Try to harvest client_id from any tool we can
            if name == "clients_create" and t.get("result"):
                client_id = (t.get("result") or {}).get("id") or client_id
            elif "clientId" in args and args["clientId"]:
                client_id = args["clientId"]
            elif "id" in args and name.startswith("clients_"):
                client_id = args["id"]
    if not noteworthy or not client_id:
        return

    # Compose a terse summary (1 line) from intent + final response
    snippet = (result.final_response or "")[:160].replace("\n", " ").strip()
    if not snippet:
        return
    date_tag = time.strftime("%Y-%m-%d", time.gmtime())
    memory_line = f"{date_tag}: {snippet}"

    # Server-side append: fetch current aiSummary, append bounded to last 5 entries
    try:
        get_resp = await call_tool(business_id, "clients_get", {"id": client_id})
    except Exception:
        return
    existing = (get_resp.get("aiSummary") or "") if isinstance(get_resp, dict) else ""
    lines = [ln for ln in existing.splitlines() if ln.strip()]
    lines.append(memory_line)
    if len(lines) > 5:
        lines = lines[-5:]
    new_summary = "\n".join(lines)

    try:
        await call_tool(business_id, "clients_update", {
            "id": client_id,
            "patch": {"aiSummary": new_summary},
        })
    except Exception as err:
        log.warning("memory.update_failed", error=str(err))


@router.post("/process", response_model=ProcessResponse)
async def process(request: Request, auth: tuple[str, str] = Depends(verify_inbound)) -> ProcessResponse:
    business_id, raw_body = auth

    try:
        req = ProcessRequest.model_validate(json.loads(raw_body))
    except Exception as e:
        log.error("process.bad_body", error=str(e))
        raise HTTPException(status_code=400, detail="Invalid body") from e

    run_id = str(uuid.uuid4())
    start = time.time()
    log.info(
        "process.start",
        run_id=run_id,
        business_id=business_id,
        conversation_id=req.conversation_id,
        channel=req.channel,
        message_preview=req.message[:80],
    )

    try:
        result = await run_agent(run_id=run_id, business_id=business_id, req=req)

        # Best-effort persist (Next.js) — never block response on this
        try:
            await persist_run(business_id, result.to_log())
        except Exception as err:
            log.warning("process.persist_failed", run_id=run_id, error=str(err))

        # Dispatch the final message back through Next.js
        if result.final_response:
            try:
                await send_final_message(
                    business_id=business_id,
                    conversation_id=req.conversation_id,
                    channel=req.channel,
                    recipient_id=req.recipient_id,
                    content=result.final_response,
                )
            except Exception as err:
                log.error("process.send_failed", run_id=run_id, error=str(err))

        # Best-effort: update persistent memory (Client.aiSummary) when the run
        # touched a client. Keeps a rolling 1-2 line summary so the next run
        # has context beyond the last 10 messages.
        try:
            await _update_client_memory(business_id, result)
        except Exception as err:
            log.warning("process.memory_update_failed", run_id=run_id, error=str(err))

        # Opt-in online groundedness evaluator (LANGSMITH_EVALS_ENABLED=true).
        # Samples ~5% of runs; attaches score + hallucinations to the agentRun
        # doc for dashboard / alert consumption. Skips when disabled.
        if result.final_response and should_sample():
            try:
                eval_result = await evaluate_groundedness(
                    final_response=result.final_response,
                    tool_calls=result.tool_calls,
                    user_message=req.message,
                )
                log.info(
                    "process.grounded",
                    run_id=run_id,
                    score=eval_result.get("score"),
                    hallucinations=len(eval_result.get("hallucinations") or []),
                )
                # Attach to persisted run via a follow-up write
                try:
                    await persist_run(business_id, {
                        "id": run_id,
                        "groundednessScore": eval_result.get("score"),
                        "groundednessReason": eval_result.get("reason"),
                        "hallucinations": eval_result.get("hallucinations", []),
                    })
                except Exception as err:
                    log.warning("process.grounded.persist_failed", error=str(err))
            except Exception as err:
                log.warning("process.grounded.error", run_id=run_id, error=str(err))

        latency = int((time.time() - start) * 1000)
        log.info(
            "process.done",
            run_id=run_id,
            iterations=result.iterations,
            intent=result.intent,
            latency_ms=latency,
        )
        return ProcessResponse(
            run_id=run_id,
            final_response=result.final_response,
            intent=result.intent,
            iterations=result.iterations,
            status="success" if not result.error else "error",
            error=result.error,
        )
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        log.error("process.fatal", run_id=run_id, error=str(e), latency_ms=latency)
        return ProcessResponse(
            run_id=run_id,
            final_response=None,
            intent=None,
            iterations=0,
            status="error",
            error=str(e),
        )
