"""Pydantic mirror of `lib/contracts/api/agent/knowledge.ts`.

Covers 1 action: search. No nullable/skipped actions — RAG search always
returns an object (empty `results` list at worst), never `null`.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


KnowledgeSource = Literal[
    "product", "service", "snippet", "faq", "business_desc", "policy",
]


class KnowledgeSearchResult(_Base):
    source: KnowledgeSource
    sourceId: str
    text: str
    # TS: `z.object({}).passthrough()` — object with no fixed shape, any keys.
    metadata: dict[str, Any]
    score: float


# ─── Action response shapes ─────────────────────────────────────────────────


class KnowledgeSearchData(_Base):
    query: str
    count: int
    results: list[KnowledgeSearchResult]
