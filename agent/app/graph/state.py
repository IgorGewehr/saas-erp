"""Shared state & trace types used across LangGraph nodes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from langchain_core.messages import BaseMessage


class AgentState(TypedDict, total=False):
    """The graph's running state. Flows through every node.

    All keys are optional (total=False) because nodes produce partial updates
    that LangGraph merges into the parent state.
    """

    # --- Identity / context ---
    run_id: str
    business_id: str
    conversation_id: str
    message_id: str
    use_case: Literal["pedidos", "servicos", "simples", "operator", "analyst"]
    business_context: dict[str, Any]
    contact: dict[str, Any]  # {name, phone, channel, recipient_id}

    # --- Conversation ---
    messages: list[BaseMessage]

    # --- Control flow ---
    intent: str | None
    iterations: int
    final_response: str | None
    error: str | None
    interactive_sent: bool  # set by executor when conversation_send_interactive succeeds

    # --- Chain-of-thought scratchpad (operator mode only) ---
    # Each entry = {"node": "planner|reflection", "thought": "...", "at": iso}
    # Not sent back to the user; persisted in agentRuns.nodes for debugging +
    # future LangSmith replay. Keeps reasoning explicit + auditable.
    reasoning: list[dict[str, Any]]

    # --- Reflection triggers ---
    # Set by executor when any destructive (write/mutation) tool is called.
    # reflection_node fires only when True AND use_case='operator'. Lets us
    # keep customer-facing latency low (no reflection for pedidos/agenda).
    needs_reflection: bool

    # --- Observability (appended throughout) ---
    node_traces: list[dict[str, Any]]
    tool_calls_log: list[dict[str, Any]]
    total_tokens_in: int
    total_tokens_out: int


@dataclass
class AgentRunResult:
    """Returned by the top-level runner — packed for API response + persistence."""

    run_id: str
    business_id: str
    conversation_id: str
    message_id: str
    user_message: str
    final_response: str | None
    intent: str | None
    iterations: int
    status: Literal["success", "error", "skipped"]
    error: str | None
    node_traces: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    total_tokens_in: int = 0
    total_tokens_out: int = 0
    total_latency_ms: int = 0
    cost_usd: float = 0.0
    model: str = ""

    def to_log(self) -> dict[str, Any]:
        """Serialize for POST to /api/agent/runs."""
        return {
            "id": self.run_id,
            "businessId": self.business_id,
            "conversationId": self.conversation_id,
            "messageId": self.message_id,
            "userMessage": self.user_message,
            "status": self.status,
            "finalResponse": self.final_response,
            "intent": self.intent,
            "nodes": self.node_traces,
            "tools": self.tool_calls,
            "iterations": self.iterations,
            "totalLatencyMs": self.total_latency_ms,
            "totalTokensIn": self.total_tokens_in,
            "totalTokensOut": self.total_tokens_out,
            "costUsd": self.cost_usd,
            "model": self.model,
            "errorMessage": self.error,
            "createdAt": None,  # server sets
            "completedAt": None,
        }
