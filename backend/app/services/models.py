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