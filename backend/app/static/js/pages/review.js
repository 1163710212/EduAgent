import { getReview } from "../api/challenges.js";
import {
  getWorkflowState,
  saveEvaluation,
  sessionIdFromLocation,
  stepUrl,
} from "../state/workflow-store.js";
import { byId, initPageMotion } from "../ui/common.js";
import { renderReport } from "../ui/report.js";

function showUnavailable(message, sessionId) {
  console.warn(`[review] ${message}`);
  window.location.replace(stepUrl(sessionId ? "solve" : "create", sessionId));
}

function showReview(evaluation, taskType, sessionId, fromApi = false) {
  byId("reviewLoading").classList.add("hidden");
  byId("reviewContent").classList.remove("hidden");
  renderReport(byId("report"), evaluation, taskType);
  // Notify optional artwork only after a real evaluation has been rendered.
  document.body.dataset.reviewSession = sessionId;
  document.body.dataset.reviewSource = fromApi ? "api" : "cache";
  document.body.dataset.reviewReady = "true";
  document.dispatchEvent(new CustomEvent("eduagent:review-ready"));
}

async function loadReview() {
  const stored = getWorkflowState();
  const sessionId = sessionIdFromLocation() || stored.sessionId;
  if (!sessionId) {
    showUnavailable("Complete a challenge before opening Review.", "");
    return;
  }

  byId("reviewSession").textContent = `session: ${sessionId}`;
  try {
    if (stored.sessionId === sessionId && stored.evaluation) {
      showReview(stored.evaluation, stored.challenge?.task_type, sessionId);
    } else {
      const response = await getReview(sessionId);
      saveEvaluation(sessionId, response.evaluation);
      showReview(response.evaluation, response.task_type, sessionId, true);
    }
  } catch (error) {
    showUnavailable(error.message || String(error), sessionId);
  }
}

function init() {
  initPageMotion();
  loadReview();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
