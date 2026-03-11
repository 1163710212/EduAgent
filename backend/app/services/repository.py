from __future__ import annotations

import json
from typing import Any, Dict, Optional, List

from sqlmodel import Session, select

from app.services.db import engine
from app.services.models import ChallengeSession, Submission


def create_challenge_session(
    *,
    repo_url: str,
    owner: str,
    repo: str,
    ref: str,
    language: str,
    target_paths: List[str],
    challenge: Dict[str, Any],
) -> ChallengeSession:
    row = ChallengeSession(
        repo_url=repo_url,
        owner=owner,
        repo=repo,
        ref=ref,
        language=language,
        target_paths_json=json.dumps(target_paths, ensure_ascii=False),
        challenge_json=json.dumps(challenge, ensure_ascii=False),
    )
    with Session(engine) as s:
        s.add(row)
        s.commit()
        s.refresh(row)
    return row


def get_challenge_session(session_id: str) -> Optional[ChallengeSession]:
    with Session(engine) as s:
        stmt = select(ChallengeSession).where(ChallengeSession.id == session_id)
        return s.exec(stmt).first()


def create_submission(
    *,
    session_id: str,
    explanation_md: str,
    filled_files: Dict[str, str],
    evaluation: Dict[str, Any],
) -> Submission:
    row = Submission(
        session_id=session_id,
        explanation_md=explanation_md,
        filled_files_json=json.dumps(filled_files, ensure_ascii=False),
        evaluation_json=json.dumps(evaluation, ensure_ascii=False),
    )
    with Session(engine) as s:
        s.add(row)
        s.commit()
        s.refresh(row)
    return row
