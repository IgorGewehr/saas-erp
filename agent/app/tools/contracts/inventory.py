"""Pydantic mirror of `lib/contracts/api/agent/inventory.ts`.

Actions covered: list, search, create, update, adjust_stock, list_low_stock,
set_active, set_out_of_stock. Skipped: get (nullable — response is
`ProductShape.nullable()`, validation is a no-op for that action).

Note on `search`: the TS response extends the item with `_score: z.number()`.
A leading-underscore attribute is not a validatable Pydantic field (v2 treats
it as a private attribute placeholder with no input binding); since
`_Base.model_config` already sets `extra="allow"`, `_score` flows through
untyped on the base `ProductShape` without any special-casing needed.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class ProductShape(_Base):
    id: str
    businessId: str
    name: str
    category: Optional[str] = None
    unit: Optional[str] = None
    costPrice: Optional[float] = None
    salePrice: float
    currentStock: float
    minStock: Optional[float] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    isActive: bool
    imageUrl: Optional[str] = None
    isDeliverable: Optional[bool] = None
    menuCategory: Optional[str] = None
    menuDescription: Optional[str] = None
    preparationTime: Optional[int] = None


class StockMovementShape(_Base):
    id: str
    businessId: str
    productId: str
    productName: Optional[str] = None
    type: Literal["entrada", "saida", "ajuste"]
    quantity: float
    previousStock: float
    newStock: float
    reason: Optional[str] = None
    operatorId: Optional[str] = None
    operatorName: Optional[str] = None


# ─── Action response shapes ─────────────────────────────────────────────────


class InventoryListResponse(RootModel[list[ProductShape]]):
    pass


class InventorySearchResponse(RootModel[list[ProductShape]]):
    pass


class InventoryAdjustStockData(_Base):
    product: ProductShape
    movement: StockMovementShape


class InventoryListLowStockResponse(RootModel[list[ProductShape]]):
    pass
