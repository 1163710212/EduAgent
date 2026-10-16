"""Deterministic external adapters; real graphs, endpoints and storage stay in use."""
import base64
import json
import re

from app.graphs.prompts import ChallengeArtifact, ExplainArtifact, GradeArtifact, OverallArtifact

SOURCES = {
    "src/main.py": "from services.transform import normalize\n\ndef run(value):\n    return normalize(value)\n",
    "src/services/transform.py": "def normalize(value):\n    text = value.strip()\n    return text.lower()\n",
    "src/models/record.py": "def record(value):\n    return {\"value\": value, \"length\": len(value)}\n",
}


class FakeGithub:
    def __init__(self, sources=None):
        self.sources = SOURCES if sources is None else sources

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
    def __init__(self):
        self.grade_calls = 0
        self.overall_calls = 0
        self.fail_grade = None
        self.fail_overall = False
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
                        if schema is GradeArtifact:
                            controller.grade_calls += 1
                            if controller.fail_grade == controller.grade_calls:
                                raise RuntimeError("Temporary model outage")
                            index = next(i for i, p in enumerate(SOURCES) if p in prompt)
                            return GradeArtifact(total_score=[72, 84, 95][index], passed_blanks=True,
                                                 feedback_md=f"Assessment for question {index + 1}: reasoning is grounded in its source.",
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
