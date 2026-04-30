"""Observability helpers — LangSmith metadata + PII redaction.

Every LangGraph run must be tagged with the tenant scope so we can:
  1. Filter traces per business in the LangSmith UI.
  2. Alert on error/latency regressions per-tenant.
  3. Attribute token cost per tenant for billing.

PII redaction is applied to payloads before they leave the process (LangSmith
uploads), not to the operational state itself — the agent still sees real
phone/address/CPF so it can function.
"""

from __future__ import annotations

import re
from typing import Any

from importlib.metadata import version as _pkg_version, PackageNotFoundError as _PNF

from .config import Settings, get_settings, langsmith_project_name

try:
    _AGENT_VERSION = _pkg_version("servicepro-agent")
except _PNF:
    _AGENT_VERSION = "dev"


# ─── LangSmith metadata builders ─────────────────────────────────────────────

def build_run_config(
    *,
    run_id: str,
    business_id: str,
    conversation_id: str,
    message_id: str | None,
    use_case: str,
    channel: str,
    model: str,
    intent: str | None = None,
    tenant_tier: str | None = None,
    extra_tags: list[str] | None = None,
) -> dict[str, Any]:
    """Build the LangSmith config dict passed to `graph.ainvoke(state, config)`.

    Results in every nested run (nodes, LLM calls, tool calls) inheriting:
      - Metadata: structured filters in LangSmith UI ({"business_id": ...}).
      - Tags: flat strings for quick filtering ("channel:whatsapp", "use_case:pedidos").
      - run_name: top-level group label.

    The runtime `configurable.thread_id` = conversation_id is what will wire the
    future checkpointer (Wave 3) to resume per-conversation state.
    """
    s = get_settings()
    env = (s.app_env or "development").lower()

    metadata: dict[str, Any] = {
        "business_id": business_id,
        "conversation_id": conversation_id,
        "use_case": use_case,
        "channel": channel,
        "env": env,
        "model_default": model,
        "agent_version": _AGENT_VERSION,
    }
    if message_id:
        metadata["message_id"] = message_id
    if intent:
        metadata["intent"] = intent
    if tenant_tier:
        metadata["tenant_tier"] = tenant_tier
    if run_id:
        metadata["run_id"] = run_id

    tags: list[str] = [
        f"business:{business_id}",
        f"channel:{channel}",
        f"use_case:{use_case}",
        f"env:{env}",
    ]
    if tenant_tier:
        tags.append(f"tier:{tenant_tier}")
    if intent:
        tags.append(f"intent:{intent}")
    if extra_tags:
        tags.extend(extra_tags)

    return {
        "recursion_limit": 32,
        "run_name": f"agent.{use_case}.{channel}",
        "tags": tags,
        "metadata": metadata,
        "configurable": {
            "thread_id": conversation_id,
            "business_id": business_id,
        },
    }


# ─── PII redaction (applied to LangSmith trace payloads) ─────────────────────

# Brazilian doc patterns (with or without punctuation). Order matters — CNPJ
# is 14 digits so it must be tried before CPF (11 digits) to avoid partial
# matches.
_PII_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Credit card — 13-19 digits with optional spaces/dashes
    (re.compile(r"\b(?:\d[ -]*?){13,19}\b"), "[CARD]"),
    # CNPJ — 14 digits with/without formatting: 11.222.333/0001-44
    (re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b"), "[CNPJ]"),
    # CPF — 11 digits: 123.456.789-00
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "[CPF]"),
    # RG — 7-10 digits with optional dot/dash (SP format): 12.345.678-9
    (re.compile(r"\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b"), "[RG]"),
    # CEP — 8 digits: 01310-100
    (re.compile(r"\b\d{5}-?\d{3}\b"), "[CEP]"),
    # Email
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "[EMAIL]"),
    # Brazilian phone — +55 (47) 99999-8888 or 5547999998888 (10-13 digits)
    (re.compile(r"(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}"), "[PHONE]"),
    # Bearer / API tokens (at least 20 chars of allowed set)
    (re.compile(r"\b(?:Bearer\s+)?[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"), "[TOKEN]"),
    # PIX key (UUID format — often copy/pasted)
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"), "[PIX_KEY]"),
]

# Keys whose values should always be scrubbed regardless of content (privacy
# posture — simpler to nuke the key than risk a missed regex).
_SENSITIVE_KEYS = {
    "cpf", "cnpj", "cpfCnpj", "rg", "inscricaoEstadual", "inscricaoMunicipal",
    "cep", "email", "phone", "whatsapp", "phone2", "telefone",
    "cardNumber", "cardCvv", "cardExpiry", "cardHolderName",
    "accessKey", "certificate", "certificatePassword", "certificateContent",
    "apiKey", "keyHash", "keyPrefix", "password", "passwordHash",
    "pixKey", "bankAccount", "bankAccountNumber", "agency",
    "oauth_token", "refresh_token", "id_token", "idToken",
    "clientSecret", "secretKey", "webhookSecret",
}


def redact_pii_text(value: str) -> str:
    """Scrub known PII patterns out of a string."""
    out = value
    for pat, tag in _PII_PATTERNS:
        out = pat.sub(tag, out)
    return out


def redact_pii(data: Any, *, max_depth: int = 6) -> Any:
    """Recursively redact PII from arbitrary JSON-like structures.

    Rules:
      - Strings go through regex scrubber.
      - Dict keys in `_SENSITIVE_KEYS` have values replaced with a type tag.
      - Depth cap prevents blow-up on malformed inputs.
    """
    if max_depth <= 0:
        return data
    if isinstance(data, str):
        return redact_pii_text(data)
    if isinstance(data, dict):
        out: dict[Any, Any] = {}
        for k, v in data.items():
            if isinstance(k, str) and k in _SENSITIVE_KEYS:
                # Preserve shape info without leaking value
                if isinstance(v, str):
                    out[k] = f"[redacted:{k}:{len(v)}c]"
                else:
                    out[k] = f"[redacted:{k}]"
            else:
                out[k] = redact_pii(v, max_depth=max_depth - 1)
        return out
    if isinstance(data, list):
        return [redact_pii(v, max_depth=max_depth - 1) for v in data]
    return data


def redact_if_enabled(data: Any, settings: Settings | None = None) -> Any:
    """Apply redaction only when REDACT_PII_IN_TRACES is on. Pass-through otherwise."""
    s = settings or get_settings()
    if not s.redact_pii_in_traces:
        return data
    return redact_pii(data)


# ─── LangSmith init ──────────────────────────────────────────────────────────

def enable_langsmith_if_configured(settings: Settings | None = None) -> bool:
    """Enable LangSmith globally when an API key is present.

    Presence of LANGCHAIN_API_KEY auto-enables tracing even if
    LANGCHAIN_TRACING_V2 is unset — matches user expectation when they just
    drop the key into .env.

    Returns True if LangSmith is active after this call.
    """
    import os

    s = settings or get_settings()
    enabled = bool(s.langchain_tracing_v2) or bool(s.langchain_api_key)
    if not enabled:
        return False

    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    if s.langchain_api_key:
        os.environ["LANGCHAIN_API_KEY"] = s.langchain_api_key
    os.environ["LANGCHAIN_PROJECT"] = langsmith_project_name(s)
    # Reduce payload size — we only upload what we need, PII-scrubbed when enabled.
    os.environ.setdefault("LANGCHAIN_HIDE_INPUTS", "false")
    os.environ.setdefault("LANGCHAIN_HIDE_OUTPUTS", "false")
    return True
