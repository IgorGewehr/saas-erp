"""Pydantic mirror of `lib/contracts/api/agent/business.ts`.

Covers 1 action: get_context. No nullable/skipped actions in this domain.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class SegmentVocab(_Base):
    cliente: str
    servico: str
    profissional: str
    agendar: str


class OpeningHourEntry(_Base):
    isOpen: bool
    openTime: Optional[str] = None
    closeTime: Optional[str] = None


BusinessSegment = Literal["academia", "salao", "clinica", "consultoria", "generico"]


# ─── Action response shapes ─────────────────────────────────────────────────


class BusinessGetContextData(_Base):
    id: str
    name: str
    useCase: Optional[str] = None
    description: Optional[str] = None
    tone: Optional[str] = None
    segment: Optional[BusinessSegment] = None
    segmentVocab: Optional[SegmentVocab] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    openingHours: Optional[list[OpeningHourEntry]] = None
    isOpenNow: Optional[bool] = None
    delivery: Optional[dict[str, Any]] = None
    promotions: Optional[list[dict[str, Any]]] = None
