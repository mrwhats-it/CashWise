from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, Field


EntryKind = Literal["income", "expense"]
Repeat = Literal["never", "daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"]


class EntryIn(BaseModel):
    kind: EntryKind
    title: str = Field(min_length=1, max_length=200)
    category: Optional[str] = None
    amount: float = Field(gt=0)
    entry_date: date
    memo: Optional[str] = None
    repeat: Repeat = "never"
    end_date: Optional[date] = None


class EntryOut(BaseModel):
    id: str
    user_id: str
    kind: EntryKind
    title: str
    category: Optional[str] = None
    amount: float
    entry_date: date
    memo: Optional[str] = None
    series_id: Optional[str] = None


class EntryUpdate(BaseModel):
    """Partial update. If the target row has a series_id, non-date fields
    are propagated to every row in the series."""
    kind: Optional[EntryKind] = None
    title: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    entry_date: Optional[date] = None
    memo: Optional[str] = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class InferenceConfirm(BaseModel):
    """User confirmation of an AI-inferred entry (used by the chat clarify form)."""
    kind: EntryKind
    title: str
    category: Optional[str] = None
    amount: float
    entry_date: date
    memo: Optional[str] = None
    repeat: Repeat = "never"
    end_date: Optional[date] = None
    accepted: bool = True
