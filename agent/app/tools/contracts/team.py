"""Pydantic mirror of `lib/contracts/api/agent/team.ts`.

Covers 3 of 4 actions: list_sectors, list_members, capacity_today.
`get_member` returns `UserShape.nullable()` in TS — nullable response,
skipped here (validation falls through to None per registry convention).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


Role = Literal["founder", "admin", "manager", "operator", "viewer"]
UserStatus = Literal["online", "busy", "invisible", "offline"]


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class SectorShape(_Base):
    id: str
    businessId: str
    name: str
    isActive: bool


class UserShape(_Base):
    id: str
    uid: Optional[str] = None
    name: str
    email: Optional[str] = None
    role: Optional[Role] = None
    sectorIds: Optional[list[str]] = None
    isProfessional: Optional[bool] = None
    serviceIds: Optional[list[str]] = None
    commissionRate: Optional[float] = None
    isActive: Optional[bool] = None
    isOnline: Optional[bool] = None
    userStatus: Optional[UserStatus] = None
    lastSeenAt: Optional[str] = None
    workingHours: Optional[dict] = None
    photoURL: Optional[str] = None


class TeamCapacityEntry(_Base):
    userId: str
    userName: str
    appointments: int
    orders: int
    kanbanCards: int
    conversations: int


# ─── Action response shapes ─────────────────────────────────────────────────


class TeamListSectorsResponse(RootModel[list[SectorShape]]):
    pass


class TeamListMembersResponse(RootModel[list[UserShape]]):
    pass


class TeamCapacityTodayResponse(RootModel[list[TeamCapacityEntry]]):
    pass
