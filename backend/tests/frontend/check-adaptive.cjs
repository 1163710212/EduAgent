const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.EDUAGENT_PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.EDUAGENT_BASE_URL || "http://127.0.0.1:8144";
const out = process.env.EDUAGENT_SCREENSHOT_DIR || "/tmp/eduagent-adaptive-screenshots";

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal overflow");
}

async function journey(browser, width, quality, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce" });
  if (options.blockStorage) await context.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("blocked"); };
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(`${base}/create`);
  assert.equal(await page.locator("#taskType option").count(), 1);
  await page.locator("#repoUrl").fill("owner/repo");
  await page.locator("#btnCreate").click();
  await page.waitForURL("**/solve?session_id=**");
  const sid = new URL(page.url()).searchParams.get("session_id");
  const url = `${base}/api/challenges/${sid}`;
  let count = 0;
  const levels = [];
  while (count < 12) {
    await page.locator("#workspaceContent").waitFor({ state: "visible" });
    await page.waitForFunction(i => document.querySelector("#questionProgressLabel").textContent === `Question ${i + 1} · Adaptive practice`, count);
    const snapshot = await (await context.request.get(url)).json();
    const q = snapshot.challenge;
    assert.equal(q.question_index, count);
    levels.push(q.difficulty);
    assert.equal(q.edits[0].end_line - q.edits[0].start_line + 1, 2);
    assert.match(await page.locator("#snippetDifficulty").innerText(), new RegExp(`L${q.difficulty}`));
    await noOverflow(page);
    const editor = page.locator("#explanation");
    assert.equal(await editor.inputValue(), "");
    if (quality === "skip") {
      await page.locator("#btnSkip").click();
    } else {
      if (count === 0) {
        await editor.fill("1");
        await page.locator("#btnSubmit").click();
        await page.locator("#submitLog[data-status=error]").waitFor();
        assert.equal((await (await context.request.get(url)).json()).completed_count, 0);
        assert.equal(await editor.isDisabled(), false);
      }
      const answer = `A ${quality} answer explains how the input is transformed and returned at question ${count + 1}.`;
      await editor.fill(answer);
      if (count === 0 && !options.blockStorage) {
        await page.reload();
        await page.locator("#workspaceContent").waitFor({ state: "visible" });
        assert.equal(await editor.inputValue(), answer);
      }
      if (count === 0 && options.failure) {
        await context.request.post(`${base}/__test__/fail-next-grade`);
        await page.locator("#btnSubmit").click();
        await page.locator("#submitLog[data-status=error]").waitFor();
        assert.equal(await editor.isDisabled(), false);
        assert.match(await page.locator("#btnSubmit").innerText(), /Retry assessment/);
        await editor.fill(answer + " This revision gives the required explanation.");
        assert.match(await page.locator("#btnSubmit").innerText(), /Submit revised answer/);
      }
      await page.locator("#btnSubmit").click();
    }
    await page.locator("#questionAssessment").waitFor({ state: "visible" });
    assert.equal(await editor.isDisabled(), true);
    const assessed = await (await context.request.get(url)).json();
    assert.equal(assessed.status, "feedback_ready");
    if (quality === "skip") {
      assert.equal(assessed.challenge.evaluation.response_status, "skipped");
      assert.equal(await page.locator("#questionReport .score-card").count(), 0);
    }
    if (count === 0) {
      await page.reload();
      await page.locator("#questionAssessment").waitFor({ state: "visible" });
      await page.screenshot({ path: path.join(out, `solve-${width}-${quality}.png`), fullPage: true });
    }
    count++;
    if (options.finish) {
      await page.locator("#btnFinish").click();
      break;
    }
    const last = assessed.challenge.adaptive.next_action === "review";
    await page.locator("#btnContinue").click();
    if (last) break;
  }
  await page.waitForURL("**/review?session_id=**");
  await page.locator('body[data-review-ready="true"]').waitFor();
  assert.equal(await page.locator("#adaptiveReview").count(), 1);
  assert.equal(await page.locator(".score-card").count(), 0, "Ability report must not present mean score as ability");
  assert.equal(await page.locator(".adaptive-observation").count(), count);
  assert.equal(await page.locator(".review-question-button").count(), count);
  assert.equal(await page.locator(".review-score-bar").count(), quality === "skip" ? 0 : count);
  assert.equal(await page.locator(".review-difficulty-path").count(), 1);
  const report = await (await context.request.get(url + "/review")).json();
  assert.equal(report.evaluation.ability_profile.valid_answers, quality === "skip" ? 0 : count);
  if (!options.finish) {
    assert.ok(count >= 6 && count <= 12);
    if (quality === "strong") assert.equal(report.evaluation.ability_profile.supported_level, 4);
    if (quality === "partial" || quality === "skip") assert.equal(count, 12);
  } else assert.equal(report.evaluation.stop_reason, "user_finished");
  const before = await (await context.request.get(`${base}/__test__/calls`)).json();
  await page.reload();
  await page.locator('body[data-review-ready="true"]').waitFor();
  assert.deepEqual(await (await context.request.get(`${base}/__test__/calls`)).json(), before);
  await noOverflow(page);
  await page.screenshot({ path: path.join(out, `review-${width}-${quality}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
  console.log(JSON.stringify({ width, quality, count, levels, stop: report.evaluation.stop_reason }));
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EDUAGENT_CHROME || "/opt/google/chrome/chrome",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    await journey(browser, 1440, "strong", { failure: true });
    await journey(browser, 390, "partial", { blockStorage: true });
    await journey(browser, 320, "weak");
    await journey(browser, 1440, "skip", { finish: true });
    await journey(browser, 390, "strong", { finish: true });
    console.log(`Adaptive browser checks passed. Screenshots: ${out}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
