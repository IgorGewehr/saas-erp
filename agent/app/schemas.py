"""Request/response contracts shared between Next.js and the agent."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ProcessRequest(BaseModel):
    """Sent by Next.js webhook handler when a new inbound message arrives."""

    message_id: str
    conversation_id: str
    message: str
    contact_name: str
    contact_phone: str | None = None
    channel: Literal["whatsapp", "facebook", "instagram", "web", "dashboard"] = "whatsapp"
    recipient_id: str  # Meta user id or phone for outbound send
    # Prior messages to ground the model (most recent last), optional
    history: list[dict[str, Any]] = Field(default_factory=list)
    # Business-level config — passed by the webhook so we don't re-fetch
    use_case: Literal["pedidos", "servicos", "simples", "operator", "analyst"] = "servicos"
    business_name: str | None = None
    business_description: str | None = None
    tone: Literal["formal", "casual", "friendly"] = "friendly"
    # Per-mode granular settings that influence the prompt
    pedidos_settings: dict[str, Any] | None = None
    agenda_settings: dict[str, Any] | None = None
    # Long-term memory summary of the client (last ~5 interactions, 1 line each)
    client_memory: str | None = None
    # Business operational context passed from Settings
    opening_hours: list[dict[str, Any]] | None = None  # 7 BusinessHoursDay entries (0=Dom..6=Sáb)
    address: dict[str, Any] | None = None              # business.endereco
    services_list: list[dict[str, Any]] | None = None  # active services (agenda mode pre-load)
    current_date: str | None = None  # ISO date YYYY-MM-DD injected by dispatcher
    # Operator context (use_case='operator'/'analyst' only) — populated from UI session
    operator_user_id: str | None = None
    operator_user_name: str | None = None
    operator_user_role: Literal["founder", "admin", "manager", "operator", "viewer"] | None = None
    # Autonomous execution: when true, destructive tools auto-execute without UI confirm.
    # Controlled by business.settings.aiAgent.operator.autonomousMode toggle.
    operator_autonomous: bool = False
    # ─── Wave 7 — policy-aware context (all optional) ────────────────────
    policies: dict[str, Any] | None = None          # {cancellation, refund, privacy}
    sla: dict[str, Any] | None = None               # {prepMaxMinutes, deliveryMaxMinutes, firstResponseMinutes}
    is_closed_today: bool = False                   # holiday or closed day
    seasonal_label: str | None = None               # e.g., "Carnaval 2026"
    delivery_zones: list[dict[str, Any]] | None = None
    accepted_payment_methods: list[str] | None = None
    team_capacity: dict[str, Any] | None = None     # {maxConcurrentOrders, maxDailyAppointments}
    upsell_rules: list[dict[str, Any]] | None = None


class ProcessResponse(BaseModel):
    run_id: str
    final_response: str | None
    intent: str | None
    iterations: int
    status: Literal["success", "error", "skipped"]
    error: str | None = None
