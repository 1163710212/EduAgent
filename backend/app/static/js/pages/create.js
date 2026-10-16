import { createChallenge } from "../api/challenges.js";
import { validateRepoUrl } from "../domain/challenge.js";
import { startWorkflow, stepUrl } from "../state/workflow-store.js";
import {
  byId,
  initPageMotion,
  navigateForward,
  setButtonLoading,
  setLog,
} from "../ui/common.js";

function formPayload() {
  return {
    repo_url: byId("repoUrl").value.trim(),
    ref: byId("ref").value.trim() || "main",
    language: byId("language").value,
    task_type: byId("taskType").value,
  };
}

async function handleCreate() {
  if (byId("btnCreate").disabled) return;
  const payload = formPayload();
  const validationError = validateRepoUrl(payload.repo_url);
  if (validationError) {
    setLog(byId("createLog"), validationError, "error");
    byId("repoUrl").focus();
    return;
  }

  setButtonLoading(byId("btnCreate"), true, "Analyzing repository");
  setLog(
    byId("createLog"),
    "Selecting three key files and preparing your questions…",
  );
  try {
    const challenge = await createChallenge(payload);
    startWorkflow(challenge);
    setLog(
      byId("createLog"),
      "Three questions ready. Opening question 1…",
      "success",
    );
    await navigateForward(stepUrl("solve", challenge.session_id));
  } catch (error) {
    setLog(byId("createLog"), error.message || String(error), "error");
  } finally {
    setButtonLoading(byId("btnCreate"), false);
  }
}

function init() {
  initPageMotion();
  byId("challengeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    handleCreate();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
