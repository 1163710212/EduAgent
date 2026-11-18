"""Explainable routing for short-code practice, not a calibrated psychometric test.

All decisions are deterministic over saved questions and grades. Independent
evidence is conservatively counted by source file; repeated snippets from one
file cannot establish a level by themselves.
"""
from collections import Counter

POLICY_VERSION = "short_code_evidence_v1"
MIN_ANSWERS = 6
MAX_QUESTIONS = 12
LEVELS = {1: "Direct semantics", 2: "Local relationships", 3: "Implicit effects", 4: "Complex execution"}
SKILLS = {"data_flow": "Data flow", "control_flow": "Control flow",
          "state_effects": "State and side effects", "language_semantics": "Language semantics"}
STOP_REASONS = {
    "stable_evidence": "Repeated evidence and skill coverage support ending this practice session.",
    "question_limit": "The 12-question limit was reached; unresolved skills remain provisional.",
    "pool_exhausted": "No unused suitable snippets remain in the selected source files.",
    "user_finished": "You ended the session with the evidence collected so far.",
}


def outcome(grade: dict) -> str:
    if grade.get("response_status") == "skipped":
        return "skipped"
    correctness = next((d.get("score", 0) for d in grade.get("score_breakdown", [])
                        if d.get("key") == "correctness"), None)
    # Unknown/old grading formats must never establish mastery.
    if correctness is None:
        return "unverified"
    if grade.get("passed_blanks") and correctness >= 48 and not grade.get("score_caps"):
        return "strong"
    if correctness < 36:
        return "weak"
    return "partial"


def observations(questions: list[dict], grades: dict[str, dict]) -> list[dict]:
    records = []
    seen_skills = set()
    for q in questions:
        grade = grades.get(q["question_id"])
        if grade is None:
            continue
        skill = q["skill"]
        records.append({"question_id": q["question_id"], "file_path": q["file_path"],
                        "start_line": q["answer_key"]["start_line"],
                        "end_line": q["answer_key"]["end_line"],
                        "difficulty": q["difficulty"], "skill": skill,
                        "outcome": outcome(grade), "score": grade["total_score"],
                        "after_related_feedback": skill in seen_skills,
                        "evidence": [quote for d in grade.get("score_breakdown", [])
                                     if d.get("key") == "correctness" for quote in d.get("evidence", [])]})
        if outcome(grade) != "skipped":
            seen_skills.add(skill)
    return records


def _files(records: list[dict], result: str) -> set[str]:
    return {r["file_path"] for r in records if r["outcome"] == result}


def ability_profile(records: list[dict]) -> dict:
    levels = []
    for level, label in LEVELS.items():
        subset = [r for r in records if r["difficulty"] == level]
        strong, weak = _files(subset, "strong"), _files(subset, "weak")
        status = ("conflicting" if strong and weak else "supported" if len(strong) >= 2
                  else "needs_practice" if len(weak) >= 2 else "emerging" if subset else "not_observed")
        levels.append({"level": level, "label": label, "status": status,
                       "strong_files": len(strong), "weak_files": len(weak),
                       "question_ids": [r["question_id"] for r in subset]})
    supported = max((l["level"] for l in levels if l["status"] == "supported"), default=0)
    # Conflicting lower-level evidence prevents a global mastery claim, while
    # the level-by-level results still show the learner's individual strengths.
    contradictory = any(l["status"] in {"conflicting", "needs_practice"}
                        for l in levels if l["level"] <= supported)
    skills = []
    for key, label in SKILLS.items():
        subset = [r for r in records if r["skill"] == key and r["outcome"] not in {"skipped", "unverified"}]
        skills.append({"key": key, "label": label, "observations": len(subset),
                       "source_files": len({r["file_path"] for r in subset}),
                       "strong_answers": sum(r["outcome"] == "strong" for r in subset),
                       "question_ids": [r["question_id"] for r in subset]})
    valid_count = sum(r["outcome"] not in {"skipped", "unverified"} for r in records)
    coverage = sum(s["observations"] >= 2 and s["source_files"] >= 2 for s in skills)
    boundary = supported == 4 or (supported > 0 and levels[supported]["status"] == "needs_practice")
    lower_boundary = levels[0]["status"] == "needs_practice" and not any(_files(records, "strong"))
    stable = valid_count >= MIN_ANSWERS and coverage >= 3 and not contradictory and (boundary or lower_boundary)
    return {"policy_version": POLICY_VERSION, "supported_level": supported or None,
            "level_label": f"L{supported} · {LEVELS[supported]}" if supported else "Level not yet established",
            "evidence_status": "supported_in_session" if stable else "provisional",
            "conflicting_evidence": contradictory or any(l["status"] == "conflicting" for l in levels),
            "valid_answers": valid_count, "skipped_answers": sum(r["outcome"] == "skipped" for r in records),
            "covered_skills": coverage, "levels": levels, "skills": skills, "stable": stable,
            "initial_observations": sum(not r["after_related_feedback"] and r["outcome"] != "skipped" for r in records),
            "followup_observations": sum(r["after_related_feedback"] and r["outcome"] != "skipped" for r in records),
            "scope": "Short-code explanations in this repository and language during a guided practice session.",
            "method_note": "Difficulty is a model estimate, not empirically calibrated. Results include answers after feedback; no statistical confidence or professional seniority is inferred."}


def target_level(records: list[dict], current: int = 2) -> tuple[int, str]:
    recent = [r for r in records if r["difficulty"] == current and r["outcome"] not in {"skipped", "unverified"}][-2:]
    if len(recent) == 2 and len({r["file_path"] for r in recent}) == 2:
        if all(r["outcome"] == "strong" for r in recent) and current < 4:
            return current + 1, "Two strong explanations from different files; probing the next difficulty."
        if all(r["outcome"] == "weak" for r in recent) and current > 1:
            return current - 1, "Two explanations with core gaps from different files; checking foundational understanding."
    return current, "Checking another snippet for skill coverage and consistent understanding."


def decide(pack: dict, records: list[dict]) -> dict:
    used = {q["candidate_id"] for q in pack["questions"]}
    pool = [c for c in pack["candidate_pool"] if c["candidate_id"] not in used]
    profile = ability_profile(records)
    reason = ("question_limit" if len(records) >= MAX_QUESTIONS else
              "stable_evidence" if profile["stable"] else "pool_exhausted" if not pool else None)
    if reason:
        return {"stop_reason": reason, "reason": STOP_REASONS[reason]}
    current = pack["questions"][-1]["difficulty"] if pack["questions"] else 2
    target, explanation = target_level(records, current)
    skills = Counter(r["skill"] for r in records if r["outcome"] not in {"skipped", "unverified"})
    files = Counter(r["file_path"] for r in records)
    latest_file = records[-1]["file_path"] if records else None
    candidate = min(pool, key=lambda c: (abs(c["difficulty"] - target),
                    c["file_path"] == latest_file, skills[c["skill"]], files[c["file_path"]], c["candidate_id"]))
    if candidate["difficulty"] != target:
        explanation += f" No unused L{target} snippet is available; using L{candidate['difficulty']}."
    return {"candidate_id": candidate["candidate_id"], "target_level": target,
            "selected_level": candidate["difficulty"], "reason": explanation}
