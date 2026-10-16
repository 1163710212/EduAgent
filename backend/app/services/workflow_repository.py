"""Durable question progression, independent of browser storage and model calls."""
import json
from sqlmodel import Session, select
from app.services import repository
from app.services.models import QuestionAnswer, WorkflowReview, QuestionFeedbackReceipt


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
                  explanation: str, files: dict[str, str]) -> None:
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
            raise ValueError("This answer is already submitted and cannot be changed.")
        if len(accepted) != position:
            raise ValueError("Submit the current question before continuing.")
        db.add(QuestionAnswer(session_id=session_id, question_id=question_id,
                             position=position, explanation_md=explanation,
                             filled_files_json=json.dumps(files, ensure_ascii=False)))
        db.commit()


def save_grade(session_id: str, question_id: str, evaluation: dict) -> None:
    with Session(repository.engine) as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        answer = db.get(QuestionAnswer, (session_id, question_id))
        if answer and answer.evaluation_json is None:
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
