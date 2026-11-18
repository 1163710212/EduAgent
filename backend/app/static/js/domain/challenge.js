export function validateRepoUrl(repoUrl) {
  if (!repoUrl) return "Enter a repository URL, such as github.com/owner/repo.";
  const patterns = [
    /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\/.*)?$/i,
    /^(www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\/.*)?$/i,
    /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i
  ];
  return patterns.some((pattern) => pattern.test(repoUrl))
    ? ""
    : "Use a GitHub URL or owner/repository path.";
}

export function countLines(text) {
  if (!text) return 0;
  return String(text).split(/\r?\n/).length;
}

export function cloneFiles(files) {
  return Object.fromEntries(
    Object.entries(files || {}).map(([path, content]) => [
      path,
      typeof content === "string" ? content : String(content || "")
    ])
  );
}

function leadingWhitespace(line) {
  return String(line || "").match(/^\s*/)?.[0] || "";
}

export function explanationValidationError(text) {
  const visible = String(text || "").normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0]/gu, "").trim();
  const letters = visible.match(/\p{L}/gu) || [];
  if (!visible || !letters.length) {
    return "Explain what the highlighted code does; whitespace, symbols or a number alone are not an explanation.";
  }
  const compact = visible.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  if (["idk", "na", "none", "null", "undefined", "todo", "test", "不知道", "不懂", "无", "略"].includes(compact)
      || new Set(letters.join("").toLowerCase()).size === 1) {
    return "Provide an explanation of the highlighted code instead of a placeholder or repeated characters.";
  }
  return "";
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markerRegex(marker, blankId) {
  const id = String(blankId || "").trim();
  return id
    ? new RegExp(`\\b${marker}:${escapeRegExp(id)}\\b`)
    : new RegExp(`\\b${marker}(?::[A-Za-z0-9_\\-]+)?\\b`);
}

function normalizeCompletionLines(completionCode, baseIndent) {
  const normalized = String(completionCode || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\n+|\n+$/g, "");
  if (!/\S/.test(normalized)) throw new Error("Code completion cannot be empty.");

  const rawLines = normalized.split("\n");
  const nonEmptyLines = rawLines.filter((line) => line.trim());
  const minIndent = nonEmptyLines.length
    ? Math.min(...nonEmptyLines.map((line) => leadingWhitespace(line).length))
    : 0;

  return rawLines.map((line) => line.trim() ? `${baseIndent}${line.slice(minIndent)}` : "");
}

export function applyCompletionToContent(content, completionCode, blankId) {
  const normalized = String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const body = hasTrailingNewline ? normalized.slice(0, -1) : normalized;
  const lines = body ? body.split("\n") : [];
  if (!lines.length) throw new Error("The challenge file is empty.");

  const startRe = markerRegex("BLANK_START", blankId);
  const endRe = markerRegex("BLANK_END", blankId);
  const blankRe = markerRegex("BLANK", blankId);
  const startIndex = lines.findIndex((line) => startRe.test(line));
  const endIndex = startIndex < 0
    ? -1
    : lines.findIndex((line, index) => index >= startIndex && endRe.test(line));

  if (startIndex >= 0 && endIndex >= startIndex) {
    const blankOffset = lines.slice(startIndex, endIndex + 1).findIndex((line) => blankRe.test(line));
    const indentLine = blankOffset >= 0 ? lines[startIndex + blankOffset] : lines[startIndex];
    lines.splice(
      startIndex,
      endIndex - startIndex + 1,
      ...normalizeCompletionLines(completionCode, leadingWhitespace(indentLine))
    );
  } else {
    const blankIndex = lines.findIndex((line) => blankRe.test(line));
    if (blankIndex < 0) throw new Error("No replaceable BLANK region was found.");
    lines.splice(
      blankIndex,
      1,
      ...normalizeCompletionLines(completionCode, leadingWhitespace(lines[blankIndex]))
    );
  }

  return `${lines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

export function buildSubmission(challenge, answer) {
  const taskType = challenge?.task_type || "rewrite";
  const files = cloneFiles(challenge?.files);
  if (!Object.keys(files).length) throw new Error("The challenge has no source files.");

  if (taskType === "rewrite") {
    const explanation = String(answer.explanation || "");
    const issue = explanationValidationError(explanation);
    if (issue) throw new Error(issue);
    return { explanation_md: explanation, filled_files: files };
  }

  if (taskType !== "blank_fill") throw new Error(`Unknown challenge type: ${taskType}`);
  const blanks = Array.isArray(challenge.blanks) ? challenge.blanks : [];
  if (blanks.length > 1) throw new Error("This version supports one BLANK region per challenge.");

  const blank = blanks[0] && typeof blanks[0] === "object" ? blanks[0] : {};
  let targetPath = typeof blank.file_path === "string" ? blank.file_path : "";
  if (!Object.prototype.hasOwnProperty.call(files, targetPath)) {
    targetPath = Object.keys(files).find((path) => /BLANK_START|BLANK:[A-Za-z0-9_\-]+/.test(files[path])) || "";
  }
  if (!targetPath) throw new Error("No challenge file contains a BLANK marker.");

  files[targetPath] = applyCompletionToContent(files[targetPath], answer.completionCode, blank.blank_id || "");
  return { explanation_md: "", filled_files: files };
}
