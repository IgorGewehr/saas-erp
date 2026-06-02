"""Async post-conversation enricher — populates client tags + aiSummary in CRM.

Runs fire-and-forget AFTER the main graph completes. Never raises: silent
failure is the contract — enrichment is best-effort and must never affect
the user-facing turn (already delivered by the time we run).

Flow:
  1. Resolve client_id via clients_lookup_by_phone (skip if no phone).
  2. Build a compact transcript from state.messages.
  3. One LLM call (cheap model, JSON output) → {tags, aiSummary}.
  4. Call clients_update with the patch (whitelist already covers tags +
     aiSummary in app/api/agent/tools/clients/route.ts:116-121).

Config:
  ENRICHER_ENABLED env var (default true) lets ops kill it without redeploy.
  Uses openai_model_router (nano) — single short call, low budget impact.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI

from ..config import get_settings
from ..logging_config import get_logger
from ..observability import build_enricher_config
from ..tools.client import ToolError, call_tool
from . import prompts
from .state import AgentState

log = get_logger("enricher")

# Hard cap on transcript characters fed to the LLM. The nano model has plenty
# of context; this is to bound cost on monster sessions.
_TRANSCRIPT_MAX_CHARS = 6_000
_LLM_TIMEOUT_S = 15.0


def _is_enabled() -> bool:
    val = os.getenv("ENRICHER_ENABLED", "true").strip().lower()
    return val not in ("false", "0", "no", "off")


def _build_transcript(state: AgentState) -> str:
    """Compact `[role]: text` lines from the run's messages, newest last.

    Skips ToolMessages and AIMessages with tool_calls — those are internal
    machinery, not what the contact saw.
    """
    lines: list[str] = []
    for m in state.get("messages", []) or []:
        if isinstance(m, HumanMessage):
            content = m.content if isinstance(m.content, str) else str(m.content)
            lines.append(f"[cliente]: {content.strip()}")
        elif isinstance(m, AIMessage):
            if getattr(m, "tool_calls", None):
                continue
            content = m.content if isinstance(m.content, str) else str(m.content)
            if content.strip():
                lines.append(f"[atendente]: {content.strip()}")
    transcript = "\n".join(lines)
    if len(transcript) > _TRANSCRIPT_MAX_CHARS:
        transcript = transcript[-_TRANSCRIPT_MAX_CHARS:]
    return transcript


def _coerce_payload(raw: str) -> dict[str, Any] | None:
    """Parse the LLM's JSON output. Tolerates ```json fences just in case.

    Returns None on any parse error — caller treats that as "skip update".
    """
    if not raw:
        return None
    text = raw.strip()
    # Strip code fences if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _normalize_tags(value: Any) -> list[str]:
    """Tags must be list[str]. Trim, lower, dedupe, cap at 5 (matches prompt)."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for t in value:
        if not isinstance(t, str):
            continue
        cleaned = t.strip().lower()
        # Tag shape sanity — alphanum + underscore, no spaces or punctuation.
        # If model returned "muito caro" we keep it as-is (whitespace-stripped),
        # but we drop tags that are pure noise.
        if not cleaned or len(cleaned) > 50:
            continue
        if cleaned in seen:
            continue
        seen.add(cleaned)
        out.append(cleaned)
        if len(out) >= 5:
            break
    return out


def _normalize_summary(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    s = value.strip()
    if len(s) > 200:
        s = s[:200].rstrip()
    return s


async def _resolve_client_id(business_id: str, phone: str | None) -> str | None:
    """Look up the client in the CRM by phone. Returns None on miss/error."""
    if not phone:
        return None
    try:
        result = await call_tool(business_id, "clients_lookup_by_phone", {"phone": phone})
    except ToolError as e:
        log.info("enricher.lookup_failed", error=str(e))
        return None
    except Exception as e:  # network/timeout — bail silently
        log.warning("enricher.lookup_unexpected", error=str(e))
        return None
    if not isinstance(result, dict) or not result.get("id"):
        return None
    return str(result["id"])


async def _generate_patch(
    transcript: str, trace_config: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Single LLM call. Returns {tags, aiSummary} or None on failure.

    `trace_config` taggeia esta chamada no LangSmith com metadata do tenant
    (o enricher roda fora da árvore do run principal).
    """
    if not transcript.strip():
        return None
    settings = get_settings()
    llm = ChatOpenAI(
        model=settings.openai_model_router,  # nano — cheapest tier
        api_key=settings.openai_api_key,
        temperature=0.0,
        max_tokens=400,
        timeout=_LLM_TIMEOUT_S,
    )
    try:
        response = await llm.ainvoke([
            ("system", prompts.ENRICHER_SYSTEM),
            ("user", f"<conversa>\n{transcript}\n</conversa>\n\nProduza o JSON conforme as regras."),
        ], config=trace_config)
    except Exception as e:
        log.warning("enricher.llm_failed", error=str(e))
        return None

    raw = response.content if isinstance(response.content, str) else str(response.content)
    parsed = _coerce_payload(raw)
    if parsed is None:
        log.info("enricher.parse_failed", raw_preview=raw[:200] if raw else "")
        return None

    tags = _normalize_tags(parsed.get("tags"))
    summary = _normalize_summary(parsed.get("aiSummary"))

    # Skip update entirely if nothing actionable came back. Saves a Firestore
    # write and an audit log entry per empty conversation.
    if not tags and not summary:
        return None

    patch: dict[str, Any] = {}
    if tags:
        patch["tags"] = tags
    if summary:
        patch["aiSummary"] = summary
    return patch


async def run_enricher(state: AgentState) -> None:
    """Main entrypoint. Best-effort, never raises.

    Called fire-and-forget from `run_agent` after graph.ainvoke completes.
    """
    if not _is_enabled():
        return
    business_id = state.get("business_id")
    if not business_id:
        return

    contact = state.get("contact") or {}
    # Skip when there's no contact-side phone — typically dashboard/operator
    # use_cases where there's no real CRM contact behind the chat.
    use_case = state.get("use_case") or ""
    if use_case in ("operator", "analyst"):
        return

    phone = contact.get("phone")
    if not phone:
        return

    try:
        client_id = await _resolve_client_id(business_id, phone)
        if not client_id:
            log.info("enricher.no_client", business_id=business_id)
            return

        transcript = _build_transcript(state)
        if not transcript:
            return

        patch = await _generate_patch(transcript, build_enricher_config(state))
        if not patch:
            return

        await call_tool(business_id, "clients_update", {"id": client_id, "patch": patch})
        log.info(
            "enricher.applied",
            business_id=business_id,
            client_id=client_id,
            tag_count=len(patch.get("tags", [])),
            has_summary=bool(patch.get("aiSummary")),
        )
    except Exception as e:
        # Top-level safety net. The contract is "never raise" — the user's
        # response was already sent by the time this runs.
        log.warning("enricher.failed", error=str(e), business_id=business_id)


def schedule_enricher(state: AgentState) -> None:
    """Fire-and-forget scheduler. Safe to call from sync or async context.

    Caller does not await. We intentionally drop the task reference: the
    asyncio loop owns it until completion. Errors are caught inside
    run_enricher itself.
    """
    if not _is_enabled():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No loop — likely a test or sync caller. Skip silently rather than
        # spinning a new loop, which would block.
        return
    loop.create_task(run_enricher(state))
