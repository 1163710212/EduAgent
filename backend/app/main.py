from __future__ import annotations

import json
import inspect
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.core.mcp import GitHubMCP
from app.services.db import init_db
from app.services import repository
from app.graphs.challenge_graph import build_challenge_graph
from app.graphs.evaluation_graph import build_evaluation_graph

STATIC_DIR = Path(__file__).resolve().parent / "static"
FAVICON_PATH = STATIC_DIR / "favicon.ico"
logger = logging.getLogger(__name__)


def _challenge_error_status(detail: str) -> int:
    normalized = detail.lower()
    infra_markers = (
        "failed to select files:",
        "failed to initialize file content tool:",
        "failed to fetch file",
        "failed to generate challenge artifact:",
    )
    client_markers = (
        "repo_url is required",
        "only github.com urls are supported",
        "invalid github repo url",
        "task_type must be one of",
        "no suitable code files found",
        "challenge changed_file must",
        "target file is empty",
        "missing from fetched source files",
        "challenge must include exactly one",
        "rewrite task must",
        "blank_fill task must",
        "generated task_type mismatch",
        "could not read file:",
    )
    if any(m in normalized for m in infra_markers):
        return 502
    if any(m in normalized for m in client_markers):
        return 400
    # 未知错误倾向按上游失败处理，避免误判为客户端参数问题
    return 502


class CreateChallengeRequest(BaseModel):
    repo_url: str = Field(min_length=1)
    ref: str = "main"
    language: str = "python"
    task_type: Literal["rewrite", "blank_fill"] = "rewrite"
    # 可选：指定文件路径（否则自动挑 1 个）
    file_paths: List[str] = Field(default_factory=list)

    @field_validator("repo_url")
    @classmethod
    def normalize_repo_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("repo_url cannot be empty")
        return value


class CreateChallengeResponse(BaseModel):
    session_id: str
    task_type: Literal["rewrite", "blank_fill"]
    title: str
    language: str
    student_instructions_md: str
    files: Dict[str, str]  # modified files shown to student
    edits: List[Dict[str, Any]]
    blanks: List[Dict[str, Any]]


class SubmitRequest(BaseModel):
    explanation_md: str = ""
    filled_files: Dict[str, str]


class SubmitResponse(BaseModel):
    session_id: str
    evaluation: Dict[str, Any]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # db
    init_db()

    # github mcp
    github = GitHubMCP()
    await github.init()
    app.state.github = github

    # graphs
    app.state.challenge_graph = build_challenge_graph(github)
    app.state.eval_graph = build_evaluation_graph()

    try:
        yield
    finally:
        client = getattr(github, "client", None)
        if client is None:
            return

        close_async = getattr(client, "aclose", None)
        if callable(close_async):
            await close_async()
            return

        close_sync = getattr(client, "close", None)
        if callable(close_sync):
            maybe_awaitable = close_sync()
            if inspect.isawaitable(maybe_awaitable):
                await maybe_awaitable


app = FastAPI(title="Edu-Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ALLOW_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# static
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def ui():
    with open(STATIC_DIR / "index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    if FAVICON_PATH.exists():
        return FileResponse(FAVICON_PATH)
    return Response(status_code=204)


@app.post("/api/challenges/create", response_model=CreateChallengeResponse)
async def create_challenge(req: CreateChallengeRequest):
    graph = app.state.challenge_graph

    state = {
        "repo_url": req.repo_url,
        "ref": req.ref,
        "language": req.language,
        "task_type": req.task_type,
        "requested_paths": req.file_paths,
    }

    try:
        out = await graph.ainvoke(state)
    except Exception as e:
        logger.exception("Challenge pipeline failed for repo_url=%s ref=%s", req.repo_url, req.ref)
        raise HTTPException(status_code=502, detail=f"Challenge pipeline failed: {e}")

    if out.get("error"):
        detail = str(out["error"])
        status_code = _challenge_error_status(detail)
        logger.warning(
            "Challenge creation rejected status=%s repo_url=%s ref=%s task_type=%s error=%s",
            status_code,
            req.repo_url,
            req.ref,
            req.task_type,
            detail,
        )
        raise HTTPException(status_code=status_code, detail=detail)

    challenge = out.get("challenge")
    if not isinstance(challenge, dict):
        raise HTTPException(status_code=500, detail="Invalid challenge artifact generated.")
    task_type = challenge.get("task_type", req.task_type)
    if task_type not in ("rewrite", "blank_fill"):
        task_type = req.task_type

    try:
        # 入库（MVP 直接保存 challenge JSON 供后续评估使用）
        row = repository.create_challenge_session(
            repo_url=req.repo_url,
            owner=out["owner"],
            repo=out["repo"],
            ref=req.ref,
            language=req.language,
            target_paths=out.get("target_paths", []),
            challenge=challenge,
        )
    except KeyError as e:
        logger.exception("Missing pipeline field while persisting challenge: %s", e)
        raise HTTPException(status_code=500, detail=f"Missing pipeline field: {e}")
    except Exception as e:
        logger.exception("Failed to persist challenge session")
        raise HTTPException(status_code=500, detail=f"Failed to persist challenge session: {e}")

    # 返回给学生端：仅返回作答所需字段
    resp = {
        "session_id": row.id,
        "task_type": task_type,
        "title": challenge["title"],
        "language": challenge["language"],
        "student_instructions_md": challenge["student_instructions_md"],
        "files": challenge["files"],
        "edits": challenge["edits"],
        "blanks": challenge.get("blanks", []),
    }
    return resp


@app.get("/api/challenges/{session_id}")
def get_challenge(session_id: str):
    row = repository.get_challenge_session(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    challenge = json.loads(row.challenge_json)
    task_type = challenge.get("task_type", "rewrite")
    if task_type not in ("rewrite", "blank_fill"):
        task_type = "rewrite"
    data = {
        "session_id": row.id,
        "repo_url": row.repo_url,
        "owner": row.owner,
        "repo": row.repo,
        "ref": row.ref,
        "language": row.language,
        "target_paths": json.loads(row.target_paths_json),
        "challenge": {
            "task_type": task_type,
            "title": challenge["title"],
            "language": challenge["language"],
            "student_instructions_md": challenge["student_instructions_md"],
            "files": challenge["files"],
            "edits": challenge["edits"],
            "blanks": challenge.get("blanks", []),
        },
    }
    return data


@app.post("/api/challenges/{session_id}/submit", response_model=SubmitResponse)
async def submit(session_id: str, req: SubmitRequest):
    row = repository.get_challenge_session(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    challenge = json.loads(row.challenge_json)
    graph = app.state.eval_graph

    state = {
        "session": row.model_dump(),
        "challenge": challenge,
        "filled_files": req.filled_files,
        "explanation_md": req.explanation_md,
    }

    try:
        out = await graph.ainvoke(state)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Evaluation pipeline failed: {e}")

    if out.get("error"):
        raise HTTPException(status_code=400, detail=out["error"])

    evaluation = out.get("evaluation")
    if not isinstance(evaluation, dict):
        raise HTTPException(status_code=500, detail="Invalid evaluation artifact generated.")

    try:
        repository.create_submission(
            session_id=session_id,
            explanation_md=req.explanation_md,
            filled_files=req.filled_files,
            evaluation=evaluation,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to persist submission: {e}")

    return {"session_id": session_id, "evaluation": evaluation}
