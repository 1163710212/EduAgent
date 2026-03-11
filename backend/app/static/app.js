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
  "filesArea",
  "fileSelect",
  "codeViewer",
  "rewriteAnswerArea",
  "explanation",
  "blankFillAnswerArea",
  "completionCode",
  "btnSubmit",
  "submitLog",
  "report"
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

function setLog(el, obj) {
  el.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

function validateRepoUrl(repoUrl) {
  if (!repoUrl) return "请填写 Repo URL（示例: https://github.com/OWNER/REPO）";
  const patterns = [
    /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\/.*)?$/i,
    /^(www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\/.*)?$/i,
    /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i
  ];
  if (!patterns.some((p) => p.test(repoUrl))) {
    return "Repo URL 仅支持 GitHub 仓库（可用 https://github.com/OWNER/REPO 或 git@github.com:OWNER/REPO.git）";
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
  $("challengeTitle").textContent = "挑战详情";
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
  $("fileSelect").innerHTML = "";
  $("codeViewer").value = "";
  $("rewriteAnswerArea").classList.add("hidden");
  $("blankFillAnswerArea").classList.add("hidden");
  $("explanation").value = "";
  $("completionCode").value = "";
}

function setAnswerMode(taskType) {
  const isRewrite = taskType === "rewrite";
  $("rewriteAnswerArea").classList.toggle("hidden", !isRewrite);
  $("blankFillAnswerArea").classList.toggle("hidden", isRewrite);
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

  $("challengeTitle").textContent = data.title || "未命名挑战";
  $("challengeTaskType").textContent = `task: ${data.task_type || "unknown"}`;
  $("challengeLanguage").textContent = `lang: ${data.language || "unknown"}`;
  $("challengeSession").textContent = `session: ${data.session_id || "-"}`;
  $("challengeInstructions").textContent = data.student_instructions_md || "(无说明)";

  const files = data.files && typeof data.files === "object" ? data.files : {};
  const fileList = $("challengeFiles");
  clearElement(fileList);
  const paths = Object.keys(files);

  if (paths.length === 0) {
    const li = document.createElement("li");
    li.textContent = "无文件";
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
      stats.textContent = `${countLines(content)} 行 / ${String(content).length} 字符`;
      summary.appendChild(stats);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn";
      btn.textContent = "查看代码";
      btn.onclick = () => switchViewerToPath(path);

      li.appendChild(summary);
      li.appendChild(btn);
      fileList.appendChild(li);
    }
  }

  $("challengeView").classList.remove("hidden");
}

function renderReport(evaluation) {
  const report = $("report");
  const taskType = evaluation.task_type || currentTaskType || "unknown";
  const passLabel = taskType === "blank_fill" ? "BLANK 是否通过" : "任务规则是否通过";
  const md = [
    `任务类型: ${taskType}`,
    `总分: ${evaluation.total_score}/100`,
    `${passLabel}: ${evaluation.passed_blanks}`,
    "",
    evaluation.feedback_md || "",
    "",
    "建议:",
    ...(evaluation.suggestions || []).map((s) => `- ${s}`)
  ].join("\n");
  report.textContent = md;
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
    throw new Error("补全代码不能为空");
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
    throw new Error("挑战文件为空，无法补全。");
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

  throw new Error("未找到可替换的 BLANK 标记区域。");
}

function buildFilledFilesForBlankFill() {
  const files = cloneFiles(currentFiles);
  const blanks = Array.isArray(currentChallenge?.blanks) ? currentChallenge.blanks : [];
  if (blanks.length > 1) {
    throw new Error("当前版本仅支持 1 个 BLANK 区域。");
  }

  const blank = blanks[0] && typeof blanks[0] === "object" ? blanks[0] : {};
  let targetPath = typeof blank.file_path === "string" ? blank.file_path : "";
  if (!targetPath || !Object.prototype.hasOwnProperty.call(files, targetPath)) {
    targetPath = Object.keys(files).find((path) => /BLANK_START|BLANK:[A-Za-z0-9_\-]+/.test(files[path] || ""));
  }
  if (!targetPath || !Object.prototype.hasOwnProperty.call(files, targetPath)) {
    throw new Error("未找到包含 BLANK 标记的挑战文件。");
  }

  files[targetPath] = applyCompletionToContent(files[targetPath], $("completionCode").value, blank.blank_id || "");
  return files;
}

function bindEventHandlers() {
  $("btnCreate").onclick = async () => {
    $("createLog").textContent = "请求中...";
    $("submitLog").textContent = "";
    $("report").textContent = "";
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
      setLog($("createLog"), repoErr);
      return;
    }

    const payload = {
      repo_url: repoUrl,
      ref,
      language,
      task_type: taskType,
      file_paths: filePath ? [filePath] : []
    };

    try {
      const res = await fetch("/api/challenges/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.detail || "create failed");

      setLog($("createLog"), "请求完成");

      $("sessionId").value = data.session_id;
      currentChallenge = data;
      currentTaskType = data.task_type || taskType;
      currentFiles = cloneFiles(data.files || {});

      loadFileOptions(currentFiles);
      renderChallengeArtifact(data);
      setAnswerMode(currentTaskType);

      $("completionCode").value = "";
      $("explanation").value = "";
    } catch (e) {
      resetChallengeView();
      resetStudentWorkspace();
      setLog($("createLog"), String(e));
    }
  };

  $("btnSubmit").onclick = async () => {
    $("submitLog").textContent = "提交中...";
    $("report").textContent = "";

    const sessionId = $("sessionId").value.trim();
    if (!sessionId) {
      setLog($("submitLog"), "缺少 session_id");
      return;
    }
    if (!currentChallenge || Object.keys(currentFiles).length === 0) {
      setLog($("submitLog"), "请先生成挑战并加载挑战文件。");
      return;
    }

    let filledFiles = {};
    let explanationMd = "";
    try {
      if (currentTaskType === "rewrite") {
        explanationMd = $("explanation").value;
        if (!explanationMd.trim()) {
          setLog($("submitLog"), "rewrite 任务需要填写代码解释。");
          return;
        }
        filledFiles = cloneFiles(currentFiles);
      } else if (currentTaskType === "blank_fill") {
        filledFiles = buildFilledFilesForBlankFill();
        explanationMd = "";
      } else {
        setLog($("submitLog"), `未知任务类型: ${currentTaskType}`);
        return;
      }
    } catch (e) {
      setLog($("submitLog"), String(e));
      return;
    }

    const payload = {
      explanation_md: explanationMd,
      filled_files: filledFiles
    };

    try {
      const res = await fetch(`/api/challenges/${sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.detail || "submit failed");

      setLog($("submitLog"), "提交完成");
      renderReport(data.evaluation);
    } catch (e) {
      setLog($("submitLog"), String(e));
    }
  };
}

function initApp() {
  if (!ensureRequiredElements()) return;
  bindEventHandlers();
  resetChallengeView();
  resetStudentWorkspace();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}
