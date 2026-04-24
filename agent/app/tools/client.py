"""HTTP client for Next.js REST tools — signs every request with HMAC."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from ..auth import sign_payload
from ..config import get_settings
from ..logging_config import get_logger

log = get_logger("tools.client")


async def _post(
    business_id: str,
    path: str,
    body: dict[str, Any],
    *,
    timeout: float | None = None,
) -> dict[str, Any]:
    """POST helper — signs the request, times it, logs failures."""
    settings = get_settings()
    base = settings.next_public_api_base_url.rstrip("/")
    url = f"{base}{path}"
    raw_body = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
    signature, timestamp = sign_payload(business_id, raw_body)

    headers = {
        "Content-Type": "application/json",
        "x-agent-signature": signature,
        "x-agent-timestamp": timestamp,
        "x-business-id": business_id,
    }

    t0 = time.time()
    async with httpx.AsyncClient(timeout=timeout or settings.agent_request_timeout_s) as client:
        try:
            resp = await client.post(url, content=raw_body.encode("utf-8"), headers=headers)
        except httpx.HTTPError as e:
            latency = int((time.time() - t0) * 1000)
            log.error("tools.http_error", path=path, error=str(e), latency_ms=latency)
            raise ToolError(f"HTTP error calling {path}: {e}") from e

    latency = int((time.time() - t0) * 1000)
    if resp.status_code >= 400:
        try:
            payload = resp.json()
        except Exception:
            payload = {"error": resp.text}
        log.error("tools.bad_response", path=path, status=resp.status_code, payload=payload, latency_ms=latency)
        raise ToolError(payload.get("error") or f"HTTP {resp.status_code}")

    data = resp.json()
    log.info("tools.ok", path=path, latency_ms=latency)
    if not data.get("ok"):
        raise ToolError(data.get("error") or "Unknown tool error")
    return data.get("data", {})


class ToolError(Exception):
    """Raised when the Next.js tool endpoint returns an error.

    The message is surfaced to the LLM so it can retry or adjust. Exception class
    kept simple — the LangGraph executor node catches this.
    """


# ─── Dispatcher used by executor node ────────────────────────────────────────


TOOL_ENDPOINTS: dict[str, str] = {
    # orders
    "orders_create":          "/api/agent/tools/orders",
    "orders_get":             "/api/agent/tools/orders",
    "orders_list_by_client":  "/api/agent/tools/orders",
    "orders_update_status":   "/api/agent/tools/orders",
    "orders_update_items":    "/api/agent/tools/orders",
    "orders_cancel":          "/api/agent/tools/orders",
    "orders_list_recent":     "/api/agent/tools/orders",
    # agenda
    "agenda_list_services":      "/api/agent/tools/agenda",
    "agenda_list_professionals": "/api/agent/tools/agenda",
    "agenda_check_availability": "/api/agent/tools/agenda",
    "agenda_get_next_available": "/api/agent/tools/agenda",
    "agenda_book":               "/api/agent/tools/agenda",
    "agenda_list_by_client":     "/api/agent/tools/agenda",
    "agenda_get":                "/api/agent/tools/agenda",
    "agenda_update":             "/api/agent/tools/agenda",
    "agenda_cancel":             "/api/agent/tools/agenda",
    # catalog
    "catalog_list_menu":      "/api/agent/tools/catalog",
    "catalog_list_categories": "/api/agent/tools/catalog",
    "catalog_search":         "/api/agent/tools/catalog",
    "catalog_get":            "/api/agent/tools/catalog",
    # clients
    "clients_lookup_by_phone": "/api/agent/tools/clients",
    "clients_create":          "/api/agent/tools/clients",
    "clients_get":             "/api/agent/tools/clients",
    "clients_update":          "/api/agent/tools/clients",
    "clients_update_address":  "/api/agent/tools/clients",
    "clients_get_full_history": "/api/agent/tools/clients",
    # business
    "business_get_context": "/api/agent/tools/business",
    # conversation / interactive
    "conversation_send_interactive": "/api/agent/tools/send-interactive",
    # ─── Wave 1: operator-mode tools (dashboard chat) ──────────────────────
    # financial
    "financial_list":               "/api/agent/tools/financial",
    "financial_get":                "/api/agent/tools/financial",
    "financial_create_receivable":  "/api/agent/tools/financial",
    "financial_create_payable":     "/api/agent/tools/financial",
    "financial_mark_paid":          "/api/agent/tools/financial",
    "financial_cancel":             "/api/agent/tools/financial",
    "financial_summary_today":      "/api/agent/tools/financial",
    "financial_summary_month":      "/api/agent/tools/financial",
    # inventory
    "inventory_list":               "/api/agent/tools/inventory",
    "inventory_get":                "/api/agent/tools/inventory",
    "inventory_create":             "/api/agent/tools/inventory",
    "inventory_update":             "/api/agent/tools/inventory",
    "inventory_adjust_stock":       "/api/agent/tools/inventory",
    "inventory_list_low_stock":     "/api/agent/tools/inventory",
    "inventory_set_active":         "/api/agent/tools/inventory",
    "inventory_set_out_of_stock":   "/api/agent/tools/inventory",
    # kanban
    "kanban_list_boards":           "/api/agent/tools/kanban",
    "kanban_get_board":             "/api/agent/tools/kanban",
    "kanban_list_cards":            "/api/agent/tools/kanban",
    "kanban_get_card":              "/api/agent/tools/kanban",
    "kanban_create_card":           "/api/agent/tools/kanban",
    "kanban_move_card":             "/api/agent/tools/kanban",
    "kanban_update_card":           "/api/agent/tools/kanban",
    "kanban_assign":                "/api/agent/tools/kanban",
    "kanban_add_comment":           "/api/agent/tools/kanban",
    "kanban_archive_card":          "/api/agent/tools/kanban",
    # notes
    "notes_list":                   "/api/agent/tools/notes",
    "notes_get":                    "/api/agent/tools/notes",
    "notes_create":                 "/api/agent/tools/notes",
    "notes_update":                 "/api/agent/tools/notes",
    "notes_delete":                 "/api/agent/tools/notes",
    "notes_search":                 "/api/agent/tools/notes",
    # crm
    "crm_list_contacts":            "/api/agent/tools/crm",
    "crm_list_deals":               "/api/agent/tools/crm",
    "crm_get_deal":                 "/api/agent/tools/crm",
    "crm_create_deal":              "/api/agent/tools/crm",
    "crm_update_deal_stage":        "/api/agent/tools/crm",
    "crm_close_deal":               "/api/agent/tools/crm",
    "crm_list_activities":          "/api/agent/tools/crm",
    "crm_log_activity":             "/api/agent/tools/crm",
    "crm_list_segments":            "/api/agent/tools/crm",
    "crm_segment_query":            "/api/agent/tools/crm",
    # conversations admin
    "conversations_list":           "/api/agent/tools/conversations",
    "conversations_get":            "/api/agent/tools/conversations",
    "conversations_list_messages":  "/api/agent/tools/conversations",
    "conversations_set_label":      "/api/agent/tools/conversations",
    "conversations_set_priority":   "/api/agent/tools/conversations",
    "conversations_set_status":     "/api/agent/tools/conversations",
    "conversations_list_snippets":  "/api/agent/tools/conversations",
    "conversations_search_snippets":"/api/agent/tools/conversations",
    # team
    "team_list_sectors":            "/api/agent/tools/team",
    "team_list_members":            "/api/agent/tools/team",
    "team_get_member":              "/api/agent/tools/team",
    "team_capacity_today":          "/api/agent/tools/team",
    # services (admin)
    "services_list":                "/api/agent/tools/services",
    "services_get":                 "/api/agent/tools/services",
    "services_create":              "/api/agent/tools/services",
    "services_update":              "/api/agent/tools/services",
    "services_set_active":          "/api/agent/tools/services",
    # sales
    "sales_list":                   "/api/agent/tools/sales",
    "sales_get":                    "/api/agent/tools/sales",
    "sales_list_by_client":         "/api/agent/tools/sales",
    "sales_create":                 "/api/agent/tools/sales",
    "sales_cancel":                 "/api/agent/tools/sales",
    "sales_summary_today":          "/api/agent/tools/sales",
    # suppliers
    "suppliers_list":               "/api/agent/tools/suppliers",
    "suppliers_get":                "/api/agent/tools/suppliers",
    "suppliers_create":             "/api/agent/tools/suppliers",
    "suppliers_update":             "/api/agent/tools/suppliers",
    "suppliers_find_by_cnpj":       "/api/agent/tools/suppliers",
    # purchase-notes (note: dash in path; tool name uses dash too for consistency)
    "purchase-notes_list":                "/api/agent/tools/purchase-notes",
    "purchase-notes_get":                 "/api/agent/tools/purchase-notes",
    "purchase-notes_match_products":      "/api/agent/tools/purchase-notes",
    "purchase-notes_apply_to_stock":      "/api/agent/tools/purchase-notes",
    "purchase-notes_list_unmatched":      "/api/agent/tools/purchase-notes",
}


def _split_action(tool_name: str) -> tuple[str, str]:
    """`orders_create` -> (`orders`, `create`). Used to build the request body."""
    namespace, _, action = tool_name.partition("_")
    # some tools have multi-word actions, e.g. `list_by_client`
    return namespace, action if "_" not in tool_name.replace(namespace + "_", "", 1) else tool_name[len(namespace) + 1:]


async def call_tool(business_id: str, tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Call a tool by name — returns the `data` field on success, raises ToolError."""
    if tool_name not in TOOL_ENDPOINTS:
        raise ToolError(f"Unknown tool: {tool_name}")
    path = TOOL_ENDPOINTS[tool_name]
    _, action = _split_action(tool_name)
    return await _post(business_id, path, {"action": action, "params": params})


# ─── Outbound messaging (agent -> contact) ───────────────────────────────────


async def send_final_message(
    business_id: str,
    conversation_id: str,
    channel: str,
    recipient_id: str,
    content: str,
) -> dict[str, Any]:
    """Dispatch the agent's final message back to the contact via Next.js `/api/conversations/send`.

    Next.js validates the HMAC headers, then routes through the right channel (WA Cloud, Baileys,
    FB Messenger, IG) based on `conversation.channel` and the business's stored credentials.

    For `channel='web'`, the response is returned directly in the HTTP response from /process,
    so there is no outbound channel to send to — skip silently.
    """
    if channel == "web":
        return {"ok": True, "skipped": "web channel — response returned via HTTP"}

    return await _post(
        business_id,
        "/api/conversations/send",
        {
            "businessId": business_id,
            "conversationId": conversation_id,
            "channel": channel,
            "recipientId": recipient_id,
            "content": content,
            "type": "text",
        },
    )
