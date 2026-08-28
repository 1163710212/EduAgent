const $ = (id) => document.getElementById(id);

const REQUIRED_ELEMENT_IDS = [
  "repoUrl",
  "ref",
  "language",
  "taskType",
  "filePath",
  "btnCreate",
  "createLog",
  "challengeView",
  "challengeTitle",
  "challengeTaskType",
  "challengeLanguage",
  "challengeSession",
  "challengeInstructions",
  "challengeFiles",
  "sessionId",
  "workspaceEmpty",
  "answerWorkspace",
  "filesArea",
  "fileSelect",
  "codeViewer",
  "rewriteAnswerArea",
  "explanation",
  "blankFillAnswerArea",
  "completionCode",
  "btnSubmit",
  "submitLog",
  "report",
  "progressBar",
  "progressLabel"
];

let currentFiles = {}; // path -> content (read-only challenge files)
let currentTaskType = "rewrite";
let currentViewingPath = "";
let currentChallenge = null;

function ensureRequiredElements() {
  const missing = REQUIRED_ELEMENT_IDS.filter((id) => !$(id));
  if (missing.length > 0) {
    console.error(`[ui] Missing required DOM elements: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

function setLog(el, obj, status = "") {
  el.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  if (status) {
    el.dataset.status = status;
  } else {
    delete el.dataset.status;
  }
}

function refreshIcons() {
  // Phosphor icons are rendered by the icon font stylesheet.
}

function makeIcon(name) {
  const icon = document.createElement("i");
  const icons = {
    "code-2": "code",
    "chart-no-axes-column-increasing": "chart-bar",
    "chart-spline": "chart-line",
    "messages-square": "chats-circle",
    route: "path"
  };
  icon.className = `ph-duotone ph-${icons[name] || name}`;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function setButtonLoading(button, isLoading, loadingLabel) {
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.querySelector("span")?.textContent || button.textContent;
  }
  button.disabled = isLoading;
  button.setAttribute("aria-busy", String(isLoading));
  const label = button.querySelector("span");
  if (label) label.textContent = isLoading ? loadingLabel : button.dataset.defaultLabel;
  const existingSpinner = button.querySelector(".spinner");
  const icon = button.querySelector("i[class*='ph-']");
  if (isLoading && !existingSpinner) {
    if (icon) icon.classList.add("hidden");
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    button.appendChild(spinner);
  } else if (!isLoading && existingSpinner) {
    existingSpinner.remove();
    if (icon) icon.classList.remove("hidden");
  }
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function updateProgress(stage) {
  const order = ["create", "workspace", "evaluation"];
  const icons = { create: "plus", workspace: "code-2", evaluation: "chart-no-axes-column-increasing" };
  const labels = {
    create: "Ready",
    workspace: "In progress",
    evaluation: "Complete"
  };
  const widths = { create: "14%", workspace: "56%", evaluation: "100%" };
  const activeIndex = Math.max(0, order.indexOf(stage));

  $("progressBar").style.width = widths[stage] || widths.create;
  $("progressLabel").textContent = labels[stage] || labels.create;
  document.querySelectorAll("[data-progress-step]").forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.progressStep);
    item.classList.toggle("current", itemIndex === activeIndex);
    item.classList.toggle("complete", itemIndex < activeIndex);
    const indicator = item.querySelector(".step-indicator");
    if (indicator) {
      clearElement(indicator);
      indicator.appendChild(makeIcon(itemIndex < activeIndex ? "check" : icons[item.dataset.progressStep]));
    }
  });
  refreshIcons();
}

function resetReport() {
  const report = $("report");
  clearElement(report);
  const empty = document.createElement("div");
  empty.className = "empty-state compact";
  const emptyIcon = document.createElement("span");
  emptyIcon.className = "empty-icon";
  emptyIcon.appendChild(makeIcon("chart-spline"));
  const heading = document.createElement("h3");
  heading.textContent = "Feedback appears here.";
  const copy = document.createElement("p");
  copy.textContent = "Submit your response to see a score, details, and next steps.";
  empty.append(emptyIcon, heading, copy);
  report.appendChild(empty);
  refreshIcons();
}

function validateRepoUrl(repoUrl) {
  if (!repoUrl) return "Enter a repository URL, such as github.com/owner/repo.";
  const patterns = [
    /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\/.*)?$/i,
    /^(www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\/.*)?$/i,
    /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i
  ];
  if (!patterns.some((p) => p.test(repoUrl))) {
    return "Use a GitHub URL or owner/repository path.";
  }
  return "";
}

async function parseApiResponse(res) {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { detail: raw };
  }
}

function clearElement(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function countLines(text) {
  if (!text) return 0;
  return String(text).split(/\r?\n/).length;
}

function cloneFiles(files) {
  const cloned = {};
  for (const [path, content] of Object.entries(files || {})) {
    cloned[path] = typeof content === "string" ? content : String(content || "");
  }
  return cloned;
}

function resetChallengeView() {
  $("challengeTitle").textContent = "Challenge details";
  $("challengeTaskType").textContent = "";
  $("challengeLanguage").textContent = "";
  $("challengeSession").textContent = "";
  $("challengeInstructions").textContent = "";
  clearElement($("challengeFiles"));
  $("challengeView").classList.add("hidden");
}

function resetStudentWorkspace() {
  currentFiles = {};
  currentTaskType = "rewrite";
  currentViewingPath = "";
  currentChallenge = null;

  $("filesArea").classList.add("hidden");
  $("answerWorkspace").classList.add("hidden");
  $("workspaceEmpty").classList.remove("hidden");
  $("fileSelect").innerHTML = "";
  $("codeViewer").value = "";
  $("rewriteAnswerArea").classList.add("hidden");
  $("blankFillAnswerArea").classList.add("hidden");
  $("explanation").value = "";
  $("completionCode").value = "";
  $("explanationCount").textContent = "0 chars";
  $("completionCount").textContent = "0 lines";
  updateProgress("create");
}

function setAnswerMode(taskType) {
  const isRewrite = taskType === "rewrite";
  $("workspaceEmpty").classList.add("hidden");
  $("answerWorkspace").classList.remove("hidden");
  $("rewriteAnswerArea").classList.toggle("hidden", !isRewrite);
  $("blankFillAnswerArea").classList.toggle("hidden", isRewrite);
  updateProgress("workspace");
}

function switchViewerToPath(path) {
  if (!Object.prototype.hasOwnProperty.call(currentFiles, path)) return;
  $("filesArea").classList.remove("hidden");
  $("fileSelect").value = path;
  currentViewingPath = path;
  $("codeViewer").value = currentFiles[path] || "";
}

function renderChallengeArtifact(data) {
  if (!data || typeof data !== "object") {
    resetChallengeView();
    return;
  }

  $("challengeTitle").textContent = data.title || "Untitled challenge";
  $("challengeTaskType").textContent = `task: ${data.task_type || "unknown"}`;
  $("challengeLanguage").textContent = `lang: ${data.language || "unknown"}`;
  $("challengeSession").textContent = `session: ${data.session_id || "-"}`;
  $("challengeInstructions").textContent = data.student_instructions_md || "No brief provided.";

  const files = data.files && typeof data.files === "object" ? data.files : {};
  const fileList = $("challengeFiles");
  clearElement(fileList);
  const paths = Object.keys(files);

  if (paths.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No files";
    fileList.appendChild(li);
  } else {
    for (const path of paths) {
      const content = files[path] || "";
      const li = document.createElement("li");
      li.className = "file-item";

      const summary = document.createElement("div");
      summary.className = "file-item-summary";

      const pathEl = document.createElement("code");
      pathEl.textContent = path;
      summary.appendChild(pathEl);

      const stats = document.createElement("span");
      stats.className = "file-stats";
      stats.textContent = `${countLines(content)} lines / ${String(content).length} chars`;
      summary.appendChild(stats);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn";
      btn.textContent = "View code";
      btn.onclick = () => {
        switchViewerToPath(path);
        document.querySelector("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
      };

      li.appendChild(summary);
      li.appendChild(btn);
      fileList.appendChild(li);
    }
  }

  $("challengeView").classList.remove("hidden");
  refreshIcons();
}

function renderReport(evaluation) {
  const report = $("report");
  const taskType = evaluation.task_type || currentTaskType || "unknown";
  const passLabel = taskType === "blank_fill" ? "Blank passed" : "Rules passed";
  const score = Number.isFinite(Number(evaluation.total_score)) ? Number(evaluation.total_score) : 0;
  const suggestions = Array.isArray(evaluation.suggestions) ? evaluation.suggestions : [];
  clearElement(report);

  const summary = document.createElement("div");
  summary.className = "report-summary";

  const scoreCard = document.createElement("div");
  scoreCard.className = "score-card";
  const scoreLabel = document.createElement("div");
  scoreLabel.className = "score-label";
  scoreLabel.append(document.createTextNode("Overall score"), makeIcon("gauge"));
  const scoreValue = document.createElement("div");
  scoreValue.className = "score-value";
  scoreValue.append(document.createTextNode(String(score)), Object.assign(document.createElement("small"), { textContent: "/100" }));
  const scoreStatus = document.createElement("span");
  scoreStatus.className = "score-status";
  scoreStatus.textContent = score >= 80 ? "Strong result" : score >= 60 ? "Keep building" : "Review again";
  scoreCard.append(scoreLabel, scoreValue, scoreStatus);

  const feedbackCard = document.createElement("div");
  feedbackCard.className = "feedback-card";
  const feedbackTitle = document.createElement("h3");
  feedbackTitle.append(makeIcon("messages-square"), document.createTextNode("AI feedback"));
  const feedback = document.createElement("pre");
  feedback.className = "feedback-content";
  feedback.textContent = evaluation.feedback_md || "No detailed feedback yet.";
  const meta = document.createElement("div");
  meta.className = "report-meta";
  const taskPill = document.createElement("span");
  taskPill.className = "pill";
  taskPill.textContent = `task: ${taskType}`;
  const passPill = document.createElement("span");
  passPill.className = "pill";
  passPill.textContent = `${passLabel}: ${String(evaluation.passed_blanks ?? "-")}`;
  meta.append(taskPill, passPill);
  feedbackCard.append(feedbackTitle, feedback, meta);

  const suggestionsCard = document.createElement("div");
  suggestionsCard.className = "suggestions-card";
  const suggestionsTitle = document.createElement("h3");
  suggestionsTitle.append(makeIcon("route"), document.createTextNode("Next steps"));
  const suggestionList = document.createElement("ul");
  suggestionList.className = "suggestion-list";
  const items = suggestions.length ? suggestions : ["Review the brief and restate the key logic in your own words."];
  items.forEach((suggestion, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    number.className = "suggestion-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("span");
    copy.textContent = String(suggestion);
    item.append(number, copy);
    suggestionList.appendChild(item);
  });
  suggestionsCard.append(suggestionsTitle, suggestionList);

  summary.append(scoreCard, feedbackCard, suggestionsCard);
  report.appendChild(summary);
  updateProgress("evaluation");
  refreshIcons();
}

function loadFileOptions(files) {
  const select = $("fileSelect");
  select.innerHTML = "";
  const paths = Object.keys(files);
  for (const p of paths) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  }
  select.onchange = () => switchViewerToPath(select.value);

  if (paths.length > 0) {
    switchViewerToPath(paths[0]);
  } else {
    currentViewingPath = "";
    $("codeViewer").value = "";
    $("filesArea").classList.add("hidden");
  }
}

function leadingWhitespace(line) {
  const match = String(line || "").match(/^\s*/);
  return match ? match[0] : "";
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markerRegex(marker, blankId) {
  const id = String(blankId || "").trim();
  if (id) {
    return new RegExp(`\\b${marker}:${escapeRegExp(id)}\\b`);
  }
  return new RegExp(`\\b${marker}(?::[A-Za-z0-9_\\-]+)?\\b`);
}

function normalizeCompletionLines(completionCode, baseIndent) {
  const normalized = String(completionCode || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\n+|\n+$/g, "");
  if (!/\S/.test(normalized)) {
    throw new Error("Code completion cannot be empty.");
  }

  const rawLines = normalized.split("\n");
  const nonEmptyLines = rawLines.filter((line) => line.trim().length > 0);
  const minIndent = nonEmptyLines.length
    ? Math.min(...nonEmptyLines.map((line) => leadingWhitespace(line).length))
    : 0;

  return rawLines.map((line) => {
    if (!line.trim()) return "";
    const stripped = line.slice(minIndent);
    return `${baseIndent}${stripped}`;
  });
}

function splitContentLines(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const body = hasTrailingNewline ? normalized.slice(0, -1) : normalized;
  const lines = body ? body.split("\n") : [];
  return { lines, hasTrailingNewline };
}

function joinContentLines(lines, hasTrailingNewline) {
  let text = lines.join("\n");
  if (hasTrailingNewline) {
    text += "\n";
  }
  return text;
}

function applyCompletionToContent(content, completionCode, blankId) {
  const { lines, hasTrailingNewline } = splitContentLines(content);
  if (lines.length === 0) {
    throw new Error("The challenge file is empty.");
  }

  const startRe = markerRegex("BLANK_START", blankId);
  const endRe = markerRegex("BLANK_END", blankId);
  const blankRe = markerRegex("BLANK", blankId);

  let startIndex = -1;
  let endIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (startIndex < 0 && startRe.test(lines[i])) {
      startIndex = i;
      continue;
    }
    if (startIndex >= 0 && endRe.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (startIndex >= 0 && endIndex >= startIndex) {
    let blankLineIndex = startIndex;
    for (let i = startIndex; i <= endIndex; i += 1) {
      if (blankRe.test(lines[i])) {
        blankLineIndex = i;
        break;
      }
    }
    const baseIndent = leadingWhitespace(lines[blankLineIndex]);
    const replacement = normalizeCompletionLines(completionCode, baseIndent);
    lines.splice(startIndex, endIndex - startIndex + 1, ...replacement);
    return joinContentLines(lines, hasTrailingNewline);
  }

  const inlineBlankIndex = lines.findIndex((line) => blankRe.test(line));
  if (inlineBlankIndex >= 0) {
    const baseIndent = leadingWhitespace(lines[inlineBlankIndex]);
    const replacement = normalizeCompletionLines(completionCode, baseIndent);
    lines.splice(inlineBlankIndex, 1, ...replacement);
    return joinContentLines(lines, hasTrailingNewline);
  }

  throw new Error("No replaceable BLANK region was found.");
}

function buildFilledFilesForBlankFill() {
  const files = cloneFiles(currentFiles);
  const blanks = Array.isArray(currentChallenge?.blanks) ? currentChallenge.blanks : [];
  if (blanks.length > 1) {
    throw new Error("This version supports one BLANK region per challenge.");
  }

  const blank = blanks[0] && typeof blanks[0] === "object" ? blanks[0] : {};
  let targetPath = typeof blank.file_path === "string" ? blank.file_path : "";
  if (!targetPath || !Object.prototype.hasOwnProperty.call(files, targetPath)) {
    targetPath = Object.keys(files).find((path) => /BLANK_START|BLANK:[A-Za-z0-9_\-]+/.test(files[path] || ""));
  }
  if (!targetPath || !Object.prototype.hasOwnProperty.call(files, targetPath)) {
    throw new Error("No challenge file contains a BLANK marker.");
  }

  files[targetPath] = applyCompletionToContent(files[targetPath], $("completionCode").value, blank.blank_id || "");
  return files;
}

function bindEventHandlers() {
  $("btnCreate").onclick = async () => {
    $("createLog").textContent = "";
    $("submitLog").textContent = "";
    resetReport();
    $("sessionId").value = "";
    resetChallengeView();
    resetStudentWorkspace();

    const repoUrl = $("repoUrl").value.trim();
    const ref = $("ref").value.trim() || "main";
    const language = $("language").value;
    const taskType = $("taskType").value;
    const filePath = $("filePath").value.trim();
    const repoErr = validateRepoUrl(repoUrl);
    if (repoErr) {
      setLog($("createLog"), repoErr, "error");
      $("repoUrl").focus();
      return;
    }

    const payload = {
      repo_url: repoUrl,
      ref,
      language,
      task_type: taskType,
      file_paths: filePath ? [filePath] : []
    };

    setButtonLoading($("btnCreate"), true, "Analyzing repository");
    setLog($("createLog"), "Reading the repository and building your challenge…");
    try {
      const res = await fetch("/api/challenges/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.detail || "create failed");

      setLog($("createLog"), "Challenge ready. Your workspace is set.", "success");

      $("sessionId").value = data.session_id;
      currentChallenge = data;
      currentTaskType = data.task_type || taskType;
      currentFiles = cloneFiles(data.files || {});

      loadFileOptions(currentFiles);
      renderChallengeArtifact(data);
      setAnswerMode(currentTaskType);

      $("completionCode").value = "";
      $("explanation").value = "";
      showToast("Challenge ready. Start when you are.");
    } catch (e) {
      resetChallengeView();
      resetStudentWorkspace();
      setLog($("createLog"), String(e), "error");
    } finally {
      setButtonLoading($("btnCreate"), false, "");
    }
  };

  $("btnSubmit").onclick = async () => {
    $("submitLog").textContent = "";
    resetReport();

    const sessionId = $("sessionId").value.trim();
    if (!sessionId) {
      setLog($("submitLog"), "Create a challenge first.", "error");
      return;
    }
    if (!currentChallenge || Object.keys(currentFiles).length === 0) {
      setLog($("submitLog"), "Create a challenge and load its files first.", "error");
      return;
    }

    let filledFiles = {};
    let explanationMd = "";
    try {
      if (currentTaskType === "rewrite") {
        explanationMd = $("explanation").value;
        if (!explanationMd.trim()) {
          setLog($("submitLog"), "Add your explanation before submitting.", "error");
          $("explanation").focus();
          return;
        }
        filledFiles = cloneFiles(currentFiles);
      } else if (currentTaskType === "blank_fill") {
        filledFiles = buildFilledFilesForBlankFill();
        explanationMd = "";
      } else {
        setLog($("submitLog"), `Unknown challenge type: ${currentTaskType}`, "error");
        return;
      }
    } catch (e) {
      setLog($("submitLog"), String(e), "error");
      return;
    }

    const payload = {
      explanation_md: explanationMd,
      filled_files: filledFiles
    };

    setButtonLoading($("btnSubmit"), true, "Reviewing answer");
    setLog($("submitLog"), "Evaluating your answer in context…");
    try {
      const res = await fetch(`/api/challenges/${sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.detail || "submit failed");

      setLog($("submitLog"), "Review complete. Feedback is ready.", "success");
      renderReport(data.evaluation);
      showToast("Feedback ready. See what to improve.");
      $("evaluation").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setLog($("submitLog"), String(e), "error");
    } finally {
      setButtonLoading($("btnSubmit"), false, "");
    }
  };

  $("copySession").onclick = async () => {
    const value = $("sessionId").value.trim();
    if (!value) {
      showToast("Create a challenge before copying the session ID.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast("Session ID copied.");
    } catch (_) {
      $("sessionId").select();
      document.execCommand("copy");
      showToast("Session ID copied.");
    }
  };

  $("explanation").addEventListener("input", (event) => {
    $("explanationCount").textContent = `${event.target.value.trim().length} chars`;
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 420)}px`;
  });

  $("completionCode").addEventListener("input", (event) => {
    $("completionCount").textContent = `${countLines(event.target.value)} lines`;
  });
}

function initPageMotion() {
  const revealItems = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("visible"));
    return;
  }

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -30px" });
  revealItems.forEach((item) => revealObserver.observe(item));

  const sections = ["create", "workspace", "evaluation"]
    .map((id) => $(id))
    .filter(Boolean);
  const navObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    document.querySelectorAll(".nav-item").forEach((item) => {
      const isActive = item.dataset.section === visible.target.id;
      item.classList.toggle("active", isActive);
      if (isActive) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }, { threshold: [0.2, 0.45, 0.7], rootMargin: "-90px 0px -45%" });
  sections.forEach((section) => navObserver.observe(section));
}

function initApp() {
  if (!ensureRequiredElements()) return;
  refreshIcons();
  bindEventHandlers();
  resetChallengeView();
  resetStudentWorkspace();
  resetReport();
  initPageMotion();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
