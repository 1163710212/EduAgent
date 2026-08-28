from __future__ import annotations

import asyncio
import json

import requests

from app.core import llm as llm_module
from app.core.llm import LocalLlama3Model
from app.graphs.challenge_graph import (
    _directory_entries,
    _pick_paths_from_directory_listing,
)


def _json_response(status_code: int, payload: object) -> requests.Response:
    response = requests.Response()
    response.status_code = status_code
    response.headers["Content-Type"] = "application/json"
    response._content = json.dumps(payload).encode("utf-8")
    return response


def test_chat_completion_uses_configured_url_and_model(monkeypatch):
    captured: dict[str, object] = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs["json"]
        return _json_response(
            200,
            {"choices": [{"message": {"content": "{\"ok\": true}"}}]},
        )

    monkeypatch.setattr(llm_module.settings, "OPENAI_BASE_URL", "http://llm.internal:11434/v1")
    monkeypatch.setattr(llm_module.settings, "OPENAI_MODEL", "qwen2.5:7b")
    monkeypatch.setattr(llm_module.requests, "post", fake_post)

    result = LocalLlama3Model(temperature=0.2).invoke("test")

    assert result == '{"ok": true}'
    assert captured["url"] == "http://llm.internal:11434/v1/chat/completions"
    assert captured["json"]["model"] == "qwen2.5:7b"


def test_generate_error_includes_upstream_status_and_detail(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "OPENAI_BASE_URL", "http://llm.internal:11434/api/generate")
    monkeypatch.setattr(llm_module.settings, "OPENAI_MODEL", "missing-model")
    monkeypatch.setattr(
        llm_module.requests,
        "post",
        lambda *args, **kwargs: _json_response(404, {"error": "model not found"}),
    )

    try:
        LocalLlama3Model(temperature=0).invoke("test")
    except RuntimeError as exc:
        assert "HTTP 404" in str(exc)
        assert "model not found" in str(exc)
    else:
        raise AssertionError("Expected an upstream HTTP error")


def test_chat_completion_retries_transient_runner_failure(monkeypatch):
    responses = [
        _json_response(500, {"error": "llama runner process has terminated"}),
        _json_response(
            200,
            {"choices": [{"message": {"content": "recovered"}}]},
        ),
    ]

    monkeypatch.setattr(llm_module.settings, "OPENAI_BASE_URL", "http://llm.internal:11434/v1")
    monkeypatch.setattr(llm_module.settings, "OPENAI_MODEL", "qwen2.5:7b")
    monkeypatch.setattr(llm_module.settings, "LLM_HTTP_MAX_RETRIES", 2)
    monkeypatch.setattr(llm_module.settings, "LLM_HTTP_RETRY_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(
        llm_module.requests,
        "post",
        lambda *args, **kwargs: responses.pop(0),
    )

    assert LocalLlama3Model(temperature=0).invoke("test") == "recovered"
    assert responses == []


def test_directory_entries_decode_mcp_text_wrapper():
    payload = [
        {
            "type": "text",
            "text": '[{"name":"main.py","path":"src/main.py","type":"file","size":10}]',
        }
    ]

    assert _directory_entries(payload) == [
        {"name": "main.py", "path": "src/main.py", "type": "file", "size": 10}
    ]


def test_directory_listing_fallback_selects_matching_source_file():
    class FakeTool:
        async def ainvoke(self, payload):
            assert payload["path"] == "/"
            return [
                {
                    "type": "text",
                    "text": '[{"name":"main.py","path":"src/main.py","type":"file","size":10}]',
                }
            ]

    class FakeGithub:
        def tool(self, name):
            assert name == "get_file_contents"
            return FakeTool()

    state = {
        "owner": "owner",
        "repo": "repo",
        "ref": "main",
        "language": "python",
    }
    paths = asyncio.run(_pick_paths_from_directory_listing(state, FakeGithub()))
    assert paths == ["src/main.py"]
