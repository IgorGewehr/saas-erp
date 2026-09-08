"""Pydantic mirror of `lib/contracts/api/agent/b2b-orders.ts`.

Cobre 3 actions: create, get, list_by_client. Deliberadamente SEM
update_status/cancel — ver docstring do arquivo TS (mesma decisão de
segurança do M02.5c, transições ficam fora do alcance do LLM).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


OrderStatus = Literal[
    "pendente", "confirmado", "condicional", "faturado", "enviado", "entregue", "cancelado",
]


class B2bOrderShort(_Base):
    id: str
    type: Literal["pdv", "b2b", "condicional"]
    status: OrderStatus
    subtotal: float
    discount: float
    total: float


class B2bOrdersCreateData(_Base):
    id: str
    status: Literal["pendente"]
    subtotal: float
    discount: float
    total: float


class B2bOrdersListByClientResponse(RootModel[list[B2bOrderShort]]):
    pass
