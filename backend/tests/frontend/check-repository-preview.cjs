const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.EDUAGENT_PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.EDUAGENT_BASE_URL || "http://127.0.0.1:8126";
const out = process.env.EDUAGENT_SCREENSHOT_DIR || "/tmp/eduagent-repository-preview";
const today = new Date().toISOString();
const commits = [
  { sha: "a".repeat(40), author: { login: "alice" }, commit: { author: { date: today }, message: "Handle input\n\n<img src=x onerror=window.__injected=1>", verification: { verified: true } } },
  { sha: "b".repeat(40), author: { login: "bob" }, commit: { author: { date: today }, message: "Add validation" } },
];

async function setup(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [], requests = [], payloads = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "api.github.com") {
      requests.push(url);
      if (options.handle && await options.handle(route, url)) return;
      if (options.failure) return route.fulfill({ status: options.failure, json: { message: "Unavailable" } });
      if (/\/git\/trees\//.test(url.pathname)) return route.fulfill({ json: { truncated: true, tree: [
        { path: "src", type: "tree" }, { path: "src/main.py", type: "blob" },
        { path: '<img src=x onerror="window.__injected=1">.py', type: "blob" },
      ] } });
      if (url.pathname.endsWith("/contributors")) return route.fulfill({ json: [{ login: "alice", contributions: 7 }, { login: "bob", contributions: 3 }] });
      if (url.pathname.endsWith("/commits")) {
        const author = url.searchParams.get("author");
        if (author) return route.fulfill({ json: commits.filter(commit => commit.author.login === author) });
        if (url.searchParams.get("per_page") === "1") return route.fulfill({ json: [commits[0]], headers: { "Access-Control-Expose-Headers": "Link", Link: '<https://api.github.com/repos/owner/repo/commits?per_page=1&page=42>; rel="last"' } });
        return route.fulfill({ json: commits });
      }
      const repo = url.pathname.split("/").at(-1);
      return route.fulfill({ json: { name: repo, full_name: `owner/${repo}`, default_branch: "develop", language: "TypeScript", private: false } });
    }
    if (route.request().url().startsWith(base)) {
      if (url.pathname === "/api/challenges/create") {
        payloads.push(route.request().postDataJSON());
        return route.fulfill({ status: 503, json: { detail: "Fixture: generation unavailable; retry allowed." } });
      }
      return route.continue();
    }
    return route.abort();
  });
  await page.goto(`${base}/create`);
  return { context, page, errors, requests, payloads };
}

async function connected(page, repo = "owner/repo") {
  await page.locator("#repoUrl").fill(repo);
  await page.locator("#repoUrl").press("Tab");
  await page.locator('#repoStatus[data-status="success"]').waitFor();
  await page.locator("#recentCommitsList button").first().waitFor();
  await page.locator("#contributorsList button").first().waitFor();
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EDUAGENT_BROWSER_PATH || "/opt/google/chrome/chrome", args: ["--disable-dev-shm-usage"] });
  try {
    for (const width of [1440, 1024, 390, 320]) {
      const { context, page, errors, requests, payloads } = await setup(browser, { width });
      await connected(page, "https://github.com/owner/repo.git/");
      assert.equal(await page.locator("#ref").inputValue(), "develop");
      assert.equal(await page.locator("#language").inputValue(), "Automatic");
      assert.equal(await page.locator("#language").evaluate(input => input.readOnly), true);
      assert.match(await page.locator("#repositoryFiles").textContent(), /truncated/);
      assert.match(await page.locator("#commitTotal").textContent(), /42 total commits/);
      await page.locator('#contributorsList button').filter({ hasText: "alice" }).click();
      await page.locator("#contributorRecordsList").waitFor();
      assert.match(await page.locator("#contributorDetailPanel").textContent(), /Handle input/);
      await page.locator("#recentCommitsList button").nth(1).focus();
      await page.keyboard.press("Enter");
      assert.match(await page.locator("#commitDetailPanel").textContent(), /Add validation/);
      assert.equal(await page.evaluate(() => window.__injected), undefined);
      assert.equal(await page.locator("#repositoryExplorer img").count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow at ${width}px`);
      await page.screenshot({ path: path.join(out, `repository-${width}.png`), fullPage: true });
      await page.locator("#btnCreate").click();
      await page.locator('#createLog[data-status="error"]').waitFor();
      assert.equal(payloads.length, 1);
      assert.equal(payloads[0].ref, "develop");
      assert.equal(payloads[0].language, undefined);
      assert.deepEqual(Object.keys(payloads[0]).sort(), ["ref", "repo_url", "task_type"]);
      assert.equal(requests.filter(url => url.pathname === "/repos/owner/repo").length, 1, "Debounce, blur and submit share metadata");
      assert.equal(await page.locator("#repoUrl").isEnabled(), true);
      assert.deepEqual(errors, []);
      await context.close();
    }

    // A generation click while metadata is in flight must use the detected defaults.
    {
      let release, entered;
      const started = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const { context, page, payloads, errors } = await setup(browser, { handle: async (route, url) => {
        if (url.pathname !== "/repos/owner/repo") return false;
        entered(); await gate;
        await route.fulfill({ json: { name: "repo", full_name: "owner/repo", default_branch: "release/v2", language: "Java" } });
        return true;
      } });
      await page.locator("#repoUrl").fill("owner/repo");
      await page.locator("#btnCreate").click();
      await started;
      assert.equal(await page.locator("#btnCreate").isDisabled(), true);
      await page.locator("#challengeForm").evaluate(form => form.dispatchEvent(new Event("submit", { cancelable: true })));
      assert.equal(payloads.length, 0);
      release();
      await page.locator('#createLog[data-status="error"]').waitFor();
      assert.equal(payloads.length, 1);
      assert.equal(payloads[0].ref, "release/v2");
      assert.equal(payloads[0].language, undefined);
      assert.deepEqual(errors, []);
      await context.close();
    }

    // Branch overrides remain authoritative. Even a modified readonly input
    // cannot override server-side language detection through the request payload.
    {
      const { context, page, requests, payloads } = await setup(browser);
      await page.locator("#ref").fill("feature/manual");
      await page.locator("#language").evaluate(input => { input.value = "go"; });
      await connected(page);
      assert.equal(await page.locator("#ref").inputValue(), "feature/manual");
      assert.equal(await page.locator("#language").inputValue(), "go");
      await page.locator("#ref").fill("release/new");
      await page.locator("#ref").press("Tab");
      await page.locator("#recentCommitsList button").first().waitFor();
      assert.ok(requests.some(url => url.pathname.endsWith("/commits") && url.searchParams.get("sha") === "release/new"));
      await page.locator("#btnCreate").click();
      await page.locator('#createLog[data-status="error"]').waitFor();
      assert.equal(payloads[0].ref, "release/new");
      assert.equal(payloads[0].language, undefined);
      await context.close();
    }

    // Private/rate-limited previews do not prevent the original create flow.
    for (const failure of [404, 403, 429]) {
      const { context, page, payloads, errors } = await setup(browser, { failure });
      await page.locator("#repoUrl").fill("owner/private");
      await page.locator("#btnCreate").click();
      await page.locator('#createLog[data-status="error"]').waitFor();
      assert.match(await page.locator("#repoStatus").textContent(), /still set the branch/);
      assert.equal(payloads.length, 1);
      assert.equal(await page.locator("#repositoryExplorer").isHidden(), true);
      assert.deepEqual(errors, []);
      await context.close();
    }

    // A failed panel/count must not hide successful sections or invent zeroes.
    {
      let failPanels = true;
      const { context, page, errors } = await setup(browser, { handle: async (route, url) => {
        if (!failPanels || !(url.pathname.endsWith("/contributors") || /\/git\/trees\//.test(url.pathname) || url.searchParams.get("per_page") === "1")) return false;
        await route.fulfill({ status: 403, json: { message: "Rate limited" } });
        return true;
      } });
      await page.locator("#repoUrl").fill("owner/repo");
      await page.locator("#repoUrl").press("Tab");
      await page.locator("#recentCommitsList button").first().waitFor();
      assert.match(await page.locator("#repositoryFiles").textContent(), /rate limit/);
      assert.match(await page.locator("#contributorsContent").textContent(), /rate limit/);
      assert.match(await page.locator("#commitTotal").textContent(), /total unavailable/);
      assert.match(await page.locator("#repositoryAnalysisSummary").textContent(), /loading or unavailable/);
      failPanels = false;
      await page.locator("#btnRefreshRepository").click();
      await page.locator("#contributorsList button").first().waitFor();
      assert.match(await page.locator("#repositoryFiles").textContent(), /src\/main.py/);
      assert.deepEqual(errors, []);
      await context.close();
    }

    // Empty repositories produce honest empty states (GitHub 204/409 responses).
    {
      const { context, page, errors } = await setup(browser, { handle: async (route, url) => {
        if (url.pathname.endsWith("/contributors")) {
          await route.fulfill({ status: 204, body: "" }); return true;
        }
        if (url.pathname.endsWith("/commits") || /\/git\/trees\//.test(url.pathname)) {
          await route.fulfill({ status: 409, json: { message: "Git Repository is empty." } }); return true;
        }
        return false;
      } });
      await page.locator("#repoUrl").fill("owner/empty");
      await page.locator("#repoUrl").press("Tab");
      await page.locator("#commitTrendChart").waitFor();
      assert.match(await page.locator("#commitTotal").textContent(), /0 total commits/);
      assert.match(await page.locator("#repositoryFiles").textContent(), /No files found/);
      assert.equal(await page.locator("#contributorsList button").count(), 0);
      assert.equal(await page.locator("#btnCreate").isEnabled(), true);
      assert.deepEqual(errors, []);
      await context.close();
    }

    // Slow old responses must not repopulate a new repository or cleared input.
    {
      let release, entered;
      const started = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const { context, page, errors } = await setup(browser, { handle: async (route, url) => {
        if (url.pathname !== "/repos/owner/slow") return false;
        entered(); await gate;
        await route.fulfill({ json: { name: "slow", default_branch: "stale", language: "Java" } }).catch(() => {});
        return true;
      } });
      await page.locator("#repoUrl").fill("owner/slow");
      await page.locator("#repoUrl").press("Tab");
      await started;
      await connected(page, "owner/fresh");
      release();
      await page.waitForTimeout(100);
      assert.equal(await page.locator("#repoPreviewName").textContent(), "owner/fresh");
      assert.equal(await page.locator("#ref").inputValue(), "develop");
      await page.locator("#repoUrl").fill("not a repository");
      assert.equal(await page.locator("#repositoryExplorer").isHidden(), true);
      await page.locator("#repoUrl").press("Tab");
      await page.locator('#repoStatus[data-status="error"]').waitFor();
      await page.locator("#repoUrl").fill("");
      assert.equal(await page.locator("#repoPreview").isHidden(), true);
      assert.equal(await page.locator("#repoStatus").textContent(), "");
      assert.deepEqual(errors, []);
      await context.close();
    }

    // Parser compatibility and UTC boundaries, independent of the host timezone.
    {
      const { context, page } = await setup(browser);
      const result = await page.evaluate(async () => {
        const { parseGitHubRepository: parse, commitMetrics } = await import("/static/js/domain/repository.js");
        const now = new Date("2026-11-03T01:00:00Z");
        const metrics = commitMetrics([
          { commit: { author: { date: "2026-11-02T23:30:00-01:00" } } },
          { commit: { author: { date: "2026-11-04T00:00:00Z" } } },
          { commit: { author: { date: null } } },
        ], now);
        return {
          repos: ["owner/repo", "git@github.com:owner/repo.git", "https://github.com/owner/repo.git/", "github.com/owner/repo/tree/main"].map(value => parse(value)?.key),
          invalid: ["https://github.com.evil.test/owner/repo", "../repo", "owner/..", "https://evil@github.com/owner/repo"].map(parse),
          count: metrics.count30, day: metrics.days.get("2026-11-03"), active: metrics.activeDays,
        };
      });
      assert.deepEqual(result.repos, Array(4).fill("owner/repo"));
      assert.deepEqual(result.invalid, Array(4).fill(null));
      assert.equal(result.count, 1); assert.equal(result.day, 1); assert.equal(result.active, 1);
      await context.close();
    }
    console.log("Repository preview checks passed: responsive UI, defaults, overrides, failure fallback, request races, safe rendering, and UTC metrics.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
