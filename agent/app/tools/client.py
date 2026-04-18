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
    """
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
