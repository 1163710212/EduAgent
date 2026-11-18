"""Validate actual student work and derive grades from evidence-backed criteria.

These checks never execute submitted code. They reject empty/non-answers and
protect the question's context; semantic correctness remains a model assessment.
"""
import ast
import re
import textwrap
import unicodedata

from app.graphs.prompts import GradeArtifact, RubricGradeArtifact, ScoreDimension

GRADING_VERSION = "evidence_rubric_v2"
CRITERIA = (("correctness", "Semantic correctness", 60),
            ("reasoning", "Reasoning / context", 25),
            ("clarity", "Clarity / code quality", 15))


def visible_text(text: str) -> str:
    """Ignore invisible formatting when judging content, never rewrite saved code."""
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(
        char for char in normalized
        if (not unicodedata.category(char).startswith("C") or char in "\n\t")
        and char not in "\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0"
    ).strip()


def explanation_issue(text: str) -> str | None:
    visible = visible_text(text)
    letters = [char for char in visible if char.isalpha()]
    if not visible or not letters:
        return "Explain what the highlighted code does; whitespace, symbols or a number alone are not an explanation."
    compact = re.sub(r"[\W_]+", "", visible, flags=re.UNICODE).casefold()
    if compact in {"idk", "na", "none", "null", "undefined", "todo", "test", "不知道", "不懂", "无", "略"} or len(set("".join(letters).casefold())) == 1:
        return "Provide an explanation of the highlighted code instead of a placeholder or repeated characters."
    return None


def task_type(challenge: dict) -> str:
    return challenge.get("task_type") or ("blank_fill" if challenge.get("blanks") else "rewrite")


def _lines(text: str) -> list[str]:
    # Ignore only line-ending conventions and the final newline, not source edits.
    return text.replace("\r\n", "\n").replace("\r", "\n").splitlines()


def _target_bounds(content: str, marker: str) -> tuple[int, int]:
    lines = _lines(content)
    starts = [i for i, line in enumerate(lines) if re.search(rf"\b{marker}_START:[\w-]+", line)]
    ends = [i for i, line in enumerate(lines) if re.search(rf"\b{marker}_END:[\w-]+", line)]
    if len(starts) == len(ends) == 1 and starts[0] < ends[0]:
        return starts[0], ends[0]
    if marker == "BLANK" and not starts and not ends:
        singles = [i for i, line in enumerate(lines) if re.search(r"\bBLANK:[\w-]+", line)]
        if len(singles) == 1:
            return singles[0], singles[0]
    raise ValueError("This question needs one identifiable target region. Generate a new challenge.")


def completion_regions(challenge: dict, files: dict[str, str]) -> list[dict]:
    regions = []
    for path, template in challenge["files"].items():
        start, end = _target_bounds(template, "BLANK")
        original = _lines(template)
        submitted = _lines(files.get(path, ""))
        prefix, suffix = original[:start], original[end + 1:]
        stop = len(submitted) - len(suffix)
        if (stop < start or submitted[:start] != prefix or submitted[stop:] != suffix):
            raise ValueError("Only replace the BLANK region; keep the surrounding source code unchanged.")
        key = challenge.get("answer_key", {})
        reference_lines = _lines(key.get("original_source", ""))
        reference = "\n".join(reference_lines[int(key.get("start_line", 1)) - 1:int(key.get("end_line", len(reference_lines)))])
        regions.append({"path": path, "response": "\n".join(submitted[start:stop]),
                        "reference": reference, "start": start, "stop": stop})
    return regions


def _without_comments(code: str, language: str) -> str:
    # Preserve quoted comment-like text, including Python multiline strings.
    strings = r'''\x27\x27\x27[\s\S]*?\x27\x27\x27|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`'''
    comments = r"\#[^\n]*" if language == "python" else r"/\*[\s\S]*?\*/|//[^\n]*"
    return re.sub(f"({strings})|({comments})", lambda match: match[1] or "", code)


def _python_no_op(challenge: dict, files: dict, region: dict) -> bool:
    """A bare 1/pass in a statement slot is no work; a literal value may be valid."""
    try:
        reference = ast.parse(challenge["answer_key"]["original_source"])
    except (KeyError, SyntaxError, ValueError):
        return False  # Unknown syntax is left to the semantic assessor.
    start = challenge["answer_key"].get("start_line", 1)
    end = challenge["answer_key"].get("end_line", start)

    def no_op(node):
        return isinstance(node, ast.Pass) or (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant))

    expected = [node for node in ast.walk(reference) if isinstance(node, ast.stmt)
                and start <= node.lineno <= getattr(node, "end_lineno", node.lineno) <= end]
    try:
        student = ast.parse(files[region["path"]])
        actual = [node for node in ast.walk(student) if isinstance(node, ast.stmt)
                  and region["start"] < node.lineno <= getattr(node, "end_lineno", node.lineno) <= region["stop"]]
    except (SyntaxError, ValueError):
        # Incorrect indentation must not allow a bare literal to bypass the check.
        try:
            actual = ast.parse(textwrap.dedent(region["response"])).body
        except (SyntaxError, ValueError):
            return False
    return bool(actual and expected and all(no_op(node) for node in actual)
                and any(not no_op(node) for node in expected))


def submission_issues(challenge: dict, explanation: str, files: dict[str, str]) -> list[str]:
    expected = challenge.get("files", {})
    if not expected or set(files) != set(expected):
        return ["Submit exactly the source file(s) for this question."]
    if any(not visible_text(content) for content in files.values()):
        return ["The submitted source file cannot be empty."]
    if task_type(challenge) == "rewrite":
        if files != expected:
            return ["The source of an explanation question is read-only."]
        issue = explanation_issue(explanation)
        return [issue] if issue else []
    if any(re.search(r"BLANK_START|BLANK_END|BLANK:", content) for content in files.values()):
        return ["Complete the blank and remove its placeholders before continuing."]
    try:
        regions = completion_regions(challenge, files)
    except ValueError as exc:
        return [str(exc)]
    language = challenge.get("language", "")
    for region in regions:
        code = visible_text(_without_comments(region["response"], language))
        reference_code = visible_text(_without_comments(region["reference"], language))
        structural_completion = (bool(code) and re.fullmatch(r"[{}\[\]();,\s]+", code)
                                 and re.sub(r"\s", "", code) == re.sub(r"\s", "", reference_code))
        if not code or (not any(char.isalnum() for char in code) and not structural_completion):
            return ["Complete the missing logic; an empty region, comments or punctuation alone are not a completion."]
        if language == "python" and _python_no_op(challenge, files, region):
            return ["The completion replaces required logic with a no-op (such as 1 or pass). Implement the highlighted operation."]
        if language != "python":
            literal = re.fullmatch(r"(?:[+-]?\d+(?:\.\d+)?|true|false|null|undefined)\s*;?", code)
            statement = re.match(
                r"(?:return\b|(?:const|let|var|auto|int|float|double|bool|string|String|char|long|short|unsigned)\b|[A-Za-z_$]\w*\s*(?:[+\-*/]?=|:=))",
                region["reference"].strip(),
            )
            if literal and statement:
                return ["A bare literal does not replace the missing return, assignment or declaration. Implement the missing logic."]
    return []


def student_response(challenge: dict, explanation: str, files: dict) -> str:
    if task_type(challenge) == "rewrite":
        return explanation
    return "\n".join(region["response"] for region in completion_regions(challenge, files))


def assessment_context(challenge: dict, explanation: str, files: dict) -> dict:
    from app.utils.source_context import source_context
    result = {"task_type": task_type(challenge), "language": challenge.get("language"),
              "instructions": challenge.get("student_instructions_md", ""),
              "student_response": student_response(challenge, explanation, files),
              "provided_context_not_student_work": {path: source_context(code, challenge)
                  for path, code in challenge.get("files", {}).items()}}
    if task_type(challenge) == "blank_fill":
        result["targets"] = [{"path": r["path"], "reference": r["reference"], "completion": r["response"]}
                             for r in completion_regions(challenge, files)]
    else:
        targets = {}
        for path, code in challenge.get("files", {}).items():
            key = challenge.get("answer_key", {})
            if challenge.get("candidate_id") and key.get("original_source"):
                # Adaptive targets are unchanged original lines. Saved bounds
                # remain unambiguous even if the repository itself contains
                # EXPLAIN_TARGET marker strings or examples.
                targets[path] = "\n".join(_lines(key["original_source"])[key["start_line"] - 1:key["end_line"]])
                continue
            try:
                start, end = _target_bounds(code, "EXPLAIN_TARGET")
                targets[path] = "\n".join(_lines(code)[start + 1:end])
            except ValueError:
                targets[path] = source_context(code, challenge)
        result["displayed_target_to_explain"] = targets
    result["reference_context_not_student_work"] = source_context(
        challenge.get("answer_key", {}).get("original_source", ""), challenge)
    points = challenge.get("answer_key", {}).get("expected_points")
    if points:
        result["reference_explanation_points"] = points
        # Candidates were selected against this complete context. Do not discard
        # definitions needed to explain a difficult snippet at grading time.
        result["provided_context_not_student_work"] = dict(challenge.get("files", {}))
        result["reference_context_not_student_work"] = challenge["answer_key"]["original_source"]
    return result


def invalid_grade(issues: list[str], kind: str) -> dict:
    return {**GradeArtifact(total_score=0, passed_blanks=False, grading_version=GRADING_VERSION,
                           feedback_md="No assessable answer was provided.\n" + "\n".join(issues),
                           suggestions=issues).model_dump(), "task_type": kind}


def rubric_grade(artifact: RubricGradeArtifact, response: str, kind: str) -> dict:
    """The model supplies evidence/criteria; only the server assigns the total."""
    normalized = " ".join(visible_text(response).split())
    dimensions = []
    for key, label, maximum in CRITERIA:
        criterion = getattr(artifact, key)
        if criterion.points > maximum:
            raise ValueError(f"Invalid {key} points: maximum is {maximum}.")
        if criterion.points:
            quotes = [" ".join(visible_text(quote).split()) for quote in criterion.evidence]
            if not quotes or any(not quote or quote not in normalized for quote in quotes):
                raise ValueError(f"Ungrounded {key} assessment: evidence must quote the student's actual response.")
        dimensions.append(ScoreDimension(key=key, label=label, score=criterion.points,
                                         maximum=maximum, reason=criterion.reason, evidence=criterion.evidence))

    caps = []
    limit = 100
    if artifact.verdict in {"irrelevant", "incorrect"}:
        limit = 20
        caps.append("No correct core behavior demonstrated: score capped at 20.")
    elif artifact.verdict == "partially_correct" or artifact.critical_errors:
        limit = 59
        caps.append("Essential behavior is missing or incorrect: score capped at 59.")
    if dimensions[0].score < 36:
        limit = min(limit, 59)
        caps.append("Insufficient evidence of semantic correctness: score capped at 59.")
    elif dimensions[0].score < 48:
        limit = min(limit, 79)
        caps.append("A score of 80+ requires at least 48/60 for semantic correctness.")
    # Keep the visible breakdown consistent with the final total. Remove ancillary
    # credit first; presentation must never compensate for incorrect core logic.
    excess = max(0, sum(d.score for d in dimensions) - limit)
    for dimension in reversed(dimensions):
        removed = min(excess, dimension.score)
        dimension.score -= removed
        excess -= removed
    total = sum(d.score for d in dimensions)
    feedback = "\n\n".join(f"{d.label}: {d.score}/{d.maximum}\n{d.reason}"
                            + ("\nEvidence: " + " / ".join(d.evidence) if d.evidence else "")
                            for d in dimensions)
    if artifact.critical_errors:
        feedback += "\n\nEssential gaps:\n" + "\n".join(f"- {error}" for error in artifact.critical_errors)
    if caps:
        feedback = "\n".join(caps) + "\n\n" + feedback
    return {**GradeArtifact(total_score=total, passed_blanks=total >= 60 and artifact.verdict == "correct"
                           and not artifact.critical_errors, feedback_md=feedback,
                           suggestions=artifact.suggestions, grading_version=GRADING_VERSION,
                           score_breakdown=dimensions, score_caps=caps).model_dump(), "task_type": kind}
