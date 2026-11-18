const STORAGE_KEY = "eduagent.workflow.v1";

function emptyState() {
  return {
    sessionId: "",
    challenge: null,
    answerDraft: { explanation: "", completionCode: "" },
    hasAnswerDraft: false,
    evaluation: null
  };
}

function read() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
    return value && typeof value === "object" ? { ...emptyState(), ...value } : emptyState();
  } catch (_) {
    return emptyState();
  }
}

function write(state) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    // The session_id in the URL still lets the next page restore from the API.
  }
  return state;
}

export function getWorkflowState() {
  return read();
}

export function startWorkflow(challenge) {
  return write({
    ...emptyState(),
    sessionId: challenge.session_id,
    challenge
  });
}

export function cacheChallenge(challenge) {
  const current = read();
  const isSameSession = current.sessionId === challenge.session_id;
  const isSameQuestion = isSameSession && current.challenge?.question_id === challenge.question_id;
  const sameSavedAnswer = isSameQuestion
    && JSON.stringify(current.challenge?.pending_answer || null) === JSON.stringify(challenge.pending_answer || null);
  const keepDraft = sameSavedAnswer && !challenge.evaluation;
  return write({
    ...emptyState(),
    ...(isSameSession ? current : {}),
    sessionId: challenge.session_id,
    challenge,
    answerDraft: keepDraft ? current.answerDraft : emptyState().answerDraft,
    hasAnswerDraft: keepDraft && Boolean(current.hasAnswerDraft),
    evaluation: null
  });
}

export function saveAnswerDraft(answerDraft) {
  const current = read();
  return write({ ...current, hasAnswerDraft: true, answerDraft: { ...current.answerDraft, ...answerDraft } });
}

export function saveEvaluation(sessionId, evaluation) {
  const current = read();
  const base = current.sessionId === sessionId ? current : emptyState();
  return write({ ...base, sessionId, evaluation });
}

export function clearWorkflow() {
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export function sessionIdFromLocation() {
  return new URLSearchParams(window.location.search).get("session_id")?.trim() || "";
}

export function stepUrl(step, sessionId = "") {
  const path = step === "create" ? "/create" : `/${step}`;
  return sessionId ? `${path}?session_id=${encodeURIComponent(sessionId)}` : path;
}
