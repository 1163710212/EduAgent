"""Public projection and deterministic reporting for adaptive explanation sessions."""
import json

from app.services import workflow_repository as storage
from app.services.adaptive_policy import observations, ability_profile, decide, STOP_REASONS

PUBLIC_FIELDS = ("question_id", "file_path", "selection_reason", "task_type", "title", "language",
                 "student_instructions_md", "files", "edits", "blanks", "difficulty", "skill")


def records_for(session_id: str, pack: dict) -> list[dict]:
    return observations(pack["questions"], {a.question_id: json.loads(a.evaluation_json)
                        for a in storage.answers(session_id) if a.evaluation_json})


def progress(session_id: str, pack: dict) -> dict:
    accepted = storage.answers(session_id)
    records = observations(pack["questions"], {a.question_id: json.loads(a.evaluation_json)
                                             for a in accepted if a.evaluation_json})
    profile = ability_profile(records)
    finished = pack["adaptive"]["finished"]
    public = None
    if not finished:
        current = pack["questions"][-1]
        public = {key: current[key] for key in PUBLIC_FIELDS}
        public.update(session_id=session_id, workflow_version=3, question_index=len(pack["questions"]) - 1,
                      question_count=len(pack["questions"]), language_selection=pack.get("language_selection"))
        answer = next((a for a in accepted if a.question_id == current["question_id"]), None)
        if answer:
            public["pending_answer"] = {"question_id": answer.question_id,
                                        "explanation_md": answer.explanation_md,
                                        "filled_files": json.loads(answer.filled_files_json)}
            if answer.evaluation_json:
                public["evaluation"] = json.loads(answer.evaluation_json)
        public["adaptive"] = {"minimum_answers": pack["adaptive"]["minimum_answers"],
                              "maximum_questions": pack["adaptive"]["maximum_questions"],
                              "valid_answers": profile["valid_answers"],
                              "skipped_answers": profile["skipped_answers"],
                              "next_action": "review" if answer and answer.evaluation_json and decide(pack, records).get("stop_reason") else "question"}
    return {"session_id": session_id, "workflow_version": 3, "question_count": len(pack["questions"]),
            "completed_count": len(records), "challenge": public,
            "status": ("ready_for_review" if finished else "feedback_ready" if public.get("evaluation")
                       else "assessment_pending" if public.get("pending_answer") else "answering")}


def review(session_id: str, pack: dict) -> dict:
    from app.services.workflow import WorkflowError
    if not pack["adaptive"]["finished"]:
        raise WorkflowError("Continue from your feedback or finish the adaptive session before opening Review.")
    evaluation = storage.overall(session_id)
    return {"session_id": session_id, "workflow_version": 3, "task_type": "rewrite",
            "question_count": len(pack["questions"]), "evaluated_count": len(records_for(session_id, pack)),
            "status": "complete" if evaluation else "evaluating", "evaluation": evaluation}


def evaluate(session_id: str, pack: dict) -> dict:
    current = review(session_id, pack)
    if current["evaluation"]:
        return current
    records = records_for(session_id, pack)
    profile = ability_profile(records)
    stop = pack["adaptive"]["stop_reason"]
    suggestions = []
    for skill in profile["skills"]:
        if skill["observations"] < 2 or skill["source_files"] < 2:
            suggestions.append(f"Collect more explanations from different files for {skill['label'].lower()}.")
        elif skill["strong_answers"] < skill["observations"]:
            suggestions.append(f"Practice {skill['label'].lower()} using the specific gaps in your question feedback.")
    if not suggestions:
        suggestions = ["Check transfer to an unfamiliar repository without prior feedback."]
    evaluation = {"task_type": "rewrite", "score_method": "adaptive_evidence_v1",
                  "question_count": len(records), "ability_profile": profile, "observations": records,
                  "stop_reason": stop, "stop_description": STOP_REASONS[stop],
                  "feedback_md": f"{profile['level_label']}. " + STOP_REASONS[stop],
                  "suggestions": suggestions[:3]}
    storage.save_overall(session_id, evaluation)
    return review(session_id, pack)
