"""Pydantic mirror of `lib/contracts/api/agent/suppliers.ts`.

Covers 4 of 6 actions: list, create, update, search. `get` and `find_by_cnpj`
return `SupplierShape.nullable()` (a single record-or-null) → not modeled here,
validation is skipped for those actions.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class AddressShape(_Base):
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    municipio: Optional[str] = None
    uf: Optional[str] = None
    cep: Optional[str] = None


class SupplierShape(_Base):
    id: str
    businessId: str
    schemaVersion: Optional[Literal[2]] = None
    documentType: Optional[Literal["cpf", "cnpj"]] = None
    document: Optional[str] = None
    razaoSocial: str
    nomeFantasia: Optional[str] = None
    cnpj: Optional[str] = None
    inscricaoEstadual: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    endereco: Optional[AddressShape] = None
    notes: Optional[str] = None
    paymentTerms: Optional[str] = None
    leadTimeDays: Optional[int] = None
    minimumOrderValue: Optional[float] = None
    minimumOrderQuantity: Optional[float] = None
    orderMultiple: Optional[float] = None
    isActive: bool


# ─── Action response shapes ─────────────────────────────────────────────────


class SuppliersListResponse(RootModel[list[SupplierShape]]):
    pass


class SuppliersSearchResponse(RootModel[list[SupplierShape]]):
    """Each item carries an extra `_score` (search relevance) — `_Base`'s
    `extra="allow"` already lets it flow through `model_validate`/
    `model_dump` untouched (leading-underscore names can't be plain Pydantic
    fields, so we don't declare it explicitly — same convention as
    `catalog.py`/`kanban.py`/`notes.py`)."""
    pass
