import { clearElement, makeIcon } from "./common.js";
import { revealElements } from "./motion.js";

export function renderEmptyReport(
  container,
  message = "Submit your response to see a score, details, and next steps.",
) {
  clearElement(container);
  const empty = document.createElement("div");
  empty.className = "empty-state compact";
  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.appendChild(makeIcon("chart-spline"));
  const heading = document.createElement("h3");
  heading.textContent = "Feedback appears here.";
  const copy = document.createElement("p");
  copy.textContent = message;
  empty.append(icon, heading, copy);
  container.appendChild(empty);
}

export function renderReport(
  container,
  evaluation,
  fallbackTaskType = "unknown",
) {
  clearElement(container);
  const taskType = evaluation.task_type || fallbackTaskType;
  const passLabel = taskType === "blank_fill" ? "Blank passed" : "Rules passed";
  const score = Number.isFinite(Number(evaluation.total_score))
    ? Number(evaluation.total_score)
    : 0;
  const suggestions =
    Array.isArray(evaluation.suggestions) && evaluation.suggestions.length
      ? evaluation.suggestions
      : ["Review the brief and restate the key logic in your own words."];

  const summary = document.createElement("div");
  summary.className = "report-summary";

  const scoreCard = document.createElement("div");
  scoreCard.className = "score-card";
  scoreCard.dataset.tone =
    score >= 80 ? "strong" : score >= 60 ? "building" : "review";
  const scoreLabel = document.createElement("div");
  scoreLabel.className = "score-label";
  scoreLabel.append(
    document.createTextNode("Overall score"),
    makeIcon("gauge"),
  );
  const scoreValue = document.createElement("div");
  scoreValue.className = "score-value";
  scoreValue.append(
    document.createTextNode(String(score)),
    Object.assign(document.createElement("small"), { textContent: "/100" }),
  );
  const meter = document.createElement("div");
  meter.className = "score-meter";
  meter.style.setProperty(
    "--score-angle",
    `${Math.min(100, Math.max(0, score)) * 3.6}deg`,
  );
  meter.appendChild(scoreValue);
  const scoreStatus = document.createElement("span");
  scoreStatus.className = "score-status";
  scoreStatus.textContent =
    score >= 80
      ? "Strong result"
      : score >= 60
        ? "Keep building"
        : "Review again";
  const scoreNote = document.createElement("p");
  scoreNote.className = "score-note";
  scoreNote.textContent = "Every attempt builds understanding.";
  scoreCard.append(scoreLabel, meter, scoreStatus, scoreNote);

  const feedbackCard = document.createElement("div");
  feedbackCard.className = "feedback-card";
  const feedbackTitle = document.createElement("h3");
  feedbackTitle.append(
    makeIcon("messages-square"),
    document.createTextNode("AI feedback"),
  );
  const feedback = document.createElement("pre");
  feedback.className = "feedback-content";
  feedback.textContent = evaluation.feedback_md || "No detailed feedback yet.";
  const meta = document.createElement("div");
  meta.className = "report-meta";
  [
    `task: ${taskType}`,
    `${passLabel}: ${String(evaluation.passed_blanks ?? "-")}`,
  ].forEach((text) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = text;
    meta.appendChild(pill);
  });
  feedbackCard.append(feedbackTitle, feedback, meta);

  const suggestionsCard = document.createElement("div");
  suggestionsCard.className = "suggestions-card";
  const suggestionsTitle = document.createElement("h3");
  suggestionsTitle.append(
    makeIcon("route"),
    document.createTextNode("Next steps"),
  );
  const list = document.createElement("ul");
  list.className = "suggestion-list";
  suggestions.forEach((suggestion, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    number.className = "suggestion-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("span");
    copy.textContent = String(suggestion);
    item.append(number, copy);
    list.appendChild(item);
  });
  suggestionsCard.append(suggestionsTitle, list);

  summary.append(scoreCard, feedbackCard, suggestionsCard);
  container.appendChild(summary);
  revealElements([scoreCard, feedbackCard, suggestionsCard], { stagger: 0.09 });
}
