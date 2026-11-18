"""Durable question progression, independent of browser storage and model calls."""
import json
from sqlmodel import Session, select
from app.services import repository
from app.services.models import ChallengeSession, QuestionAnswer, WorkflowReview, QuestionFeedbackReceipt


def answers(session_id: str) -> list[QuestionAnswer]:
    with Session(repository.engine) as db:
        return list(db.exec(select(QuestionAnswer).where(
            QuestionAnswer.session_id == session_id
        ).order_by(QuestionAnswer.position)).all())


def acknowledged(session_id: str) -> set[str]:
    with Session(repository.engine) as db:
        return {r.question_id for r in db.exec(select(QuestionFeedbackReceipt).where(
            QuestionFeedbackReceipt.session_id == session_id)).all()}


def acknowledge_feedback(session_id: str, question_id: str) -> None:
    with Session(repository.engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if db.get(QuestionFeedbackReceipt, (session_id, question_id)):
            return
        answer = db.get(QuestionAnswer, (session_id, question_id))
        if not answer or not answer.evaluation_json:
            raise ValueError("Wait for this question's assessment before continuing.")
        previous = db.exec(select(QuestionAnswer).where(
            QuestionAnswer.session_id == session_id, QuestionAnswer.position < answer.position)).all()
        if any(not db.get(QuestionFeedbackReceipt, (session_id, a.question_id)) for a in previous):
            raise ValueError("Read the current question's feedback before continuing.")
        db.add(QuestionFeedbackReceipt(session_id=session_id, question_id=question_id))
        db.commit()


def accept_answer(session_id: str, question_id: str, position: int,
                  explanation: str, files: dict[str, str], *, allow_revision: bool = False) -> None:
    with Session(repository.engine) as db:
        # SQLite write reservation makes checking and advancing one transaction.
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        accepted = db.exec(select(QuestionAnswer).where(QuestionAnswer.session_id == session_id)).all()
        if any(a.position < position and a.evaluation_json is None for a in accepted):
            raise ValueError("Finish assessing the current question before continuing.")
        if any(a.position < position and not db.get(QuestionFeedbackReceipt, (session_id, a.question_id))
               for a in accepted):
            raise ValueError("Read the current question's feedback and click Continue first.")
        existing = db.get(QuestionAnswer, (session_id, question_id))
        if existing:
            if existing.explanation_md == explanation and json.loads(existing.filled_files_json) == files:
                return  # Safe retry after a lost response.
            if existing.evaluation_json is not None or not allow_revision:
                raise ValueError("This answer has already been assessed and cannot be changed.")
            existing.explanation_md = explanation
            existing.filled_files_json = json.dumps(files, ensure_ascii=False)
            db.add(existing)
            db.commit()
            return
        if len(accepted) != position:
            raise ValueError("Submit the current question before continuing.")
        db.add(QuestionAnswer(session_id=session_id, question_id=question_id,
                             position=position, explanation_md=explanation,
                             filled_files_json=json.dumps(files, ensure_ascii=False)))
        db.commit()


def save_grade(session_id: str, question_id: str, evaluation: dict, *,
               explanation: str, files: dict[str, str]) -> None:
    with Session(repository.engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        answer = db.get(QuestionAnswer, (session_id, question_id))
        if not answer or answer.explanation_md != explanation or json.loads(answer.filled_files_json) != files:
            raise ValueError("Your answer changed during assessment. The newer answer is safe; reload to view or assess it.")
        if answer.evaluation_json is None:
            answer.evaluation_json = json.dumps(evaluation, ensure_ascii=False)
            db.add(answer)
            db.commit()


def overall(session_id: str) -> dict | None:
    with Session(repository.engine) as db:
        row = db.get(WorkflowReview, session_id)
        return json.loads(row.evaluation_json) if row else None


def save_overall(session_id: str, evaluation: dict) -> None:
    with Session(repository.engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        if not db.get(WorkflowReview, session_id):
            db.add(WorkflowReview(session_id=session_id,
                                  evaluation_json=json.dumps(evaluation, ensure_ascii=False)))
            db.commit()


def advance_adaptive(session_id: str, question_id: str, *, finish: bool = False) -> dict:
    """Atomically acknowledge feedback and issue exactly one durable next question.

    Read the latest snapshot under a SQLite write reservation, including across
    workers. No model or network calls occur inside the transaction.
    """
    from app.services.adaptive_challenge import materialize
    from app.services.adaptive_policy import decide, observations, STOP_REASONS
    with Session(repository.engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        session = db.get(ChallengeSession, session_id)
        pack = json.loads(session.challenge_json)
        if pack.get("workflow_version") != 3:
            raise ValueError("This action requires an adaptive session.")
        if question_id not in {q["question_id"] for q in pack["questions"]}:
            raise ValueError("A valid question_id is required.")
        if db.get(QuestionFeedbackReceipt, (session_id, question_id)):
            return pack  # Lost response/repeated Continue must not advance twice.
        if pack["adaptive"]["finished"] or pack["questions"][-1]["question_id"] != question_id:
            raise ValueError("Continue from the current question's feedback.")
        accepted = list(db.exec(select(QuestionAnswer).where(
            QuestionAnswer.session_id == session_id).order_by(QuestionAnswer.position)).all())
        if len(accepted) != len(pack["questions"]) or any(not a.evaluation_json for a in accepted):
            raise ValueError("Wait for this question's assessment before continuing.")
        if any(not db.get(QuestionFeedbackReceipt, (session_id, a.question_id)) for a in accepted[:-1]):
            raise ValueError("Read the current question's feedback before continuing.")
        records = observations(pack["questions"], {a.question_id: json.loads(a.evaluation_json) for a in accepted})
        decision = ({"stop_reason": "user_finished", "reason": STOP_REASONS["user_finished"]}
                    if finish else decide(pack, records))
        if decision.get("stop_reason"):
            pack["adaptive"].update(finished=True, stop_reason=decision["stop_reason"])
        else:
            pack["questions"].append(materialize(pack, decision["candidate_id"], len(pack["questions"]), decision))
        pack["adaptive"]["decisions"].append({"after_question_id": question_id, **decision})
        session.challenge_json = json.dumps(pack, ensure_ascii=False)
        db.add(session)
        db.add(QuestionFeedbackReceipt(session_id=session_id, question_id=question_id))
        db.commit()
        return pack


def skip_adaptive(session_id: str, question_id: str) -> dict:
    """A deliberate skip is missing evidence, never a fabricated incorrect grade."""
    with Session(repository.engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        session = db.get(ChallengeSession, session_id)
        pack = json.loads(session.challenge_json)
        if pack.get("workflow_version") != 3:
            raise ValueError("Skipping is available for adaptive sessions.")
        existing = db.get(QuestionAnswer, (session_id, question_id))
        if existing and existing.evaluation_json and json.loads(existing.evaluation_json).get("response_status") == "skipped":
            return pack
        if existing:
            raise ValueError("Your saved answer must be assessed before continuing.")
        if pack["adaptive"]["finished"] or pack["questions"][-1]["question_id"] != question_id:
            raise ValueError("Only the current question can be skipped.")
        for q in pack["questions"][:-1]:
            if not db.get(QuestionFeedbackReceipt, (session_id, q["question_id"])):
                raise ValueError("Read the previous question's feedback before continuing.")
        grade = {"total_score": 0, "passed_blanks": False, "task_type": "rewrite",
                 "response_status": "skipped", "score_breakdown": [], "score_caps": [],
                 "feedback_md": "Question skipped. No ability evidence was recorded. Skips count toward the question limit, but do not lower your assessed level.",
                 "suggestions": []}
        db.add(QuestionAnswer(session_id=session_id, question_id=question_id,
                             position=len(pack["questions"]) - 1, explanation_md="", filled_files_json="{}",
                             evaluation_json=json.dumps(grade)))
        db.commit()
        return pack
