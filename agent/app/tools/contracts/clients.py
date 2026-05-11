"""Pydantic mirror of `lib/contracts/api/agent/clients.ts`.

Cobre 6 actions: lookup_by_phone, create, get, update, update_address,
get_full_history.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class ClientShape(_Base):
    id: str
    businessId: str
    name: str
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    status: Optional[str] = None
    lifecycleStage: Optional[str] = None
    source: Optional[str] = None
    score: Optional[float] = None
    totalSpent: Optional[float] = None
    visitCount: Optional[int] = None
    isActive: Optional[bool] = None


class AddressShape(_Base):
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    municipio: Optional[str] = None
    uf: Optional[str] = None
    cep: Optional[str] = None


class ClientsUpdateAddressData(_Base):
    id: str
    endereco: AddressShape


class OrderSummary(_Base):
    id: str
    number: int
    status: str
    total: float
    createdAt: str
    items: list[str]


class AppointmentSummary(_Base):
    id: str
    date: str
    startTime: str
    serviceName: Optional[str] = None
    professionalName: Optional[str] = None
    status: str
    price: Optional[float] = None


class ClientFullHistoryStats(_Base):
    totalOrders: int
    totalAppointments: int
    totalSpent: float
    visitCount: int
    lastVisit: Optional[str] = None


class ClientsGetFullHistoryData(_Base):
    client: ClientShape
    orders: list[OrderSummary]
    appointments: list[AppointmentSummary]
    stats: ClientFullHistoryStats
