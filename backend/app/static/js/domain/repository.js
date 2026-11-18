export function parseGitHubRepository(value) {
  let raw = String(value || "").trim();
  raw = raw.replace(/^git@github\.com:/i, "https://github.com/");
  if (/^(www\.)?github\.com\//i.test(raw)) raw = `https://${raw}`;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;
      raw = url.pathname.replace(/^\/+/, "").split("/").slice(0, 2).join("/");
    } catch { return null; }
  }
  const match = raw.replace(/\/+$/, "").match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  const owner = match[1], repo = match[2].replace(/\.git$/i, "");
  if (!repo || [owner, repo].some(part => part === "." || part === "..")) return null;
  return { owner, repo, key: `${owner}/${repo}`.toLowerCase() };
}

export const commitDate = commit => commit?.commit?.author?.date || commit?.commit?.committer?.date || null;
export const commitAuthor = commit => commit?.author?.login || commit?.commit?.author?.name || "Unknown";
export const shortSha = commit => String(commit?.sha || "").slice(0, 7) || "—";
export function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

// Every day-based statistic uses UTC, including the weekday chart.
export function commitMetrics(commits, now = new Date()) {
  const days = new Map();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 29; i >= 0; i--) days.set(new Date(today - i * 86400000).toISOString().slice(0, 10), 0);
  const weekdays = Array(7).fill(0), authors = new Map(), timestamps = [];
  for (const commit of commits) {
    const author = commitAuthor(commit);
    authors.set(author, (authors.get(author) || 0) + 1);
    const raw = commitDate(commit), date = raw ? new Date(raw) : null;
    if (!date || !Number.isFinite(date.getTime()) || date > now) continue;
    timestamps.push(date.getTime());
    weekdays[date.getUTCDay()]++;
    const key = date.toISOString().slice(0, 10);
    if (days.has(key)) days.set(key, days.get(key) + 1);
  }
  timestamps.sort((a, b) => b - a);
  return {
    days, weekdays, authors,
    count30: [...days.values()].reduce((a, b) => a + b, 0),
    activeDays: [...days.values()].filter(Boolean).length,
    latest: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
    gapHours: timestamps.length > 1 ? (timestamps[0] - timestamps.at(-1)) / (timestamps.length - 1) / 3600000 : null,
  };
}

export function totalFromLink(link, items) {
  const last = String(link).split(",").find(part => /rel="last"/.test(part));
  const page = last?.match(/[?&]page=(\d+)/)?.[1];
  if (page) return Number(page); // Used only with per_page=1.
  return /rel="next"/.test(link) ? null : items.length;
}
