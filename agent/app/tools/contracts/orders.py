"""Pydantic mirror of `lib/contracts/api/agent/orders.ts`.

Cobre 7 actions: create, get, list_by_client, update_status, update_items,
cancel, list_recent.

Response shapes são intencionalmente lenientes (extra='allow') porque o
TS handler retorna DeliveryOrder shape completo via passthrough no Zod;
validamos só os campos garantidos.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


DeliveryOrderStatus = Literal[
    "recebido", "preparando", "pronto", "saiu_entrega", "entregue", "cancelado",
]


class DeliveryOrderShort(_Base):
    id: str
    number: int
    status: DeliveryOrderStatus
    total: float
    subtotal: float


class OrdersCreateData(_Base):
    id: str
    number: int
    total: float
    subtotal: float
    estimatedDeliveryAt: str


class OrdersUpdateStatusData(_Base):
    id: str
    status: DeliveryOrderStatus
    deliveredAt: Optional[str] = None


class OrdersUpdateItemsData(_Base):
    id: str
    itemsCount: int
    subtotal: float
    total: float


class OrdersCancelData(_Base):
    id: str
    status: Literal["cancelado"]


class OrdersListByClientResponse(RootModel[list[DeliveryOrderShort]]):
    pass


class OrdersListRecentResponse(RootModel[list[DeliveryOrderShort]]):
    pass
