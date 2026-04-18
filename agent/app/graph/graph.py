"""LangGraph assembly + public `run_agent` entrypoint.

Graph shape:

      START
        │
        ▼
     router
        │
        ▼
     planner ◄──────────┐
        │               │
        ├──(tool calls)─▶ executor ─┘
        │
        └──(no tools)──▶ responder ─▶ END

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
from ..schemas import ProcessRequest
from .nodes import executor_node, planner_node, planner_routes_to, responder_node, router_node
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
        node_traces: list[dict]
        tool_calls_log: list[dict]
        total_tokens_in: int
        total_tokens_out: int

    g = StateGraph(_State)
    g.add_node("router", router_node)
    g.add_node("planner", planner_node)
    g.add_node("executor", executor_node)
    g.add_node("responder", responder_node)

    g.add_edge(START, "router")
    g.add_edge("router", "planner")
    g.add_conditional_edges("planner", planner_routes_to, {"executor": "executor", "responder": "responder"})
    g.add_edge("executor", "planner")
    g.add_edge("responder", END)

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
            # Settings específicas por modo — consumidas pelos prompts
            "pedidos": req.pedidos_settings or {},
            "agenda": req.agenda_settings or {},
        },
        "contact": {
            "name": req.contact_name,
            "phone": req.contact_phone,
            "channel": req.channel,
            "recipient_id": req.recipient_id,
        },
        "messages": initial_messages,
        "iterations": 0,
        "node_traces": [],
        "tool_calls_log": [],
        "total_tokens_in": 0,
        "total_tokens_out": 0,
    }

    graph = get_graph()
    try:
        final = await graph.ainvoke(state, {"recursion_limit": 32})
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
        status="success" if final.get("final_response") else "error",
        error=final.get("error"),
        node_traces=final.get("node_traces", []),
        tool_calls=final.get("tool_calls_log", []),
        total_tokens_in=tokens_in,
        total_tokens_out=tokens_out,
        total_latency_ms=latency,
        cost_usd=cost,
        model=model,
    )
