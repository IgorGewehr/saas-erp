"""AgentRun persistence — best-effort POST to /api/agent/runs in Next.js."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from ..auth import sign_payload
from ..config import get_settings
from ..logging_config import get_logger

log = get_logger("store.runs")


async def persist_run(business_id: str, payload: dict[str, Any]) -> None:
    """Fire-and-forget-ish — we await but catch all errors."""
    settings = get_settings()
    base = settings.next_public_api_base_url.rstrip("/")
    url = f"{base}/api/agent/runs"

    # Stamp completion time on server — Next.js also backfills createdAt
    payload["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    body = {"action": "log", "params": payload}
    raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
    sig, ts = sign_payload(business_id, raw)

    headers = {
        "Content-Type": "application/json",
        "x-agent-signature": sig,
        "x-agent-timestamp": ts,
        "x-business-id": business_id,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(url, content=raw.encode("utf-8"), headers=headers)
            if resp.status_code >= 400:
                log.warning("store.persist_failed", status=resp.status_code, body=resp.text[:200])
        except httpx.HTTPError as e:
            log.warning("store.persist_http_error", error=str(e))
