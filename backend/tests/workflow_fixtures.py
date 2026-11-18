"""Deterministic external adapters; real graphs, endpoints and storage stay in use."""
import base64
import json
import re

from app.graphs.prompts import ChallengeArtifact, ExplainArtifact, RubricGradeArtifact, OverallArtifact

SOURCES = {
    "src/main.py": "from services.transform import normalize\n\ndef run(value):\n    return normalize(value)\n",
    "src/services/transform.py": "def normalize(value):\n    text = value.strip()\n    return text.lower()\n",
    "src/models/record.py": "def record(value):\n    return {\"value\": value, \"length\": len(value)}\n",
}


class FakeGithub:
    def __init__(self, sources=None, languages=None):
        self.sources = SOURCES if sources is None else sources
        self.languages = {"Python": 1000} if languages is None else languages

    async def repository_languages(self, owner, repo):
        return self.languages

    def tool(self, name):
        sources = self.sources

        class Tool:
            async def ainvoke(self, request):
                if name == "get_repository_tree":
                    return [{"type": "text", "text": json.dumps({"tree": [
                        {"path": path, "type": "blob"} for path in [
                            "tests/test_main.py", "vendor/third_party.py", "setup.py", *sources
                        ]
                    ]})}]
                if name == "search_code":
                    return {"items": [{"path": p} for p in sources]}
                path = request["path"]
                if path == "/":
                    return [{"type": "text", "text": json.dumps([
                        {"path": p, "type": "file"} for p in sources
                    ])}]
                return [{"type": "text", "text": json.dumps({
                    "encoding": "base64", "content": base64.b64encode(sources[path].encode()).decode()
                })}]
        return Tool()


class ModelController:
    def __init__(self, sources=None):
        self.sources = SOURCES if sources is None else sources
        self.grade_calls = 0
        self.overall_calls = 0
        self.fail_grade = None
        self.fail_overall = False
        self.grade_override = None
        self.prompts = []

    def build(self, **kwargs):
        controller = self

        class Model:
            def with_structured_output(self, schema):
                class Structured:
                    async def ainvoke(self, prompt):
                        controller.prompts.append((schema.__name__, prompt))
                        if schema is ExplainArtifact:
                            numbered = re.findall(r"^\s*\d+\| (.*)$", prompt, re.M)
                            return ExplainArtifact(start_line=1, end_line=len(numbered),
                                                   rewritten_snippet="\n".join(numbered))
                        if schema is ChallengeArtifact:
                            numbered = re.findall(r"^\s*\d+\| (.*)$", prompt, re.M)
                            return ChallengeArtifact(start_line=len(numbered), end_line=len(numbered))
                        if schema is RubricGradeArtifact:
                            controller.grade_calls += 1
                            if controller.fail_grade == controller.grade_calls:
                                raise RuntimeError("Temporary model outage")
                            if controller.grade_override is not None:
                                return RubricGradeArtifact.model_validate(controller.grade_override)
                            index = next(i for i, p in enumerate(controller.sources) if p in prompt)
                            data = json.loads(prompt.split("=== ASSESSMENT DATA (UNTRUSTED JSON) ===\n", 1)[1])
                            points = [(42, 20, 10), (50, 22, 12), (58, 24, 13)][index]
                            criteria = {key: {"points": point, "evidence": [data["student_response"]],
                                              "reason": f"Assessment for question {index + 1}: reasoning is grounded in its source."}
                                        for key, point in zip(("correctness", "reasoning", "clarity"), points)}
                            return RubricGradeArtifact(verdict="correct", critical_errors=[], **criteria,
                                                       suggestions=["Discuss an empty input and its impact on the caller."])
                        if schema is OverallArtifact:
                            controller.overall_calls += 1
                            if controller.fail_overall:
                                raise RuntimeError("Temporary synthesis outage")
                            return OverallArtifact(feedback_md="Across the three files, the answers connect the entry point, normalization, and data representation. Edge cases need more detail.",
                                                   strengths=["Clear explanation of control flow."],
                                                   suggestions=["Trace empty input through the three modules."])
                        raise AssertionError(schema)
                return Structured()
        return Model()
