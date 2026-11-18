import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from app import main
from app.graphs import challenge_graph, evaluation_graph
from app.services import adaptive_challenge, repository, workflow_repository
from app.services.adaptive_policy import ability_profile, decide, outcome, target_level
from app.services.adaptive_challenge import SnippetCandidate, SnippetBankArtifact, validate_candidates
from adaptive_fixtures import AdaptiveModels, SOURCES
from workflow_fixtures import FakeGithub
from test_three_question_workflow import app_client


@pytest.fixture
def adaptive_client(app_client, monkeypatch):
    client, _ = app_client
    models = AdaptiveModels()
    monkeypatch.setattr(adaptive_challenge, "build_chat_model", models.build)
    monkeypatch.setattr(evaluation_graph, "build_chat_model", models.build)
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(FakeGithub(SOURCES)))
    return client, models


def create(client):
    response = client.post("/api/challenges/create", json={"repo_url": "owner/repo"})
    assert response.status_code == 200, response.text
    return response.json()


def submit(client, q, quality="strong"):
    return client.post(f"/api/challenges/{q['session_id']}/submit", json={
        "question_id": q["question_id"], "filled_files": q["files"],
        "explanation_md": f"A {quality} answer describing the input transformation and its returned value."})


def action(client, q, name="continue"):
    return client.post(f"/api/challenges/{q['session_id']}/{name}", json={"question_id": q["question_id"]})


def run_session(client, quality):
    q = create(client)
    sid = q["session_id"]
    seen = []
    for _ in range(12):
        seen.append(q)
        response = submit(client, q, quality)
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "feedback_ready"
        response = action(client, q)
        assert response.status_code == 200, response.text
        if response.json()["status"] == "ready_for_review":
            break
        q = response.json()["challenge"]
    else:
        pytest.fail("Session exceeded its question budget")
    review = client.post(f"/api/challenges/{sid}/review/evaluate")
    assert review.status_code == 200, review.text
    return sid, seen, review.json()


def test_new_default_is_adaptive_original_short_code_with_private_bank(adaptive_client):
    client, models = adaptive_client
    q = create(client)
    assert q["workflow_version"] == 3 and q["difficulty"] == 2
    assert q["task_type"] == "rewrite" and q["adaptive"]["maximum_questions"] == 12
    assert models.bank_calls == 6
    public = json.dumps(q)
    assert all(secret not in public for secret in ("candidate_pool", "expected_points", "difficulty_reason", "source_snapshots", "answer_key"))
    pack = json.loads(repository.get_challenge_session(q["session_id"]).challenge_json)
    assert len(pack["candidate_pool"]) == 36 and len(pack["questions"]) == 1
    edit = q["edits"][0]
    target = q["files"][q["file_path"]].split("EXPLAIN_TARGET_START:focus_1\n")[1].split("# EXPLAIN_TARGET_END")[0].rstrip()
    expected = "\n".join(SOURCES[q["file_path"]].splitlines()[edit["start_line"] - 1:edit["end_line"]])
    assert target == expected
    assert edit["end_line"] - edit["start_line"] + 1 in (2, 3)
    assert client.get(f"/api/challenges/{q['session_id']}/review").status_code == 409
    assert action(client, q).status_code == 409
    assert action(client, q, "finish").status_code == 409


@pytest.mark.parametrize("quality,expected", [("strong", 4), ("weak", 1), ("partial", 2)])
def test_adapts_difficulty_stops_and_reports_evidence(adaptive_client, quality, expected):
    client, models = adaptive_client
    sid, questions, response = run_session(client, quality)
    assert 6 <= len(questions) <= 12
    assert questions[0]["difficulty"] == questions[1]["difficulty"] == 2
    assert questions[-1]["difficulty"] == expected
    assert len({(q["file_path"], q["edits"][0]["start_line"]) for q in questions}) == len(questions)
    evaluation = response["evaluation"]
    assert evaluation["score_method"] == "adaptive_evidence_v1" and "total_score" not in evaluation
    assert evaluation["ability_profile"]["valid_answers"] == len(questions)
    if quality == "partial":
        assert len(questions) == 12 and evaluation["stop_reason"] == "question_limit"
        assert evaluation["ability_profile"]["supported_level"] is None
    elif quality == "strong":
        assert evaluation["ability_profile"]["supported_level"] == 4
        assert evaluation["ability_profile"]["followup_observations"] > 0
    else:
        assert evaluation["ability_profile"]["supported_level"] is None
    assert models.grade_calls == len(questions) and models.overall_calls == 0
    assert client.post(f"/api/challenges/{sid}/review/evaluate").json() == response
    assert client.get(f"/api/challenges/{sid}").json()["status"] == "ready_for_review"


def test_failed_assessment_does_not_change_route_and_can_be_revised(adaptive_client):
    client, models = adaptive_client
    q = create(client)
    models.fail_grade = 1
    assert submit(client, q).status_code == 502
    sid = q["session_id"]
    snapshot = client.get(f"/api/challenges/{sid}").json()
    assert snapshot["status"] == "assessment_pending" and snapshot["completed_count"] == 0
    assert snapshot["challenge"]["adaptive"]["valid_answers"] == 0
    assert action(client, q).status_code == action(client, q, "finish").status_code == 409
    assert action(client, q, "skip").status_code == 409
    assert submit(client, q, "weak").status_code == 200
    stored = workflow_repository.answers(sid)[0]
    assert "weak answer" in stored.explanation_md and json.loads(stored.evaluation_json)["total_score"] == 0
    assert action(client, q).json()["challenge"]["difficulty"] == 2  # One failure cannot lower difficulty.
    prompt = next(p for schema, p in models.prompts if schema == "RubricGradeArtifact")
    assert "reference_explanation_points" in prompt


def test_concurrent_continue_is_atomic_and_refresh_restores_question(adaptive_client):
    client, models = adaptive_client
    q = create(client)
    assert submit(client, q).status_code == 200
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: action(client, q), range(4)))
    assert all(r.status_code == 200 and r.json()["challenge"]["question_id"] == "q2" for r in responses)
    sid = q["session_id"]
    pack = json.loads(repository.get_challenge_session(sid).challenge_json)
    assert len(pack["questions"]) == 2 and len(pack["adaptive"]["decisions"]) == 2
    assert client.get(f"/api/challenges/{sid}").json()["challenge"] == responses[0].json()["challenge"]
    assert submit(client, q).json()["challenge"]["question_id"] == "q2"  # Lost submission response.
    assert action(client, q, "finish").json()["challenge"]["question_id"] == "q2"  # Stale tab cannot end q2.
    assert models.grade_calls == 1


def test_skips_are_not_ability_failures_and_are_bounded(adaptive_client):
    client, models = adaptive_client
    q = create(client)
    sid = q["session_id"]
    for index in range(12):
        assert q["difficulty"] == 2
        first = action(client, q, "skip")
        assert first.status_code == 200
        assert action(client, q, "skip").json() == first.json()
        assert first.json()["challenge"]["adaptive"]["valid_answers"] == 0
        result = action(client, q).json()
        if index < 11:
            q = result["challenge"]
    assert result["status"] == "ready_for_review"
    report = client.post(f"/api/challenges/{sid}/review/evaluate").json()["evaluation"]
    assert report["ability_profile"]["supported_level"] is None
    assert report["ability_profile"]["skipped_answers"] == 12
    assert not any(level["weak_files"] for level in report["ability_profile"]["levels"])
    assert models.grade_calls == 0


def test_early_finish_is_explicit_durable_and_provisional(adaptive_client):
    client, _ = adaptive_client
    q = create(client)
    assert submit(client, q).status_code == 200
    assert action(client, q, "finish").json()["status"] == "ready_for_review"
    assert action(client, q, "finish").json()["status"] == "ready_for_review"
    report = client.post(f"/api/challenges/{q['session_id']}/review/evaluate").json()["evaluation"]
    assert report["stop_reason"] == "user_finished"
    assert report["ability_profile"]["evidence_status"] == "provisional"
    assert report["ability_profile"]["supported_level"] is None


@pytest.mark.parametrize("value", ["", " ", "1", "\u200b"])
def test_invalid_answer_never_consumes_an_adaptive_question(adaptive_client, value):
    client, models = adaptive_client
    q = create(client)
    result = client.post(f"/api/challenges/{q['session_id']}/submit", json={
        "question_id": q["question_id"], "explanation_md": value, "filled_files": q["files"]})
    assert result.status_code == 422
    assert not workflow_repository.answers(q["session_id"]) and models.grade_calls == 0


def test_small_pool_ends_with_limited_evidence_without_repeating(adaptive_client, monkeypatch):
    client, _ = adaptive_client
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(
        FakeGithub({"src/module_0.py": SOURCES["src/module_0.py"].split("\n\n")[0]})))
    q = create(client)
    assert submit(client, q).status_code == 200
    assert action(client, q).json()["status"] == "ready_for_review"
    report = client.post(f"/api/challenges/{q['session_id']}/review/evaluate").json()["evaluation"]
    assert report["stop_reason"] == "pool_exhausted"
    assert report["ability_profile"]["evidence_status"] == "provisional"


def test_dominant_language_remains_authoritative_in_adaptive_mode(adaptive_client, monkeypatch):
    client, _ = adaptive_client
    github = FakeGithub({**SOURCES, **{f"js/other_{i}.js": "return unrelated;" for i in range(15)}},
                        languages={"HTML": 9000, "Python": 6000, "JavaScript": 3000})
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(github))
    q = create(client)
    assert q["language"] == "python"
    pack = json.loads(repository.get_challenge_session(q["session_id"]).challenge_json)
    assert all(c["file_path"].endswith(".py") for c in pack["candidate_pool"])
    assert q["language_selection"]["share_percent"] == pytest.approx(33.333, abs=0.01)


def test_one_line_file_is_never_promoted_to_an_adaptive_question(adaptive_client, monkeypatch):
    client, models = adaptive_client
    monkeypatch.setattr(main.app.state, "challenge_graph", challenge_graph.build_challenge_graph(
        FakeGithub({"src/module_0.py": "return value"})))
    response = client.post("/api/challenges/create", json={"repo_url": "owner/repo"})
    assert response.status_code == 400
    assert models.bank_calls == 0


def test_missing_difficulty_uses_actual_nearest_level_without_relabeling():
    pack = {"questions": [], "candidate_pool": [
        {"candidate_id": "only", "difficulty": 1, "skill": "data_flow", "file_path": "a.py"}]}
    decision = decide(pack, [])
    assert decision["target_level"] == 2 and decision["selected_level"] == 1
    assert "No unused L2 snippet" in decision["reason"]


def test_grade_target_uses_saved_original_bounds_even_with_marker_text(adaptive_client):
    from app.services.assessment import assessment_context
    client, _ = adaptive_client
    q = create(client)
    pack = json.loads(repository.get_challenge_session(q["session_id"]).challenge_json)
    private = pack["questions"][0]
    path = private["file_path"]
    private["files"][path] += '\nexample = "EXPLAIN_TARGET_START:example"\n'
    context = assessment_context(private, "The selected lines transform and return the input.", private["files"])
    key = private["answer_key"]
    assert context["displayed_target_to_explain"][path] == "\n".join(
        key["original_source"].splitlines()[key["start_line"] - 1:key["end_line"]])
    assert len(context["displayed_target_to_explain"][path].splitlines()) in (2, 3)


def record(level, result, file, skill="data_flow"):
    return {"question_id": f"{file}-{level}", "difficulty": level, "outcome": result,
            "file_path": file, "skill": skill, "after_related_feedback": False}


def test_level_changes_need_two_distinct_files_and_clarity_never_upgrades():
    assert target_level([record(2, "strong", "a"), record(2, "strong", "a")], 2)[0] == 2
    assert target_level([record(2, "strong", "a"), record(2, "strong", "b")], 2)[0] == 3
    assert target_level([record(2, "weak", "a"), record(2, "weak", "b")], 2)[0] == 1
    assert target_level([record(2, "weak", "a"), record(2, "partial", "b")], 2)[0] == 2
    assert outcome({"passed_blanks": True, "total_score": 100, "score_breakdown": [
        {"key": "correctness", "score": 35}, {"key": "clarity", "score": 15}]}) == "weak"
    assert outcome({"passed_blanks": True, "total_score": 100}) == "unverified"


def test_stability_requires_coverage_and_boundary_not_just_many_high_scores():
    same_file = [record(4, "strong", "a") for _ in range(6)]
    assert ability_profile(same_file)["supported_level"] is None
    varied = [record(4, "strong", str(i), skill) for i, skill in enumerate(
        ("data_flow", "data_flow", "control_flow", "control_flow", "state_effects", "state_effects"))]
    assert ability_profile(varied)["stable"]
    varied.append(record(2, "weak", "x"))
    varied.append(record(2, "weak", "y"))
    assert not ability_profile(varied)["stable"]
    assert ability_profile(varied)["conflicting_evidence"]
    partial = [record(2, "partial", str(i)) for i in range(6)]
    assert not ability_profile(partial)["stable"]


def candidate(**kwargs):
    return SnippetCandidate(start_line=kwargs.pop("start_line", 1), end_line=kwargs.pop("end_line", 2),
        difficulty=2, skill="data_flow", difficulty_reason="Local data transformation.",
        expected_points=["Describe the transformation."], context_sufficient=kwargs.pop("context_sufficient", True), **kwargs)


@pytest.mark.parametrize("end", [1, 4, 20])
def test_candidate_schema_never_accepts_a_target_outside_two_or_three_lines(end):
    with pytest.raises(ValidationError):
        candidate(end_line=end)


def test_candidates_reject_missing_context_overlap_out_of_bounds_duplicates_and_imports():
    source = "value = source.strip()\nresult = value.lower()\nreturn result\n"
    bank = SnippetBankArtifact(candidates=[candidate(), candidate(start_line=2, end_line=3),
        candidate(start_line=4, end_line=5), candidate(context_sufficient=False)])
    seen = set()
    assert len(validate_candidates("a.py", source, bank, seen)) == 1
    assert not validate_candidates("b.py", source, bank, seen)
    assert not validate_candidates("a.py", "import os\nimport sys\n", SnippetBankArtifact(candidates=[candidate()]), set())
