from __future__ import annotations

from typing import Dict, List
from pydantic import BaseModel, Field


class ChallengeArtifact(BaseModel):
    # 1-based line numbers selected by the LLM from the original file.
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)


class ExplainArtifact(ChallengeArtifact):
    # Rewritten snippet that should replace the selected line range.
    rewritten_snippet: str = Field(min_length=1)


class GradeArtifact(BaseModel):
    total_score: int = Field(ge=0, le=100)
    passed_blanks: bool
    feedback_md: str
    suggestions: List[str] = Field(default_factory=list)
