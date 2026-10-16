const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.EDUAGENT_PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.EDUAGENT_BASE_URL || "http://127.0.0.1:8137";
const out = process.env.EDUAGENT_SCREENSHOT_DIR || "/tmp/eduagent-three-question-screenshots";

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal overflow");
}

async function checkSolveLayout(page, width) {
  await page.locator("#workspaceContent").waitFor({ state: "visible" });
  // Both modules stay in normal document flow, including while scrolling.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const boxes = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      shell: rect("#workspaceContent"), progress: rect(".question-progress"),
      context: rect(".challenge-view"), response: rect(".workspace-card"),
      title: rect("#answerTitle"), session: rect(".session-row"),
      videoWidth: getComputedStyle(document.querySelector("#solveBackgroundVideo")).width,
      layerWidth: document.querySelector("#ambientBackground").clientWidth,
    };
  });
  assert.ok(Math.abs(boxes.progress.width - boxes.shell.width) < 1, "Progress must span both columns");
  assert.ok(boxes.progress.bottom <= boxes.context.top, "Progress belongs above the question modules");
  if (width > 1200) {
    assert.ok(boxes.context.right < boxes.response.left, "Brief must be left, answer workspace right");
    assert.ok(Math.abs(boxes.context.top - boxes.response.top) < 1, "Both modules start on the same row");
    assert.ok(boxes.response.width > boxes.context.width * 2, "Answer workspace must retain the wide column");
  } else {
    assert.ok(boxes.context.bottom <= boxes.response.top, "Stack brief before response on narrow screens");
  }
  assert.ok(boxes.title.right <= boxes.session.left || boxes.title.bottom <= boxes.session.top, "Session ID must not overlap the heading");
  // Failed videos use display:none, where computed widths can remain percentages.
  assert.ok(boxes.videoWidth === "100%" || Math.abs(parseFloat(boxes.videoWidth) - boxes.layerWidth) < 1, "Background should fill the viewport without additional zoom");
  const scrolled = await page.evaluate(() => {
    window.scrollTo({ top: 600, behavior: "instant" });
    const card = document.querySelector(".challenge-view");
    return { y: scrollY, top: card.getBoundingClientRect().top, position: getComputedStyle(card).position };
  });
  assert.equal(scrolled.position, "static", "Question brief must not stick to the viewport");
  assert.ok(Math.abs(scrolled.top + scrolled.y - boxes.context.top) < 2, "Brief scrolls with the document");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}

async function journey(browser, width, type, storageBlocked = false) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce" });
  if (storageBlocked) await context.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  // Keep this integration test offline except for the actual local application API.
  await page.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(`${base}/create`);
  await page.locator('#ambientBackground[data-renderer="fallback"]').waitFor();
  assert.equal(await page.locator("#filePath").count(), 0);
  await noOverflow(page);
  await page.screenshot({ path: path.join(out, `create-${width}-${type}.png`), fullPage: true });
  await page.locator("#repoUrl").fill("owner/repo");
  await page.locator("#taskType").selectOption(type);
  await page.locator("#btnCreate").click();
  await page.waitForURL("**/solve?session_id=**");
  const sid = new URL(page.url()).searchParams.get("session_id");
  const paths = [];
  const callsBefore = await (await context.request.get(`${base}/__test__/calls`)).json();
  for (let index = 0; index < 3; index++) {
    await page.waitForFunction(i => document.querySelector("#questionProgressLabel").textContent === `Question ${i + 1} of 3`, index);
    await page.locator('#ambientBackground[data-renderer="fallback"]').waitFor();
    const snapshot = await (await context.request.get(`${base}/api/challenges/${sid}`)).json();
    assert.equal(snapshot.completed_count, index);
    const q = snapshot.challenge;
    paths.push(q.file_path);
    assert.equal(Object.keys(q.files).length, 1);
    const editor = page.locator(type === "rewrite" ? "#explanation" : "#completionCode");
    assert.equal(await editor.inputValue(), "", "Answer must not leak from previous question");
    await page.locator("#btnSubmit").click();
    await page.locator("#submitLog[data-status=error]").waitFor();
    assert.equal((await (await context.request.get(`${base}/api/challenges/${sid}`)).json()).completed_count, index);
    const value = type === "rewrite" ? `Question ${index + 1}: the function preserves the data contract and handles input in sequence.`
      : ["return normalize(value)", "return text.lower()", 'return {"value": value, "length": len(value)}'][index];
    await editor.fill(value);
    if (!storageBlocked) {
      await page.reload();
      await page.locator("#workspaceContent").waitFor({ state: "visible" });
      assert.equal(await editor.inputValue(), value, "Current-question draft survives reload");
    }
    await noOverflow(page);
    await checkSolveLayout(page, width);
    await page.screenshot({ path: path.join(out, `solve-${width}-${type}-${index + 1}.png`), fullPage: true });
    if (index === 2) await context.request.post(`${base}/__test__/fail-next-grade`);
    await page.locator("#btnSubmit").click();
    if (index === 2) {
      await page.locator("#submitLog[data-status=error]").waitFor();
      assert.match(page.url(), /\/solve\?/);
      const pending = await (await context.request.get(`${base}/api/challenges/${sid}`)).json();
      assert.equal(pending.completed_count, 2);
      assert.equal(pending.status, "assessment_pending");
      assert.equal((await context.request.get(`${base}/api/challenges/${sid}/review`)).status(), 409);
      await page.reload();
      await page.locator("#workspaceContent").waitFor({ state: "visible" });
      assert.equal(await editor.isDisabled(), true, "Saved answer stays locked after failed grading and reload");
      assert.match(await page.locator("#btnSubmit").textContent(), /Retry assessment/);
      await context.request.post(`${base}/__test__/fail-overall/true`);
      await page.locator("#btnSubmit").click();
    }
    await page.locator("#questionAssessment").waitFor({ state: "visible" });
    assert.equal(await page.locator("#questionProgressLabel").textContent(), `Question ${index + 1} of 3`, "Assessment does not auto-advance");
    assert.match(await page.locator("#questionReport .score-value").textContent(), new RegExp(String([72, 84, 95][index])));
    assert.ok((await page.locator("#questionReport .feedback-content").textContent()).trim());
    assert.equal(await page.locator("#questionReport .suggestions-card").count(), 0, "Solve feedback omits Next steps");
    assert.equal(await page.locator("#btnSubmit").isVisible(), false);
    assert.equal(await editor.isDisabled(), true);
    const assessed = await (await context.request.get(`${base}/api/challenges/${sid}`)).json();
    assert.equal(assessed.status, "feedback_ready");
    assert.equal(assessed.challenge.question_id, q.question_id);
    assert.equal((await context.request.get(`${base}/api/challenges/${sid}/review`)).status(), 409);
    const callsAtFeedback = await (await context.request.get(`${base}/__test__/calls`)).json();
    await page.reload();
    await page.locator("#questionAssessment").waitFor({ state: "visible" });
    assert.equal(await page.locator("#questionProgressLabel").textContent(), `Question ${index + 1} of 3`, "Reload preserves unacknowledged feedback");
    assert.deepEqual(await (await context.request.get(`${base}/__test__/calls`)).json(), callsAtFeedback);
    await noOverflow(page);
    await page.screenshot({ path: path.join(out, `feedback-${width}-${type}-${index + 1}.png`), fullPage: true });
    await page.locator("#btnContinue").click();
    if (index < 2) {
      await page.waitForFunction(i => document.querySelector("#questionProgressLabel").textContent === `Question ${i + 2} of 3`, index);
      await page.reload();
    }
  }
  assert.equal(new Set(paths).size, 3);
  await page.waitForURL("**/review?session_id=**");
  await page.locator("#retryReview").waitFor({ state: "visible" });
  assert.match(await page.locator("#reviewStatus").textContent(), /individual grades are saved/);
  assert.equal(await page.locator(".question-review").count(), 0);
  assert.equal(await page.locator(".score-value").count(), 0, "No fake overall score on failure");
  await context.request.post(`${base}/__test__/fail-overall/false`);
  await page.locator("#retryReview").click();
  await page.locator("body[data-review-ready=true]").waitFor();
  await page.locator('#ambientBackground[data-renderer="fallback"]').waitFor();
  assert.equal(await page.locator(".question-score").count(), 0, "Individual results are not rendered in Review");
  assert.equal(await page.locator(".question-feedback").count(), 0);
  assert.match(await page.locator(".score-value").textContent(), /83\.7/);
  assert.equal(await page.locator(".suggestions-card").count(), 1, "Overall Review retains Next steps");
  const callsAfter = await (await context.request.get(`${base}/__test__/calls`)).json();
  assert.equal(callsAfter.grades - callsBefore.grades, 4);
  assert.equal(callsAfter.overall - callsBefore.overall, 2);
  await noOverflow(page);
  await page.screenshot({ path: path.join(out, `review-${width}-${type}.png`), fullPage: true });
  await page.reload();
  await page.locator(".score-value").waitFor();
  assert.deepEqual(await (await context.request.get(`${base}/__test__/calls`)).json(), callsAfter, "Review refresh must not regrade");
  await page.goto(`${base}/solve?session_id=${sid}`);
  await page.waitForURL("**/review?session_id=**");
  assert.equal(await page.locator('a[href^="/solve"], a[href^="/create"]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EDUAGENT_BROWSER_PATH || "/opt/google/chrome/chrome", args: ["--disable-dev-shm-usage"] });
  try {
    for (const [width, type, blocked] of [[2466, "rewrite", false], [1440, "rewrite", false], [1280, "blank_fill", false], [1024, "rewrite", false], [390, "blank_fill", false], [320, "rewrite", true]]) {
      await journey(browser, width, type, blocked);
    }
    console.log(`Three-question browser integration passed; screenshots: ${out}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
