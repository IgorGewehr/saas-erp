"""Pydantic mirror of `lib/contracts/api/agent/kanban.ts`.

Covers 9 of 11 actions: list_boards, list_cards, search_cards, create_card,
move_card, update_card, assign, add_comment, archive_card. `get_board` and
`get_card` return a `.nullable()` single record → not modeled here, validation
is skipped for those actions.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


# ─── Sub-schemas ────────────────────────────────────────────────────────────


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class Label(_Base):
    id: str
    name: str
    color: str


class Column(_Base):
    id: str
    title: str
    order: Optional[int] = None


class BoardShape(_Base):
    id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    columns: list[Column]
    isArchived: bool


KanbanPriority = Literal["urgent", "high", "medium", "low"]


class CardShape(_Base):
    id: str
    businessId: str
    boardId: str
    columnId: str
    title: str
    description: Optional[str] = None
    priority: Optional[KanbanPriority] = None
    assigneeIds: Optional[list[str]] = None
    assigneeNames: Optional[list[str]] = None
    dueDate: Optional[str] = None
    labels: Optional[list[Label]] = None
    order: Optional[int] = None
    coverColor: Optional[str] = None


class Comment(_Base):
    id: str
    text: str
    authorId: str
    authorName: str
    createdAt: str


# ─── Action response shapes ─────────────────────────────────────────────────


class KanbanListBoardsResponse(RootModel[list[BoardShape]]):
    pass


class KanbanListCardsResponse(RootModel[list[CardShape]]):
    pass


class KanbanSearchCardsResponse(RootModel[list[CardShape]]):
    """Each item carries an extra `_score` (search relevance) — `_Base`'s
    `extra="allow"` already lets it flow through `model_validate`/
    `model_dump` untouched (leading-underscore names can't be plain Pydantic
    fields, so we don't declare it explicitly — same convention as
    `catalog.py`/`suppliers.py`/`notes.py`)."""
    pass


class KanbanArchiveCardData(_Base):
    id: str
    archived: Literal[True]
