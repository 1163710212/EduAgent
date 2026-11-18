import { renderReport } from "./report.js";
import { renderReviewCharts } from "./review-charts.js?v=20261112-viz";

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderWorkflowReport(container, review) {
  container.replaceChildren();
  const overall = element("section", "overall-review");
  overall.id = "overallReview";
  overall.append(element("h3", "review-section-title", "Overall assessment"));
  if (review.evaluation) {
    renderReviewCharts(overall, review.observations);
    overall.append(element("p", "score-method", "Equal weight · Average of all three question scores. AI assessment; code was not executed."));
    const report = element("div", "");
    renderReport(report, review.evaluation, review.task_type);
    overall.append(report);
    if (review.evaluation.strengths?.length) {
      const strengths = element("div", "review-strengths");
      strengths.append(element("h4", "", "What you did well"));
      const list = element("ul", "");
      review.evaluation.strengths.forEach((text) => list.append(element("li", "", text)));
      strengths.append(list);
      overall.append(strengths);
    }
  } else {
    overall.append(element("p", "selection-note", review.evaluated_count === review.question_count
      ? "Combining the three assessments into your overall feedback…"
      : "Available after all three answers have been assessed."));
  }
  container.append(overall);
}
