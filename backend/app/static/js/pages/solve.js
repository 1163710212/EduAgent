import { getChallenge, submitChallenge, continueChallenge, adaptiveAction } from "../api/challenges.js?v=20261112-adaptive";
import { renderReport } from "../ui/report.js?v=20261014-solve-feedback-cleanup";
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
} from "../state/workflow-store.js?v=20261103-editable-assessment";
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
let pendingAnswer = null;
let actionPending = false;
const skillLabels = { data_flow: "Data flow", control_flow: "Control flow", state_effects: "State and side effects", language_semantics: "Language semantics" };

function showWorkspaceError(message) {
  byId("workspaceLoading").classList.add("hidden");
  byId("workspaceError").classList.remove("hidden");
  byId("workspaceErrorText").textContent = message;
}

function updateSubmitLabel() {
  const revised = pendingAnswer && (challenge.task_type === "rewrite"
    ? byId("explanation").value !== pendingAnswer.explanation_md
    : byId("completionCode").value !== savedCompletion());
  const label = revised ? "Submit revised answer" : pendingAnswer ? "Retry assessment" : "Submit & view feedback";
  byId("btnSubmit").dataset.defaultLabel = label;
  byId("btnSubmit").querySelector("span").textContent = label;
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
  const firstPath = Object.keys(files)[0];
  if (firstPath) switchFile(firstPath);
  else byId("filesArea").classList.add("hidden");
}

function renderWorkspace(state) {
  challenge = state.challenge;
  pendingAnswer = challenge.pending_answer || null;
  files = cloneFiles(challenge.files);
  byId("workspaceLoading").classList.add("hidden");
  byId("workspaceContent").classList.remove("hidden");
  byId("sessionId").value = challenge.session_id;
  const index = challenge.question_index ?? 0;
  const count = challenge.question_count ?? 1;
  const assessed = index + (challenge.evaluation ? 1 : 0);
  const adaptive = challenge.adaptive;
  byId("questionProgressLabel").textContent = adaptive ? `Question ${index + 1} · Adaptive practice` : `Question ${index + 1} of ${count}`;
  byId("questionProgress").max = adaptive?.maximum_questions || count;
  byId("questionProgress").value = index + 1;
  byId("questionProgress").setAttribute("aria-label", adaptive ? "Questions used out of the session limit" : "Current question");
  byId("questionSavedCount").textContent = adaptive
    ? `${adaptive.valid_answers} assessed · ${adaptive.skipped_answers} skipped`
    : `${assessed} ${assessed === 1 ? "answer" : "answers"} assessed`;
  byId("adaptiveProgressNote").classList.toggle("hidden", !adaptive);
  byId("adaptiveProgressNote").textContent = adaptive
    ? `Aim for ${adaptive.minimum_answers} assessed answers; up to ${adaptive.maximum_questions} questions. The session may finish earlier if suitable snippets run out.` : "";
  byId("snippetDifficulty").classList.toggle("hidden", !adaptive);
  byId("snippetDifficulty").textContent = adaptive ? `L${challenge.difficulty} · ${skillLabels[challenge.skill] || challenge.skill} · Estimated snippet difficulty` : "";
  byId("selectionReason").textContent = challenge.selection_reason || "";

  renderChallengeSummary(challenge, (path) => switchFile(path, true));
  loadFiles();

  const isRewrite = challenge.task_type === "rewrite";
  byId("rewriteAnswerArea").classList.toggle("hidden", !isRewrite);
  byId("blankFillAnswerArea").classList.toggle("hidden", isRewrite);
  const useDraft = !challenge.evaluation && (!pendingAnswer || state.hasAnswerDraft);
  byId("explanation").value = useDraft ? state.answerDraft?.explanation || "" : pendingAnswer?.explanation_md || "";
  byId("completionCode").value = useDraft ? state.answerDraft?.completionCode || "" : pendingAnswer ? savedCompletion() : "";
  byId("explanation").disabled = Boolean(challenge.evaluation);
  byId("completionCode").disabled = Boolean(challenge.evaluation);
  updateSubmitLabel();
  byId("explanation").style.height = "auto";
  byId("explanationCount").textContent =
    `${byId("explanation").value.trim().length} chars`;
  byId("completionCount").textContent =
    `${countLines(byId("completionCode").value)} lines`;
  if (byId("explanation").value) {
    byId("explanation").style.height =
      `${Math.min(byId("explanation").scrollHeight, 420)}px`;
  }
  revealSection(byId("workspaceContent"));
  byId("btnSubmit").classList.toggle("hidden", Boolean(challenge.evaluation));
  byId("btnSkip").classList.toggle("hidden", !adaptive || Boolean(pendingAnswer));
  byId("btnFinish").classList.toggle("hidden", !adaptive || !challenge.evaluation || adaptive.next_action === "review");
  byId("questionAssessment").classList.toggle("hidden", !challenge.evaluation);
  byId("questionReport").replaceChildren();
  setLog(byId("continueLog"), "");
  if (challenge.evaluation) {
    byId("questionAssessmentTitle").textContent = `Question ${index + 1} feedback`;
    if (challenge.evaluation.response_status === "skipped") {
      const note = document.createElement("p");
      note.className = "selection-note";
      note.textContent = challenge.evaluation.feedback_md;
      byId("questionReport").append(note);
    } else renderReport(byId("questionReport"), challenge.evaluation, challenge.task_type, {
      scoreLabel: "Question score", showSuggestions: false,
    });
    const last = adaptive ? adaptive.next_action === "review" : index + 1 === count;
    const label = last ? "Continue to overall review" : "Continue to next question";
    byId("btnContinue").dataset.defaultLabel = label;
    byId("btnContinue").querySelector("span").textContent = label;
    setLog(byId("submitLog"), "Assessment complete. Read your feedback below, then continue.", "success");
  } else if (pendingAnswer) {
    setLog(byId("submitLog"), "Your answer is saved but has not been assessed. You can edit it or retry assessment.");
  } else setLog(byId("submitLog"), "");
}

function savedCompletion() {
  if (challenge.task_type !== "blank_fill") return "";
  const path = Object.keys(files)[0];
  const original = files[path].split("\n");
  const submitted = (pendingAnswer.filled_files[path] || "").split("\n");
  const start = original.findIndex(line => line.includes("BLANK_START:"));
  const end = original.findIndex(line => line.includes("BLANK_END:"));
  return start >= 0 && end >= start
    ? submitted.slice(start, submitted.length - (original.length - end - 1)).join("\n")
    : pendingAnswer.filled_files[path] || "";
}

async function loadWorkspace() {
  byId("workspaceError").classList.add("hidden");
  const stored = getWorkflowState();
  const sessionId = sessionIdFromLocation() || stored.sessionId;
  if (!sessionId) {
    showWorkspaceError(
      "Create a challenge to load its source and response tools.",
    );
    return;
  }

  try {
    // Server progress is authoritative, even after refresh or browser Back.
    const response = await getChallenge(sessionId);
    if (response.status === "ready_for_review") {
      await navigateForward(stepUrl("review", sessionId));
      return;
    }
    const loaded = { ...response.challenge, session_id: response.session_id };
    renderWorkspace(cacheChallenge(loaded));
  } catch (error) {
    showWorkspaceError(error.message || String(error));
  }
}

async function handleSubmit() {
  if (actionPending || byId("btnSubmit").disabled || challenge?.evaluation) return;
  setLog(byId("submitLog"), "");
  let payload;
  try {
    payload = buildSubmission(challenge, {
      explanation: byId("explanation").value,
      completionCode: byId("completionCode").value,
    });
    if (challenge.question_id) payload.question_id = challenge.question_id;
  } catch (error) {
    setLog(byId("submitLog"), error.message || String(error), "error");
    (challenge?.task_type === "rewrite"
      ? byId("explanation")
      : byId("completionCode")
    ).focus();
    return;
  }

  setButtonLoading(byId("btnSubmit"), true, "Assessing answer");
  actionPending = true;
  byId("btnSkip").disabled = true;
  byId("explanation").disabled = true;
  byId("completionCode").disabled = true;
  setLog(byId("submitLog"), "Saving and assessing your answer. Your feedback will appear below…");
  try {
    const response = await submitChallenge(challenge.session_id, payload);
    if ([2, 3].includes(response.workflow_version) && response.challenge) {
      renderWorkspace(cacheChallenge(response.challenge));
      if (challenge.evaluation) focusFeedback();
      return;
    }
    if (response.evaluation) saveEvaluation(challenge.session_id, response.evaluation);
    setLog(
      byId("submitLog"),
      "All answers assessed. Opening your overall review…",
      "success",
    );
    await navigateForward(stepUrl("review", challenge.session_id));
  } catch (error) {
    // Recover the saved answer even if the grading request failed or
    // its response was lost. Never let a refresh skip an unassessed question.
    try {
      const response = await getChallenge(challenge.session_id);
      if (response.status === "ready_for_review") {
        await navigateForward(stepUrl("review", challenge.session_id));
        return;
      }
      renderWorkspace(cacheChallenge({ ...response.challenge, session_id: response.session_id }));
      if (challenge.evaluation) {
        focusFeedback();
        return;
      }
      if (payload.question_id && response.challenge.question_id !== payload.question_id) {
        if (!pendingAnswer) setLog(byId("submitLog"), "Answer assessed. Restored the next question.", "success");
        return;
      }
    } catch (_) { /* Preserve the current draft when the network is unavailable. */ }
    setLog(byId("submitLog"), error.message || String(error), "error");
  } finally {
    actionPending = false;
    byId("btnSkip").disabled = false;
    setButtonLoading(byId("btnSubmit"), false);
    byId("explanation").disabled = Boolean(challenge?.evaluation);
    byId("completionCode").disabled = Boolean(challenge?.evaluation);
    updateSubmitLabel();
  }
}

function focusFeedback() {
  byId("questionAssessmentTitle").focus({ preventScroll: true });
  scrollToElement(byId("questionAssessment"), { block: "start" });
}

async function handleContinue() {
  if (actionPending || !challenge?.evaluation || byId("btnContinue").disabled) return;
  actionPending = true;
  byId("btnFinish").disabled = true;
  setButtonLoading(byId("btnContinue"), true, "Continuing…");
  try {
    const response = await continueChallenge(challenge.session_id, challenge.question_id);
    if (response.status === "ready_for_review") {
      await navigateForward(stepUrl("review", challenge.session_id));
      return;
    }
    renderWorkspace(cacheChallenge(response.challenge));
    byId("challengeTitle").setAttribute("tabindex", "-1");
    byId("challengeTitle").focus({ preventScroll: true });
    scrollToElement(byId("questionProgressLabel"), { block: "start" });
  } catch (error) {
    setLog(byId("continueLog"), error.message || String(error), "error");
  } finally {
    actionPending = false;
    byId("btnFinish").disabled = false;
    setButtonLoading(byId("btnContinue"), false);
  }
}

async function handleAdaptiveAction(action) {
  if (actionPending || !challenge?.adaptive) return;
  actionPending = true;
  const button = byId(action === "skip" ? "btnSkip" : "btnFinish");
  const log = byId(action === "skip" ? "submitLog" : "continueLog");
  setButtonLoading(button, true, action === "skip" ? "Skipping…" : "Finishing…");
  byId("btnSubmit").disabled = true;
  byId("btnContinue").disabled = true;
  byId("explanation").disabled = true;
  try {
    const response = await adaptiveAction(challenge.session_id, challenge.question_id, action);
    if (response.status === "ready_for_review") {
      await navigateForward(stepUrl("review", challenge.session_id));
      return;
    }
    renderWorkspace(cacheChallenge(response.challenge));
    if (challenge.evaluation) focusFeedback();
  } catch (error) {
    setLog(log, error.message || String(error), "error");
  } finally {
    actionPending = false;
    setButtonLoading(button, false);
    byId("btnSubmit").disabled = false;
    byId("btnContinue").disabled = false;
    byId("explanation").disabled = Boolean(challenge?.evaluation);
  }
}

function bindEvents() {
  byId("retryWorkspace").addEventListener("click", loadWorkspace);
  byId("fileSelect").addEventListener("change", (event) => switchFile(event.target.value));
  byId("btnSubmit").addEventListener("click", handleSubmit);
  byId("btnContinue").addEventListener("click", handleContinue);
  byId("btnSkip").addEventListener("click", () => handleAdaptiveAction("skip"));
  byId("btnFinish").addEventListener("click", () => handleAdaptiveAction("finish"));
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
    updateSubmitLabel();
  });
  byId("completionCode").addEventListener("input", (event) => {
    const completionCode = event.target.value;
    byId("completionCount").textContent = `${countLines(completionCode)} lines`;
    saveAnswerDraft({ completionCode });
    updateSubmitLabel();
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
