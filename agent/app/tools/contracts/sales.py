"""Pydantic mirror of `lib/contracts/api/agent/sales.ts`.

Cobre 6 actions: list, get, list_by_client, create, cancel, summary_today.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


SaleStatus = Literal["aberta", "finalizada", "cancelada"]
PaymentMethod = Literal[
    "dinheiro", "pix", "credito", "debito", "boleto",
    "creditoLoja", "semPagamento", "pontos", "gift_card", "outros",
]


class SaleShape(_Base):
    id: str
    businessId: str
    status: SaleStatus
    subtotal: float
    total: float
    discount: Optional[float] = None
    tip: Optional[float] = None


class SalesListResponse(RootModel[list[SaleShape]]):
    pass


class SalesListByClientResponse(RootModel[list[SaleShape]]):
    pass


class PaymentMethodSummary(_Base):
    method: PaymentMethod
    amount: float


class SalesSummaryTodayData(_Base):
    date: str
    revenue: float
    totalDiscount: float
    avgTicket: float
    saleCount: int
    cancelledCount: int
    byPaymentMethod: list[PaymentMethodSummary]
