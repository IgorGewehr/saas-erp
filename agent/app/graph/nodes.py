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
from ..observability import redact_if_enabled
from ..tools.client import ToolError, call_tool
from ..tools.registry import get_tool, tools_for_use_case
from ..tools.validator import validate as validate_tool_args
from . import prompts
from .state import AgentState

# LangSmith @traceable decorator — runs are auto-traced when env is set, but
# this gives us explicit control over run_name, metadata and run_type per node.
try:
    from langsmith import traceable  # type: ignore
except Exception:  # pragma: no cover — LangSmith is optional
    def traceable(*dargs, **dkwargs):  # type: ignore[misc]
        def _wrap(fn):
            return fn
        return _wrap if dargs or dkwargs else dargs[0]

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


@traceable(run_type="chain", name="agent.router")
async def router_node(state: AgentState) -> dict[str, Any]:
    settings = get_settings()
    model_name = settings.openai_model_router
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
    valid = {"pedido", "agenda", "confirmacao", "info", "saudacao", "reclamacao", "outro"}
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
            # PII-scrubbed mirror of input — the agent state keeps the real text.
            "input": redact_if_enabled(user_message[:240]),
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


#  Max messages to forward to the planner. Older turns are dropped while keeping
# the first two (initial human/contact context) and respecting the OpenAI rule
# that every AIMessage with tool_calls must be followed by its ToolMessage(s).
_MESSAGE_WINDOW = 20
_HEAD_KEEP = 2


def _window_messages(messages: list[Any]) -> list[Any]:
    """Return a compacted message list within the planner token budget.

    Strategy:
      1. If short enough, return as-is.
      2. Otherwise keep the first `_HEAD_KEEP` messages (original human input,
         initial context) and the tail that fits the window.
      3. When the tail starts mid tool_call→tool_result pair, walk forward
         until we land on a message that is not a lone ToolMessage with no
         preceding AIMessage in scope — prevents OpenAI validation errors.
    """
    if len(messages) <= _MESSAGE_WINDOW:
        return messages

    head = messages[:_HEAD_KEEP]
    tail_size = _MESSAGE_WINDOW - _HEAD_KEEP
    tail = messages[-tail_size:]

    # If the tail begins with a ToolMessage orphaned from its AIMessage, drop it.
    # We walk forward until we find a HumanMessage / SystemMessage / AIMessage.
    from langchain_core.messages import ToolMessage as _TM  # local import avoids top-level reorder
    while tail and isinstance(tail[0], _TM):
        tail = tail[1:]

    return head + tail


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


@traceable(run_type="chain", name="agent.planner")
async def planner_node(state: AgentState) -> dict[str, Any]:
    settings = get_settings()
    use_case = state.get("use_case") or "servicos"
    business_ctx = state.get("business_context") or {}
    model = business_ctx.get("model") or settings.openai_model_default

    # Escalate to full model for complex multi-step flows (> 3 iterations)
    if state.get("iterations", 0) > 3:
        model = settings.openai_model_fallback

    tools = tools_for_use_case(use_case)  # filtered by mode
    llm = _planner_llm(model, tools)

    system = prompts.planner_system_for(use_case, business_ctx)
    # Inject contact & channel context so the LLM can plan address/phone flows
    contact = state.get("contact") or {}
    system += (
        f"\n\nDADOS DO CONTATO: nome='{contact.get('name','?')}', "
        f"telefone='{contact.get('phone','?')}', canal='{contact.get('channel','?')}', "
        f"conversation_id='{state.get('conversation_id','?')}'."
        "\nAo criar pedidos use canal e conversation_id acima como channel e conversationId."
    )

    conv_messages = _window_messages(state.get("messages") or [])
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
            # PII-scrubbed trace. Tool args may contain client phone/address/CPF.
            "output": redact_if_enabled(
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


@traceable(run_type="chain", name="agent.executor")
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

        # Pre-flight schema validation. When the LLM emits malformed args we
        # short-circuit here and return a structured error the planner can see
        # in its next turn — saves a network round-trip + prevents garbage
        # hitting the backend.
        schema = get_tool(name)
        if schema is None:
            err = f"Unknown tool: {name}"
            log.warning("node.executor.unknown_tool", tool=name)
            return (
                ToolMessage(content=json.dumps({"error": err}), tool_call_id=call_id, name=name),
                {
                    "name": name,
                    "arguments": args,
                    "error": err,
                    "latencyMs": 0,
                    "startedAt": started,
                },
            )
        schema_errors = validate_tool_args(schema["function"]["parameters"], args)
        if schema_errors:
            err = "Invalid arguments: " + "; ".join(schema_errors[:5])
            log.warning("node.executor.schema_invalid", tool=name, errors=schema_errors)
            return (
                ToolMessage(
                    content=json.dumps({"error": err, "validation": schema_errors}),
                    tool_call_id=call_id,
                    name=name,
                ),
                {
                    "name": name,
                    "arguments": args,
                    "error": err,
                    "validation": schema_errors,
                    "latencyMs": 0,
                    "startedAt": started,
                },
            )

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

    # If any tool call was a successful interactive send, suppress the responder
    interactive_sent = any(
        e["name"] == "conversation_send_interactive" and "error" not in e
        for e in log_entries
    )

    # Detect mutations for operator-mode reflection: any tool name that creates,
    # updates or deletes something is considered destructive. Read-only tools
    # (list/get/search/recall/summary) are excluded so customer-facing flows and
    # cheap operator queries stay fast.
    destructive_entries = [e for e in log_entries if _is_destructive_tool(e.get("name", ""))]
    needs_reflection = len(destructive_entries) > 0 and state.get("use_case") == "operator"

    log.info(
        "node.executor",
        run_id=state.get("run_id"),
        count=len(results),
        destructive=len(destructive_entries),
        latency_ms=trace_latency,
    )

    update: dict[str, Any] = {
        "messages": new_messages,
        "tool_calls_log": (state.get("tool_calls_log") or []) + log_entries,
        "node_traces": _push_trace(state, {
            "node": "executor",
            "output": [e["name"] for e in log_entries],
            "destructive": [e["name"] for e in destructive_entries],
            "latencyMs": trace_latency,
            "startedAt": _now_iso(),
        }),
    }
    if interactive_sent:
        update["interactive_sent"] = True
    if needs_reflection:
        update["needs_reflection"] = True
    return update


# Destructive tool prefixes/suffixes — used by reflection gating in executor.
# Keep this list tight; false-positives add latency without safety benefit.
_DESTRUCTIVE_PREFIXES = (
    "orders_create", "orders_cancel", "orders_update_items", "orders_update_status",
    "agenda_book", "agenda_update", "agenda_cancel",
    "clients_create", "clients_update", "clients_update_address",
    "inventory_create", "inventory_update", "inventory_adjust_stock",
    "inventory_set_active", "inventory_set_out_of_stock",
    "kanban_create_card", "kanban_move_card", "kanban_update_card",
    "kanban_assign", "kanban_add_comment", "kanban_archive_card",
    "notes_create", "notes_update", "notes_delete",
    "crm_create_deal", "crm_update_deal_stage", "crm_close_deal", "crm_log_activity",
    "conversations_set_label", "conversations_set_priority", "conversations_set_status",
    "services_create", "services_update", "services_set_active",
    "sales_create", "sales_cancel",
    "suppliers_create", "suppliers_update",
    "purchase-notes_apply_to_stock",
    "financial_create_receivable", "financial_create_payable",
    "financial_mark_paid", "financial_cancel",
    "memory_remember", "memory_forget",
)


def _is_destructive_tool(name: str) -> bool:
    return any(name.startswith(p) for p in _DESTRUCTIVE_PREFIXES)


# ─── 4. Responder — polish the final answer ─────────────────────────────────


@traceable(run_type="chain", name="agent.responder")
async def responder_node(state: AgentState) -> dict[str, Any]:
    """Take the last planner AIMessage and rewrite for the customer in the business tone."""
    # If an interactive message was already sent to the client, skip the text response
    if state.get("interactive_sent"):
        log.info("node.responder.skip_interactive", run_id=state.get("run_id"))
        return {"final_response": None}

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
            "input": redact_if_enabled(draft[:300]),
            "output": redact_if_enabled(final[:300]),
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": latency,
            "startedAt": _now_iso(),
        }),
    }


# ─── 5. Reflection — self-check after destructive operator actions ──────────


@traceable(run_type="chain", name="agent.reflection")
async def reflection_node(state: AgentState) -> dict[str, Any]:
    """Verifies that destructive tools succeeded and cross-checks the result.

    Only invoked when:
      - use_case == 'operator' (dashboard chat)
      - executor flagged `needs_reflection` (at least one write tool fired)

    The reflector receives the tool outputs + the user's original request and
    produces a structured verdict: {"ok": bool, "summary": str, "warnings": [...]}.
    On errors it appends a note to the planner's message chain so the next
    planner turn can surface the issue to the operator honestly.

    Zero-shot is fine here — the task is constrained.
    """
    settings = get_settings()
    business_ctx = state.get("business_context") or {}
    model = business_ctx.get("model") or settings.openai_model_default

    # Harvest the last-executor tool results (most recent)
    tool_log = state.get("tool_calls_log") or []
    # Only look at the last batch — find the destructive subset
    dest = [t for t in tool_log[-8:] if _is_destructive_tool(t.get("name", ""))]
    if not dest:
        return {"needs_reflection": False}

    log.info("node.reflection.start", run_id=state.get("run_id"), count=len(dest))

    llm = ChatOpenAI(
        model=model,
        api_key=settings.openai_api_key,
        temperature=0.0,
        max_tokens=250,
    )

    # Harvest the last user turn for context
    msgs = state.get("messages") or []
    last_user = ""
    for m in reversed(msgs):
        if isinstance(m, HumanMessage):
            last_user = m.content if isinstance(m.content, str) else str(m.content)
            break

    import json as _json
    tool_summary = _json.dumps(
        [
            {"name": t.get("name"), "args": t.get("arguments"), "result": t.get("result"), "error": t.get("error")}
            for t in dest
        ],
        ensure_ascii=False,
        default=str,
    )[:3500]

    system = (
        "Você é um verificador de ações. Recebe o pedido do operador + ações destrutivas "
        "executadas. Responda SOMENTE em JSON válido:\n"
        '{"ok": bool, "summary": "frase em pt-BR do que aconteceu", "warnings": ["...","..."]}\n\n'
        "Considere 'ok=false' quando: qualquer tool retornou error, "
        "criação/alteração foi parcial, ou o resultado contradiz o pedido original."
    )

    human = f"PEDIDO DO OPERADOR:\n{last_user[:400]}\n\nAÇÕES EXECUTADAS:\n{tool_summary}"

    t0 = time.time()
    try:
        result = await _invoke_with_retry(
            llm,
            [SystemMessage(content=system), HumanMessage(content=human)],
        )
    except Exception as err:
        log.warning("node.reflection.error", error=str(err))
        return {"needs_reflection": False}

    latency = int((time.time() - t0) * 1000)

    raw = result.content if isinstance(result.content, str) else str(result.content)
    verdict: dict[str, Any] = {"ok": True, "summary": "", "warnings": []}
    try:
        # Strip markdown if present
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1] if "\n" in clean else clean
            if clean.endswith("```"):
                clean = clean.rsplit("```", 1)[0]
            if clean.startswith("json"):
                clean = clean[4:].strip()
        verdict = _json.loads(clean)
    except Exception:
        log.warning("node.reflection.parse_failed", raw=raw[:100])

    usage = getattr(result, "response_metadata", {}).get("token_usage", {}) or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)

    new_messages: list[Any] = []
    reasoning_entry = {
        "node": "reflection",
        "thought": verdict.get("summary", ""),
        "ok": bool(verdict.get("ok", True)),
        "warnings": list(verdict.get("warnings", []))[:5],
        "at": _now_iso(),
    }

    # If verdict flags a problem, inject a SystemMessage into the planner chain
    # so the next planner turn picks up the issue and escalates honestly.
    if not verdict.get("ok", True):
        issue = verdict.get("summary") or "Verificação detectou problema na última ação."
        warns = "; ".join(verdict.get("warnings", []) or [])
        note = f"[reflection] {issue}"
        if warns:
            note += f" | Avisos: {warns}"
        new_messages.append(SystemMessage(content=note))
        log.warning("node.reflection.flagged", run_id=state.get("run_id"), issue=issue)

    log.info("node.reflection.done", run_id=state.get("run_id"), ok=verdict.get("ok"), latency_ms=latency)

    return {
        "messages": new_messages,
        "needs_reflection": False,  # clear the flag
        "total_tokens_in": state.get("total_tokens_in", 0) + tokens_in,
        "total_tokens_out": state.get("total_tokens_out", 0) + tokens_out,
        "reasoning": (state.get("reasoning") or []) + [reasoning_entry],
        "node_traces": _push_trace(state, {
            "node": "reflection",
            "output": redact_if_enabled(verdict),
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": latency,
            "startedAt": _now_iso(),
        }),
    }


# ─── Routing predicates ──────────────────────────────────────────────────────


def planner_routes_to(state: AgentState) -> str:
    """Decide: executor (tool calls present), reflection (operator mutations)
    or responder (draft ready).
    """
    max_iter = get_settings().agent_max_iterations
    if state.get("iterations", 0) >= max_iter:
        log.warning("loop.max_iter", run_id=state.get("run_id"))
        # For operator mode, skip responder polish (planner draft is direct).
        return "skip_responder" if state.get("use_case") == "operator" else "responder"
    msgs = state.get("messages") or []
    last = msgs[-1] if msgs else None
    if last and getattr(last, "tool_calls", None):
        return "executor"
    # Operator mode: planner output IS the final response. Saves a polish LLM call.
    if state.get("use_case") == "operator":
        return "skip_responder"
    return "responder"


def executor_routes_to(state: AgentState) -> str:
    """After executor: either reflect (operator + destructive ops) or back to planner."""
    if state.get("needs_reflection") and state.get("use_case") == "operator":
        return "reflection"
    return "planner"


def skip_responder_to_end(state: AgentState) -> dict[str, Any]:
    """For operator mode — promote the planner draft to final_response without
    a separate polish LLM call. Saves ~1s + 200 tokens per operator turn.
    """
    msgs = state.get("messages") or []
    draft: str | None = None
    for m in reversed(msgs):
        if isinstance(m, AIMessage) and not getattr(m, "tool_calls", None):
            draft = m.content if isinstance(m.content, str) else str(m.content)
            break
    if not draft:
        draft = "Não consegui processar o comando. Tenta reformular?"

    log.info("node.skip_responder", run_id=state.get("run_id"), length=len(draft))

    return {
        "final_response": draft.strip(),
        "node_traces": _push_trace(state, {
            "node": "skip_responder",
            "output": redact_if_enabled(draft[:300]),
            "latencyMs": 0,
            "startedAt": _now_iso(),
        }),
    }
