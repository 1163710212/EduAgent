import asyncio

import httpx
import pytest

from app.core import mcp
from app.core.config import settings
from app.graphs import challenge_graph as graph
from app.services.repository_language import (
    LanguageSelectionError, language_extensions, matches_language, select_dominant_language,
)


def test_code_bytes_choose_programming_language_and_preserve_distribution():
    counts = {"HTML": 90000, "CSS": 20000, "TypeScript": 6000, "JavaScript": 1000, "Python": 3000}
    result = select_dominant_language(counts)
    assert result["language"] == "typescript"
    assert result["github_language"] == "TypeScript"
    assert result["bytes"] == 6000
    assert result["total_bytes"] == 120000
    assert result["share_percent"] == 5.0
    assert result["language_bytes"] == counts
    assert result["scope"] == "repository_default_branch"


def test_equal_counts_use_stable_language_name_order():
    assert select_dominant_language({"Python": 50, "JavaScript": 50})["language"] == "javascript"
    assert select_dominant_language({"JavaScript": 50, "Python": 50})["language"] == "javascript"


@pytest.mark.parametrize("counts", [{}, {"Python": 0}, {"HTML": 100, "CSS": 50, "Jupyter Notebook": 200}])
def test_no_programming_language_never_defaults_to_python(counts):
    with pytest.raises(LanguageSelectionError, match="No programming languages"):
        select_dominant_language(counts)


def test_unsupported_dominant_language_does_not_choose_supported_runner_up():
    with pytest.raises(LanguageSelectionError, match="Dominant programming language 'Rust'"):
        select_dominant_language({"Rust": 200, "Python": 199})


@pytest.mark.parametrize("counts", [[], None, {"Python": "10"}, {"Python": True}, {"Python": -1}, {"Python": 1.5}, {"UnknownNewLanguage": 100}])
def test_invalid_or_unclassified_statistics_fail_instead_of_guessing(counts):
    with pytest.raises(ValueError):
        select_dominant_language(counts)


def test_source_extensions_keep_js_ts_and_c_cpp_separate():
    assert all(matches_language(path, "javascript") for path in ("app.js", "ui.jsx", "app.mjs", "app.cjs"))
    assert all(matches_language(path, "typescript") for path in ("app.ts", "ui.tsx", "app.mts", "app.cts"))
    assert not matches_language("app.ts", "javascript")
    assert not matches_language("app.js", "typescript")
    assert not matches_language("app.cpp", "c")
    assert not matches_language("app.c", "cpp")
    assert matches_language("app.C", "cpp")
    assert not matches_language("app.C", "c")
    assert not matches_language("common.h", "cpp")
    with pytest.raises(ValueError):
        language_extensions("unknown")


@pytest.mark.parametrize("strategy", ["tree", "directory", "search"])
def test_every_selection_strategy_filters_languages_and_typescript_declarations(strategy):
    wanted = ["src/main.ts", "src/services/logic.mts", "src/models/record.cts"]
    candidates = ["src/main.js", "src/types.d.ts", "src/types.d.mts", "src/types.d.cts", *wanted]
    calls = []

    class Github:
        def tool(self, name):
            if name == "get_repository_tree" and strategy != "tree":
                raise KeyError(name)
            if name == "get_file_contents" and strategy != "directory":
                raise KeyError(name)

            class Tool:
                async def ainvoke(self, payload):
                    calls.append((name, payload))
                    if name == "get_repository_tree":
                        return {"tree": [{"type": "blob", "path": p} for p in candidates]}
                    if name == "get_file_contents":
                        return [{"type": "file", "path": p} for p in candidates]
                    assert "language:TypeScript" in payload["query"]
                    return {"items": [{"path": p} for p in candidates]}
            return Tool()

    result = asyncio.run(graph.node_select_files({"owner": "o", "repo": "r", "language": "typescript", "question_count": 3}, Github()))
    assert result["target_paths"] == wanted
    assert calls[-1][0] == {"tree": "get_repository_tree", "directory": "get_file_contents", "search": "search_code"}[strategy]


def test_explicit_paths_cannot_bypass_detected_language():
    result = asyncio.run(graph.node_select_files({
        "language": "typescript", "question_count": 1, "requested_paths": ["src/main.py"],
    }, None))
    assert "requested paths" in result["error"]
    assert "target_paths" not in result


def test_language_timeout_stops_before_file_or_model_requests(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_READ_TIMEOUT_SECONDS", .01)

    class Github:
        async def repository_languages(self, *args):
            await asyncio.sleep(1)

        def tool(self, name):
            pytest.fail("File selection must not run without language statistics")

    result = asyncio.run(graph.build_challenge_graph(Github()).ainvoke({"repo_url": "owner/repo", "language": "python"}))
    assert "Failed to detect repository language: TimeoutError" in result["error"]
    assert "challenge" not in result


@pytest.mark.parametrize("status", [200, 302, 403])
def test_language_request_is_authenticated_read_only_bounded_and_not_redirected(monkeypatch, status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, json={"Python": 1234}, headers={"Location": "https://untrusted.invalid/"})

    original = httpx.AsyncClient

    def client(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["timeout"] == settings.GITHUB_READ_TIMEOUT_SECONDS
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(mcp.httpx, "AsyncClient", client)
    monkeypatch.setattr(settings, "GITHUB_MCP_PAT", "test-credential")
    request = mcp.GitHubMCP().repository_languages("owner", "repo space")
    if status == 200:
        assert asyncio.run(request) == {"Python": 1234}
    else:
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(request)
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert requests[0].url.host == "api.github.com"
    assert requests[0].url.raw_path == b"/repos/owner/repo%20space/languages"
    assert requests[0].headers["Authorization"] == "Bearer test-credential"
