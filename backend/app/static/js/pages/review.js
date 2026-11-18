import { getReview, evaluateNext } from "../api/challenges.js";
import {
  getWorkflowState,
  saveEvaluation,
  sessionIdFromLocation,
} from "../state/workflow-store.js";
import { byId, initPageMotion, setLog } from "../ui/common.js";
import { renderReport } from "../ui/report.js";
import { renderWorkflowReport } from "../ui/workflow-report.js?v=20261112-viz";
import { renderAdaptiveReport } from "../ui/adaptive-report.js?v=20261112-viz";

let running = false;
let disposed = false;

function showReview(response) {
  byId("reviewLoading").classList.add("hidden");
  byId("reviewContent").classList.remove("hidden");
  if (response.workflow_version === 3) {
    renderAdaptiveReport(byId("report"), response);
    setLog(byId("reviewStatus"), response.status === "complete"
      ? "Your ability evidence and practice results are ready."
      : "Preparing your ability report…");
  } else if (response.workflow_version === 2) {
    renderWorkflowReport(byId("report"), response);
    setLog(byId("reviewStatus"), response.status === "complete"
      ? "All three answers assessed. Your overall review is ready."
      : "All answers assessed. Preparing overall feedback…");
  } else {
    renderReport(byId("report"), response.evaluation, response.task_type);
  }
  if (response.evaluation) {
    saveEvaluation(response.session_id, response.evaluation);
    document.body.dataset.reviewSession = response.session_id;
    document.body.dataset.reviewSource = "api";
    document.body.dataset.reviewReady = "true";
    document.dispatchEvent(new CustomEvent("eduagent:review-ready"));
  }
}

async function loadReview() {
  if (running) return;
  running = true;
  byId("retryReview").classList.add("hidden");
  const sessionId = sessionIdFromLocation() || getWorkflowState().sessionId;
  byId("reviewSession").textContent = sessionId ? `session: ${sessionId}` : "";
  try {
    if (!sessionId) throw new Error("Complete your practice session before opening Review.");
    let response = await getReview(sessionId);
    if (disposed) return;
    showReview(response);
    if (!disposed && [2, 3].includes(response.workflow_version) && response.status !== "complete") {
      response = await evaluateNext(sessionId);
      if (!disposed) showReview(response);
    }
  } catch (error) {
    if (!disposed) {
      byId("reviewLoading").classList.add("hidden");
      setLog(byId("reviewStatus"), error.message || String(error), "error");
      byId("retryReview").classList.remove("hidden");
    }
  } finally {
    running = false;
  }
}

function init() {
  initPageMotion();
  byId("retryReview").addEventListener("click", loadReview);
  window.addEventListener("pagehide", () => { disposed = true; });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) { disposed = false; loadReview(); }
  });
  loadReview();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
