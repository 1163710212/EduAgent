import { getChallenge, submitChallenge } from "../api/challenges.js";
import {
  buildSubmission,
  cloneFiles,
  countLines,
} from "../domain/challenge.js";
import {
  cacheChallenge,
  getWorkflowState,
  saveAnswerDraft,
  saveEvaluation,
  sessionIdFromLocation,
  stepUrl,
} from "../state/workflow-store.js";
import { renderChallengeSummary } from "../ui/challenge-view.js";
import {
  byId,
  copyText,
  initPageMotion,
  navigateForward,
  setButtonLoading,
  setLog,
  showToast,
} from "../ui/common.js";
import {
  revealSection,
  animateFeedback,
  scrollToElement,
} from "../ui/motion.js";

let challenge = null;
let files = {};

function showWorkspaceError(message) {
  console.warn(`[solve] ${message}`);
  window.location.replace(stepUrl("create"));
}

function switchFile(path, shouldScroll = false) {
  if (!Object.prototype.hasOwnProperty.call(files, path)) return;
  byId("fileSelect").value = path;
  byId("codeViewer").value = files[path];
  byId("sourceLineCount").textContent = `${countLines(files[path])} lines`;
  // Optional file artwork observes the same validated selection as View code.
  if (shouldScroll) animateFeedback(byId("codeViewer"));
  if (shouldScroll) {
    scrollToElement(byId("filesArea"), { block: "center" });
  }
}

function loadFiles() {
  const select = byId("fileSelect");
  select.replaceChildren();
  Object.keys(files).forEach((path) => {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path;
    select.appendChild(option);
  });
  select.addEventListener("change", () => switchFile(select.value));
  const firstPath = Object.keys(files)[0];
  if (firstPath) switchFile(firstPath);
  else byId("filesArea").classList.add("hidden");
}

function renderWorkspace(state) {
  challenge = state.challenge;
  files = cloneFiles(challenge.files);
  byId("workspaceLoading").classList.add("hidden");
  byId("workspaceContent").classList.remove("hidden");
  byId("sessionId").value = challenge.session_id;

  renderChallengeSummary(challenge, (path) => switchFile(path, true));
  loadFiles();

  const isRewrite = challenge.task_type === "rewrite";
  byId("rewriteAnswerArea").classList.toggle("hidden", !isRewrite);
  byId("blankFillAnswerArea").classList.toggle("hidden", isRewrite);
  byId("explanation").value = state.answerDraft?.explanation || "";
  byId("completionCode").value = state.answerDraft?.completionCode || "";
  byId("explanationCount").textContent =
    `${byId("explanation").value.trim().length} chars`;
  byId("completionCount").textContent =
    `${countLines(byId("completionCode").value)} lines`;
  if (byId("explanation").value) {
    byId("explanation").style.height =
      `${Math.min(byId("explanation").scrollHeight, 420)}px`;
  }
  revealSection(byId("workspaceContent"));
}

async function loadWorkspace() {
  const stored = getWorkflowState();
  const sessionId = sessionIdFromLocation() || stored.sessionId;
  if (!sessionId) {
    showWorkspaceError(
      "Create a challenge to load its source and response tools.",
    );
    return;
  }

  try {
    if (stored.sessionId === sessionId && stored.challenge) {
      renderWorkspace(stored);
    } else {
      const response = await getChallenge(sessionId);
      const loaded = { ...response.challenge, session_id: response.session_id };
      renderWorkspace(cacheChallenge(loaded));
    }
  } catch (error) {
    showWorkspaceError(error.message || String(error));
  }
}

async function handleSubmit() {
  if (byId("btnSubmit").disabled) return;
  setLog(byId("submitLog"), "");
  let payload;
  try {
    payload = buildSubmission(challenge, {
      explanation: byId("explanation").value,
      completionCode: byId("completionCode").value,
    });
  } catch (error) {
    setLog(byId("submitLog"), error.message || String(error), "error");
    (challenge?.task_type === "rewrite"
      ? byId("explanation")
      : byId("completionCode")
    ).focus();
    return;
  }

  setButtonLoading(byId("btnSubmit"), true, "Reviewing answer");
  setLog(byId("submitLog"), "Evaluating your answer in context…");
  try {
    const response = await submitChallenge(challenge.session_id, payload);
    saveEvaluation(challenge.session_id, response.evaluation);
    setLog(
      byId("submitLog"),
      "Review complete. Opening your feedback…",
      "success",
    );
    await navigateForward(stepUrl("review", challenge.session_id));
  } catch (error) {
    setLog(byId("submitLog"), error.message || String(error), "error");
  } finally {
    setButtonLoading(byId("btnSubmit"), false);
  }
}

function bindEvents() {
  byId("btnSubmit").addEventListener("click", handleSubmit);
  byId("copySession").addEventListener("click", async () => {
    const value = byId("sessionId").value.trim();
    if (!value) return;
    await copyText(value, byId("sessionId"));
    showToast("Session ID copied.");
  });
  byId("explanation").addEventListener("input", (event) => {
    const explanation = event.target.value;
    byId("explanationCount").textContent = `${explanation.trim().length} chars`;
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 420)}px`;
    saveAnswerDraft({ explanation });
  });
  byId("completionCode").addEventListener("input", (event) => {
    const completionCode = event.target.value;
    byId("completionCount").textContent = `${countLines(completionCode)} lines`;
    saveAnswerDraft({ completionCode });
  });
}

function init() {
  initPageMotion();
  bindEvents();
  loadWorkspace();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
