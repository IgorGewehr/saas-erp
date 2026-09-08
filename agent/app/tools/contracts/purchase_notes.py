"""Pydantic mirror of `lib/contracts/api/agent/purchase-notes.ts`.

Covers 6 actions: list, match_products, apply_to_stock, list_unmatched,
reverse_stock, link_financial. `get` → None (nullable, skip).

Module filename is `purchase_notes` (Python identifiers can't have hyphens);
the tool/domain string used in the registry key stays `"purchase-notes"`
(matches the TS route `/api/agent/tools/purchase-notes`) — these are two
different strings, don't conflate them when wiring `__init__.py`.

`status` uses the canonical V2 status enum (`PURCHASE_NOTE_V2_STATUSES` from
`lib/contracts/domain/purchaseNoteV2.ts`), a superset of the legacy V1
subset — see the comment in the TS source for why.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


PurchaseNoteStatus = Literal[
    "rascunho",
    "pendente",
    "processando",
    "importada",
    "parcial",
    "falha",
    "cancelada",
    "revertida",
]


class PurchaseNoteShape(_Base):
    id: str
    businessId: str
    status: PurchaseNoteStatus
    numero: Optional[str] = None
    serie: Optional[str] = None
    supplierId: Optional[str] = None
    supplierName: Optional[str] = None
    issueDate: Optional[str] = None
    stockImportedAt: Optional[str] = None
    stockMovementIds: Optional[list[str]] = None


class PurchaseItemShape(_Base):
    productId: Optional[str] = None
    productName: str
    quantity: float
    unitPrice: float


class ProductShape(_Base):
    id: str
    name: str


class UnmatchedItemSummaryShape(_Base):
    """Snapshot reduzido de `PurchaseNote.unmatchedItems` — nunca carrega
    `unitPrice`/`productId` (não é um `PurchaseItemShape` completo)."""

    productName: str
    quantity: float
    cProd: Optional[str] = None


class MatchedItem(_Base):
    item: PurchaseItemShape
    product: ProductShape
    confidence: float


class PurchaseNoteUnmatchedSummary(_Base):
    id: str
    numero: Optional[str] = None
    supplierName: Optional[str] = None
    issueDate: Optional[str] = None
    unmatchedItems: list[UnmatchedItemSummaryShape]


class PurchaseNoteTransaction(_Base):
    id: str
    businessId: str
    type: Literal["despesa"]
    amount: float
    status: Literal["pendente", "pago", "atrasado", "cancelado"]
    purchaseNoteId: str


# ─── Action response shapes ─────────────────────────────────────────────────


class PurchaseNotesListResponse(RootModel[list[PurchaseNoteShape]]):
    pass


class PurchaseNotesMatchProductsData(_Base):
    note: PurchaseNoteShape
    matched: list[MatchedItem]
    unmatched: list[PurchaseItemShape]


class PurchaseNotesApplyToStockData(_Base):
    note: PurchaseNoteShape
    movementsCreated: int
    unmatchedCount: int


class PurchaseNotesListUnmatchedResponse(RootModel[list[PurchaseNoteUnmatchedSummary]]):
    pass


class PurchaseNotesReverseStockData(_Base):
    note: PurchaseNoteShape
    movementsReversed: int


class PurchaseNotesLinkFinancialData(_Base):
    note: PurchaseNoteShape
    transaction: PurchaseNoteTransaction
    replayed: bool
