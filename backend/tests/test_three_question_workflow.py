import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from anyio.from_thread import start_blocking_portal

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine

from app import main
from app.graphs import challenge_graph, evaluation_graph
from app.services import repository, workflow, workflow_repository
from app.services.file_importance import rank_source_paths
from app.utils.source_context import source_context
from workflow_fixtures import FakeGithub, ModelController, SOURCES


@pytest.fixture
def app_client(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'workflow.db'}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(repository, "engine", engine)
    models = ModelController()
    monkeypatch.setattr(challenge_graph, "build_chat_model", models.build)
    monkeypatch.setattr(evaluation_graph, "build_chat_model", models.build)
    monkeypatch.setattr(workflow, "build_chat_model", models.build)
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(FakeGithub()), raising=False)
    monkeypatch.setattr(main.app.state, "eval_graph", evaluation_graph.build_evaluation_graph(), raising=False)
    client = TestClient(main.app)
    # Share one event loop like the production ASGI worker, including concurrent requests.
    with start_blocking_portal() as portal:
        client.portal = portal
        yield client, models
        client.portal = None
    client.close()
    engine.dispose()


def create(client, task_type="rewrite"):
    response = client.post("/api/challenges/create", json={"repo_url": "owner/repo", "task_type": task_type})
    assert response.status_code == 200, response.text
    assert all(stage in response.headers["Server-Timing"] for stage in (
        "select_files;dur=", "fetch_files;dur=", "generate_questions;dur="
    ))
    return response.json()


def answer(question):
    files = question["files"]
    if question["task_type"] == "blank_fill":
        files = {p: SOURCES[p] for p in files}
    return {"question_id": question["question_id"], "explanation_md": "It preserves the input/output contract." if question["task_type"] == "rewrite" else "", "filled_files": files}


def continue_question(client, sid, question_id):
    response = client.post(f"/api/challenges/{sid}/continue", json={"question_id": question_id})
    assert response.status_code == 200, response.text
    return response.json()


def complete(client, task_type="rewrite"):
    question = create(client, task_type)
    session_id = question["session_id"]
    for i in range(3):
        assert question["question_index"] == i
        response = client.post(f"/api/challenges/{session_id}/submit", json=answer(question))
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "feedback_ready"
        assert response.json()["challenge"]["question_id"] == question["question_id"]
        assert response.json()["challenge"]["evaluation"]["total_score"] == [72, 84, 95][i]
        question = continue_question(client, session_id, question["question_id"])["challenge"]
    assert question is None
    return session_id


@pytest.mark.parametrize("task_type", ["rewrite", "blank_fill"])
def test_full_three_question_flow_and_durable_evaluations(app_client, task_type):
    client, models = app_client
    session_id = complete(client, task_type)
    assert models.grade_calls == 3, "Solve must assess each answer before advancing"
    snapshot = client.get(f"/api/challenges/{session_id}").json()
    assert snapshot["completed_count"] == 3
    assert snapshot["status"] == "ready_for_review"
    assert snapshot["challenge"] is None
    response = client.post(f"/api/challenges/{session_id}/review/evaluate")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["evaluated_count"] == 3
    assert "questions" not in data
    assert [json.loads(a.evaluation_json)["total_score"] for a in workflow_repository.answers(session_id)] == [72, 84, 95]
    assert data["evaluation"]["total_score"] == 83.7
    assert data["evaluation"]["score_method"] == "equal_weight_mean"
    assert data["status"] == "complete"
    assert models.grade_calls == 3 and models.overall_calls == 1
    assert client.get(f"/api/challenges/{session_id}/review").json() == data
    assert client.post(f"/api/challenges/{session_id}/review/evaluate").json() == data
    assert models.grade_calls == 3 and models.overall_calls == 1
    summary_prompt = next(p for schema, p in models.prompts if schema == "OverallArtifact")
    for path in SOURCES:
        assert path in summary_prompt


def test_only_current_question_exposed_no_reference_leak(app_client):
    client, _ = app_client
    q = create(client)
    assert q["question_count"] == 3 and q["question_id"] == "q1"
    assert len(q["files"]) == 1 and q["selection_reason"]
    assert "answer_key" not in json.dumps(q) and "original_source" not in json.dumps(q)
    sid = q["session_id"]
    assert client.get(f"/api/challenges/{sid}/review").status_code == 409
    assert client.post(f"/api/challenges/{sid}/review/evaluate").status_code == 409
    payload = answer(q)
    skipped = {**payload, "question_id": "q3", "filled_files": {"src/models/record.py": SOURCES["src/models/record.py"]}}
    # Obtain the server-side q3 snapshot to isolate sequence validation from payload validation.
    pack = json.loads(repository.get_challenge_session(sid).challenge_json)
    skipped["filled_files"] = pack["questions"][2]["files"]
    assert client.post(f"/api/challenges/{sid}/submit", json=skipped).status_code == 409
    response = client.post(f"/api/challenges/{sid}/submit", json=payload)
    assert response.json()["challenge"]["question_id"] == "q1"
    assert client.post(f"/api/challenges/{sid}/submit", json=payload).json() == response.json()
    assert client.get(f"/api/challenges/{sid}").json()["status"] == "feedback_ready"
    assert continue_question(client, sid, "q1")["challenge"]["question_id"] == "q2"
    assert client.post(f"/api/challenges/{sid}/submit", json={**payload, "explanation_md": "changed"}).status_code == 409
    assert len(workflow_repository.answers(sid)) == 1


def test_duplicate_concurrent_submission_advances_once(app_client):
    client, models = app_client
    q = create(client)
    sid = q["session_id"]
    payload = answer(q)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: client.post(f"/api/challenges/{sid}/submit", json=payload), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert len(workflow_repository.answers(sid)) == 1
    assert models.grade_calls == 1


def test_feedback_requires_explicit_idempotent_continue(app_client):
    client, models = app_client
    q = create(client)
    sid = q["session_id"]
    url = f"/api/challenges/{sid}"
    assert client.post(url + "/continue", json={"question_id": "q1"}).status_code == 409
    assert client.post(url + "/continue", json={"question_id": "q4"}).status_code == 422
    result = client.post(url + "/submit", json=answer(q)).json()
    assert result["status"] == "feedback_ready"
    assert result["challenge"]["evaluation"]["total_score"] == 72
    assert client.get(url).json()["challenge"] == result["challenge"]
    pack = json.loads(repository.get_challenge_session(sid).challenge_json)
    assert client.post(url + "/submit", json=answer(pack["questions"][1])).status_code == 409
    assert client.post(url + "/continue", json={"question_id": "q2"}).status_code == 409
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post(url + "/continue", json={"question_id": "q1"}), range(2)))
    assert all(r.status_code == 200 and r.json()["challenge"]["question_id"] == "q2" for r in responses)
    assert workflow_repository.acknowledged(sid) == {"q1"}
    assert models.grade_calls == 1


def test_pending_assessment_cannot_advance_on_refresh(app_client, monkeypatch):
    client, models = app_client
    q = create(client)
    sid = q["session_id"]
    started, release = Event(), Event()
    original = main.app.state.eval_graph
    class SlowGraph:
        async def ainvoke(self, state):
            started.set()
            assert await asyncio.to_thread(release.wait, 5)
            return await original.ainvoke(state)
    monkeypatch.setattr(main.app.state, "eval_graph", SlowGraph())
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(client.post, f"/api/challenges/{sid}/submit", json=answer(q))
        try:
            assert started.wait(5)
            snapshot = client.get(f"/api/challenges/{sid}").json()
            assert snapshot["completed_count"] == 0
            assert snapshot["status"] == "assessment_pending"
            assert snapshot["challenge"]["question_id"] == "q1"
            assert snapshot["challenge"]["pending_answer"] == answer(q)
            assert client.get(f"/api/challenges/{sid}/review").status_code == 409
        finally:
            release.set()
        result = pending.result(timeout=5).json()
        assert result["status"] == "feedback_ready"
        assert result["challenge"]["question_id"] == "q1"
    assert models.grade_calls == 1


def test_old_saved_unassessed_answers_resume_in_solve(app_client):
    from sqlmodel import Session
    from app.services.models import QuestionAnswer
    client, models = app_client
    q = create(client)
    sid = q["session_id"]
    pack = json.loads(repository.get_challenge_session(sid).challenge_json)
    # Simulate a pre-migration session that saved all three answers before grading.
    with Session(repository.engine) as db:
        for index, question in enumerate(pack["questions"]):
            payload = answer(question)
            db.add(QuestionAnswer(session_id=sid, question_id=question["question_id"], position=index,
                                  explanation_md=payload["explanation_md"],
                                  filled_files_json=json.dumps(payload["filled_files"])))
        db.commit()
    assert client.post(f"/api/challenges/{sid}/review/evaluate").status_code == 409
    for index in range(3):
        snapshot = client.get(f"/api/challenges/{sid}").json()
        assert snapshot["completed_count"] == index
        assert snapshot["status"] == "assessment_pending"
        payload = snapshot["challenge"]["pending_answer"]
        response = client.post(f"/api/challenges/{sid}/submit", json=payload)
        assert response.status_code == 200, response.text
        result = continue_question(client, sid, payload["question_id"])
    assert result["status"] == "ready_for_review"
    assert models.grade_calls == 3


@pytest.mark.parametrize("task_type", ["rewrite", "blank_fill"])
def test_invalid_answers_do_not_advance(app_client, task_type):
    client, _ = app_client
    q = create(client, task_type)
    sid = q["session_id"]
    invalid = answer(q)
    invalid["explanation_md"] = " "
    if task_type == "blank_fill":
        invalid["filled_files"] = q["files"]
    assert client.post(f"/api/challenges/{sid}/submit", json=invalid).status_code == 422
    invalid = answer(q)
    invalid["filled_files"] = {"unexpected.py": "print('wrong')"}
    assert client.post(f"/api/challenges/{sid}/submit", json=invalid).status_code == 422
    assert client.get(f"/api/challenges/{sid}").json()["completed_count"] == 0


def test_grade_and_synthesis_failures_resume_without_regrading(app_client):
    client, models = app_client
    q = create(client)
    sid = q["session_id"]
    submit_url = f"/api/challenges/{sid}/submit"
    assert client.post(submit_url, json=answer(q)).json()["status"] == "feedback_ready"
    q = continue_question(client, sid, "q1")["challenge"]
    payload = answer(q)
    models.fail_grade = 2
    assert client.post(submit_url, json=payload).status_code == 502
    snapshot = client.get(f"/api/challenges/{sid}").json()
    assert snapshot["completed_count"] == 1
    assert snapshot["status"] == "assessment_pending"
    assert snapshot["challenge"]["question_id"] == "q2"
    assert snapshot["challenge"]["pending_answer"] == payload
    assert client.get(f"/api/challenges/{sid}/review").status_code == 409
    pack = json.loads(repository.get_challenge_session(sid).challenge_json)
    assert client.post(submit_url, json=answer(pack["questions"][2])).status_code == 409
    assert client.post(submit_url, json={**payload, "explanation_md": "changed"}).status_code == 409
    assert client.post(submit_url, json=payload).json()["status"] == "feedback_ready"
    q = continue_question(client, sid, "q2")["challenge"]
    assert q["question_id"] == "q3"
    assert client.post(submit_url, json=answer(q)).json()["status"] == "feedback_ready"
    assert continue_question(client, sid, "q3")["status"] == "ready_for_review"
    url = f"/api/challenges/{sid}/review/evaluate"
    models.fail_overall = True
    assert client.post(url).status_code == 502
    assert client.get(f"/api/challenges/{sid}/review").json()["evaluation"] is None
    models.fail_overall = False
    assert client.post(url).json()["status"] == "complete"
    assert models.grade_calls == 4  # Three successes, one failed call; q1 wasn't regraded.


def test_insufficient_source_files_never_create_fake_questions(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(FakeGithub({"main.py": "print('hello')"})))
    response = client.post("/api/challenges/create", json={"repo_url": "owner/repo"})
    assert response.status_code == 400
    assert "3 distinct source files" in response.json()["detail"]


def test_structure_ranking_prefers_important_and_diverse_modules():
    candidates = ["tests/test_app.py", "vendor/main.py", "node_modules/app.py", "src/__init__.py",
                  "src/main.py", "src/services/billing.py", "src/services/orders.py", "src/models/order.py",
                  "src/foo.py", "src/generated/client.py", "examples/main.py"]
    selected = rank_source_paths(candidates, 3)
    assert selected == ["src/main.py", "src/services/billing.py", "src/models/order.py"]
    assert rank_source_paths(list(reversed(candidates)), 3) == selected


def test_directory_fallback_scans_beyond_first_three_files():
    visited = []
    class Github:
        def tool(self, name):
            class Tool:
                async def ainvoke(self, payload):
                    visited.append(payload["path"])
                    items = ([{"path": p, "type": "file"} for p in ["a.py", "b.py", "c.py"]]
                             + [{"path": "src", "type": "dir"}]) if payload["path"] == "/" else [
                        {"path": p, "type": "file"} for p in SOURCES
                    ]
                    return [{"text": json.dumps(items)}]
            return Tool()
    selected = asyncio.run(challenge_graph._pick_paths_from_directory_listing(
        {"owner": "o", "repo": "r", "language": "python"}, Github(), max_files=3))
    assert selected == list(SOURCES)
    assert visited == ["/", "src"]


def test_create_form_no_longer_accepts_manual_file():
    assert 'id="filePath"' not in main.create_ui().body.decode()
    assert "file_paths" not in main.CreateChallengeRequest.model_fields


@pytest.mark.parametrize("payload", [
    [{"type": "text", "text": "Successfully downloaded file"},
     {"type": "resource", "resource": {"text": "def run():\n    return 1\n"}}],
    {"content": "def run():\n    return 1\n", "encoding": "utf-8"},
    [{"type": "text", "text": json.dumps({"content": "ZGVmIHJ1bigpOlxu", "encoding": "base64"})}],
])
def test_mcp_file_payloads_do_not_turn_status_text_into_code(payload):
    content = challenge_graph._extract_text_from_file_payload(payload)
    assert content.startswith("def run():")
    assert "Successfully downloaded" not in content


@pytest.mark.parametrize("status_only", [False, True])
def test_adapter_file_responses_reach_api_without_status_contamination(app_client, monkeypatch, status_only):
    from langchain_mcp_adapters.tools import _convert_mcp_content_to_lc_block
    from mcp.types import EmbeddedResource, TextContent, TextResourceContents
    from sqlmodel import Session, select
    from app.services.models import ChallengeSession

    class AdapterGithub(FakeGithub):
        def tool(self, name):
            if name != "get_file_contents":
                return super().tool(name)
            class Tool:
                async def ainvoke(self, request):
                    path = request["path"]
                    blocks = [TextContent(type="text", text="successfully downloaded text file (SHA: 5cabdcba70a0d3d9c3f5598eb4dc930607701f37)")]
                    # One bad read must prevent saving the entire three-question pack.
                    if not status_only or path != list(SOURCES)[1]:
                        blocks.append(EmbeddedResource(type="resource", resource=TextResourceContents(
                            uri=f"file:///{path}", text=SOURCES[path], mimeType="text/x-python")))
                    return [_convert_mcp_content_to_lc_block(block) for block in blocks]
            return Tool()

    client, models = app_client
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(AdapterGithub()))
    if status_only:
        response = client.post("/api/challenges/create", json={"repo_url": "owner/repo"})
        assert response.status_code == 502, response.text
        assert "source body" in response.json()["detail"]
        assert models.prompts == [], "Invalid sources must never be sent to the model"
        with Session(repository.engine) as session:
            assert session.exec(select(ChallengeSession)).all() == []
    else:
        question = create(client)
        for path, source in SOURCES.items():
            assert list(question["files"]) == [path]
            rendered = question["files"][path]
            assert "successfully downloaded" not in rendered
            actual = "\n".join(line for line in rendered.splitlines() if "EXPLAIN_TARGET_" not in line) + "\n"
            assert actual == source
            response = client.post(f"/api/challenges/{question['session_id']}/submit", json=answer(question))
            assert response.status_code == 200, response.text
            question = continue_question(client, question["session_id"], question["question_id"])["challenge"]
        assert question is None
        assert all("successfully downloaded" not in prompt for _, prompt in models.prompts)


def test_direct_directory_and_search_payloads_supported():
    assert challenge_graph._directory_entries([{"type": "file", "path": "src/main.py"}]) == [{"type": "file", "path": "src/main.py"}]


@pytest.mark.parametrize("legacy", [False, True])
def test_contaminated_saved_sessions_are_blocked_without_modification(app_client, legacy):
    from sqlmodel import Session
    client, models = app_client
    question = create(client)
    sid = question["session_id"]
    payload = answer(question)
    if not legacy:
        assert client.post(f"/api/challenges/{sid}/submit", json=payload).status_code == 200
    row = repository.get_challenge_session(sid)
    pack = json.loads(row.challenge_json)
    if legacy:
        pack = pack["questions"][0]
    bad = pack if legacy else pack["questions"][1]
    bad["files"] = {bad["file_path"]: "# EXPLAIN_TARGET_START:focus_1\nsuccessfully downloaded text file (SHA: 0b79d09327c11894ad33bcaf10ab6b79c8cfccf2)\n# EXPLAIN_TARGET_END:focus_1"}
    bad.pop("answer_key", None)  # Actual old snapshots did not contain original_source.
    row.challenge_json = json.dumps(pack)
    with Session(repository.engine) as session:
        session.add(row)
        session.commit()
    before = repository.get_challenge_session(sid).challenge_json
    answers_before = [item.model_dump() for item in workflow_repository.answers(sid)]
    prompts_before = len(models.prompts)
    for method, suffix, kwargs in [
        ("get", "", {}), ("post", "/submit", {"json": payload}),
        ("get", "/review", {}), ("post", "/review/evaluate", {}),
    ]:
        response = getattr(client, method)(f"/api/challenges/{sid}{suffix}", **kwargs)
        assert response.status_code == 409, response.text
        assert "/create" in response.json()["detail"]
        assert "download notice" in response.json()["detail"]
    assert repository.get_challenge_session(sid).challenge_json == before
    assert [item.model_dump() for item in workflow_repository.answers(sid)] == answers_before
    assert len(models.prompts) == prompts_before


def test_generated_receipt_is_rejected_before_persistence(app_client, monkeypatch):
    from sqlmodel import Session, select
    from app.services.models import ChallengeSession
    client, _ = app_client
    build = challenge_graph._build_rewrite_payload
    def contaminated(state, artifact):
        result = build(state, artifact)
        result["files"] = {path: "# EXPLAIN_TARGET_START:focus_1\nsuccessfully downloaded text file (SHA: abc123)\n# EXPLAIN_TARGET_END:focus_1" for path in result["files"]}
        return result
    monkeypatch.setattr(challenge_graph, "_build_rewrite_payload", contaminated)
    response = client.post("/api/challenges/create", json={"repo_url": "owner/repo"})
    assert response.status_code == 502, response.text
    with Session(repository.engine) as session:
        assert session.exec(select(ChallengeSession)).all() == []


def test_saved_progress_survives_new_database_connection(app_client, monkeypatch):
    client, _ = app_client
    q = create(client)
    sid = q["session_id"]
    client.post(f"/api/challenges/{sid}/submit", json=answer(q))
    engine = create_engine(repository.engine.url, connect_args={"check_same_thread": False})
    monkeypatch.setattr(repository, "engine", engine)
    try:
        restored = client.get(f"/api/challenges/{sid}").json()
        assert restored["completed_count"] == 1
        assert restored["status"] == "feedback_ready"
        assert restored["challenge"]["question_id"] == "q1"
        assert restored["challenge"]["evaluation"]["total_score"] == 72
    finally:
        engine.dispose()


def test_concurrent_review_requests_serialize_stages(app_client):
    client, models = app_client
    sid = complete(client)
    row = repository.get_challenge_session(sid)
    pack = json.loads(row.challenge_json)
    graph = main.app.state.eval_graph

    async def concurrent():
        return await asyncio.gather(*(workflow.evaluate_next(row, pack, graph) for _ in range(4)))
    results = asyncio.run(concurrent())
    assert results[-1]["status"] == "complete"
    assert models.grade_calls == 3 and models.overall_calls == 1


def test_late_target_in_large_file_is_present_in_grading_context():
    source = "# filler\n" * 3000 + "return important_business_result\n"
    q = {"answer_key": {"start_line": 3001, "end_line": 3001, "original_source": source}, "files": {"core.py": source}}
    excerpt = source_context(source, q)
    assert len(excerpt) <= 12000
    assert "return important_business_result" in excerpt
    prompt = evaluation_graph._build_grade_prompt({"challenge": q, "filled_files": {"core.py": source}})
    assert prompt.count("return important_business_result") == 2
