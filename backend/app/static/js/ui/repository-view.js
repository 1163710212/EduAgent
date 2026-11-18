import { commitAuthor, commitDate, commitMetrics, formatDate, shortSha } from "../domain/repository.js";

const byId = id => document.getElementById(id);
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const text = (id, value) => { byId(id).textContent = String(value ?? "—"); };
const colors = ["#82b2f7", "#8ed1b2", "#e8c878", "#d58fd2", "#e28b8b", "#8fc7df", "#64758c"];
const message = value => `<p class="repo-empty">${escapeHtml(value)}</p>`;
const stat = (name, value) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`;

export function setRepositoryStatus(value, kind = "") {
  text("repoStatus", value);
  byId("repoStatus").dataset.status = kind;
  byId("repoValidationIcon").textContent = kind === "success" ? "✓" : kind === "error" ? "!" : "";
  byId("repoValidationIcon").dataset.status = kind;
}

export function resetRepositoryView() {
  byId("repoPreview").hidden = true;
  byId("repositoryExplorer").hidden = true;
  for (const id of ["repositoryFiles", "contributorsContent", "commitsContent", "repositoryAnalysisSummary"]) {
    byId(id).replaceChildren();
  }
}

export function showRepository(data, branch) {
  text("repoPreviewName", data.full_name || data.name);
  text("repoVisibility", data.private ? "Private" : "Public");
  text("repoDefaultBranch", data.default_branch || "—");
  text("repoLanguage", data.language || "Not detected");
  text("repositoryContext", `${data.full_name || data.name} · ${branch}`);
  byId("repoPreview").hidden = false;
  byId("repositoryExplorer").hidden = false;
}

export function panelMessage(id, value) {
  byId(id).innerHTML = message(value);
}

export function renderFiles(tree) {
  const items = (Array.isArray(tree.tree) ? tree.tree : []).filter(item => typeof item.path === "string");
  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));
  text("repositoryFilesCount", `${items.length}${tree.truncated ? "+" : ""} entries returned`);
  byId("repositoryFiles").innerHTML = sorted.length ? `<ul class="repo-file-list">${sorted.slice(0, 150).map(item => `
    <li><i class="ph ${item.type === "tree" ? "ph-folder" : "ph-file-code"}" aria-hidden="true"></i>
      <span title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</span></li>`).join("")}</ul>
    ${items.length > 150 ? message(`Showing the first 150 of ${items.length} entries.`) : ""}
    ${tree.truncated ? message("GitHub returned a truncated file tree; this preview is incomplete.") : ""}`
    : message("No files found on this branch.");
}

function bars(entries) {
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return `<ul class="repo-bars">${entries.map(([label, value]) => `<li>
    <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
    <span class="repo-bar-track" aria-hidden="true"><span style="width:${value / max * 100}%"></span></span>
    <strong>${value}</strong></li>`).join("")}</ul>`;
}

function shareChart(entries) {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return message("No contribution data available.");
  const top = sorted.slice(0, 6), others = sorted.slice(6).reduce((sum, [, value]) => sum + value, 0);
  if (others) top.push(["Others", others]);
  let angle = 0;
  const gradient = top.map(([, value], index) => {
    const start = angle;
    angle += value / total * 360;
    return `${colors[index]} ${start}deg ${angle}deg`;
  }).join(",");
  return `<div class="repo-share"><div class="repo-donut" aria-hidden="true" style="background:conic-gradient(${gradient})"><span>${total}</span></div>
    <ul>${top.map(([label, value], index) => `<li><span class="repo-dot" style="background:${colors[index]}" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span><strong>${Math.round(value / total * 100)}%</strong></li>`).join("")}</ul></div>`;
}

function timeline(days) {
  const max = Math.max(1, ...days.values());
  return `<div class="repo-timeline" role="list" aria-label="Daily commits in UTC">${[...days].map(([day, count]) => `
    <div role="listitem" aria-label="${day}: ${count} commits" title="${day}: ${count} commits">
      <span>${count || ""}</span><i style="height:${count / max * 90 + 2}px" aria-hidden="true"></i>
    </div>`).join("")}</div><p class="repo-chart-caption">${[...days.keys()][0]} – ${[...days.keys()].at(-1)} · UTC</p>`;
}

function chart(title, content, id = "") {
  return `<section class="repo-chart"><h4>${title}</h4><div${id ? ` id="${id}"` : ""}>${content}</div></section>`;
}

export function renderContributors(contributors, hasMore, onSelect) {
  const sorted = [...contributors].sort((a, b) => Number(b.contributions || 0) - Number(a.contributions || 0));
  const total = sorted.reduce((sum, item) => sum + Number(item.contributions || 0), 0);
  const entries = sorted.map(item => [item.login || "Unknown", Number(item.contributions || 0)]);
  text("contributorsTotal", `${sorted.length}${hasMore ? "+" : ""} contributors · repository-wide`);
  byId("contributorsContent").innerHTML = `
    <p class="repo-note">${hasMore ? "First 100 contributors returned by GitHub." : "Contributors returned by GitHub."} Shares use this sample; contributor history uses the selected branch.</p>
    <dl class="repo-stats">${stat("Contributions in sample", total)}${stat("Top contributor", sorted[0]?.login || "—")}
      ${stat("Top contributor share", total ? `${Math.round(entries[0][1] / total * 100)}%` : "—")}</dl>
    <div class="repo-chart-grid">${chart("Contribution share", shareChart(entries), "contributionShareChart")}
      ${chart("Top contributors", entries.length ? bars(entries.slice(0, 6)) : message("No contributors found."), "contributorsBarChart")}</div>
    <div id="contributorsList" class="repo-scroll-list">${sorted.map((item, index) => `<button type="button" class="repo-row contributor-row" data-contributor-index="${index}" aria-pressed="false">
      <span>${index + 1}. ${escapeHtml(item.login || "Unknown")}</span><strong>${Number(item.contributions || 0)} contributions</strong></button>`).join("")}</div>
    <section id="contributorDetailPanel" class="repo-detail" aria-live="polite"><h4>Contributor activity</h4>${message("Select a contributor to inspect commit history.")}</section>`;
  byId("contributorsList").querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    byId("contributorsList").querySelectorAll("button").forEach(row => row.setAttribute("aria-pressed", String(row === button)));
    onSelect(sorted[Number(button.dataset.contributorIndex)].login);
  }));
}

export function renderContributor(login, commits, error = "") {
  const title = `<h4>${escapeHtml(login)} · Contributor activity</h4>`;
  if (!commits) {
    byId("contributorDetailPanel").innerHTML = title + message(error || "Loading commit history…");
    return;
  }
  const metrics = commitMetrics(commits);
  byId("contributorDetailPanel").innerHTML = `${title}
    <p class="repo-note">Up to 100 recent commits on the selected branch.</p>
    <dl class="repo-stats">${stat("Commits loaded", commits.length)}${stat("Last 30 days in sample", metrics.count30)}${stat("Latest commit", formatDate(metrics.latest))}</dl>
    ${chart("Commit timeline", timeline(metrics.days), "contributorTimeline")}
    <h4>Commit records</h4><div id="contributorRecordsList" class="repo-scroll-list">${commits.length ? commits.map(commit => `
      <article class="repo-record"><strong>${escapeHtml(shortSha(commit))}</strong><time>${escapeHtml(formatDate(commitDate(commit)))}</time>
      <p>${escapeHtml(commit.commit?.message || "No commit message")}</p></article>`).join("") : message("No commits found for this contributor on the selected branch.")}</div>`;
}

function renderCommitDetail(commit) {
  byId("commitDetailPanel").innerHTML = `<h4>Commit detail</h4><dl class="repo-stats">
    ${stat("SHA", commit.sha || "—")}${stat("Author", commitAuthor(commit))}${stat("Date", formatDate(commitDate(commit)))}
    ${stat("Verified signature", commit.commit?.verification?.verified === true ? "Yes" : "No / unavailable")}</dl>
    <p class="repo-commit-message">${escapeHtml(commit.commit?.message || "No commit message")}</p>`;
}

export function renderCommits(commits, total) {
  const metrics = commitMetrics(commits);
  text("commitTotal", total === null ? `${commits.length} recent commits loaded · total unavailable` : `${total} total commits on selected branch`);
  byId("commitsContent").innerHTML = `<p class="repo-note">Statistics use up to 100 recent commits on the selected branch. Daily counts use UTC.</p>
    <dl class="repo-stats">${stat("Last 30 days in sample", metrics.count30)}${stat("Active days (30d)", metrics.activeDays)}
      ${stat("Recent authors", metrics.authors.size)}${stat("Average gap", metrics.gapHours === null ? "—" : `${metrics.gapHours.toFixed(1)}h`)}</dl>
    ${chart("30-day commit trend", timeline(metrics.days), "commitTrendChart")}
    <div class="repo-chart-grid">${chart("Commits by weekday (UTC)", bars(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => [day, metrics.weekdays[i]])), "commitWeekdayChart")}
      ${chart("Commit authors", shareChart([...metrics.authors]), "commitAuthorChart")}</div>
    <h4>Recent commits · select a row for details</h4><div id="recentCommitsList" class="repo-scroll-list">${commits.length ? commits.map((commit, index) => `
      <button type="button" class="repo-row recent-commit-row" data-commit-index="${index}" aria-pressed="false">
        <strong>${escapeHtml(shortSha(commit))}</strong><span>${escapeHtml((commit.commit?.message || "No commit message").split("\n")[0])}</span>
        <small>${escapeHtml(commitAuthor(commit))} · ${escapeHtml(formatDate(commitDate(commit)))}</small></button>`).join("") : message("No commits found on this branch.")}</div>
    <section id="commitDetailPanel" class="repo-detail" aria-live="polite">${message("Select a commit to inspect it.")}</section>`;
  byId("recentCommitsList").querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    byId("recentCommitsList").querySelectorAll("button").forEach(row => row.setAttribute("aria-pressed", String(row === button)));
    renderCommitDetail(commits[Number(button.dataset.commitIndex)]);
  }));
  byId("recentCommitsList").querySelector("button")?.click();
}

export function renderAnalysis(info, contributors, commits, branch) {
  const profile = `${info.full_name || info.name} is a ${info.private ? "private" : "public"} repository. Default branch: ${info.default_branch || "—"}. GitHub top language: ${info.language || "not detected"}. Preview branch: ${branch}.`;
  let contribution = "Contributor information is loading or unavailable.";
  if (contributors) {
    const sorted = [...contributors].sort((a, b) => b.contributions - a.contributions);
    const total = sorted.reduce((sum, item) => sum + Number(item.contributions || 0), 0);
    contribution = total ? `${sorted[0].login} accounts for ${Math.round(sorted[0].contributions / total * 100)}% of contributions in the returned sample of ${sorted.length} contributors.` : "No contributor activity returned by GitHub.";
  }
  let activity = "Commit information is loading or unavailable.";
  if (commits) {
    const metrics = commitMetrics(commits);
    activity = `${commits.length} recent commits loaded, ${metrics.authors.size} authors, ${metrics.count30} commits across ${metrics.activeDays} active days in the last 30 UTC calendar days. Latest commit: ${formatDate(metrics.latest)}.`;
  }
  byId("repositoryAnalysisSummary").innerHTML = [["Repository profile", profile], ["Contribution pattern", contribution], ["Commit activity", activity]]
    .map(([title, value]) => `<div><h4>${title}</h4><p>${escapeHtml(value)}</p></div>`).join("") +
    '<p class="repo-note">Descriptive statistics from GitHub samples; these are not code-quality or learning assessments.</p>';
}
