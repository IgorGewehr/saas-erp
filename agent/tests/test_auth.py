"""Round-trip HMAC tests — verifies the exact scheme Next.js uses."""

from __future__ import annotations

import hmac
import os
import time
from hashlib import sha256

import pytest


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret-xyz")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:3000")
    # Force reload of settings singleton
    from app.config import get_settings
    get_settings.cache_clear()


def test_sign_matches_reference():
    from app.auth import sign_payload
    business_id = "biz_123"
    raw = '{"action":"ping","params":{}}'
    ts = 1_700_000_000_000
    sig, returned_ts = sign_payload(business_id, raw, timestamp_ms=ts)

    expected = hmac.new(
        b"test-secret-xyz",
        f"{ts}.{business_id}.{raw}".encode(),
        sha256,
    ).hexdigest()

    assert sig == expected
    assert returned_ts == str(ts)


def test_sign_timestamp_default_is_recent():
    from app.auth import sign_payload
    before = int(time.time() * 1000) - 5
    _, ts_str = sign_payload("biz_1", "{}")
    after = int(time.time() * 1000) + 5
    ts = int(ts_str)
    assert before <= ts <= after
