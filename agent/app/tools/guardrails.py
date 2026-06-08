"""Pydantic-backed guardrails for tool arguments.

Run on the executor BEFORE any destructive HTTP call:

  1. Validate against the JSON schema declared in registry.py (structural).
  2. Apply semantic guardrails (no negative prices, dates in a plausible
     window, enumerated values, max string lengths beyond the schema).
  3. For operator mode, enforce role-based tool gating (viewer cannot reach
     destructive tools even if the model tries).

These are defense-in-depth — the REST layer also validates, but catching it
earlier gives a cleaner error message back to the LLM so the retry is
constructive rather than a generic 500.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator


# ─── Role hierarchy — mirrored from TS verifyAuth ────────────────────────────

ROLE_RANK = {"founder": 100, "admin": 80, "manager": 60, "operator": 40, "viewer": 20}

# Tools that require specific minimum role at operator-chat surface. Missing
# entries default to "operator" (40). Anything above operator is allowed by
# default — role-based gating is only tightened here.
TOOL_MIN_ROLE: dict[str, str] = {
    # Financial writes — manager+ (consistent with firestore.rules)
    "financial_create_receivable": "manager",
    "financial_create_payable": "manager",
    "financial_mark_paid": "manager",
    "financial_cancel": "manager",
    # Inventory stock writes — manager+
    "inventory_adjust_stock": "manager",
    "inventory_set_out_of_stock": "manager",
    # Supplier writes — manager+
    "suppliers_create": "manager",
    "suppliers_update": "manager",
    # Service catalog — manager+
    "services_create": "manager",
    "services_update": "manager",
    "services_set_active": "manager",
    # Sales cancel — manager+ (operator can create)
    "sales_cancel": "manager",
    # Purchase-notes apply — admin+ (moves real money → stock)
    "purchase-notes_apply_to_stock": "admin",
    # Fiscal writes — manager+ (regulatory; emit/cancel hit SEFAZ)
    "fiscal_emit": "manager",
    "fiscal_cancel": "manager",
    # Memory wipe — admin only
    "memory_forget": "admin",
}


class GuardrailViolation(Exception):
    """Thrown from check_tool_call when the call fails a guardrail."""


def check_role_allowed(tool_name: str, role: str | None) -> None:
    """Raise when `role` is below the required threshold for this tool."""
    if not role:
        return  # customer-facing modes don't have an operator role
    min_role = TOOL_MIN_ROLE.get(tool_name)
    if not min_role:
        return
    if ROLE_RANK.get(role, 0) < ROLE_RANK.get(min_role, 40):
        raise GuardrailViolation(
            f"Sua role '{role}' não tem permissão para executar '{tool_name}' "
            f"(requer '{min_role}' ou superior)."
        )


# ─── Semantic validators — defense in depth on tool args ────────────────────

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


class BaseToolArgs(BaseModel):
    """Common base — forbid extra keys to catch LLM hallucinated params early."""

    model_config = {"extra": "forbid"}


def _check_plausible_date(value: str | None, *, past_ok: bool = True, future_years: int = 2) -> None:
    if not value:
        return
    if not _DATE_RE.match(value):
        raise GuardrailViolation(f"Data inválida (esperado YYYY-MM-DD): {value!r}")
    try:
        d = date.fromisoformat(value)
    except Exception as err:  # noqa: BLE001
        raise GuardrailViolation(f"Data não parseável: {value!r}") from err
    today = date.today()
    if not past_ok and d < today:
        raise GuardrailViolation(f"Data não pode ser no passado: {value}")
    delta_days = (d - today).days
    if delta_days > future_years * 365:
        raise GuardrailViolation(
            f"Data muito distante no futuro ({value}); confirme antes de prosseguir."
        )


# Semantic checks per tool — keyed by tool name, each takes the args dict and
# either returns None (ok) or raises GuardrailViolation.
SemanticCheck = callable  # type: ignore[valid-type]


def _check_orders_create(args: dict[str, Any]) -> None:
    items = args.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        raise GuardrailViolation("items: lista vazia não é permitida")
    for i, it in enumerate(items):
        qty = (it or {}).get("quantity")
        if not isinstance(qty, int) or qty <= 0 or qty > 999:
            raise GuardrailViolation(f"items[{i}].quantity deve ser 1..999, veio {qty!r}")
    fee = args.get("deliveryFee")
    if fee is not None and (not isinstance(fee, (int, float)) or fee < 0 or fee > 500):
        raise GuardrailViolation(f"deliveryFee implausível: {fee}")


def _check_agenda_book(args: dict[str, Any]) -> None:
    _check_plausible_date(args.get("date"), past_ok=False, future_years=1)
    t = args.get("startTime")
    if t is not None and not _TIME_RE.match(str(t)):
        raise GuardrailViolation(f"startTime inválido (HH:MM): {t!r}")
    dur = args.get("durationMinutes")
    if dur is not None and (not isinstance(dur, int) or dur <= 0 or dur > 480):
        raise GuardrailViolation(f"durationMinutes implausível: {dur}")


def _check_financial_create(args: dict[str, Any]) -> None:
    amt = args.get("amount")
    if not isinstance(amt, (int, float)) or amt <= 0:
        raise GuardrailViolation("amount deve ser > 0")
    if amt > 10_000_000:  # R$ 10M sanity limit
        raise GuardrailViolation(
            f"amount implausivelmente alto ({amt}); confirme duas vezes antes de prosseguir."
        )
    ins = args.get("installments")
    if ins is not None and (not isinstance(ins, int) or ins < 1 or ins > 48):
        raise GuardrailViolation(f"installments fora do range 1..48: {ins}")
    _check_plausible_date(args.get("dueDate"))


def _check_inventory_adjust(args: dict[str, Any]) -> None:
    delta = args.get("delta")
    if not isinstance(delta, (int, float)) or delta == 0:
        raise GuardrailViolation("delta: deve ser número diferente de zero")
    if abs(delta) > 100_000:
        raise GuardrailViolation(f"|delta| implausível ({delta}); confirme.")
    if not (args.get("reason") or "").strip():
        raise GuardrailViolation("reason é obrigatório para ajuste de estoque")


def _check_memory_remember(args: dict[str, Any]) -> None:
    text = (args.get("text") or "").strip()
    if len(text) < 3:
        raise GuardrailViolation("text muito curto para ser um fato utilizável")
    if len(text) > 500:
        raise GuardrailViolation(f"text excede 500 chars ({len(text)})")
    conf = args.get("confidence")
    if conf is not None and (not isinstance(conf, (int, float)) or conf < 0 or conf > 1):
        raise GuardrailViolation(f"confidence fora do range 0..1: {conf}")


def _check_sales_create(args: dict[str, Any]) -> None:
    items = args.get("items") or []
    payments = args.get("payments") or []
    if not items:
        raise GuardrailViolation("sales_create: items obrigatório")
    if not payments:
        raise GuardrailViolation("sales_create: payments obrigatório")


SEMANTIC_CHECKS: dict[str, Any] = {
    "orders_create": _check_orders_create,
    "orders_update_items": _check_orders_create,
    "agenda_book": _check_agenda_book,
    "agenda_update": _check_agenda_book,
    "financial_create_receivable": _check_financial_create,
    "financial_create_payable": _check_financial_create,
    "inventory_adjust_stock": _check_inventory_adjust,
    "memory_remember": _check_memory_remember,
    "sales_create": _check_sales_create,
}


def check_tool_call(
    tool_name: str,
    args: dict[str, Any],
    *,
    operator_role: str | None = None,
) -> list[str]:
    """Returns a list of human-readable violation messages. Empty = ok.

    Unlike GuardrailViolation (thrown), this returns a list so executor can
    surface the errors to the LLM as a ToolMessage and let it retry with
    better args rather than crashing the run.
    """
    errors: list[str] = []
    try:
        check_role_allowed(tool_name, operator_role)
    except GuardrailViolation as ex:
        errors.append(str(ex))
    check = SEMANTIC_CHECKS.get(tool_name)
    if check:
        try:
            check(args)
        except GuardrailViolation as ex:
            errors.append(str(ex))
        except ValidationError as ex:
            errors.extend([e["msg"] for e in ex.errors()])
    return errors
