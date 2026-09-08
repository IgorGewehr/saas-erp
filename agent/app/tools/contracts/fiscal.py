"""Pydantic mirror of `lib/contracts/api/agent/fiscal.ts`.

Covers 3 of 5 actions: list, emit, cancel. `get` returns
`FiscalDocumentShortSchema.nullable()` and `query_status` returns an object
schema wrapped in `.nullable()` — both are single record-or-null responses →
not modeled here, validation is skipped for those actions.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, RootModel


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


FiscalDocType = Literal["nfe", "nfce", "nfse"]


class FiscalDocumentShort(_Base):
    id: str
    businessId: str
    type: FiscalDocType
    number: Optional[Union[float, str]] = None
    series: Optional[Union[float, str]] = None
    status: str
    statusMessage: Optional[str] = None
    accessKey: Optional[str] = None
    protocol: Optional[str] = None
    clientName: Optional[str] = None
    clientCpfCnpj: Optional[str] = None
    totalValue: Optional[float] = None
    issueDate: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


# ─── Action response shapes ─────────────────────────────────────────────────


class FiscalListResponse(RootModel[list[FiscalDocumentShort]]):
    pass


class FiscalEmitData(_Base):
    success: bool
    documentId: Optional[str] = None
    status: Optional[str] = None
    accessKey: Optional[str] = None
    protocol: Optional[str] = None
    message: Optional[str] = None


class FiscalCancelData(_Base):
    success: bool
    status: Optional[str] = None
    message: Optional[str] = None
