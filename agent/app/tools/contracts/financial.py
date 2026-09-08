"""Pydantic mirror of `lib/contracts/api/agent/financial.ts`.

Actions covered: list, create_receivable, create_payable, mark_paid, cancel,
summary_today, summary_month. Skipped: get (nullable — response is
`TransactionShapeSchema.nullable()`, validation is a no-op for that action).
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Enums ──────────────────────────────────────────────────────────────────

TransactionType = Literal["receita", "despesa"]

TransactionStatus = Literal["pendente", "pago", "atrasado", "cancelado"]

PaymentMethod = Literal[
    "dinheiro", "pix", "credito", "debito", "boleto", "transferencia",
    "cartao_loja", "outro",
]


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class TransactionShape(_Base):
    id: str
    businessId: str
    type: TransactionType
    status: TransactionStatus
    amount: float
    description: str
    dueDate: Optional[str] = None
    paymentDate: Optional[str] = None
    paymentMethod: Optional[PaymentMethod] = None
    category: Optional[str] = None
    clientId: Optional[str] = None
    clientName: Optional[str] = None
    installmentGroupId: Optional[str] = None
    installmentNumber: Optional[int] = None
    installmentTotal: Optional[int] = None


class FinancialMonthCounts(_Base):
    pendente: int
    pago: int
    atrasado: int
    cancelado: int


class FinancialCategoryBreakdown(_Base):
    category: str
    amount: float
    count: int


# ─── Action response shapes ─────────────────────────────────────────────────


class FinancialListResponse(RootModel[list[TransactionShape]]):
    pass


# create_receivable / create_payable: TS response is
# `z.union([TransactionShapeSchema, z.array(TransactionShapeSchema)])` —
# single transaction when `installments=1`, array when parcelado in batch.
class FinancialCreateTxResponse(RootModel[Union[TransactionShape, list[TransactionShape]]]):
    pass


class FinancialSummaryTodayData(_Base):
    date: str
    pendingIn: float
    pendingOut: float
    paidInToday: float
    paidOutToday: float
    netPendingBalance: float
    netPaidToday: float
    overdueCount: int
    pendingCount: int


class FinancialSummaryMonthData(_Base):
    month: str
    totalReceita: float
    totalDespesa: float
    netBalance: float
    counts: FinancialMonthCounts
    byCategory: list[FinancialCategoryBreakdown]
