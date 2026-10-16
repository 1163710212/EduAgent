from __future__ import annotations

from typing import Dict, List, Optional, TypedDict, Any


class ChallengeState(TypedDict, total=False):
    repo_url: str
    owner: str
    repo: str
    ref: str
    language: str
    task_type: str
    requested_paths: List[str]
    question_count: int
    timings: Dict[str, float]

    # from github
    target_paths: List[str]
    files: Dict[str, str]  # path -> content

    # llm output
    challenge: Dict[str, Any]

    error: Optional[str]


class EvalState(TypedDict, total=False):
    session: Dict[str, Any]          # ChallengeSession as dict
    challenge: Dict[str, Any]        # challenge artifact json
    filled_files: Dict[str, str]
    explanation_md: str

    # computed
    diffs: Dict[str, Any]
    evaluation: Dict[str, Any]

    error: Optional[str]
