"""Pydantic mirror of `lib/contracts/api/agent/catalog.ts`.

Actions covered: list_menu, search, list_categories. Skipped: get (nullable —
response is `MenuItemSchema.nullable()`, validation is a no-op for that
action).

Note on `search`: the TS response extends the item with `_score: z.number()`.
A leading-underscore attribute is not a validatable Pydantic field (v2 treats
it as a private attribute placeholder with no input binding); since
`_Base.model_config` already sets `extra="allow"`, `_score` flows through
untyped on the base `MenuItemShape` without any special-casing needed.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class MenuItemVariantShape(_Base):
    id: str
    name: str
    price: float
    outOfStock: bool


class MenuItemShape(_Base):
    id: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    price: float
    preparationTime: Optional[int] = None
    imageUrl: Optional[str] = None
    outOfStock: Optional[bool] = None
    isKit: Optional[bool] = None
    dietary: Optional[list[str]] = None
    # M02.5e — só presente pra produtos com variação; pedir exige variantId.
    variants: Optional[list[MenuItemVariantShape]] = None


class CatalogCategoryCount(_Base):
    name: str
    count: int


# ─── Action response shapes ─────────────────────────────────────────────────


class CatalogListMenuData(_Base):
    count: int
    items: list[MenuItemShape]


class CatalogSearchData(_Base):
    count: int
    items: list[MenuItemShape]  # each item carries an extra `_score` (see module docstring)


class CatalogListCategoriesData(_Base):
    categories: list[CatalogCategoryCount]
