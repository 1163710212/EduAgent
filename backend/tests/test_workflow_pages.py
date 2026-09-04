from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import main
from app.services import repository
from app.services.models import Submission


STATIC_DIR = Path(main.__file__).resolve().parent / "static"


@pytest.mark.parametrize(
    "route_handler,page_name,page_module",
    [
        (main.create_ui, "index.html", "/static/js/pages/create.js"),
        (main.solve_ui, "solve.html", "/static/js/pages/solve.js"),
        (main.review_ui, "review.html", "/static/js/pages/review.js"),
    ],
)
def test_workflow_routes_serve_independent_pages(route_handler, page_name, page_module):
    response = route_handler()
    body = response.body.decode("utf-8")

    assert (STATIC_DIR / page_name).exists()
    assert page_module in body
    assert '<script type="module"' in body


def test_each_workflow_page_owns_only_its_step_action():
    create_page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    solve_page = (STATIC_DIR / "solve.html").read_text(encoding="utf-8")
    review_page = (STATIC_DIR / "review.html").read_text(encoding="utf-8")

    assert 'id="btnCreate"' in create_page
    assert 'id="btnSubmit"' not in create_page
    assert 'id="btnSubmit"' in solve_page
    assert 'id="btnCreate"' not in solve_page
    assert 'id="btnCreate"' not in review_page
    assert 'id="btnSubmit"' not in review_page


def test_workflow_pages_do_not_expose_cross_step_navigation():
    for page_name in ("index.html", "solve.html", "review.html"):
        page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
        assert "pill-nav" not in page
        assert "progress-panel" not in page
        assert "data-step-link" not in page

    for script_name in ("create.js", "solve.js"):
        script = (STATIC_DIR / "js" / "pages" / script_name).read_text(encoding="utf-8")
        assert "location.replace" in script
        assert "location.assign" not in script


def test_latest_review_can_restore_review_page(monkeypatch):
    challenge = {"task_type": "blank_fill"}
    evaluation = {"total_score": 92, "feedback_md": "Well done"}
    monkeypatch.setattr(
        main.repository,
        "get_challenge_session",
        lambda session_id: SimpleNamespace(challenge_json=json.dumps(challenge)),
    )
    monkeypatch.setattr(
        main.repository,
        "get_latest_submission",
        lambda session_id: SimpleNamespace(evaluation_json=json.dumps(evaluation)),
    )

    assert main.get_latest_review("session-1") == {
        "session_id": "session-1",
        "task_type": "blank_fill",
        "evaluation": evaluation,
    }

    response = TestClient(main.app).get("/api/challenges/session-1/review")
    assert response.status_code == 200
    assert response.json()["evaluation"] == evaluation


def test_latest_review_requires_a_submission(monkeypatch):
    monkeypatch.setattr(
        main.repository,
        "get_challenge_session",
        lambda session_id: SimpleNamespace(challenge_json='{"task_type":"rewrite"}'),
    )
    monkeypatch.setattr(main.repository, "get_latest_submission", lambda session_id: None)

    with pytest.raises(HTTPException) as error:
        main.get_latest_review("session-1")

    assert error.value.status_code == 404


def test_repository_returns_most_recent_submission(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    now = datetime.utcnow()
    with Session(engine) as session:
        session.add_all(
            [
                Submission(
                    session_id="session-1",
                    explanation_md="first",
                    filled_files_json="{}",
                    evaluation_json='{"total_score":50}',
                    created_at=now - timedelta(minutes=1),
                ),
                Submission(
                    session_id="session-1",
                    explanation_md="latest",
                    filled_files_json="{}",
                    evaluation_json='{"total_score":90}',
                    created_at=now,
                ),
            ]
        )
        session.commit()

    monkeypatch.setattr(repository, "engine", engine)
    latest = repository.get_latest_submission("session-1")

    assert latest is not None
    assert latest.explanation_md == "latest"
