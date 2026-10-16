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
        assert "navigateForward" in script
        assert "location.assign" not in script
    common = (STATIC_DIR / "js" / "ui" / "common.js").read_text(encoding="utf-8")
    assert "window.location.replace(url)" in common


def test_animation_assets_are_local_and_accessible():
    response = TestClient(main.app).get("/static/vendor/motion-mini.mjs")
    assert response.status_code == 200
    motion = (STATIC_DIR / "js" / "ui" / "motion.js").read_text(encoding="utf-8")
    assert "prefers-reduced-motion: reduce" in motion
    assert 'import("../../vendor/motion-mini.mjs")' in motion
    assert (STATIC_DIR / "vendor" / "LICENSE.txt").exists()


def test_each_step_uses_its_independent_background_module():
    for page_name in ("index.html", "solve.html", "review.html"):
        page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
        assert 'id="ambientBackground"' in page
        assert 'class="ambient-background' in page
        assert 'aria-hidden="true"' in page
        assert '/static/optical-background.css' in page
        assert '/static/workflow-theme.css' in page
        assert 'id="backgroundToggle"' not in page

    create_page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    for required in (
        'id="createBackgroundVideo"', 'id="createBackgroundVideoBackdrop"',
        "autoplay", "muted", "loop",
        "playsinline", 'preload="metadata"',
        "/static/js/ui/video-background.js",
        "hf_20260325_120549_0cd82c36-56b3-4dd9-b190-069cfc3a623f.mp4",
    ):
        assert required in create_page
    assert 'id="opticalCanvas"' not in create_page
    assert "/static/js/ui/background.js" not in create_page
    assert "create-background-veil" not in create_page
    assert "create-background-fade" not in create_page

    solve_page = (STATIC_DIR / "solve.html").read_text(encoding="utf-8")
    for required in (
        'id="solveBackgroundVideo"', "autoplay", "muted", "loop",
        "playsinline", 'preload="auto"', "solve-background-veil",
        "/static/js/ui/solve-video-background.js",
        "hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4",
    ):
        assert required in solve_page
    assert 'id="opticalCanvas"' not in solve_page
    assert "/static/js/ui/background.js" not in solve_page

    review_page = (STATIC_DIR / "review.html").read_text(encoding="utf-8")
    for required in (
        'id="reviewBackgroundVideo"', "autoplay", "muted", "loop",
        "playsinline", 'preload="metadata"',
        "/static/js/ui/review-video-background.js",
        "hf_20260622_204221_5339e40b-e73d-4ab0-9c65-79c18c66fd50.mp4",
    ):
        assert required in review_page
    assert 'id="opticalCanvas"' not in review_page
    assert "/static/js/ui/background.js" not in review_page
    for removed_module in ("background.js", "optical-renderer.js"):
        assert not (STATIC_DIR / "js" / "ui" / removed_module).exists()
    video_script = (STATIC_DIR / "js" / "ui" / "video-background.js").read_text(
        encoding="utf-8"
    )
    for required in ("prefers-reduced-motion: reduce", "visibilitychange",
                     "IntersectionObserver", "pagehide", '"pointermove"'):
        assert required in video_script
    for forbidden in ("/api/challenges", "workflow-store", '"click"', '"pointerdown"'):
        assert forbidden not in video_script
    review_video_script = (
        STATIC_DIR / "js" / "ui" / "review-video-background.js"
    ).read_text(encoding="utf-8")
    for required in (
        "prefers-reduced-motion: reduce", "visibilitychange",
        "IntersectionObserver", "pagehide",
    ):
        assert required in review_video_script
    for forbidden in (
        "/api/challenges", "workflow-store", "total_score", '"click"',
        '"pointerdown"',
    ):
        assert forbidden not in review_video_script
    solve_video_script = (
        STATIC_DIR / "js" / "ui" / "solve-video-background.js"
    ).read_text(encoding="utf-8")
    for required in (
        "prefers-reduced-motion: reduce", "visibilitychange",
        "IntersectionObserver", "pagehide", "eduagent:learning-focus",
        '"pointermove"', "playbackRate",
    ):
        assert required in solve_video_script
    for forbidden in (
        "/api/challenges", "workflow-store", "total_score", '"click"',
        '"pointerdown"',
    ):
        assert forbidden not in solve_video_script


def test_header_scrolls_in_normal_page_flow():
    styles = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    header_styles = styles.split(".topbar {", 1)[1].split("}", 1)[0]
    assert "position: relative;" in header_styles
    assert "position: fixed;" not in header_styles
    assert "position: sticky;" not in header_styles
    assert "--header-clearance" not in styles
    assert ".background-toggle" not in styles
    assert "background: transparent;" in header_styles
    assert "border: 0;" in header_styles
    assert "box-shadow: none;" in header_styles
    for page_name in ("index.html", "solve.html", "review.html"):
        page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
        version = "20261001-solve-layout" if page_name == "solve.html" else "20260922-clear-video"
        assert f'/static/styles.css?v={version}' in page
        assert f'/static/optical-background.css?v={version}' in page
        theme_version = {"review.html": "20261014-overall-only", "solve.html": "20261014-solve-feedback-cleanup"}.get(page_name, version)
        assert f'/static/workflow-theme.css?v={theme_version}' in page
        assert '<meta name="theme-color" content="#071722" />' in page
        assert "AI ready" not in page
        assert "header-actions" not in page
        assert "system-status" not in page


def test_page_shell_uses_shared_ninety_percent_width():
    styles = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    assert "--page-width: 90%;" in styles
    for selector in (".topbar", ".app-shell", ".site-footer"):
        matching_rules = styles.split(f"{selector} {{")[1:]
        assert any("width: var(--page-width);" in rules.split("}", 1)[0]
                   for rules in matching_rules)
    assert "width: min(calc(100% - 64px), 1360px);" not in styles
    declarations = {line.strip() for line in styles.splitlines()}
    assert "width: calc(100% - 40px);" not in declarations
    assert "width: calc(100% - 24px);" not in declarations


def test_three_steps_share_one_cinematic_visual_system():
    response = TestClient(main.app).get("/static/workflow-theme.css")
    assert response.status_code == 200
    theme = response.text
    for page_class in (".create-page", ".solve-page", ".review-page"):
        assert page_class in theme
    for required in (
        "--scene-night: #071722;",
        "--scene-cyan: #79dce8;",
        "--scene-blue: #7199ff;",
        "--scene-shell-shadow:",
        ".create-page .create-composer",
        ".solve-page .workspace-card",
        ".review-page .evaluation-card",
        "border-radius: 28px;",
        "linear-gradient(110deg, #3d6ff3, #3278ec 58%, #268ca7)",
    ):
        assert required in theme
    for forbidden in ("/api/challenges", "workflow-store", "total_score"):
        assert forbidden not in theme


def test_solve_keeps_required_content_without_redundant_explanations():
    page = (STATIC_DIR / "solve.html").read_text(encoding="utf-8")
    for element_id in ("challengeInstructions", "challengeFiles", "fileSelect",
                       "codeViewer", "sessionId", "copySession", "explanation",
                       "completionCode", "explanationCount", "completionCount",
                       "btnSubmit", "submitLog"):
        assert f'id="{element_id}"' in page
    for removed in ("Read the source, then explain", "Work from the repository",
                    "Make your reasoning clear", "Challenge source",
                    "AI evaluates your answer", 'class="answer-mode"'):
        assert removed not in page


def test_solve_video_background_has_performance_and_lifecycle_guards():
    controller = (STATIC_DIR / "js/ui/solve-video-background.js").read_text(
        encoding="utf-8"
    )
    for required in (
        "visibilitychange", "IntersectionObserver", "pagehide",
        "eduagent:learning-focus", "finePointer", "requestAnimationFrame",
        "playbackRate", "0.45",
    ):
        assert required in controller
    for forbidden in ("/api/challenges", "workflow-store", "total_score"):
        assert forbidden not in controller
    css = TestClient(main.app).get("/static/optical-background.css")
    assert css.status_code == 200
    assert "pointer-events: none" in css.text
    assert ".solve-video-background[data-attention=\"focused\"]" in css.text
    solve_video = css.text.split(".solve-background-video {", 1)[1].split("}", 1)[0]
    assert "inset: 0;" in solve_video
    assert "width: 100%;" in solve_video
    assert "height: 100%;" in solve_video
    assert "object-fit: cover;" in css.text
    assert "--solve-scale: 1;" in css.text
    assert "radial-gradient(ellipse at center, #000 70%, transparent 100%)" in css.text
    for page_name in ("index.html", "solve.html", "review.html"):
        page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
        for removed in ("learning-props.css", "learningKit", "fileConstellation",
                        "reflectionNotebook", "data-education-art"):
            assert removed not in page


@pytest.mark.parametrize(
    "module_name",
    ["scene-transition", "pointer-glow", "common"],
)
def test_motion_upgrade_modules_are_local_and_accessible(module_name):
    response = TestClient(main.app).get(f"/static/js/ui/{module_name}.js")
    assert response.status_code == 200
    if module_name != "common":
        assert "prefers-reduced-motion: reduce" in response.text
        assert "/api/challenges" not in response.text
    scene = (STATIC_DIR / "js" / "ui" / "scene-transition.js").read_text(encoding="utf-8")
    assert '["create", "solve"]' in scene
    assert '["solve", "review"]' in scene
    assert "window.location.replace" in scene


@pytest.mark.parametrize(
    "page_name,module_name",
    [
        ("index.html", "video-background"),
        ("solve.html", "solve-video-background"),
        ("solve.html", "solve-focus"),
        ("review.html", "review-video-background"),
    ],
)
def test_learning_scene_effects_are_independent_local_enhancements(page_name, module_name):
    page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
    assert f'/static/js/ui/{module_name}.js' in page
    response = TestClient(main.app).get(f"/static/js/ui/{module_name}.js")
    assert response.status_code == 200
    assert "/api/challenges" not in response.text
    assert "total_score" not in response.text
    assert "workflow-store" not in response.text


def test_create_module_has_no_background_image():
    page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    styles = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    optical_styles = (STATIC_DIR / "optical-background.css").read_text(encoding="utf-8")
    motion = (STATIC_DIR / "js" / "ui" / "motion.js").read_text(encoding="utf-8")
    for removed in ("hero-photo", "hero-wash", "photo-credit", "create-depth",
                    "pexels-adrien-olichon-glass-facade.jpg"):
        assert removed not in page
        assert removed not in styles
        assert removed not in optical_styles
        assert removed not in motion
    hero_styles = styles.split(".hero-stage {", 1)[1].split("}", 1)[0]
    assert "background: rgba(5, 18, 29, 0.08);" in hero_styles
    video_style_blocks = [
        block.split("}", 1)[0]
        for block in optical_styles.split(".create-background-video {")[1:]
    ]
    assert any("filter: none;" in block for block in video_style_blocks)
    assert all("grayscale(" not in block for block in video_style_blocks)
    assert "--video-scale: 1.06;" in optical_styles
    assert any(
        "scale(var(--video-scale));" in block for block in video_style_blocks
    )
    assert any("object-position: 60% 60%;" in block for block in video_style_blocks)
    assert "@media (min-aspect-ratio: 3/2)" in optical_styles
    assert "object-fit: contain;" in optical_styles
    assert "aspect-ratio: 1624 / 1276;" in optical_styles
    assert "inset: 0 auto 0 30%;" in optical_styles
    assert "transform: translate(-50%, -10vh);" in optical_styles
    assert "height: 112%;" in optical_styles
    assert '.create-video-background[data-renderer="video"]' in optical_styles
    assert 'url("/static/assets/education/optical-study-v2.webp")' not in optical_styles


def test_review_uses_cinematic_video_below_unchanged_report_content():
    page = (STATIC_DIR / "review.html").read_text(encoding="utf-8")
    styles = (STATIC_DIR / "optical-background.css").read_text(encoding="utf-8")

    assert 'class="ambient-background review-video-background"' in page
    assert 'class="review-background-veil"' not in page
    assert "poster=" not in page
    assert 'id="report"' in page
    assert 'aria-live="polite"' in page
    assert ".review-video-background" in styles
    review_video_style_blocks = [
        block.split("}", 1)[0]
        for block in styles.split(".review-background-video {")[1:]
    ]
    assert any("object-fit: cover;" in block for block in review_video_style_blocks)
    assert any(
        "object-position: 70% center;" in block
        for block in review_video_style_blocks
    )
    assert "pointer-events: none;" in styles
    page_styles = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    for required in (
        ".review-page .evaluation-card",
        "backdrop-filter: blur(24px) saturate(125%);",
        ".review-page .score-meter",
        ".review-page .feedback-card",
        ".review-page .suggestions-card",
        ".review-page [data-pointer-glow] > .pointer-glow-rim",
    ):
        assert required in page_styles


def test_create_and_review_have_no_white_video_wash_layers():
    create_page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    review_page = (STATIC_DIR / "review.html").read_text(encoding="utf-8")
    optical_styles = (STATIC_DIR / "optical-background.css").read_text(
        encoding="utf-8"
    )
    for removed in (
        "create-background-veil",
        "create-background-fade",
        "review-background-veil",
        "rgba(237, 242, 245, .36)",
        "rgba(237, 242, 245, .4)",
        "rgba(237, 240, 242, .9)",
    ):
        assert removed not in create_page
        assert removed not in review_page
        assert removed not in optical_styles


def test_educational_motion_has_accessible_hooks():
    for page_name in ("index.html", "solve.html", "review.html"):
        page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
        assert "data-title-motion" in page
        assert "data-learning-book" in page
    background = (
        STATIC_DIR / "js" / "ui" / "solve-video-background.js"
    ).read_text(encoding="utf-8")
    assert 'document.getElementById("solveBackgroundVideo")' in background
    assert '"pointermove"' in background
    common = (STATIC_DIR / "js" / "ui" / "common.js").read_text(encoding="utf-8")
    assert '"spinner learning-loader"' in common


def test_legacy_white_background_is_not_in_the_runtime_layer_chain():
    optical_styles = (STATIC_DIR / "optical-background.css").read_text(
        encoding="utf-8"
    )
    shared_styles = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
    for page_name in ("index.html", "solve.html", "review.html"):
        page = (STATIC_DIR / page_name).read_text(encoding="utf-8")
        assert "optical-study-v2" not in page
        assert "poster=" not in page
    for removed in (
        "optical-background-plate", "optical-background-canvas",
        'data-renderer="webgl"', "optical-study-v2",
    ):
        assert removed not in optical_styles
    assert "body.create-page { background: #151c25; }" in shared_styles
    assert "body.solve-page { background: #03080d; }" in shared_styles
    assert "body.review-page { background: #11161d; }" in shared_styles


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
