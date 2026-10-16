"""Deterministic, explainable source-file selection from repository structure."""
from pathlib import PurePosixPath
import re

EXCLUDED = re.compile(
    r"(^|/)(\.[^/]+|venv|env|node_modules|vendor|dist|build|coverage|"
    r"__pycache__|generated|migrations|fixtures|__snapshots__|__tests__)(/|$)", re.I
)
NON_SOURCE_DIRECTORY = re.compile(r"(^|/)(tests?|examples?|docs?)(/|$)", re.I)


def skip_directory(path: str) -> bool:
    return bool(EXCLUDED.search(path) or NON_SOURCE_DIRECTORY.search(path))


def file_role(path: str) -> str:
    parts = PurePosixPath(path.lower())
    if parts.stem in {"main", "app", "server", "index", "application", "cli"}:
        return "entry point"
    if any(p in {"services", "service", "core", "domain", "lib", "graphs"} for p in parts.parts):
        return "core logic"
    if any(p in {"api", "routes", "controllers", "handlers", "views"} for p in parts.parts):
        return "request handling"
    if any(p in {"models", "repositories", "repository", "store", "state"} for p in parts.parts):
        return "data and state"
    return "source module"


def rank_source_paths(paths: list[str], limit: int) -> list[str]:
    candidates = {
        p for p in paths if p and not EXCLUDED.search(p)
        and PurePosixPath(p).stem not in {"__init__", "__main__", "setup", "conftest"}
        and not NON_SOURCE_DIRECTORY.search(p)
        and not re.search(r"(^|/)(test_|.*[._](test|spec)\.)", p, re.I)
        and not re.search(r"(\.min\.|\.generated\.|\.d\.ts$|_test\.go$)", p)
    }
    selected: list[str] = []
    weights = {"entry point": 100, "core logic": 90, "request handling": 80,
               "data and state": 75, "source module": 45}

    def score(path: str) -> int:
        parts = PurePosixPath(path)
        role = file_role(path)
        return (weights[role] + (12 if "src" in parts.parts else 0)
                - min(len(parts.parts), 10)
                - 24 * sum(file_role(p) == role for p in selected)
                - 12 * sum(PurePosixPath(p).parent == parts.parent for p in selected))

    while candidates and len(selected) < limit:
        chosen = min(candidates, key=lambda p: (-score(p), p))
        selected.append(chosen)
        candidates.remove(chosen)
    return selected


def selection_reason(path: str) -> str:
    return f"Selected for {file_role(path)} responsibilities, prioritizing application relevance and module coverage."
