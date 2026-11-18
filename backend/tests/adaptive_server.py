"""Local browser fixture: real application with synthetic adapters and a temporary DB."""
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlmodel import SQLModel, create_engine
from app.main import app
from app.graphs import challenge_graph, evaluation_graph
from app.services import adaptive_challenge, repository
from adaptive_fixtures import AdaptiveModels, SOURCES
from workflow_fixtures import FakeGithub

models = AdaptiveModels()


@asynccontextmanager
async def test_lifespan(app):
    with TemporaryDirectory(prefix="eduagent-adaptive-") as folder:
        engine = create_engine(f"sqlite:///{Path(folder) / 'test.db'}", connect_args={"check_same_thread": False})
        repository.engine = engine
        SQLModel.metadata.create_all(engine)
        adaptive_challenge.build_chat_model = models.build
        evaluation_graph.build_chat_model = models.build
        app.state.challenge_graph = challenge_graph.build_challenge_graph(FakeGithub(SOURCES))
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
    return {"grades": models.grade_calls, "banks": models.bank_calls}
