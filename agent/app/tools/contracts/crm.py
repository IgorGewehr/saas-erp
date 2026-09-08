"""Pydantic mirror of `lib/contracts/api/agent/crm.ts`.

Actions covered: list_contacts, search_contacts, list_deals, search_deals,
create_deal, update_deal_stage, close_deal, list_activities, log_activity,
list_segments, segment_query. Skipped: get_deal (nullable — response is
`DealShape.nullable()`, validation is a no-op for that action).

Note on `search_contacts`/`search_deals`: the TS response extends the item
with `_score: z.number()`. A leading-underscore attribute is not a
validatable Pydantic field (v2 treats it as a private attribute placeholder
with no input binding); since `_Base.model_config` already sets
`extra="allow"`, `_score` flows through untyped on the base shapes without
any special-casing needed.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Enums ──────────────────────────────────────────────────────────────────

CRMActivityType = Literal[
    "ligacao", "email", "reuniao", "whatsapp", "tarefa", "nota", "proposta",
]


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class ContactShape(_Base):
    id: str
    businessId: str
    name: str


class DealShape(_Base):
    id: str
    businessId: str
    contactId: str
    contactName: Optional[str] = None
    title: str
    value: float
    stage: str
    probability: Optional[float] = None
    expectedCloseDate: Optional[str] = None
    closedDate: Optional[str] = None
    lostReason: Optional[str] = None
    # FKs de resultado (P2.10) — entidade de receita que concretizou o deal ganho.
    saleId: Optional[str] = None
    appointmentId: Optional[str] = None
    deliveryOrderId: Optional[str] = None


class ActivityShape(_Base):
    id: str
    businessId: str
    type: CRMActivityType
    title: str
    contactId: Optional[str] = None
    dealId: Optional[str] = None


class SegmentShape(_Base):
    id: str
    businessId: str
    name: str


# ─── Action response shapes ─────────────────────────────────────────────────


class CRMListContactsResponse(RootModel[list[ContactShape]]):
    pass


class CRMSearchContactsResponse(RootModel[list[ContactShape]]):
    pass


class CRMListDealsResponse(RootModel[list[DealShape]]):
    pass


class CRMSearchDealsResponse(RootModel[list[DealShape]]):
    pass


class CRMListActivitiesResponse(RootModel[list[ActivityShape]]):
    pass


class CRMListSegmentsResponse(RootModel[list[SegmentShape]]):
    pass


class CRMSegmentQueryData(_Base):
    segment: SegmentShape
    contacts: list[ContactShape]
