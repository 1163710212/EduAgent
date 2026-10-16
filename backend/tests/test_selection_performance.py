"""Latency-injected checks: bounded concurrency, stable ranking, safe fallback."""
import asyncio
import time

import httpx
import pytest

from app.core import mcp
from app.core.config import settings
from app.graphs import challenge_graph as graph
from workflow_fixtures import ModelController, SOURCES


def state():
    return {"owner": "owner", "repo": "repo", "ref": "main", "language": "python",
            "task_type": "rewrite", "question_count": 3}


class DirectoryGithub:
    def __init__(self, delay=.025):
        self.calls = []
        self.active = self.peak = 0
        self.delay = delay

    def tool(self, name):
        if name != "get_file_contents":
            raise KeyError(name)
        outer = self

        class Tool:
            async def ainvoke(self, payload):
                path = payload["path"]
                outer.calls.append(path)
                outer.active += 1
                outer.peak = max(outer.peak, outer.active)
                try:
                    await asyncio.sleep(outer.delay)
                    if path == "/":
                        return [{"type": "dir", "path": name} for name in [
                            "src", "tests", "docs", "examples", "vendor", "node_modules", ".git"
                        ]]
                    if path == "src":
                        return [{"type": "dir", "path": f"src/module_{i:02d}"} for i in range(12)]
                    if not path.startswith("src/module_"):
                        raise AssertionError(f"Excluded directory fetched: {path}")
                    return [{"type": "file", "path": f"{path}/main.py"}]
                finally:
                    outer.active -= 1
        return Tool()


def test_directory_parallelism_keeps_selection_and_skips_non_source_trees(monkeypatch):
    results, elapsed, instances = [], [], []
    for concurrency in (1, 4):
        monkeypatch.setattr(settings, "GITHUB_READ_CONCURRENCY", concurrency)
        github = DirectoryGithub()
        started = time.perf_counter()
        results.append(asyncio.run(graph._pick_paths_from_directory_listing(state(), github, max_files=3)))
        elapsed.append(time.perf_counter() - started)
        instances.append(github)
    assert results[0] == results[1] and len(results[1]) == 3
    assert instances[0].peak == 1 and instances[1].peak == 4
    assert len(instances[1].calls) == 14
    assert instances[1].active == 0
    print(f"Directory latency benchmark: serial={elapsed[0]:.3f}s parallel={elapsed[1]:.3f}s calls=14 selected_equal=True")


def test_directory_budget_and_duplicate_entries_are_bounded(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_READ_CONCURRENCY", 4)
    github = DirectoryGithub(delay=0)
    asyncio.run(graph._pick_paths_from_directory_listing(state(), github, max_files=3, max_directories=5))
    assert len(github.calls) == 5
    assert len(set(github.calls)) == 5


def test_rest_tree_fast_path_avoids_directory_requests():
    class Github:
        tree_calls = 0

        def tool(self, name):
            assert name == "get_repository_tree", "Directory traversal should be unnecessary"
            raise KeyError(name)

        async def repository_tree(self, owner, repo, ref):
            self.tree_calls += 1
            assert (owner, repo, ref) == ("owner", "repo", "main")
            return {"tree": [{"path": p, "type": "blob"} for p in SOURCES], "truncated": False}

    github = Github()
    result = asyncio.run(graph.node_select_files(state(), github))
    assert result["target_paths"] == list(SOURCES)
    assert github.tree_calls == 1


@pytest.mark.parametrize("truncated", [True, False])
def test_truncated_or_failed_tree_falls_back_to_complete_directory_selection(truncated):
    class Github(DirectoryGithub):
        async def repository_tree(self, *args):
            if not truncated:
                raise httpx.ConnectError("offline")
            return {"tree": [{"path": p, "type": "blob"} for p in SOURCES], "truncated": True}

    github = Github(delay=0)
    result = asyncio.run(graph.node_select_files(state(), github))
    assert len(result["target_paths"]) == 3
    assert github.calls  # Never treat a truncated tree as a complete ranking.
    assert all("module_" in path for path in result["target_paths"])


@pytest.mark.parametrize("status", [200, 302, 403])
def test_rest_tree_is_read_only_encoded_and_never_redirects_credentials(monkeypatch, status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, json={"tree": [], "truncated": False},
                              headers={"Location": "https://untrusted.invalid/"})

    original = httpx.AsyncClient
    def client(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["timeout"] == settings.GITHUB_READ_TIMEOUT_SECONDS
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(mcp.httpx, "AsyncClient", client)
    monkeypatch.setattr(settings, "GITHUB_MCP_PAT", "test-credential")
    request = mcp.GitHubMCP().repository_tree("owner", "repo", "feature/new-ui")
    if status == 200:
        assert asyncio.run(request)["tree"] == []
    else:
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(request)
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert requests[0].url.host == "api.github.com"
    assert b"feature%2Fnew-ui" in requests[0].url.raw_path
    assert requests[0].url.params["recursive"] == "1"
    assert requests[0].headers["Authorization"] == "Bearer test-credential"


def test_file_reads_are_parallel_and_keep_path_order(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_READ_CONCURRENCY", 3)
    class Github:
        active = peak = 0
        def tool(self, name):
            outer = self
            class Tool:
                async def ainvoke(self, payload):
                    outer.active += 1
                    outer.peak = max(outer.peak, outer.active)
                    path = payload["path"]
                    try:
                        await asyncio.sleep(.01 * (3 - list(SOURCES).index(path)))
                        return {"content": SOURCES[path]}
                    finally:
                        outer.active -= 1
            return Tool()
    github = Github()
    result = asyncio.run(graph.node_fetch_files({**state(), "target_paths": list(SOURCES)}, github))
    assert list(result["files"]) == list(SOURCES)
    assert github.peak == 3 and github.active == 0


def test_slow_file_reads_timeout_without_partial_results(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_READ_TIMEOUT_SECONDS", .01)
    class Github:
        active = 0
        def tool(self, name):
            outer = self
            class Tool:
                async def ainvoke(self, payload):
                    outer.active += 1
                    try:
                        await asyncio.sleep(5)
                    finally:
                        outer.active -= 1
            return Tool()
    github = Github()
    result = asyncio.run(graph.node_fetch_files({**state(), "target_paths": list(SOURCES)}, github))
    assert "TimeoutError" in result["error"]
    assert "files" not in result
    assert github.active == 0


@pytest.mark.parametrize("fail", [False, True])
def test_generation_is_bounded_ordered_and_atomic(monkeypatch, fail):
    monkeypatch.setattr(settings, "CHALLENGE_GENERATION_CONCURRENCY", 2)
    controller = ModelController()
    active = peak = 0

    def build(**kwargs):
        class Model:
            def with_structured_output(self, schema):
                inner = controller.build(**kwargs).with_structured_output(schema)
                class Structured:
                    async def ainvoke(self, prompt):
                        nonlocal active, peak
                        active += 1
                        peak = max(peak, active)
                        try:
                            index = next(i for i, p in enumerate(SOURCES) if f"FILE: {p}" in prompt)
                            await asyncio.sleep(.01 * (3 - index))
                            if fail and index == 1:
                                raise RuntimeError("model unavailable")
                            return await inner.ainvoke(prompt)
                        finally:
                            active -= 1
                return Structured()
        return Model()

    monkeypatch.setattr(graph, "build_chat_model", build)
    result = asyncio.run(graph.node_generate_challenge({**state(), "target_paths": list(SOURCES), "files": SOURCES}))
    assert peak == 2 and active == 0
    if fail:
        assert result["error"] and "challenge" not in result
    else:
        assert [q["question_id"] for q in result["challenge"]["questions"]] == ["q1", "q2", "q3"]
        assert [q["file_path"] for q in result["challenge"]["questions"]] == list(SOURCES)
