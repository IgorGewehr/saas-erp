"""HMAC signing + verification.

Two directions:
  - OUTBOUND: sign calls the agent makes to Next.js REST tools.
  - INBOUND:  verify the webhook payload Next.js sends to /process.

Both use the same scheme:
    message    = f"{timestamp_ms}.{business_id}.{raw_body}"
    signature  = hex(HMAC-SHA256(AGENT_SHARED_SECRET, message))

Timestamp skew tolerance: ±5 minutes.

Replay protection: once a signature verifies, its hash is recorded in an
in-memory TTL cache. A second request carrying the same signature inside the
window is rejected (409). The cache is per-process — for multi-worker
deployments, each worker maintains its own cache; captured-and-replayed
traffic landing on the same worker is caught, while cross-worker replays
are bounded by the ±5min window.
"""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
from hashlib import sha256

from fastapi import Header, HTTPException, Request

from .config import get_settings

MAX_SKEW_MS = 5 * 60 * 1000
# Slightly longer than MAX_SKEW_MS so edge-of-window retries still hit the cache.
NONCE_TTL_MS = MAX_SKEW_MS + 60 * 1000
# Cap the cache to keep memory bounded under pathological traffic.
NONCE_MAX_ENTRIES = 10_000


class _NonceCache:
    """Thread-safe TTL cache for seen HMAC signatures."""

    def __init__(self) -> None:
        self._store: dict[str, int] = {}
        self._lock = threading.Lock()

    def claim(self, key: str, now_ms: int) -> bool:
        """Return True if the key was fresh (and is now claimed); False on replay."""
        with self._lock:
            existing = self._store.get(key)
            if existing is not None and existing > now_ms:
                return False
            self._store[key] = now_ms + NONCE_TTL_MS
            if len(self._store) > NONCE_MAX_ENTRIES:
                self._evict(now_ms)
            return True

    def _evict(self, now_ms: int) -> None:
        # Drop expired entries first; if still over, drop the oldest ~20%.
        fresh = {k: v for k, v in self._store.items() if v > now_ms}
        if len(fresh) > NONCE_MAX_ENTRIES:
            sorted_items = sorted(fresh.items(), key=lambda kv: kv[1])
            drop = max(1, len(sorted_items) // 5)
            for k, _ in sorted_items[:drop]:
                fresh.pop(k, None)
        self._store = fresh


_nonce_cache = _NonceCache()


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

    Returns (business_id, raw_body). Raises 401 on failure or 409 on replay.
    """
    # Timestamp skew
    try:
        ts = int(x_agent_timestamp)
    except ValueError as e:
        raise HTTPException(status_code=401, detail="Invalid timestamp header") from e
    now_ms = int(time.time() * 1000)
    if abs(now_ms - ts) > MAX_SKEW_MS:
        raise HTTPException(status_code=401, detail="Timestamp skew exceeds window")

    # Read body once — caller must reuse this rather than await .body() again
    raw_body = (await request.body()).decode("utf-8")
    secret = get_settings().agent_shared_secret
    message = f"{ts}.{x_business_id}.{raw_body}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), message, sha256).hexdigest()

    if not hmac.compare_digest(expected, x_agent_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Replay protection — record the signature's digest, reject duplicates.
    nonce_key = hashlib.sha256(x_agent_signature.encode("utf-8")).hexdigest()
    if not _nonce_cache.claim(nonce_key, now_ms):
        raise HTTPException(status_code=409, detail="Replay detected (nonce reuse)")

    return x_business_id, raw_body
