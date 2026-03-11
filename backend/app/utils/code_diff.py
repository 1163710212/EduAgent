from __future__ import annotations

import difflib
from typing import Dict, Any


def unified_diff(a: str, b: str, path: str) -> str:
    a_lines = a.splitlines(keepends=True)
    b_lines = b.splitlines(keepends=True)
    diff = difflib.unified_diff(
        a_lines, b_lines, fromfile=f"{path} (challenge)", tofile=f"{path} (student)"
    )
    return "".join(diff)


def similarity_ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(a=a, b=b).ratio()


def compute_file_metrics(challenge: str, student: str, path: str) -> Dict[str, Any]:
    return {
        "path": path,
        "similarity": round(similarity_ratio(challenge, student), 4),
        "diff": unified_diff(challenge, student, path)[:20000],
    }