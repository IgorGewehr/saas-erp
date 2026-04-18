"""LangGraph node implementations.

Each node:
  - Receives `AgentState` (partial).
  - Returns a dict with only the keys it updates (LangGraph merges the rest).
  - Appends a trace entry so the debug UI can replay the run.

Nodes:
  - router       — classifies intent (quick GPT call, no tools)
  - planner      — main LLM with tools bound; decides next action or final draft
  - executor     — runs tool_calls in parallel, produces ToolMessages
  - responder    — polish pass: takes planner's work + tool outputs → final message

Edges (built in graph.py) form a loop planner ↔ executor, terminating into responder.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI

from ..config import get_settings
from ..logging_config import get_logger
from ..tools.client import ToolError, call_tool
from ..tools.registry import tools_for_use_case
from . import prompts
from .state import AgentState

log = get_logger("nodes")

# Token cost lookup (USD per 1M tokens) for popular models — used for the audit log only.
PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o":         (2.50, 10.00),
    "gpt-4o-mini":    (0.15,  0.60),
    "gpt-4-turbo":    (10.00, 30.00),
}


def _now_iso() -> str:
    # ISO-8601 without microseconds for compact logs
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _push_trace(state: AgentState, trace: dict[str, Any]) -> list[dict[str, Any]]:
    existing = state.get("node_traces") or []
    return existing + [trace]


def _push_tool_log(state: AgentState, entry: dict[str, Any]) -> list[dict[str, Any]]:
    existing = state.get("tool_calls_log") or []
    return existing + [entry]


def _cost_for(model: str, in_tokens: int, out_tokens: int) -> float:
    if model not in PRICING:
        return 0.0
    in_price, out_price = PRICING[model]
    return round((in_tokens * in_price + out_tokens * out_price) / 1_000_000, 6)


# ─── 1. Router — intent classification ───────────────────────────────────────


async def router_node(state: AgentState) -> dict[str, Any]:
    settings = get_settings()
    model_name = "gpt-4o-mini"  # router is always cheap
    llm = ChatOpenAI(
        model=model_name,
        api_key=settings.openai_api_key,
        temperature=0.0,
        max_tokens=15,
    )
    user_message = ""
    for m in reversed(state.get("messages", [])):
        if isinstance(m, HumanMessage):
            user_message = m.content if isinstance(m.content, str) else str(m.content)
            break

    t0 = time.time()
    result = await _invoke_with_retry(llm, [
        SystemMessage(content=prompts.ROUTER_SYSTEM),
        HumanMessage(content=user_message),
    ])
    latency = int((time.time() - t0) * 1000)

    raw = (result.content or "").strip().lower() if isinstance(result.content, str) else ""
    # Normalize — accept the first token that matches a known label
    valid = {"pedido", "agenda", "info", "saudacao", "reclamacao", "outro"}
    intent = next((w for w in raw.split() if w in valid), "outro")

    usage = getattr(result, "response_metadata", {}).get("token_usage", {}) or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)

    log.info("node.router", run_id=state.get("run_id"), intent=intent, latency_ms=latency)

    return {
        "intent": intent,
        "total_tokens_in": state.get("total_tokens_in", 0) + tokens_in,
        "total_tokens_out": state.get("total_tokens_out", 0) + tokens_out,
        "node_traces": _push_trace(state, {
            "node": "router",
            "input": user_message[:240],
            "output": intent,
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": latency,
            "startedAt": _now_iso(),
        }),
    }


# ─── 2. Planner — LLM with tools; loops with executor ───────────────────────


def _planner_llm(model: str, tools: list[dict[str, Any]]) -> ChatOpenAI:
    settings = get_settings()
    llm = ChatOpenAI(
        model=model,
        api_key=settings.openai_api_key,
        temperature=0.2,
        max_tokens=800,
    )
    # LangChain binds tool schemas so the LLM emits structured tool_calls
    return llm.bind_tools(tools) if tools else llm  # type: ignore[return-value]


async def _invoke_with_retry(llm: Any, messages: list[Any], max_attempts: int = 3) -> Any:
    """Wrap an LLM invoke with exponential backoff for transient errors.

    OpenAI rate limits + network hiccups are retried; schema/auth errors are NOT.
    """
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return await llm.ainvoke(messages)
        except Exception as err:  # noqa: BLE001 — we look at the message
            last_err = err
            msg = str(err).lower()
            retryable = any(k in msg for k in ["rate limit", "timeout", "timed out", "connection", "server error", "503", "502", "500"])
            if not retryable or attempt == max_attempts - 1:
                raise
            backoff = 0.5 * (2 ** attempt)  # 0.5s, 1s, 2s
            log.warning("llm.retry", attempt=attempt + 1, backoff_s=backoff, error=str(err)[:120])
            await asyncio.sleep(backoff)
    # Unreachable, but makes type checkers happy
    raise last_err or RuntimeError("LLM invoke failed")


async def planner_node(state: AgentState) -> dict[str, Any]:
    settings = get_settings()
    use_case = state.get("use_case") or "servicos"
    business_ctx = state.get("business_context") or {}
    model = business_ctx.get("model") or settings.openai_model_default

    tools = tools_for_use_case(use_case)  # filtered by mode
    llm = _planner_llm(model, tools)

    system = prompts.planner_system_for(use_case, business_ctx)
    # Inject contact & channel context so the LLM can plan address/phone flows
    contact = state.get("contact") or {}
    system += f"\n\nDADOS DO CONTATO: nome='{contact.get('name','?')}', telefone='{contact.get('phone','?')}', canal='{contact.get('channel','?')}'."

    conv_messages = state.get("messages") or []
    t0 = time.time()
    ai_msg = await _invoke_with_retry(llm, [SystemMessage(content=system), *conv_messages])
    latency = int((time.time() - t0) * 1000)

    usage = getattr(ai_msg, "response_metadata", {}).get("token_usage", {}) or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)

    has_tools = bool(getattr(ai_msg, "tool_calls", None))
    log.info(
        "node.planner",
        run_id=state.get("run_id"),
        tool_calls=len(getattr(ai_msg, "tool_calls", None) or []),
        latency_ms=latency,
    )

    return {
        "messages": [ai_msg],  # LangGraph's add_messages reducer appends
        "iterations": state.get("iterations", 0) + 1,
        "total_tokens_in": state.get("total_tokens_in", 0) + tokens_in,
        "total_tokens_out": state.get("total_tokens_out", 0) + tokens_out,
        "node_traces": _push_trace(state, {
            "node": "planner",
            "output": (
                [{"name": tc["name"], "args": tc.get("args")} for tc in (ai_msg.tool_calls or [])]
                if has_tools
                else (ai_msg.content if isinstance(ai_msg.content, str) else str(ai_msg.content))[:300]
            ),
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": latency,
            "startedAt": _now_iso(),
        }),
    }


# ─── 3. Executor — run tool_calls in parallel ────────────────────────────────


async def executor_node(state: AgentState) -> dict[str, Any]:
    business_id = state["business_id"]
    # Last message is the AIMessage with tool_calls
    msgs = state.get("messages") or []
    last = msgs[-1] if msgs else None
    tool_calls = getattr(last, "tool_calls", None) or []

    async def _run_one(tc: dict[str, Any]) -> tuple[ToolMessage, dict[str, Any]]:
        name = tc["name"]
        args = tc.get("args") or {}
        call_id = tc.get("id") or f"tool_{int(time.time()*1000)}"
        started = _now_iso()
        t0 = time.time()
        try:
            result = await call_tool(business_id, name, args)
            latency = int((time.time() - t0) * 1000)
            log_entry = {
                "name": name,
                "arguments": args,
                "result": result,
                "latencyMs": latency,
                "startedAt": started,
            }
            return (
                ToolMessage(content=json.dumps(result, ensure_ascii=False), tool_call_id=call_id, name=name),
                log_entry,
            )
        except ToolError as e:
            latency = int((time.time() - t0) * 1000)
            err = str(e)
            log_entry = {
                "name": name,
                "arguments": args,
                "error": err,
                "latencyMs": latency,
                "startedAt": started,
            }
            log.warning("node.executor.tool_error", tool=name, error=err)
            return (
                ToolMessage(content=json.dumps({"error": err}), tool_call_id=call_id, name=name),
                log_entry,
            )

    results = await asyncio.gather(*[_run_one(tc) for tc in tool_calls])

    new_messages = [tm for tm, _ in results]
    log_entries = [entry for _, entry in results]
    trace_latency = sum(e["latencyMs"] for e in log_entries)

    log.info("node.executor", run_id=state.get("run_id"), count=len(results), latency_ms=trace_latency)

    return {
        "messages": new_messages,
        "tool_calls_log": (state.get("tool_calls_log") or []) + log_entries,
        "node_traces": _push_trace(state, {
            "node": "executor",
            "output": [e["name"] for e in log_entries],
            "latencyMs": trace_latency,
            "startedAt": _now_iso(),
        }),
    }


# ─── 4. Responder — polish the final answer ─────────────────────────────────


async def responder_node(state: AgentState) -> dict[str, Any]:
    """Take the last planner AIMessage and rewrite for the customer in the business tone."""
    settings = get_settings()
    msgs = state.get("messages") or []
    # Find the last AIMessage without tool_calls — that's the draft
    draft: str | None = None
    for m in reversed(msgs):
        if isinstance(m, AIMessage) and not getattr(m, "tool_calls", None):
            draft = m.content if isinstance(m.content, str) else str(m.content)
            break

    if not draft:
        # Shouldn't normally happen; gracefully fall back
        draft = "Estou com dificuldade para processar. Pode tentar de novo?"

    business_ctx = state.get("business_context") or {}
    model = business_ctx.get("model") or settings.openai_model_default
    llm = ChatOpenAI(
        model=model,
        api_key=settings.openai_api_key,
        temperature=0.4,
        max_tokens=300,
    )

    t0 = time.time()
    result = await _invoke_with_retry(llm, [
        SystemMessage(content=prompts.responder_system(business_ctx)),
        HumanMessage(content=(
            "Rascunho que o sistema gerou (pode conter informações técnicas ou linguagem robótica):\n\n"
            f"{draft}\n\n"
            "Reescreva como mensagem direta para o cliente seguindo as regras."
        )),
    ])
    latency = int((time.time() - t0) * 1000)

    usage = getattr(result, "response_metadata", {}).get("token_usage", {}) or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)
    final = result.content if isinstance(result.content, str) else str(result.content)

    log.info("node.responder", run_id=state.get("run_id"), latency_ms=latency)

    return {
        "final_response": final.strip(),
        "total_tokens_in": state.get("total_tokens_in", 0) + tokens_in,
        "total_tokens_out": state.get("total_tokens_out", 0) + tokens_out,
        "node_traces": _push_trace(state, {
            "node": "responder",
            "input": draft[:300],
            "output": final[:300],
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": latency,
            "startedAt": _now_iso(),
        }),
    }


# ─── Routing predicates ──────────────────────────────────────────────────────


def planner_routes_to(state: AgentState) -> str:
    """Decide: executor (tool calls present) or responder (draft ready)."""
    max_iter = get_settings().agent_max_iterations
    if state.get("iterations", 0) >= max_iter:
        log.warning("loop.max_iter", run_id=state.get("run_id"))
        return "responder"
    msgs = state.get("messages") or []
    last = msgs[-1] if msgs else None
    if last and getattr(last, "tool_calls", None):
        return "executor"
    return "responder"
