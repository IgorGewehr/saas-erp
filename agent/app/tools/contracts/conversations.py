"""Pydantic mirror of `lib/contracts/api/agent/conversations.ts`.

Covers 7 actions: list, list_messages, set_label, set_priority, set_status,
list_snippets, search_snippets. `get` → None (nullable, skip).

`set_label` / `set_priority` / `set_status` all return the plain `ConvShape`
(no dedicated wrapper class needed) — same pattern as `agenda.update` reusing
`AppointmentShort` directly in `__init__.py`'s registry.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


ConversationChannel = Literal["whatsapp", "facebook", "instagram"]
ConversationStatus = Literal["open", "waiting", "resolved"]
ConversationPriority = Literal["low", "medium", "high", "urgent"]
MessageDirection = Literal["inbound", "outbound"]


class ConvShape(_Base):
    id: str
    businessId: str
    channel: ConversationChannel
    status: Optional[ConversationStatus] = None
    priority: Optional[ConversationPriority] = None
    labels: Optional[list[str]] = None
    lastMessage: Optional[str] = None
    lastMessageAt: Optional[str] = None


class ConvMsgShape(_Base):
    id: str
    conversationId: str
    businessId: str
    direction: Optional[MessageDirection] = None
    content: Optional[str] = None
    sentAt: Optional[str] = None


class SnippetShape(_Base):
    id: str
    businessId: str
    shortcode: str
    content: str
    category: Optional[str] = None
    sectorId: Optional[str] = None


# ─── Action response shapes ─────────────────────────────────────────────────


class ConversationsListResponse(RootModel[list[ConvShape]]):
    pass


class ConversationsListMessagesResponse(RootModel[list[ConvMsgShape]]):
    pass


class ConversationsListSnippetsResponse(RootModel[list[SnippetShape]]):
    pass


class ConversationsSearchSnippetsResponse(RootModel[list[SnippetShape]]):
    pass
