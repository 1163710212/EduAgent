import pytest

from app.graphs.challenge_graph import (
    _build_blank_fill_payload, _build_rewrite_payload, _build_transform_prompt,
)
from app.graphs.prompts import ChallengeArtifact, ExplainArtifact


SOURCE = "def calculate(value):\n    adjusted = value + 1\n    result = adjusted * 2\n    return result\n\nprint(calculate(3))\n"


def state(source=SOURCE, task="rewrite"):
    return {"owner": "o", "repo": "r", "language": "python", "task_type": task,
            "target_paths": ["main.py"], "files": {"main.py": source}}


@pytest.mark.parametrize("task", ["rewrite", "blank_fill"])
@pytest.mark.parametrize("start,end", [(1, 6), (2, 3), (2, 4), (6, 6), (99, 101), (5, 2)])
def test_focus_is_two_or_three_lines_and_surroundings_are_preserved(task, start, end):
    s = state(task=task)
    if task == "rewrite":
        # Out-of-contract long rewrites must not leak into the visible target.
        result = _build_rewrite_payload(s, ExplainArtifact(start_line=start, end_line=end, rewritten_snippet=SOURCE))
    else:
        result = _build_blank_fill_payload(s, ChallengeArtifact(start_line=start, end_line=end))
    edit = result["edits"][0]
    start, end = edit["start_line"], edit["end_line"]
    assert 2 <= end - start + 1 <= 3
    assert result["answer_key"]["start_line"] == start
    assert result["answer_key"]["end_line"] == end
    output = result["files"]["main.py"].splitlines()
    source = SOURCE.splitlines()
    marker = "EXPLAIN_TARGET" if task == "rewrite" else "BLANK"
    first = next(i for i, line in enumerate(output) if f"{marker}_START" in line)
    last = next(i for i, line in enumerate(output) if f"{marker}_END" in line)
    assert output[:first] == source[:start - 1]
    assert output[last + 1:] == source[end:]
    if task == "rewrite":
        assert output[first + 1:last] == source[start - 1:end]
    assert result["files"]["main.py"].endswith("\n")


@pytest.mark.parametrize("source", ["value = 1", "value = 1\nresult = value + 1\n"])
@pytest.mark.parametrize("task", ["rewrite", "blank_fill"])
def test_short_files_do_not_gain_fabricated_lines(source, task):
    s = state(source, task)
    if task == "rewrite":
        result = _build_rewrite_payload(s, ExplainArtifact(start_line=1, end_line=10, rewritten_snippet="fake\ncode\nextra"))
    else:
        result = _build_blank_fill_payload(s, ChallengeArtifact(start_line=1, end_line=10))
    assert result["answer_key"]["start_line"] == 1
    assert result["answer_key"]["end_line"] == len(source.splitlines())
    assert "fake" not in result["files"]["main.py"]


def test_valid_rewrite_retains_relative_indentation():
    source = "def calculate(value):\n    if value:\n        return value * 2\n    return 0\n"
    result = _build_rewrite_payload(state(source), ExplainArtifact(
        start_line=2, end_line=3, rewritten_snippet="    if value:\n        return value + value"))
    output = result["files"]["main.py"]
    assert "\n    if value:\n        return value + value\n" in output
    assert output.endswith("    return 0\n")


@pytest.mark.parametrize("task", ["rewrite", "blank_fill"])
def test_prompt_asks_for_short_meaningful_focus(task):
    prompt = _build_transform_prompt(state(task=task))
    assert "2-3 lines" in prompt
    assert "meaningful logic" in prompt
    assert "3-8 lines" not in prompt and "1-5 lines" not in prompt
