from __future__ import annotations

from typing import Dict, List, Literal
from pydantic import BaseModel, Field, field_validator, model_validator, ValidationInfo


class ChallengeArtifact(BaseModel):
    # 1-based line numbers selected by the LLM from the original file.
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)


class ExplainArtifact(ChallengeArtifact):
    # Rewritten snippet that should replace the selected line range.
    rewritten_snippet: str = Field(min_length=1)


class CriterionAssessment(BaseModel):
    points: int = Field(ge=0, le=60)
    evidence: List[str] = Field(description="Exact quotations from the student's actual response only.", max_length=3)
    reason: str = Field(default="", description="Explain the points awarded; a zero-point criterion may omit its reason.")

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_zero_reason(cls, value, info: ValidationInfo):
        return "" if value is None and info.data.get("points") == 0 else value

    @model_validator(mode="after")
    def require_reason_for_credit(self):
        self.reason = self.reason.strip()
        if not self.reason:
            if self.points > 0:
                raise ValueError("A criterion with positive points must explain why credit was awarded.")
            self.reason = "No credit was awarded for this criterion."
        return self


class ReasoningAssessment(CriterionAssessment):
    points: int = Field(ge=0, le=25)


class ClarityAssessment(CriterionAssessment):
    points: int = Field(ge=0, le=15)


class RubricGradeArtifact(BaseModel):
    verdict: Literal["correct", "partially_correct", "incorrect", "irrelevant"]
    correctness: CriterionAssessment
    reasoning: ReasoningAssessment
    clarity: ClarityAssessment
    critical_errors: List[str] = Field(description="Concrete semantic errors or missing essential behavior.")
    suggestions: List[str] = Field(default_factory=list, max_length=3)


class ScoreDimension(BaseModel):
    key: str
    label: str
    score: int = Field(ge=0, le=60)
    maximum: int = Field(ge=1, le=60)
    reason: str
    evidence: List[str] = Field(default_factory=list)


class GradeArtifact(BaseModel):
    total_score: int = Field(ge=0, le=100)
    passed_blanks: bool
    feedback_md: str
    suggestions: List[str] = Field(default_factory=list)
    grading_version: str | None = None
    score_breakdown: List[ScoreDimension] = Field(default_factory=list)
    score_caps: List[str] = Field(default_factory=list)


class OverallArtifact(BaseModel):
    feedback_md: str = Field(min_length=1)
    strengths: List[str] = Field(default_factory=list, max_length=3)
    suggestions: List[str] = Field(default_factory=list, max_length=3)
