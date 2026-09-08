"""Pydantic mirror of `lib/contracts/api/agent/send-interactive.ts`.

Single action: send_interactive -> SendInteractiveData.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class SendInteractiveData(_Base):
    externalMessageId: str
