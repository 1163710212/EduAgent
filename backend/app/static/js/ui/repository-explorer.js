import { repositoryClient } from "../api/repositories.js";
import { parseGitHubRepository, totalFromLink } from "../domain/repository.js";
import {
  panelMessage, renderAnalysis, renderCommits, renderContributor, renderContributors,
  renderFiles, resetRepositoryView, setRepositoryStatus, showRepository,
} from "./repository-view.js";

export function initRepositoryExplorer() {
  const input = document.getElementById("repoUrl");
  const branch = document.getElementById("ref");
  const refresh = document.getElementById("btnRefreshRepository");
  let timer, context = null, branchEdited = false;

  function cancel() {
    clearTimeout(timer);
    context?.controller.abort();
    context?.activityController?.abort();
    context = null;
    resetRepositoryView();
  }

  function active(ctx) { return context === ctx && !ctx.controller.signal.aborted; }

  function loadActivity(ctx) {
    ctx.activityController?.abort();
    const controller = new AbortController();
    ctx.activityController = controller;
    const currentBranch = branch.value.trim() || ctx.info.default_branch || "main";
    const client = repositoryClient(ctx.parsed, controller.signal);
    const valid = () => active(ctx) && !controller.signal.aborted;
    let contributors = null, commits = null, selectedLogin = null;
    const contributorCache = new Map();
    const analysis = () => renderAnalysis(ctx.info, contributors, commits, currentBranch);
    showRepository(ctx.info, currentBranch);
    for (const id of ["repositoryFiles", "contributorsContent", "commitsContent"]) panelMessage(id, "Loading…");
    for (const id of ["repositoryFilesCount", "contributorsTotal", "commitTotal"]) document.getElementById(id).textContent = "Loading…";
    analysis();

    async function selectContributor(login) {
      if (!login || !valid()) return;
      selectedLogin = login;
      renderContributor(login, null);
      try {
        if (!contributorCache.has(login)) {
          const { data } = await client("/commits", { sha: currentBranch, author: login, per_page: 100, page: 1 });
          if (!Array.isArray(data)) throw new Error("Invalid contributor history returned by GitHub.");
          contributorCache.set(login, data);
        }
        if (valid() && selectedLogin === login) renderContributor(login, contributorCache.get(login));
      } catch (error) {
        if (valid() && selectedLogin === login) renderContributor(login, null, error.message);
      }
    }

    // Independent sections can succeed even if another endpoint is unavailable.
    void client(`/git/trees/${encodeURIComponent(currentBranch)}`, { recursive: 1 }).then(({ data }) => {
      if (!valid()) return;
      if (!Array.isArray(data.tree)) throw new Error("Invalid file tree returned by GitHub.");
      renderFiles(data);
    }).catch(error => {
      if (!valid()) return;
      document.getElementById("repositoryFilesCount").textContent = "Files unavailable";
      panelMessage("repositoryFiles", error.message);
    });

    void client("/contributors", { per_page: 100, page: 1 }).then(({ data, link }) => {
      if (!valid()) return;
      if (!Array.isArray(data)) throw new Error("Invalid contributors returned by GitHub.");
      contributors = data;
      renderContributors(data, /rel="next"/.test(link), selectContributor);
      analysis();
    }).catch(error => {
      if (!valid()) return;
      document.getElementById("contributorsTotal").textContent = "Contributors unavailable";
      panelMessage("contributorsContent", error.message);
      analysis();
    });

    void Promise.allSettled([
      client("/commits", { sha: currentBranch, per_page: 100, page: 1 }),
      client("/commits", { sha: currentBranch, per_page: 1, page: 1 }),
    ]).then(([recent, count]) => {
      if (!valid()) return;
      if (recent.status === "rejected" || !Array.isArray(recent.value.data)) {
        document.getElementById("commitTotal").textContent = "Commits unavailable";
        panelMessage("commitsContent", recent.reason?.message || "Invalid commit history returned by GitHub.");
      } else {
        commits = recent.value.data;
        const total = count.status === "fulfilled" && Array.isArray(count.value.data)
          ? totalFromLink(count.value.link, count.value.data) : null;
        renderCommits(commits, total);
      }
      analysis();
    });
  }

  async function connect(force = false) {
    clearTimeout(timer);
    const parsed = parseGitHubRepository(input.value);
    if (!parsed) {
      cancel();
      setRepositoryStatus(input.value.trim() ? "Use a GitHub URL or owner/repository path." : "", input.value.trim() ? "error" : "");
      return;
    }
    // Blur, debounce, and Submit share a single metadata request.
    if (!force && context?.parsed.key === parsed.key) return context.metadata;
    cancel();
    const ctx = { parsed, controller: new AbortController(), info: null };
    context = ctx;
    setRepositoryStatus("Checking repository…", "loading");
    ctx.metadata = (async () => {
      try {
        const { data } = await repositoryClient(parsed, ctx.controller.signal)();
        if (!active(ctx)) return;
        if (!data || typeof data !== "object" || !data.name) throw new Error("Invalid repository metadata returned by GitHub.");
        ctx.info = data;
        if (!branchEdited && data.default_branch) branch.value = data.default_branch;
        setRepositoryStatus("Repository connected. Question language will be selected automatically.", "success");
        loadActivity(ctx);
      } catch (error) {
        if (!active(ctx)) return;
        setRepositoryStatus(`${error.message} You can still set the branch and generate a challenge; the server will detect the language.`, "error");
      }
    })();
    return ctx.metadata;
  }

  input.addEventListener("input", () => {
    cancel(); // Invalidate immediately, before the next debounced request.
    if (!branchEdited) branch.value = "main";
    setRepositoryStatus("");
    if (input.value.trim()) timer = setTimeout(() => { void connect(); }, 600);
  });
  input.addEventListener("blur", () => { if (input.value.trim()) void connect(); });
  branch.addEventListener("input", () => { branchEdited = true; });
  branch.addEventListener("change", () => {
    if (context?.info) loadActivity(context);
  });
  refresh.addEventListener("click", () => { void connect(true); });
  window.addEventListener("pagehide", cancel, { once: true });
  if (input.value.trim()) void connect();
  return { ensureMetadata: () => connect() };
}
