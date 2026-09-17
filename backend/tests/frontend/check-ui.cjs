const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  process.env.EDUAGENT_PLAYWRIGHT_MODULE || "playwright-core",
);

const baseUrl = process.env.EDUAGENT_BASE_URL || "http://127.0.0.1:8126";
const outputDir =
  process.env.EDUAGENT_SCREENSHOT_DIR || path.join(__dirname, "screenshots");
const errors = [];
const challenge = {
  session_id: "ui-check-session",
  title: "Understand a collection pipeline",
  task_type: "rewrite",
  language: "python",
  student_instructions_md:
    "Read the source and explain how the collection pipeline works.\n\nFocus on the filtering condition, the transformation, and how the function handles an empty input.\n\nExplain the intent in your own words, including the relationship between the input and output.",
  files: {
    "src/collections/pipeline.py":
      'from typing import Iterable\n\n\ndef collect_active(items: Iterable[dict]) -> list[str]:\n    """Return the names of active collection items."""\n    result = []\n    for item in items:\n        if item.get(\'active\', False):\n            result.append(item[\'name\'].strip())\n    return result\n',
  },
  edits: [],
  blanks: [],
};
const evaluation = {
  task_type: "rewrite",
  total_score: 88,
  passed_blanks: 3,
  feedback_md:
    "Your explanation captures the purpose of the collection pipeline and correctly identifies the filtering condition.\n\nThe function returns the trimmed names of active items, maintaining their original order. You also correctly explain that an empty input produces an empty list.\n\nTo strengthen the response, discuss the assumptions about each item's shape and what happens when the name key is missing.",
  suggestions: [
    "Describe the expected input shape and the function's output contract.",
    "Explain why filtering happens before transforming each item's name.",
    "Consider missing keys, whitespace-only names, and empty collections.",
  ],
};

async function preparePage(browser, width, options = {}) {
  const currentChallenge = options.challenge || challenge;
  const currentEvaluation = options.evaluation || evaluation;
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: options.reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__motionCalls = [];
    window.__scrollCalls = [];
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      window.__scrollCalls.push(options);
      return originalScroll.call(this, options);
    };
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      window.__motionCalls.push({
        tag: this.tagName,
        className: this.className,
        keyframes,
      });
      return original.call(this, keyframes, options);
    };
  });
  await page.route("**/api/challenges/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/create")) {
      const payload = request.postDataJSON();
      assert.equal(payload.repo_url, "github.com/owner/repository");
      assert.equal(payload.ref, "main");
      assert.equal(payload.task_type, currentChallenge.task_type);
      return route.fulfill({ json: currentChallenge });
    }
    if (url.pathname.endsWith("/submit")) {
      const payload = request.postDataJSON();
      if (options.checkSubmission) options.checkSubmission(payload);
      else {
        assert.ok(payload.explanation_md.trim());
        assert.deepEqual(payload.filled_files, currentChallenge.files);
      }
      return route.fulfill({
        json: {
          session_id: currentChallenge.session_id,
          evaluation: currentEvaluation,
        },
      });
    }
    if (url.pathname.endsWith("/review")) {
      return route.fulfill({
        json: {
          session_id: currentChallenge.session_id,
          task_type: currentChallenge.task_type,
          evaluation: currentEvaluation,
        },
      });
    }
    return route.fulfill({
      json: {
        session_id: currentChallenge.session_id,
        challenge: currentChallenge,
      },
    });
  });
  return { context, page };
}

async function settle(page) {
  await page.waitForTimeout(1100);
  await page.evaluate(() =>
    Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  );
}

async function checkLayout(page, name) {
  const bounds = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    invalid: [
      ...document.querySelectorAll(
        ".create-composer, .challenge-view, .workspace-card, .files-area, .answer-column, .score-card, .feedback-card, .suggestions-card",
      ),
    ]
      .filter((element) => element.getClientRects().length)
      .map((element) => ({
        className: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }))
      .filter((rect) => rect.left < -1 || rect.right > window.innerWidth + 1),
  }));
  assert.ok(bounds.scroll <= bounds.width + 1, `${name}: horizontal overflow`);
  assert.deepEqual(bounds.invalid, [], `${name}: clipped module`);
  assert.equal(
    await page.locator(".pill-nav, .progress-panel, [data-step-link]").count(),
    0,
  );
}

async function capturePages(browser, width) {
  const { context, page } = await preparePage(browser, width);
  try {
    for (const step of ["create", "solve", "review"]) {
      await page.goto(
        `${baseUrl}/${step}${step === "create" ? "" : `?session_id=${challenge.session_id}`}`,
        { waitUntil: "domcontentloaded" },
      );
      if (step === "solve")
        await page.locator("#workspaceContent").waitFor({ state: "visible" });
      if (step === "review")
        await page.locator(".score-value").waitFor({ state: "visible" });
      await settle(page);
      await checkLayout(page, `${step}-${width}`);
      assert.ok(
        await page.evaluate(() => window.__motionCalls.length > 0),
        `${step}: no real animations played`,
      );
      await page.screenshot({
        path: path.join(outputDir, `${step}-${width}.png`),
        fullPage: true,
      });
    }
  } finally {
    await context.close();
  }
}

async function checkJourney(browser) {
  const { context, page } = await preparePage(browser, 1440);
  try {
    await page.goto(`${baseUrl}/create`);
    await page.locator("#btnCreate").click();
    await page.locator("#createLog[data-status='error']").waitFor();
    await page.locator("#repoUrl").fill("github.com/owner/repository");
    await page.locator("#btnCreate").click();
    await page.waitForURL("**/solve?session_id=**");
    assert.equal(
      await page.locator("#codeViewer").inputValue(),
      challenge.files["src/collections/pipeline.py"],
    );
    assert.ok(
      await page.locator("#codeViewer").evaluate((element) => element.readOnly),
    );
    await page
      .locator("#explanation")
      .fill(
        "The function filters active items and returns their trimmed names, in order. Empty input returns an empty list.",
      );
    await page.reload();
    assert.ok(
      (await page.locator("#explanation").inputValue()).includes(
        "filters active",
      ),
    );
    await page.locator("#btnSubmit").click();
    await page.waitForURL("**/review?session_id=**");
    await page.locator(".score-value").waitFor();
    assert.ok(
      (await page.locator(".score-value").textContent()).includes("88"),
    );
    await page.reload();
    await page.locator(".score-value").waitFor();
    assert.equal(await page.locator(".suggestion-list li").count(), 3);
    assert.equal(
      await page.locator('a[href^="/create"], a[href^="/solve"]').count(),
      0,
    );
  } finally {
    await context.close();
  }
}

async function checkReducedAndUnavailableMotion(browser) {
  const reduced = await preparePage(browser, 390, { reduced: true });
  try {
    await reduced.page.goto(`${baseUrl}/create`);
    await settle(reduced.page);
    assert.equal(
      await reduced.page.evaluate(() => window.__motionCalls.length),
      0,
    );
    assert.ok(await reduced.page.locator("#btnCreate").isVisible());
    await checkLayout(reduced.page, "reduced-motion");
    await reduced.page.goto(
      `${baseUrl}/solve?session_id=${challenge.session_id}`,
    );
    await reduced.page
      .locator("#workspaceContent")
      .waitFor({ state: "visible" });
    await reduced.page.locator("#challengeFiles .ghost-btn").first().click();
    await settle(reduced.page);
    assert.equal(
      await reduced.page.evaluate(() => window.__motionCalls.length),
      0,
    );
    assert.equal(
      await reduced.page.evaluate(() => window.__scrollCalls.at(-1).behavior),
      "auto",
    );
  } finally {
    await reduced.context.close();
  }

  const fallback = await preparePage(browser, 1440);
  try {
    await fallback.page.route("**/vendor/motion-mini.mjs", (route) =>
      route.abort(),
    );
    await fallback.page.goto(`${baseUrl}/create`);
    await fallback.page.locator("#repoUrl").fill("github.com/owner/repository");
    await fallback.page.locator("#btnCreate").click();
    await fallback.page.waitForURL("**/solve?session_id=**");
    await fallback.page
      .locator("#workspaceContent")
      .waitFor({ state: "visible" });
    assert.ok(await fallback.page.locator("#btnSubmit").isEnabled());
  } finally {
    await fallback.context.close();
  }
}

async function checkCompletionJourney(browser) {
  const filePath = "src/calculations/total.py";
  const blankChallenge = {
    ...challenge,
    session_id: "ui-blank-session",
    title: "Complete the calculation",
    task_type: "blank_fill",
    files: {
      [filePath]: "def total(values):\n    # BLANK:B1\n",
      "src/calculations/constants.py": "DEFAULT_TOTAL = 0\n",
    },
    blanks: [{ blank_id: "B1", file_path: filePath }],
  };
  const { context, page } = await preparePage(browser, 390, {
    challenge: blankChallenge,
    evaluation: { ...evaluation, task_type: "blank_fill", total_score: 65 },
    checkSubmission(payload) {
      assert.equal(payload.explanation_md, "");
      assert.deepEqual(payload.filled_files, {
        ...blankChallenge.files,
        [filePath]: "def total(values):\n    return sum(values)\n",
      });
    },
  });
  try {
    await page.goto(`${baseUrl}/create`);
    await page.locator("#repoUrl").fill("github.com/owner/repository");
    await page.locator("#taskType").selectOption("blank_fill");
    await page.locator("#btnCreate").click();
    await page.waitForURL("**/solve?session_id=**");
    await page.locator("#completionCode").waitFor({ state: "visible" });
    assert.equal(await page.locator("#rewriteAnswerArea").isVisible(), false);
    await page
      .locator("#fileSelect")
      .selectOption("src/calculations/constants.py");
    assert.equal(
      await page.locator("#codeViewer").inputValue(),
      "DEFAULT_TOTAL = 0\n",
    );
    await page.locator("#challengeFiles .ghost-btn").first().click();
    assert.equal(
      await page.locator("#codeViewer").inputValue(),
      blankChallenge.files[filePath],
    );
    await page.locator("#btnSubmit").click();
    await page.locator("#submitLog[data-status='error']").waitFor();
    await page.locator("#completionCode").fill("return sum(values)");
    await page.reload();
    assert.equal(
      await page.locator("#completionCode").inputValue(),
      "return sum(values)",
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await settle(page);
    await checkLayout(page, "completion-mobile");
    await page.screenshot({
      path: path.join(outputDir, "solve-completion-390.png"),
      fullPage: true,
    });
    await page.locator("#btnSubmit").click();
    await page.waitForURL("**/review?session_id=**");
    await page.locator(".score-value").waitFor();
    assert.equal(
      await page.locator(".score-card").getAttribute("data-tone"),
      "building",
    );
    assert.ok(
      (await page.locator(".report-meta").textContent()).includes(
        "Blank passed",
      ),
    );
    await settle(page);
    await checkLayout(page, "completion-review-mobile");
  } finally {
    await context.close();
  }
}

async function checkLongContent(browser) {
  const longPath = `src/${"long_directory_name_".repeat(8)}/pipeline.py`;
  const longChallenge = {
    ...challenge,
    title: `${challenge.title}: ${"VeryLongIdentifier".repeat(12)}`,
    files: { [longPath]: Object.values(challenge.files)[0] },
  };
  const longEvaluation = {
    ...evaluation,
    total_score: 42,
    feedback_md: evaluation.feedback_md.repeat(6),
    suggestions: [...evaluation.suggestions, "VeryLongIdentifier".repeat(40)],
  };
  for (const width of [1440, 390]) {
    const { context, page } = await preparePage(browser, width, {
      challenge: longChallenge,
      evaluation: longEvaluation,
    });
    try {
      await page.goto(`${baseUrl}/solve?session_id=${challenge.session_id}`);
      await page.locator("#workspaceContent").waitFor({ state: "visible" });
      await settle(page);
      await checkLayout(page, `long-solve-${width}`);
      await page.goto(`${baseUrl}/review?session_id=${challenge.session_id}`);
      await page.locator(".score-value").waitFor();
      await settle(page);
      await checkLayout(page, `long-review-${width}`);
      assert.equal(
        await page.locator(".score-card").getAttribute("data-tone"),
        "review",
      );
      assert.equal(
        await page.locator(".feedback-content").textContent(),
        longEvaluation.feedback_md,
      );
      assert.equal(await page.locator(".suggestion-list li").count(), 4);
      await page.screenshot({
        path: path.join(outputDir, `review-long-${width}.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      process.env.EDUAGENT_BROWSER_PATH || "/opt/google/chrome/chrome",
    headless: process.env.EDUAGENT_HEADFUL !== "1",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    for (const width of [1440, 1024, 768, 390, 320])
      await capturePages(browser, width);
    await checkJourney(browser);
    await checkCompletionJourney(browser);
    await checkLongContent(browser);
    await checkReducedAndUnavailableMotion(browser);
    assert.deepEqual(errors, [], "Browser JavaScript errors");
    console.log(`Frontend checks passed; screenshots: ${outputDir}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
