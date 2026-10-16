"""Browser-test server ONLY. Never use this external-adapter fixture in production.

Run from backend: PYTHONPATH=.:tests uvicorn three_question_server:app --port 8137
"""
from contextlib import asynccontextmanager
from tempfile import TemporaryDirectory
from pathlib import Path

from sqlmodel import SQLModel, create_engine
from app.main import app
from app.graphs import challenge_graph, evaluation_graph
from app.services import repository, workflow
from workflow_fixtures import FakeGithub, ModelController

models = ModelController()


@asynccontextmanager
async def test_lifespan(app):
    with TemporaryDirectory(prefix="eduagent-three-question-") as folder:
        engine = create_engine(f"sqlite:///{Path(folder) / 'test.db'}", connect_args={"check_same_thread": False})
        repository.engine = engine
        SQLModel.metadata.create_all(engine)
        challenge_graph.build_chat_model = models.build
        evaluation_graph.build_chat_model = models.build
        workflow.build_chat_model = models.build
        app.state.challenge_graph = challenge_graph.build_challenge_graph(FakeGithub())
        app.state.eval_graph = evaluation_graph.build_evaluation_graph()
        yield
        engine.dispose()


app.router.lifespan_context = test_lifespan


@app.post("/__test__/fail-next-grade")
def fail_next_grade():
    models.fail_grade = models.grade_calls + 1
    return {"ok": True}


@app.get("/__test__/calls")
def calls():
    return {"grades": models.grade_calls, "overall": models.overall_calls}


@app.post("/__test__/fail-overall/{enabled}")
def fail_overall(enabled: bool):
    models.fail_overall = enabled
    return {"ok": True}
