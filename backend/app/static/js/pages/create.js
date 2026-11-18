import { createChallenge } from "../api/challenges.js";
import { validateRepoUrl } from "../domain/challenge.js";
import { startWorkflow, stepUrl } from "../state/workflow-store.js";
import { initRepositoryExplorer } from "../ui/repository-explorer.js";
import {
  byId,
  initPageMotion,
  navigateForward,
  setButtonLoading,
  setLog,
} from "../ui/common.js";

let repositoryExplorer;

function formPayload() {
  return {
    repo_url: byId("repoUrl").value.trim(),
    ref: byId("ref").value.trim() || "main",
    task_type: byId("taskType").value,
  };
}

async function handleCreate() {
  if (byId("btnCreate").disabled) return;
  const validationError = validateRepoUrl(byId("repoUrl").value.trim());
  if (validationError) {
    setLog(byId("createLog"), validationError, "error");
    byId("repoUrl").focus();
    return;
  }

  setButtonLoading(byId("btnCreate"), true, "Analyzing repository");
  const controls = [...byId("challengeForm").querySelectorAll("input, select, button")]
    .filter(control => control.id !== "btnCreate");
  const previousDisabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  setLog(
    byId("createLog"),
    "Detecting the dominant programming language and preparing snippets at different difficulties…",
  );
  try {
    // Resolve the default branch first. Language selection always runs on the
    // backend, including when the public repository preview is unavailable.
    await repositoryExplorer.ensureMetadata();
    const payload = formPayload();
    const challenge = await createChallenge(payload);
    startWorkflow(challenge);
    setLog(
      byId("createLog"),
      "Your first question is ready. Opening adaptive practice…",
      "success",
    );
    await navigateForward(stepUrl("solve", challenge.session_id));
  } catch (error) {
    setLog(byId("createLog"), error.message || String(error), "error");
  } finally {
    controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
    setButtonLoading(byId("btnCreate"), false);
  }
}

function init() {
  initPageMotion();
  repositoryExplorer = initRepositoryExplorer();
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
