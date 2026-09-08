"""Pydantic mirror of `lib/contracts/api/agent/reports.ts`.

Covers all 4 actions: revenue_by_period, sales_by_product,
appointments_by_professional, top_clients. Read-only aggregation shapes
(numbers/breakdowns, no nested entity references) — no nullable actions to
skip.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class CategoryTotal(_Base):
    category: str
    total: float


class RankItem(_Base):
    name: str
    qty: int
    total: float


class ProfessionalStat(_Base):
    professionalId: str
    name: str
    total: int
    concluidos: int
    noShow: int
    taxaConclusao: float
    receita: float


class TopClient(_Base):
    id: str
    name: str
    totalSpent: float
    visitCount: int
    visitasNoPeriodo: int


# ─── Action response shapes ─────────────────────────────────────────────────


class RevenueByPeriodData(_Base):
    totalReceita: float
    totalDespesa: float
    lucro: float
    margem: float
    paidCount: int
    receitasPorCategoria: list[CategoryTotal]
    despesasPorCategoria: list[CategoryTotal]


class SalesByProductData(_Base):
    produtos: list[RankItem]
    servicos: list[RankItem]
    totalProdutos: float
    totalServicos: float
    qtyProdutos: int
    qtyServicos: int


class AppointmentsByProfessionalData(_Base):
    total: int
    concluidos: int
    cancelados: int
    naoCompareceu: int
    taxaConclusao: float
    taxaNoShow: float
    porProfissional: list[ProfessionalStat]


class TopClientsData(_Base):
    totalClientes: int
    novosNoPeriodo: int
    ticketMedioCLV: float
    topClients: list[TopClient]
