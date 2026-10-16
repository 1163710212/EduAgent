from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlmodel import SQLModel, Field


class ChallengeSession(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    repo_url: str
    owner: str
    repo: str
    ref: str = "main"
    language: str = "python"

    # JSON strings（避免复杂迁移；MVP 够用）
    target_paths_json: str
    challenge_json: str

    created_at: datetime = Field(default_factory=datetime.utcnow)


class Submission(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    session_id: str = Field(index=True)

    explanation_md: str
    filled_files_json: str
    evaluation_json: str

    created_at: datetime = Field(default_factory=datetime.utcnow)


class QuestionAnswer(SQLModel, table=True):
    """Immutable accepted answer; compound key prevents duplicate advancement."""
    session_id: str = Field(primary_key=True)
    question_id: str = Field(primary_key=True)
    position: int
    explanation_md: str
    filled_files_json: str
    evaluation_json: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WorkflowReview(SQLModel, table=True):
    session_id: str = Field(primary_key=True)
    evaluation_json: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class QuestionFeedbackReceipt(SQLModel, table=True):
    """Explicit Continue acknowledgement, separate from immutable grades."""
    session_id: str = Field(primary_key=True)
    question_id: str = Field(primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
