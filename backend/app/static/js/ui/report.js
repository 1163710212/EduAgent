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
  scoreCard.dataset.pointerGlow = "";
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
  if (score >= 80) {
    for (let index = 0; index < 3; index++) {
      const sparkle = document.createElement("span");
      sparkle.className = `score-sparkle score-sparkle-${index + 1}`;
      sparkle.setAttribute("aria-hidden", "true");
      sparkle.appendChild(makeIcon("sparkle"));
      meter.appendChild(sparkle);
    }
  }
  const scoreStatus = document.createElement("span");
  scoreStatus.className = "score-status";
  scoreStatus.textContent =
    score >= 80
      ? "Strong result"
      : score >= 60
        ? "Keep building"
        : "Review again";
  scoreCard.append(scoreLabel, meter, scoreStatus);

  const feedbackCard = document.createElement("div");
  feedbackCard.className = "feedback-card";
  feedbackCard.dataset.pointerGlow = "";
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
  suggestionsCard.dataset.pointerGlow = "";
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
  revealElements(list.children, {
    duration: 0.45,
    distance: 8,
    stagger: 0.07,
    delay: 0.25,
  });
}
