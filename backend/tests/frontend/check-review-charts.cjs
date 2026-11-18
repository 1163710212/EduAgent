const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.EDUAGENT_PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.EDUAGENT_BASE_URL || "http://127.0.0.1:8144";
const out = process.env.EDUAGENT_SCREENSHOT_DIR || "/tmp/eduagent-review-charts";
const skillKeys = ["data_flow", "control_flow", "state_effects", "language_semantics"];
const skillLabels = ["Data flow", "Control flow", "State and side effects", "Language semantics"];

// Synthetic chart fixtures exercise mixed/missing data independently of grading.
function responseFor(kind) {
  let values = [["strong", 86, 2], ["partial", 72, 2], ["weak", 0, 3], ["skipped", 0, 3],
    ["strong", 94, 2], ["partial", 65, 2], ["strong", 88, 3], ["unverified", 0, 3],
    ["weak", 30, 2], ["strong", 92, 2], ["partial", 70, 3], ["strong", 90, 4]];
  if (kind === "single") values = [["strong", 86, 2]];
  if (kind === "skips") values = Array.from({ length: 4 }, () => ["skipped", 0, 2]);
  if (kind === "zero") values = Array.from({ length: 3 }, () => ["weak", 0, 1]);
  if (kind === "legacy" || kind === "historical") values = [["partial", 72, null], ["strong", 84, null], ["assessed", 95, null]];
  const records = values.map(([outcome, score, difficulty], index) => ({
    question_id: `q${index + 1}`, outcome, score, difficulty, skill: skillKeys[index % 4],
    file_path: ["src/services/normalize.py", "src/domain/records.py", "src/handlers/validation.py"][index % 3],
    start_line: 12 + index * 3, end_line: 14 + index * 3, after_related_feedback: index >= 4,
    evidence: ["The function checks the input before updating the record, so invalid values leave the existing state unchanged."],
  }));
  if (kind === "unsafe") {
    records[0].file_path = 'src/<img src=x onerror="window.chartUnsafe=true">/very_long_source_path_' + "segment_".repeat(15) + ".py";
    records[0].evidence = ['<script>window.chartUnsafe=true</script> Literal source strings must stay text.'];
    records[1].score = null;
    records[2].score = "not a score";
    records[2].difficulty = null;
  }
  if (["legacy", "historical"].includes(kind)) return {
    session_id: "chart-session", workflow_version: 2, task_type: "rewrite", status: "complete",
    question_count: 3, evaluated_count: 3, observations: kind === "legacy" ? records.map(({ difficulty, skill, after_related_feedback, ...r }) => r) : [],
    evaluation: { total_score: 83.7, passed_blanks: true, feedback_md: "The answers show clear understanding of the main code paths.", strengths: ["Grounded reasoning."], suggestions: ["Explain the edge cases."], score_method: "equal_weight_mean" },
  };
  const valid = records.filter(r => !["skipped", "unverified"].includes(r.outcome));
  return {
    session_id: "chart-session", workflow_version: 3, task_type: "rewrite", status: "complete",
    question_count: records.length, evaluated_count: records.length,
    evaluation: { score_method: "adaptive_evidence_v1", observations: records,
      stop_description: "The session ended with the evidence collected so far.", suggestions: ["Practice state changes and explain the boundary conditions in your next session."],
      ability_profile: { evidence_status: "provisional", level_label: "Evidence collected · continue exploring", conflicting_evidence: kind === "mixed",
        valid_answers: valid.length, skipped_answers: records.filter(r => r.outcome === "skipped").length, covered_skills: 0,
        scope: "Short-code explanations in this repository and language during a guided practice session.",
        initial_observations: Math.min(4, valid.length), followup_observations: Math.max(0, valid.length - 4),
        method_note: "Difficulty is estimated. This report describes practice evidence, not professional seniority.",
        levels: ["Direct semantics", "Local relationships", "Implicit effects", "Complex execution"].map((label, i) => ({
          level: i + 1, label, status: "emerging", strong_files: new Set(records.filter(r => r.difficulty === i + 1 && r.outcome === "strong").map(r => r.file_path)).size,
          weak_files: new Set(records.filter(r => r.difficulty === i + 1 && r.outcome === "weak").map(r => r.file_path)).size,
        })),
        skills: skillKeys.map((key, index) => ({ key, label: skillLabels[index],
          observations: valid.filter(r => r.skill === key).length,
          source_files: new Set(valid.filter(r => r.skill === key).map(r => r.file_path)).size,
          strong_answers: valid.filter(r => r.skill === key && r.outcome === "strong").length,
        })),
      },
    },
  };
}

async function check(browser, width, kind) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [], methods = [];
  const response = responseFor(kind);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.startsWith("/api/")) {
      methods.push(request.method());
      assert.equal(url.pathname, "/api/challenges/chart-session/review", "Charts only read the existing report");
      return route.fulfill({ json: response });
    }
    return route.continue();
  });
  await page.goto(`${base}/review?session_id=chart-session`);
  await page.locator('body[data-review-ready="true"]').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px should not overflow`);
  if (kind === "historical") {
    assert.equal(await page.locator(".review-visualizations").count(), 0);
    assert.equal((await page.locator(".score-value").first().innerText()).replace(/\s/g, ""), "83.7/100");
  } else {
    const records = response.workflow_version === 2 ? response.observations : response.evaluation.observations;
    const expectedScores = records.filter(r => !["skipped", "unverified"].includes(r.outcome)
      && typeof r.score === "number");
    assert.equal(await page.locator(".review-score-bar").count(), expectedScores.length);
    assert.deepEqual(await page.locator(".review-score-bar").evaluateAll(bars => bars.map(b => Number(b.dataset.score))), expectedScores.map(r => r.score));
    assert.equal(await page.locator(".review-question-button").count(), records.length);
    assert.equal(await page.locator(".review-difficulty-path").count(), kind === "legacy" ? 0 : 1);
    assert.equal(await page.locator(".review-chart-legend strong").evaluateAll(items => items.reduce((n, item) => n + Number(item.textContent), 0)), records.length);
    assert.ok(!(await page.locator(".review-journey-svg").innerHTML()).match(/NaN|undefined|Infinity/));
    const buttons = page.locator(".review-question-button");
    await buttons.first().focus();
    await buttons.first().press("End");
    assert.equal(await buttons.last().getAttribute("aria-pressed"), "true");
    assert.ok(await buttons.last().evaluate(node => node === document.activeElement));
    await buttons.last().press("Home");
    assert.equal(await buttons.first().getAttribute("aria-pressed"), "true");
    if (records.length > 1) {
      await buttons.first().press("ArrowRight");
      assert.equal(await buttons.nth(1).getAttribute("aria-pressed"), "true");
      await page.locator(".review-chart-hit").last().click();
      assert.equal(await buttons.last().getAttribute("aria-pressed"), "true", "Clicking the chart selects its question");
    }
    const skipIndex = records.findIndex(r => r.outcome === "skipped");
    if (skipIndex >= 0) {
      await buttons.nth(skipIndex).click();
      assert.match(await page.locator(".review-selected-status").innerText(), /Skipped/);
      assert.equal(await page.locator(".review-selected-metrics dd").first().innerText(), "—");
      assert.match(await page.locator(".review-selected-question").innerText(), /not a zero score/);
    }
    if (kind === "zero") {
      assert.equal(await page.locator(".review-missing-score").count(), 0);
      assert.equal(await page.locator(".review-selected-metrics dd").first().innerText(), "0/100");
    }
    if (kind === "skips") {
      assert.equal(await page.locator(".review-skill-segment").count(), 0);
      assert.match(await page.locator(".adaptive-skills").innerText(), /Not assessed/);
    }
    await buttons.first().click();
    if (response.workflow_version === 3) {
      await page.locator(".review-evidence-link").click();
      assert.ok(await page.locator('.adaptive-observation[data-question-id="q1"]').evaluate(node => node.open));
    }
    await page.locator(".review-chart-data summary").click();
    assert.equal(await page.locator(".review-chart-data tbody tr").count(), records.length);
    await page.locator(".review-chart-data summary").click();
    if (width <= 768) assert.ok(await page.locator(".review-chart-scroll").evaluate(node => node.scrollWidth > node.clientWidth));
    if (kind === "unsafe") {
      assert.equal(await page.locator(".review-selected-question img, .review-selected-question script").count(), 0);
      assert.equal(await page.evaluate(() => window.chartUnsafe), undefined);
      assert.match(await page.locator(".review-selected-source").innerText(), /<img/);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator(".review-visualizations").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `review-${width}-${kind}.png`), fullPage: true });
    await page.locator(".review-visualizations").screenshot({ path: path.join(out, `charts-${width}-${kind}.png`) });
    // A refresh must render from the saved report, without assessment POSTs.
    await page.reload();
    await page.locator('body[data-review-ready="true"]').waitFor();
    assert.equal(await page.locator(".review-visualizations").count(), 1);
  }
  assert.ok(methods.every(method => method === "GET"));
  assert.deepEqual(errors, []);
  await context.close();
  console.log(JSON.stringify({ width, kind, status: "passed" }));
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EDUAGENT_BROWSER_PATH || "/opt/google/chrome/chrome",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [1440, 1024, 768, 390, 320]) await check(browser, width, "mixed");
    for (const kind of ["single", "skips", "zero", "legacy", "historical", "unsafe"]) await check(browser, 390, kind);
    console.log(`Review chart checks passed. Screenshots: ${out}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
