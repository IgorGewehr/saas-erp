"""Pydantic models for `/api/agent/tools/agenda` responses.

Mirrors `lib/contracts/api/agent/agenda.ts`. Keep in sync until codegen exists.

Strict on known fields, lenient on extra (Config.extra='allow') — we don't want
to break the agent if the TS handler adds a benign field but Python isn't updated.
Forbidding extras here would be too aggressive while the contracts are
incremental.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, RootModel


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class AvailabilitySlot(_Base):
    startTime: str
    endTime: str
    professionalId: Optional[str] = None
    professionalName: Optional[str] = None


class AgendaServiceShort(_Base):
    id: str
    name: str
    isActive: bool
    duration: Optional[int] = None
    price: Optional[float] = None
    category: Optional[str] = None
    commissionRate: Optional[float] = None


class AgendaProfessional(_Base):
    id: str
    name: str
    role: Optional[str] = None
    serviceIds: list[str] = Field(default_factory=list)


AppointmentStatus = Literal[
    "agendado", "confirmado", "em_atendimento", "concluido", "cancelado", "falta",
]


class AppointmentShort(_Base):
    id: str
    businessId: str
    clientId: Optional[str] = None
    clientName: Optional[str] = None
    clientPhone: Optional[str] = None
    serviceId: Optional[str] = None
    serviceName: Optional[str] = None
    professionalId: Optional[str] = None
    professionalName: Optional[str] = None
    date: str
    startTime: str
    endTime: str
    duration: int
    status: AppointmentStatus
    price: Optional[float] = None
    notes: Optional[str] = None
    channelType: Optional[str] = None
    conversationId: Optional[str] = None


# ─── Action response shapes ─────────────────────────────────────────────────


class ListServicesResponse(RootModel[list[AgendaServiceShort]]):
    pass


class ListProfessionalsResponse(RootModel[list[AgendaProfessional]]):
    pass


class CheckAvailabilityData(_Base):
    date: str
    slots: list[AvailabilitySlot]


class GetNextAvailableData(_Base):
    date: Optional[str] = None
    slots: list[AvailabilitySlot]
    searchedDays: int


class BookData(_Base):
    id: str
    status: Literal["created", "exists"]
    date: str
    startTime: str
    endTime: str
    serviceName: str
    professionalName: Optional[str] = None


class ListByClientResponse(RootModel[list[AppointmentShort]]):
    pass


class ListUpcomingResponse(RootModel[list[AppointmentShort]]):
    pass


class ListTodayResponse(RootModel[list[AppointmentShort]]):
    pass


class CancelData(_Base):
    id: str
    status: Literal["cancelado"]
