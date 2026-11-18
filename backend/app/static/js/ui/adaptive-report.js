import { renderReviewCharts, renderSkillCoverage } from "./review-charts.js?v=20261112-viz";

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

const statuses = { supported: "Repeated strong evidence", conflicting: "Mixed evidence",
  needs_practice: "Needs more practice", emerging: "More evidence needed", not_observed: "Not yet observed" };
const outcomes = { strong: "Strong explanation", partial: "Partial understanding", weak: "Core gaps",
  skipped: "Skipped · no ability evidence", unverified: "Assessment evidence unavailable" };

export function renderAdaptiveReport(container, response) {
  container.replaceChildren();
  const section = el("section", "adaptive-report");
  section.id = "adaptiveReview";
  section.append(el("h2", "review-section-title", "Your code comprehension profile"));
  const evaluation = response.evaluation;
  if (!evaluation) {
    section.append(el("p", "selection-note", "Preparing a report from your saved answers…"));
    container.append(section);
    return;
  }
  const profile = evaluation.ability_profile;
  const summary = el("div", "adaptive-summary");
  summary.append(el("p", "adaptive-eyebrow", profile.evidence_status === "supported_in_session"
    ? "Supported in this practice session" : "Provisional · more evidence may be needed"));
  summary.append(el("h3", "adaptive-level", profile.level_label));
  if (profile.conflicting_evidence) summary.append(el("p", "selection-note", "Some answers conflict. Review the evidence by difficulty before drawing a general conclusion."));
  summary.append(el("p", "selection-note", `${profile.valid_answers} assessed answers · ${profile.skipped_answers} skipped · ${profile.covered_skills} skills with repeated evidence from different files`));
  summary.append(el("p", "selection-note", evaluation.stop_description));
  summary.append(el("p", "selection-note", profile.scope));
  section.append(summary);
  const evidenceNodes = new Map();
  renderReviewCharts(section, evaluation.observations, { onEvidence(questionId) {
    const node = evidenceNodes.get(questionId);
    if (!node) return;
    node.open = true;
    node.querySelector("summary").focus({ preventScroll: true });
    node.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } });

  const levels = el("div", "adaptive-levels");
  for (const level of profile.levels) {
    const card = el("article", "adaptive-level-card");
    card.dataset.status = level.status;
    card.append(el("h3", "", `L${level.level} · ${level.label}`));
    card.append(el("p", "", statuses[level.status] || level.status));
    card.append(el("p", "selection-note", `${level.strong_files} files with strong evidence · ${level.weak_files} with core gaps`));
    levels.append(card);
  }
  section.append(levels);

  const skills = el("div", "adaptive-skills");
  renderSkillCoverage(skills, profile.skills, evaluation.observations);
  section.append(skills);

  const evidence = el("div", "adaptive-evidence");
  evidence.append(el("h3", "", "Evidence behind the profile"));
  for (const record of evaluation.observations) {
    const detail = el("details", "adaptive-observation");
    detail.dataset.questionId = record.question_id;
    evidenceNodes.set(record.question_id, detail);
    detail.append(el("summary", "", `${record.question_id.toUpperCase()} · L${record.difficulty} · ${record.file_path}:${record.start_line}–${record.end_line} · ${outcomes[record.outcome] || record.outcome}`));
    detail.append(el("p", "selection-note", record.after_related_feedback
      ? "Follow-up on a skill previously encountered in this session."
      : "First observation of this skill in this session."));
    for (const quote of record.evidence) detail.append(el("blockquote", "", quote));
    evidence.append(detail);
  }
  section.append(evidence);
  const next = el("div", "adaptive-next");
  next.append(el("h3", "", "Next practice steps"));
  const list = el("ul", "");
  for (const item of evaluation.suggestions) list.append(el("li", "", item));
  next.append(list);
  section.append(next);
  section.append(el("p", "selection-note", `${profile.initial_observations} initial observations · ${profile.followup_observations} follow-up answers after related feedback. ${profile.method_note}`));
  container.append(section);
}
