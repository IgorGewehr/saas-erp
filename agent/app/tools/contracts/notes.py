"""Pydantic mirror of `lib/contracts/api/agent/notes.ts`.

Covers 5 actions: list, create, update, delete, search. `get` → None
(nullable, skip).

`create` / `update` both return the plain `NoteShape` (no dedicated wrapper
class needed) — same pattern as `clients.create`/`clients.update` reusing
`ClientShape` directly in `__init__.py`'s registry.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


NoteColor = Literal[
    "yellow", "green", "blue", "pink", "purple", "orange", "red", "neutral",
]
NoteScope = Literal["personal", "team"]


class NoteShape(_Base):
    id: str
    businessId: str
    authorId: str
    authorName: str
    authorInitials: Optional[str] = None
    title: str
    content: str
    color: NoteColor
    scope: NoteScope
    isPinned: bool
    tags: Optional[list[str]] = None
    createdAt: str
    updatedAt: str


class NoteSearchResult(NoteShape):
    """`NoteShape` + `_score: number` (relevância) appended by `search`.

    Not declared as an explicit field: Pydantic v2 treats a leading-underscore
    class attribute as a private attribute (`PrivateAttr`), not a real model
    field, so annotating `_score: float` here would silently shadow the real
    value instead of validating it. Because `_Base` already sets
    `extra="allow"`, the actual `_score` key from the JSON payload flows
    through untouched as an extra field on the instance and survives
    `model_dump()` with its original key and value — giving the same
    round-trip fidelity without the alias contortions that leading-underscore
    field names would otherwise require (an `alias="_score"` field would dump
    back out under its Python attribute name, not `_score`, since
    `validate_response_data()` doesn't call `model_dump(by_alias=True)`).
    """


# ─── Action response shapes ─────────────────────────────────────────────────


class NotesListResponse(RootModel[list[NoteShape]]):
    pass


class NotesDeleteData(_Base):
    id: str
    deleted: Literal[True]


class NotesSearchResponse(RootModel[list[NoteSearchResult]]):
    pass
