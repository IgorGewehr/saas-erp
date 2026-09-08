"""Pydantic mirror of `lib/contracts/api/agent/memory.ts`.

Covers 4 actions: recall, remember, forget, clear. No nullable/skipped
actions in this domain.

Note: TS types `validUntil` as `z.string().datetime().or(z.string().min(1))`
(a Zod union accepting either a full RFC3339 datetime or any non-empty
string — real data stores plain dates like "2026-12-31"). Python mirrors
this loosely as `Optional[str]` — we validate shape here, not format.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class MemoryFact(_Base):
    id: str
    contactId: str
    text: str
    evidence: Optional[str] = None
    confidence: Optional[float] = None
    validUntil: Optional[str] = None
    tags: Optional[list[str]] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


# ─── Action response shapes ─────────────────────────────────────────────────


class MemoryRecallData(_Base):
    contactId: str
    facts: list[MemoryFact]


# `remember` returns the created fact as-is (MemoryRememberDataSchema =
# FactSchema in TS) — reuse MemoryFact directly, no separate class needed.


class MemoryForgetData(_Base):
    removed: bool


class MemoryClearData(_Base):
    cleared: bool
