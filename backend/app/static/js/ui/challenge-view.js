import { countLines } from "../domain/challenge.js";
import { byId, clearElement } from "./common.js";

export function renderChallengeSummary(challenge, onViewFile) {
  byId("challengeTitle").textContent = challenge.title || "Untitled challenge";
  byId("challengeTaskType").textContent = `task: ${challenge.task_type || "unknown"}`;
  byId("challengeLanguage").textContent = `lang: ${challenge.language || "unknown"}`;
  byId("challengeSession").textContent = `session: ${challenge.session_id || "-"}`;
  byId("challengeInstructions").textContent = challenge.student_instructions_md || "No brief provided.";

  const fileList = byId("challengeFiles");
  clearElement(fileList);
  const entries = Object.entries(challenge.files || {});
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "No files";
    fileList.appendChild(item);
    return;
  }

  entries.forEach(([path, content]) => {
    const item = document.createElement("li");
    item.className = "file-item";

    const summary = document.createElement("div");
    summary.className = "file-item-summary";
    const filePath = document.createElement("code");
    filePath.textContent = path;
    const stats = document.createElement("span");
    stats.className = "file-stats";
    stats.textContent = `${countLines(content)} lines / ${String(content).length} chars`;
    summary.append(filePath, stats);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn";
    button.textContent = "View code";
    button.addEventListener("click", () => onViewFile(path));
    item.append(summary, button);
    fileList.appendChild(item);
  });
}
