"""HMAC signing + verification.

Two directions:
  - OUTBOUND: sign calls the agent makes to Next.js REST tools.
  - INBOUND:  verify the webhook payload Next.js sends to /process.

Both use the same scheme:
    message    = f"{timestamp_ms}.{business_id}.{raw_body}"
    signature  = hex(HMAC-SHA256(AGENT_SHARED_SECRET, message))

Timestamp skew tolerance: ±5 minutes.
"""

from __future__ import annotations

import hmac
import time
from hashlib import sha256

from fastapi import Header, HTTPException, Request

from .config import get_settings

MAX_SKEW_MS = 5 * 60 * 1000


def sign_payload(business_id: str, raw_body: str, timestamp_ms: int | None = None) -> tuple[str, str]:
    """Return (signature_hex, timestamp_ms_str) to send as request headers."""
    secret = get_settings().agent_shared_secret
    ts = timestamp_ms or int(time.time() * 1000)
    message = f"{ts}.{business_id}.{raw_body}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), message, sha256).hexdigest()
    return sig, str(ts)


async def verify_inbound(
    request: Request,
    x_agent_signature: str = Header(...),
    x_agent_timestamp: str = Header(...),
    x_business_id: str = Header(...),
) -> tuple[str, str]:
    """FastAPI dependency — verifies HMAC on incoming requests from Next.js.

    Returns (business_id, raw_body). Raises 401 on failure.
    """
    # Timestamp skew
    try:
        ts = int(x_agent_timestamp)
    except ValueError as e:
        raise HTTPException(status_code=401, detail="Invalid timestamp header") from e
    if abs(int(time.time() * 1000) - ts) > MAX_SKEW_MS:
        raise HTTPException(status_code=401, detail="Timestamp skew exceeds window")

    # Read body once — caller must reuse this rather than await .body() again
    raw_body = (await request.body()).decode("utf-8")
    secret = get_settings().agent_shared_secret
    message = f"{ts}.{x_business_id}.{raw_body}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), message, sha256).hexdigest()

    if not hmac.compare_digest(expected, x_agent_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    return x_business_id, raw_body
