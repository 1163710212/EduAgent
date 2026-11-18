"""Replay the reported model output and safely revise failed assessments."""
import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import main
from app.core import llm as llm_module
from app.core.llm import LocalLlama3StructuredModel
from app.graphs import evaluation_graph
from app.graphs.prompts import RubricGradeArtifact
from app.services import repository, workflow_repository
from test_three_question_workflow import app_client, answer, create, continue_question


def zero_response():
    return {
        "verdict": "incorrect",
        "correctness": {"points": 0, "evidence": ["high"],
                        "reason": "The response does not demonstrate any understanding of the target code."},
        "reasoning": {"points": 0, "evidence": [], "reason": ""},
        "clarity": {"points": 0, "evidence": [], "reason": ""},
        "critical_errors": ["The response does not explain the semantics, control flow or design intent."],
        "suggestions": ['Explain why ConsumerTypeInvalid returns "invalid" and ConsumerTypeService returns "service".'],
    }


class TextModel:
    def __init__(self, text):
        self.text = text
        self.prompts = []

    def with_structured_output(self, schema):
        return LocalLlama3StructuredModel(base=self, schema=schema)

    def invoke(self, prompt):
        self.prompts.append(prompt)
        return self.text

    async def ainvoke(self, prompt):
        return self.invoke(prompt)


def malformed_suggestions():
    response = zero_response()
    response.pop("suggestions")
    return json.dumps(response)[:-1] + ', "suggestions": ["Explain why it returns "invalid" or "service"."] }'


@pytest.mark.parametrize("reason", ["", " \n\t", None, "missing"])
def test_zero_credit_does_not_require_invented_reason(reason):
    response = zero_response()
    for key in ("reasoning", "clarity"):
        if reason == "missing":
            response[key].pop("reason")
        else:
            response[key]["reason"] = reason
    grade = RubricGradeArtifact.model_validate(response)
    assert grade.reasoning.points == grade.clarity.points == 0
    assert grade.reasoning.reason == grade.clarity.reason == "No credit was awarded for this criterion."


@pytest.mark.parametrize("reason", ["", " \n", None, "missing"])
def test_positive_credit_still_requires_a_reason(reason):
    response = zero_response()
    response["reasoning"].update(points=10, evidence=["high"], reason=reason)
    if reason == "missing":
        response["reasoning"].pop("reason")
    with pytest.raises(ValueError):
        RubricGradeArtifact.model_validate(response)


@pytest.mark.parametrize("malformed", [False, True])
def test_reported_response_persists_zero_and_returns_feedback(app_client, monkeypatch, malformed):
    client, _ = app_client
    q = create(client)
    model = TextModel(malformed_suggestions() if malformed else json.dumps(zero_response()))
    monkeypatch.setattr(evaluation_graph, "build_chat_model", lambda **_: model)
    response = client.post(f"/api/challenges/{q['session_id']}/submit", json={**answer(q), "explanation_md": "high"})
    assert response.status_code == 200, response.text
    state = response.json()
    grade = state["challenge"]["evaluation"]
    assert state["status"] == "feedback_ready"
    assert state["completed_count"] == 1
    assert grade["total_score"] == 0 and grade["passed_blanks"] is False
    assert all(d["reason"].strip() for d in grade["score_breakdown"])
    assert len(model.prompts) == 1, "Zero-point empty reasons must not cause repeated repair calls"
    assert client.get(f"/api/challenges/{q['session_id']}").json()["challenge"]["evaluation"] == grade
    assert continue_question(client, q["session_id"], q["question_id"])["challenge"]["question_id"] == "q2"


def test_only_broken_optional_suggestions_are_dropped():
    model = TextModel(malformed_suggestions()).with_structured_output(RubricGradeArtifact)
    grade = model.invoke("Assess the answer")
    assert grade.suggestions == []
    assert grade.correctness.points == 0
    assert grade.critical_errors == zero_response()["critical_errors"]
    assert len(model.base.prompts) == 1


@pytest.mark.parametrize("field", ["verdict", "correctness", "reasoning", "clarity", "critical_errors"])
def test_malformed_grading_fields_are_never_recovered_as_scores(field):
    response = zero_response()
    raw = "{" + ",".join(json.dumps(key) + ":" + ("BROKEN" if key == field else json.dumps(value))
                           for key, value in response.items()) + "}"
    model = TextModel(raw).with_structured_output(RubricGradeArtifact)
    with pytest.raises(ValueError):
        model._parse_structured(raw)


def test_malformed_suggestions_before_required_data_cannot_hide_missing_scores():
    raw = '{"suggestions": ["Bad "quotes" here"], ' + json.dumps(zero_response())[1:]
    model = TextModel(raw).with_structured_output(RubricGradeArtifact)
    with pytest.raises(ValueError):
        model._parse_structured(raw)


@pytest.mark.parametrize("async_call", [False, True])
def test_json_repair_receives_the_actual_validation_failure(monkeypatch, async_call):
    response = zero_response()
    response["reasoning"].update(points=10, evidence=["high"])
    model = TextModel(json.dumps(response)).with_structured_output(RubricGradeArtifact)
    monkeypatch.setattr(llm_module.settings, "LLM_STRUCTURED_MAX_RETRY_CYCLES", 1)
    with pytest.raises(ValueError):
        if async_call:
            asyncio.run(model.ainvoke("Assess the answer"))
        else:
            model.invoke("Assess the answer")
    assert len(model.base.prompts) == 2
    assert "positive points must explain" in model.base.prompts[1]
    assert "Escape embedded double quotes" in model.base.prompts[1]


def revised_answer(q):
    if q["task_type"] == "rewrite":
        return {**answer(q), "explanation_md": "Imports normalize and defines run(value), returning the normalized input."}
    return {**answer(q), "filled_files": {"src/main.py":
        "from services.transform import normalize\n\ndef run(value):\n    return (normalize(value))\n"}}


@pytest.mark.parametrize("kind", ["rewrite", "blank_fill"])
def test_failed_answer_can_be_revised_without_changing_completed_answers(app_client, kind):
    client, models = app_client
    q = create(client, kind)
    sid = q["session_id"]
    url = f"/api/challenges/{sid}/submit"
    payload = answer(q)
    models.fail_grade = 1
    failed = client.post(url, json=payload)
    assert failed.status_code == 502
    assert "edit" in failed.json()["detail"]
    assert "Temporary model outage" not in failed.text
    assert len(failed.text) < 250
    invalid = {**payload, "explanation_md": "1"} if kind == "rewrite" else {**payload, "filled_files": q["files"]}
    assert client.post(url, json=invalid).status_code == 422
    assert client.get(f"/api/challenges/{sid}").json()["challenge"]["pending_answer"] == payload
    assert models.grade_calls == 1
    revised = revised_answer(q)
    result = client.post(url, json=revised)
    assert result.status_code == 200, result.text
    assert result.json()["challenge"]["pending_answer"] == revised
    assert result.json()["status"] == "feedback_ready"
    assert len(workflow_repository.answers(sid)) == 1
    assert client.post(url, json=payload).status_code == 409
    assert client.post(url, json=revised).json() == result.json()
    assert models.grade_calls == 2


def test_concurrent_identical_revisions_are_graded_once(app_client):
    client, models = app_client
    q = create(client)
    url = f"/api/challenges/{q['session_id']}/submit"
    models.fail_grade = 1
    assert client.post(url, json=answer(q)).status_code == 502
    revised = revised_answer(q)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: client.post(url, json=revised), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert models.grade_calls == 2
    assert len(workflow_repository.answers(q["session_id"])) == 1


@pytest.mark.parametrize("kind", ["rewrite", "blank_fill"])
def test_a_stale_grade_cannot_be_attached_to_revised_answer(app_client, monkeypatch, kind):
    client, _ = app_client
    q = create(client, kind)
    sid = q["session_id"]
    revised = revised_answer(q)
    real_graph = main.app.state.eval_graph

    class OtherWorkerRevises:
        async def ainvoke(self, state):
            # Simulate another process; it does not share the current worker's lock.
            workflow_repository.accept_answer(sid, q["question_id"], 0,
                revised["explanation_md"], revised["filled_files"], allow_revision=True)
            return await real_graph.ainvoke(state)

    monkeypatch.setattr(main.app.state, "eval_graph", OtherWorkerRevises())
    response = client.post(f"/api/challenges/{sid}/submit", json=answer(q))
    assert response.status_code == 409, response.text
    saved = workflow_repository.answers(sid)[0]
    assert saved.evaluation_json is None
    assert saved.explanation_md == revised["explanation_md"]
    assert json.loads(saved.filled_files_json) == revised["filled_files"]
    monkeypatch.setattr(main.app.state, "eval_graph", real_graph)
    retry = client.post(f"/api/challenges/{sid}/submit", json=revised)
    assert retry.status_code == 200, retry.text
    assert retry.json()["challenge"]["pending_answer"] == revised
