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
    "agenda_list_today":         "/api/agent/tools/agenda",
    "agenda_list_upcoming":      "/api/agent/tools/agenda",
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
    "inventory_search":             "/api/agent/tools/inventory",
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
    "kanban_search_cards":          "/api/agent/tools/kanban",
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
    "crm_search_contacts":          "/api/agent/tools/crm",
    "crm_list_deals":               "/api/agent/tools/crm",
    "crm_search_deals":             "/api/agent/tools/crm",
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
    "services_search":              "/api/agent/tools/services",
    "services_get":                 "/api/agent/tools/services",
    "services_create":              "/api/agent/tools/services",
    "services_update":              "/api/agent/tools/services",
    "services_set_active":          "/api/agent/tools/services",
    "services_import_grade":        "/api/agent/tools/services",
    # sales
    "sales_list":                   "/api/agent/tools/sales",
    "sales_get":                    "/api/agent/tools/sales",
    "sales_list_by_client":         "/api/agent/tools/sales",
    "sales_create":                 "/api/agent/tools/sales",
    "sales_cancel":                 "/api/agent/tools/sales",
    "sales_summary_today":          "/api/agent/tools/sales",
    # suppliers
    "suppliers_list":               "/api/agent/tools/suppliers",
    "suppliers_search":             "/api/agent/tools/suppliers",
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
    # fiscal (NF-e / NFC-e / NFSe) — read-first + cancel (manager+)
    "fiscal_list":          "/api/agent/tools/fiscal",
    "fiscal_get":           "/api/agent/tools/fiscal",
    "fiscal_query_status":  "/api/agent/tools/fiscal",
    "fiscal_emit":          "/api/agent/tools/fiscal",
    "fiscal_cancel":        "/api/agent/tools/fiscal",
    # reports (BI / read-only) — agregação cross-coleção do ReportsModule
    "reports_revenue_by_period":             "/api/agent/tools/reports",
    "reports_sales_by_product":              "/api/agent/tools/reports",
    "reports_appointments_by_professional":  "/api/agent/tools/reports",
    "reports_top_clients":                   "/api/agent/tools/reports",
    # ─── Wave 3: RAG + Memory ────────────────────────────────────────────
    "knowledge_search":                   "/api/agent/tools/knowledge",
    "memory_recall":                      "/api/agent/tools/memory",
    "memory_remember":                    "/api/agent/tools/memory",
    "memory_forget":                      "/api/agent/tools/memory",
}


def _split_action(tool_name: str) -> tuple[str, str]:
    """`orders_create` -> (`orders`, `create`). Used to build the request body."""
    namespace, _, action = tool_name.partition("_")
    # some tools have multi-word actions, e.g. `list_by_client`
    return namespace, action if "_" not in tool_name.replace(namespace + "_", "", 1) else tool_name[len(namespace) + 1:]


async def call_tool(business_id: str, tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Call a tool by name — returns the `data` field on success, raises ToolError.

    SDD Fase 1: after receiving `data`, validate against the registered Pydantic
    model (see `agent/app/tools/contracts/`). Validation failure becomes a
    structured ToolError so the planner LLM sees a clean signal instead of
    crashing downstream on malformed data.
    """
    if tool_name not in TOOL_ENDPOINTS:
        raise ToolError(f"Unknown tool: {tool_name}")
    path = TOOL_ENDPOINTS[tool_name]
    _, action = _split_action(tool_name)
    data = await _post(business_id, path, {"action": action, "params": params})

    # Response validation — opt-in per tool (registry returns None for unported tools)
    try:
        from .contracts import validate_response_data  # local import: avoid cycle

        return validate_response_data(tool_name, data)
    except ToolError:
        raise
    except Exception as exc:  # pydantic.ValidationError or anything unexpected
        log.error("tools.response_validation_failed", tool=tool_name, error=str(exc), data_preview=str(data)[:500])
        raise ToolError(f"Response shape inválida em {tool_name}: {exc}") from exc


# ─── Outbound messaging (agent -> contact) ───────────────────────────────────

# Humanized chunking parameters. Empirically tuned:
#   - 1000 chars per bubble reads cleanly on mobile (hard cap is ~1600).
#   - 400-900ms pause feels human — typing at ~80wpm averages there.
#   - Max 3 chunks — beyond that it looks spammy; a better option is asking
#     the user for confirmation to continue.
_CHUNK_MAX_CHARS = 1000
_CHUNK_MAX_COUNT = 3
_CHUNK_PAUSE_MIN_MS = 400
_CHUNK_PAUSE_MAX_MS = 900


def _split_for_humanization(text: str) -> list[str]:
    """Split a long agent reply into 1-3 chunks at natural boundaries.

    Priority of boundaries (preserved in output):
      1. Double newline (paragraph)
      2. Single newline
      3. Sentence end: ". " / "! " / "? "
      4. Fallback: hard-wrap at the character limit.

    Short messages (< _CHUNK_MAX_CHARS) are returned as a single element.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= _CHUNK_MAX_CHARS:
        return [text]

    # First pass — split by paragraphs
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 2 <= _CHUNK_MAX_CHARS:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
                buf = ""
            # If the paragraph itself is too large, split by sentence
            if len(p) > _CHUNK_MAX_CHARS:
                chunks.extend(_split_by_sentence(p))
            else:
                buf = p
    if buf:
        chunks.append(buf)

    # Clamp to max count — combine overflow into the last chunk
    if len(chunks) > _CHUNK_MAX_COUNT:
        head = chunks[: _CHUNK_MAX_COUNT - 1]
        tail = "\n\n".join(chunks[_CHUNK_MAX_COUNT - 1 :])
        # If tail is still too long, hard-truncate with a graceful suffix
        if len(tail) > _CHUNK_MAX_CHARS:
            tail = tail[: _CHUNK_MAX_CHARS - 3].rstrip() + "..."
        chunks = head + [tail]

    return chunks


def _split_by_sentence(paragraph: str) -> list[str]:
    """Split a single oversized paragraph by sentence boundary. Best-effort."""
    import re

    parts = re.split(r"(?<=[.!?])\s+", paragraph)
    chunks: list[str] = []
    buf = ""
    for s in parts:
        if len(buf) + len(s) + 1 <= _CHUNK_MAX_CHARS:
            buf = f"{buf} {s}" if buf else s
        else:
            if buf:
                chunks.append(buf)
            if len(s) > _CHUNK_MAX_CHARS:
                # Last resort — hard wrap
                for i in range(0, len(s), _CHUNK_MAX_CHARS):
                    chunks.append(s[i : i + _CHUNK_MAX_CHARS])
                buf = ""
            else:
                buf = s
    if buf:
        chunks.append(buf)
    return chunks


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

    For `channel='web'` or `channel='dashboard'`, the response is returned directly in
    the HTTP response from /process — no outbound channel, skip silently.

    HUMANIZATION: long replies are split into 2-3 bubbles with 400-900ms pauses
    between them — mimics a human typing pace. WhatsApp pricing counts bubbles
    inside the same 24h session as free, so this doesn't cost extra.
    """
    if channel in ("web", "dashboard"):
        return {"ok": True, "skipped": f"{channel} channel — response returned via HTTP"}

    chunks = _split_for_humanization(content)
    if not chunks:
        return {"ok": True, "skipped": "empty content"}

    # Single chunk — no humanization delay needed
    if len(chunks) == 1:
        return await _post(
            business_id,
            "/api/conversations/send",
            {
                "businessId": business_id,
                "conversationId": conversation_id,
                "channel": channel,
                "recipientId": recipient_id,
                "content": chunks[0],
                "type": "text",
            },
        )

    # Multi-chunk — send sequentially with random human-like pauses
    import asyncio
    import random

    log.info("humanize.chunked", count=len(chunks), lengths=[len(c) for c in chunks])
    last_result: dict[str, Any] = {}
    for i, chunk in enumerate(chunks):
        last_result = await _post(
            business_id,
            "/api/conversations/send",
            {
                "businessId": business_id,
                "conversationId": conversation_id,
                "channel": channel,
                "recipientId": recipient_id,
                "content": chunk,
                "type": "text",
            },
        )
        # Pause between chunks (not after the last one)
        if i < len(chunks) - 1:
            await asyncio.sleep(
                random.uniform(_CHUNK_PAUSE_MIN_MS, _CHUNK_PAUSE_MAX_MS) / 1000.0
            )

    return last_result
