"""Pydantic mirror of `lib/contracts/api/agent/services.ts`.

Covers 6 of 7 actions: list, search, create, update, set_active,
import_grade. `get` returns `ServiceShape.nullable()` in TS — nullable
response, skipped here (validation falls through to None per registry
convention).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class WeeklySession(_Base):
    weekday: int
    startTime: str
    duration: Optional[int] = None
    capacity: Optional[int] = None
    professionalId: Optional[str] = None
    professionalName: Optional[str] = None


class ServiceShape(_Base):
    id: str
    businessId: str
    userId: Optional[str] = None
    userName: Optional[str] = None
    name: str
    description: Optional[str] = None
    duration: int
    price: float
    category: Optional[str] = None
    color: Optional[str] = None
    commissionRate: Optional[float] = None
    lc116Code: Optional[str] = None
    codigoMunicipal: Optional[str] = None
    nbs: Optional[str] = None
    aliquotaISS: Optional[float] = None
    capacity: Optional[int] = None
    sessions: Optional[list[WeeklySession]] = None
    isActive: bool


class ServicesImportGradeItem(_Base):
    name: str
    sessionCount: int
    action: Literal["create", "update", "skip"]
    matchedServiceId: Optional[str] = None


# ─── Action response shapes ─────────────────────────────────────────────────


class ServicesListResponse(RootModel[list[ServiceShape]]):
    pass


# `search` = z.array(ServiceShape.extend({ _score: z.number() })) in TS.
# `_score` is a leading-underscore key — Pydantic v2 treats a same-named
# annotation as a private attribute rather than a model field, so it is
# intentionally left unmodeled here and passed through verbatim via
# `extra="allow"` (aliasing it to a valid identifier would round-trip back
# out as that alias on `model_dump()`, silently renaming the key — see
# `validate_response_data()` in __init__.py, which dumps without
# `by_alias=True`).
class ServicesSearchResult(ServiceShape):
    pass


class ServicesSearchResponse(RootModel[list[ServicesSearchResult]]):
    pass


class ServicesImportGradeData(_Base):
    applied: bool
    created: int
    updated: int
    items: list[ServicesImportGradeItem]
