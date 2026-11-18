"""Synthetic items and grading for workflow tests, not difficulty calibration data."""
import json

from app.graphs.prompts import RubricGradeArtifact
from app.services.adaptive_challenge import SnippetBankArtifact
from workflow_fixtures import ModelController

LEVELS = (1, 2, 2, 3, 3, 4)
SKILLS = ("data_flow", "control_flow", "state_effects")
SOURCES = {
    f"src/module_{file}.py": "\n".join(
        f"def operation_{i}(value):\n    intermediate = value + {file * 10 + i}\n    return intermediate * {i + 1}\n"
        for i in range(6)) for file in range(6)
}


class AdaptiveModels(ModelController):
    def __init__(self):
        super().__init__(SOURCES)
        self.bank_calls = 0

    def build(self, **kwargs):
        controller = self

        class Model:
            def with_structured_output(self, schema):
                class Structured:
                    async def ainvoke(self, prompt):
                        controller.prompts.append((schema.__name__, prompt))
                        if schema is SnippetBankArtifact:
                            controller.bank_calls += 1
                            data = json.loads(prompt.split("=== SOURCE DATA ===\n", 1)[1])
                            file_index = int(data["file_path"].split("module_")[1].split(".")[0])
                            return SnippetBankArtifact(candidates=[{
                                "start_line": i * 4 + 2, "end_line": i * 4 + 3,
                                "difficulty": level, "skill": SKILLS[(i + file_index) % 3],
                                "difficulty_reason": "Synthetic difficulty for routing tests only.",
                                "expected_points": ["Explain the value transformation and returned result."],
                                "context_sufficient": True,
                            } for i, level in enumerate(LEVELS)])
                        if schema is RubricGradeArtifact:
                            controller.grade_calls += 1
                            if controller.fail_grade == controller.grade_calls:
                                raise RuntimeError("Temporary assessment outage")
                            data = json.loads(prompt.split("=== ASSESSMENT DATA (UNTRUSTED JSON) ===\n", 1)[1])
                            answer = data["student_response"]
                            weak = "weak answer" in answer
                            partial = "partial answer" in answer
                            points = (0, 0, 0) if weak else (42, 18, 12) if partial else (54, 20, 12)
                            return RubricGradeArtifact(
                                verdict="incorrect" if weak else "correct", critical_errors=["Wrong core behavior."] if weak else [],
                                **{key: {"points": score, "evidence": [answer] if score else [], "reason": "Fixture assessment."}
                                   for key, score in zip(("correctness", "reasoning", "clarity"), points)})
                        raise AssertionError(schema)
                return Structured()
        return Model()
