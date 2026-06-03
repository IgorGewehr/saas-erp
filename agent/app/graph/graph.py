"""LangGraph assembly + public `run_agent` entrypoint.

Graph shape (Wave 2 evolution):

      START
        │
        ▼
     router
        │
        ▼
     planner ◄───────────────────────────┐
        │                                │
        ├──(tool calls)──▶ executor ─────┤
        │                    │           │
        │             (operator+writes)  │
        │                    ▼           │
        │                reflection ─────┘
        │
        ├──(customer-mode drafted)─▶ responder ─▶ END
        │
        └──(operator-mode drafted)─▶ skip_responder ─▶ END

Why:
  - reflection fires only for operator-mode destructive ops (verify + escalate)
  - responder is skipped in operator mode (saves one LLM call per turn — the
    operator prompt already enforces the desired format).

Iteration cap is enforced inside `planner_routes_to`.
"""

from __future__ import annotations

import time
import uuid
from typing import Annotated

from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from ..config import get_settings
from ..logging_config import get_logger
from ..observability import build_run_config
from ..schemas import ProcessRequest
from .nodes import (
    executor_node,
    executor_routes_to,
    planner_node,
    planner_routes_to,
    reflection_node,
    responder_node,
    router_node,
    skip_responder_to_end,
)
from .state import AgentRunResult, AgentState

log = get_logger("graph")

# Build once at import time — LangGraph compiles efficiently.
_graph = None


def _build_graph():
    """Compile the graph. Cached at module scope."""
    from typing import TypedDict

    # LangGraph requires the messages reducer; we redeclare the TypedDict with it.
    class _State(TypedDict, total=False):
        run_id: str
        business_id: str
        conversation_id: str
        message_id: str
        use_case: str
        business_context: dict
        contact: dict
        messages: Annotated[list[BaseMessage], add_messages]
        intent: str | None
        iterations: int
        final_response: str | None
        error: str | None
        interactive_sent: bool
        needs_reflection: bool
        reasoning: list[dict]
        node_traces: list[dict]
        tool_calls_log: list[dict]
        total_tokens_in: int
        total_tokens_out: int

    g = StateGraph(_State)
    g.add_node("router", router_node)
    g.add_node("planner", planner_node)
    g.add_node("executor", executor_node)
    g.add_node("reflection", reflection_node)
    g.add_node("responder", responder_node)
    g.add_node("skip_responder", skip_responder_to_end)

    g.add_edge(START, "router")
    g.add_edge("router", "planner")
    g.add_conditional_edges(
        "planner",
        planner_routes_to,
        {
            "executor": "executor",
            "responder": "responder",
            "skip_responder": "skip_responder",
        },
    )
    g.add_conditional_edges(
        "executor",
        executor_routes_to,
        {"reflection": "reflection", "planner": "planner"},
    )
    g.add_edge("reflection", "planner")
    g.add_edge("responder", END)
    g.add_edge("skip_responder", END)

    return g.compile()


def get_graph():
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


# ─── Public API ──────────────────────────────────────────────────────────────


async def run_agent(*, run_id: str, business_id: str, req: ProcessRequest) -> AgentRunResult:
    """Invoke the full LangGraph pipeline for one inbound message.

    Returns an `AgentRunResult` with tracing + the final message to send.
    Never raises: surfaces the error inside the result object.
    """
    settings = get_settings()
    # Model is now enforced server-side (no per-business override) — the operator
    # shouldn't be picking models; we pick the best cost/quality tradeoff.
    model = settings.openai_model_default
    t0 = time.time()

    # Daily budget gate — skip the run if the business already hit its cap
    from ..budget import check_budget
    allowed, usd_today, cap = await check_budget(business_id)
    if not allowed:
        log.warning("budget.exceeded", run_id=run_id, business_id=business_id, usd_today=usd_today, cap=cap)
        return AgentRunResult(
            run_id=run_id,
            business_id=business_id,
            conversation_id=req.conversation_id,
            message_id=req.message_id,
            user_message=req.message,
            final_response=None,
            intent="budget_exceeded",
            iterations=0,
            status="skipped",
            error=f"Daily budget exceeded: ${usd_today:.2f} / ${cap:.2f}",
            total_latency_ms=0,
            model=model,
        )

    # Prepare initial state from the HTTP payload
    initial_messages: list[BaseMessage] = []
    # Append any prior turn context (compact) — the webhook sends the last N
    for item in req.history[-10:]:
        role = item.get("role")
        content = item.get("content", "")
        if role == "user":
            initial_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            from langchain_core.messages import AIMessage
            initial_messages.append(AIMessage(content=content))
    initial_messages.append(HumanMessage(content=req.message))

    state: AgentState = {
        "run_id": run_id,
        "business_id": business_id,
        "conversation_id": req.conversation_id,
        "message_id": req.message_id,
        "use_case": req.use_case,
        "business_context": {
            "name": req.business_name,
            "description": req.business_description,
            "tone": req.tone,
            "model": model,
            # Vertical/segment — drives vocabulary + few-shot selection in prompts.
            "segment": req.segment or "generico",
            "segment_vocab": req.segment_vocab or None,
            # Settings específicas por modo — consumidas pelos prompts
            "pedidos": req.pedidos_settings or {},
            "agenda": req.agenda_settings or {},
            # Long-term memory of this client (past interactions)
            "client_memory": req.client_memory or "",
            # Operational context from Settings (profile / company)
            "opening_hours": req.opening_hours or [],
            "address": req.address or {},
            "services_list": req.services_list or [],
            "current_date": req.current_date or "",
            # Operator/analyst context — populated when running from dashboard.
            "operator": {
                "user_id": req.operator_user_id,
                "user_name": req.operator_user_name,
                "user_role": req.operator_user_role,
                "autonomous": bool(req.operator_autonomous),
            } if req.use_case in ("operator", "analyst") else {},
            # Wave 7 — policy-aware settings
            "policies": req.policies or {},
            "sla": req.sla or {},
            "is_closed_today": bool(req.is_closed_today),
            "seasonal_label": req.seasonal_label,
            "delivery_zones": req.delivery_zones or [],
            "accepted_payment_methods": req.accepted_payment_methods or [],
            "upsell_rules": req.upsell_rules or [],
        },
        "contact": {
            "name": req.contact_name,
            "phone": req.contact_phone,
            "channel": req.channel,
            "recipient_id": req.recipient_id,
        },
        "messages": initial_messages,
        "iterations": 0,
        "needs_reflection": False,
        "reasoning": [],
        "node_traces": [],
        "tool_calls_log": [],
        "total_tokens_in": 0,
        "total_tokens_out": 0,
    }

    graph = get_graph()
    # LangSmith config — every nested run (nodes, LLM calls, tool calls) inherits
    # these tags + metadata. Essential for multi-tenant debugging.
    run_config = build_run_config(
        run_id=run_id,
        business_id=business_id,
        conversation_id=req.conversation_id,
        message_id=req.message_id,
        use_case=req.use_case or "servicos",
        channel=req.channel or "whatsapp",
        model=model,
    )

    try:
        final = await graph.ainvoke(state, run_config)
    except Exception as e:
        latency = int((time.time() - t0) * 1000)
        log.error("graph.invoke_failed", run_id=run_id, error=str(e), latency_ms=latency)
        return AgentRunResult(
            run_id=run_id,
            business_id=business_id,
            conversation_id=req.conversation_id,
            message_id=req.message_id,
            user_message=req.message,
            final_response=None,
            intent=None,
            iterations=0,
            status="error",
            error=str(e),
            total_latency_ms=latency,
            model=model,
        )

    # Post-graph CRM enrichment (fire-and-forget). Tags conversa concluída
    # com tags + aiSummary para alimentar segmentação de campanhas. Best-effort:
    # nunca bloqueia a resposta nem propaga erro. Roda só em runs bem-sucedidos
    # (final_response presente) e em use_cases customer-facing.
    if final.get("final_response") or final.get("interactive_sent"):
        try:
            from .enricher import schedule_enricher
            schedule_enricher(final)  # type: ignore[arg-type]
        except Exception as e:
            log.warning("enricher.schedule_failed", run_id=run_id, error=str(e))

    latency = int((time.time() - t0) * 1000)
    tokens_in = final.get("total_tokens_in", 0)
    tokens_out = final.get("total_tokens_out", 0)
    # Pricing lookup (best-effort)
    from .nodes import PRICING
    cost = 0.0
    if model in PRICING:
        in_p, out_p = PRICING[model]
        cost = round((tokens_in * in_p + tokens_out * out_p) / 1_000_000, 6)

    return AgentRunResult(
        run_id=run_id,
        business_id=business_id,
        conversation_id=req.conversation_id,
        message_id=req.message_id,
        user_message=req.message,
        final_response=final.get("final_response"),
        intent=final.get("intent"),
        iterations=final.get("iterations", 0),
        status="success" if (final.get("final_response") or final.get("interactive_sent")) else "error",
        error=final.get("error"),
        node_traces=final.get("node_traces", []),
        tool_calls=final.get("tool_calls_log", []),
        total_tokens_in=tokens_in,
        total_tokens_out=tokens_out,
        total_latency_ms=latency,
        cost_usd=cost,
        model=model,
    )
