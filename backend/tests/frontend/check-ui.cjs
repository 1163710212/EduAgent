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
    isMobile: Boolean(options.touch),
    hasTouch: Boolean(options.touch),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__motionCalls = [];
    window.__scrollCalls = [];
    try {
      window.__sceneCalls = JSON.parse(sessionStorage.getItem("eduagent.test.scene-calls") || "[]");
    } catch (_) { window.__sceneCalls = []; }
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      window.__scrollCalls.push(options);
      return originalScroll.call(this, options);
    };
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.id === "ambientBackground" && [180,260].includes(options.duration)) {
        window.__sceneCalls.push({
          path:location.pathname,
          phase:options.duration === 180 ? "outgoing" : "incoming",
        });
        try {
          sessionStorage.setItem("eduagent.test.scene-calls",JSON.stringify(window.__sceneCalls));
        } catch (_) {}
      }
      window.__motionCalls.push({
        tag: this.tagName,
        className: this.className,
        title: this.hasAttribute("data-title-motion"),
        titleText: this.hasAttribute("data-title-motion")
          ? this.textContent.trim()
          : null,
        book: this.hasAttribute("data-learning-book"),
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
      if (options.delayCreateMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayCreateMs),
        );
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
      if (options.delayReviewMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayReviewMs),
        );
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
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  );
}

async function setPageHidden(page, hidden) {
  await page.evaluate((value) => {
    if (value)
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
    else delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function checkScrollingHeader(page, name) {
  const viewport = page.viewportSize();
  const header = page.locator(".topbar");
  assert.equal(
    await page.locator("#backgroundToggle, .background-toggle").count(),
    0,
    `${name}: pause control must be removed`,
  );
  assert.equal(
    await header.evaluate((element) => getComputedStyle(element).position),
    "relative",
  );
  assert.deepEqual(await header.evaluate(element => {
    const style=getComputedStyle(element);
    return {background:style.backgroundColor,border:style.borderTopWidth,shadow:style.boxShadow};
  }),{background:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none'});
  assert.equal(await page.locator('.header-actions, .system-status').count(),0);
  assert.equal(await page.getByText('AI ready',{exact:true}).count(),0);
  const initial = await header.boundingBox();
  const main = await page.locator("#mainContent").boundingBox();
  assert.ok(
    main.y >= initial.y + initial.height + 8,
    `${name}: header must occupy normal document space`,
  );
  try {
    await page.setViewportSize({ width: viewport.width, height: 500 });
    await page.evaluate(() =>
      window.scrollTo({ top: 350, behavior: "instant" }),
    );
    assert.ok(
      await page.evaluate(() => window.scrollY > 0),
      `${name}: scroll check must actually scroll`,
    );
    const scrolled = await header.boundingBox();
    assert.ok(
      Math.abs(
        scrolled.y + (await page.evaluate(() => window.scrollY)) - initial.y,
      ) < 0.5,
      `${name}: header must scroll with the document`,
    );
    assert.ok(
      Math.abs(scrolled.x - initial.x) < 0.5,
      `${name}: header must stay centered`,
    );
    assert.ok(
      scrolled.y + scrolled.height < 0,
      `${name}: header must leave the viewport`,
    );
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
}

async function checkLayout(page, name) {
  const shell = await page.evaluate(() => {
    const availableWidth = document.body.getBoundingClientRect().width;
    return [...document.querySelectorAll('.topbar, .app-shell, .site-footer')].map(element => ({
      name: element.className,
      width: element.getBoundingClientRect().width,
      left: element.getBoundingClientRect().left,
      availableWidth,
    }));
  });
  for (const region of shell) {
    assert.ok(Math.abs(region.width-region.availableWidth*.9)<1,`${name}: ${region.name} must use 90% width`);
    assert.ok(Math.abs(region.left-(region.availableWidth-region.width)/2)<1,`${name}: ${region.name} must be centered`);
  }
  const layers = await page.evaluate(() => {
    const background = document.getElementById("ambientBackground");
    const main = document.getElementById("mainContent");
    const bounds = main.getBoundingClientRect();
    const point = { x: bounds.left + 8, y: Math.max(bounds.top + 8, 8) };
    const originalPointerEvents = background.style.pointerEvents;
    background.style.pointerEvents = "auto";
    const paintedLayers = document.elementsFromPoint(point.x, point.y);
    background.style.pointerEvents = originalPointerEvents;
    return {
      background: getComputedStyle(background).zIndex,
      main: getComputedStyle(main).zIndex,
      footer: getComputedStyle(document.querySelector(".site-footer")).zIndex,
      pointerEvents: getComputedStyle(background).pointerEvents,
      contentAboveBackground:
        paintedLayers.indexOf(main) >= 0 &&
        paintedLayers.indexOf(main) < paintedLayers.indexOf(background),
    };
  });
  assert.deepEqual(
    layers,
    {
      background: "0",
      main: "1",
      footer: "1",
      pointerEvents: "none",
      contentAboveBackground: true,
    },
    `${name}: background must stay underneath original content`,
  );
  const bounds = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    invalid: [
      ...document.querySelectorAll(
        ".title-line, .header-actions, .create-composer, .challenge-view, .workspace-card, .files-area, .answer-column, .score-card, .feedback-card, .suggestions-card",
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
      if (step === "solve") {
        assert.equal(await page.locator('.workflow-intro p, .card-heading p, .submit-row p, .answer-heading > div > span, .answer-mode').count(),0);
        assert.equal(await page.locator('.composer-footer').allTextContents().then(values=>values.every(text=>/^\s*0 (chars|lines)\s*$/.test(text))),true);
        assert.equal(await page.locator('#challengeInstructions').textContent(),challenge.student_instructions_md);
        assert.equal(await page.locator('#codeViewer').inputValue(),Object.values(challenge.files)[0]);
        if (width > 980) {
          const composer = await page.locator('#rewriteAnswerArea .composer-shell').boundingBox();
          const submit = await page.locator('#btnSubmit').boundingBox();
          assert.ok(submit.y-composer.y-composer.height <= 22,'Answer composer must fill its column without a large submit gap');
        }
      }
      if (step === "create") {
        await page.locator('#ambientBackground:not([data-renderer="loading"])').waitFor();
        assert.equal(await page.locator("#createBackgroundVideo").count(), 1);
        assert.equal(await page.locator("#opticalCanvas").count(), 0);
      } else if (step === "solve") {
        await page.locator('#ambientBackground:not([data-renderer="loading"])').waitFor();
        assert.equal(await page.locator("#solveBackgroundVideo").count(), 1);
        assert.equal(await page.locator("#opticalCanvas").count(), 0);
      } else if (step === "review") {
        await page.locator('#ambientBackground:not([data-renderer="loading"])').waitFor();
        assert.equal(await page.locator("#reviewBackgroundVideo").count(), 1);
        assert.equal(await page.locator("#opticalCanvas").count(), 0);
      }
      assert.equal(
        await page.locator("#ambientBackground").getAttribute("aria-hidden"),
        "true",
      );
      await checkScrollingHeader(page, `${step}-${width}`);
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
    assert.equal(
      await page
        .locator("#rewriteAnswerArea .composer-shell")
        .evaluate(
          (element) => getComputedStyle(element, "::before").animationName,
        ),
      "writing-line",
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
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(()=>window.__sceneCalls.map(call=>call.phase)),[
      "outgoing","incoming","outgoing","incoming",
    ],"Only completed steps may animate the background handoff");
    assert.equal(await page.evaluate(()=>sessionStorage.getItem("eduagent.scene-handoff")),null);
    const handoffs=await page.evaluate(()=>window.__sceneCalls.length);
    await page.reload();
    await page.locator(".score-value").waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>window.__sceneCalls.length),handoffs,"Reload must not replay scene handoff");

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
    assert.equal(
      await reduced.page
        .locator("[data-title-motion]")
        .first()
        .evaluate((element) => getComputedStyle(element).transform),
      "none",
    );
    assert.equal(
      await reduced.page
        .locator("#ambientBackground")
        .getAttribute("data-state"),
      "static",
    );
    assert.equal(await reduced.page.locator("#createBackgroundVideo").count(), 1);
    assert.equal(await reduced.page.locator("#opticalCanvas").count(), 0);
    assert.equal(await reduced.page.locator("#createBackgroundVideo").evaluate(video=>video.paused),true);
    assert.equal(await reduced.page.locator("#backgroundToggle").count(), 0);
    await checkLayout(reduced.page, "reduced-motion");
    await reduced.page.goto(
      `${baseUrl}/solve?session_id=${challenge.session_id}`,
    );
    await reduced.page
      .locator("#workspaceContent")
      .waitFor({ state: "visible" });
    assert.equal(await reduced.page.locator("#solveBackgroundVideo").count(), 1);
    assert.equal(
      await reduced.page.locator("#solveBackgroundVideo").evaluate(video=>video.paused),
      true,
    );
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
    assert.equal(
      await fallback.page
        .locator("[data-title-motion]")
        .evaluate((element) => getComputedStyle(element).opacity),
      "1",
    );
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


async function checkCinematicBackgrounds(browser) {
  const {context,page} = await preparePage(browser,1440);
  try {
    await page.goto(`${baseUrl}/create`);
    await settle(page);
    await page.locator('#ambientBackground:not([data-renderer="loading"])').waitFor();
    assert.equal(await page.locator('.education-art, #learningKit, #fileConstellation, #reflectionNotebook, .learning-symbols').count(),0);
    assert.equal(await page.locator('#opticalCanvas').count(),0);
    assert.equal(await page.locator('#createBackgroundVideo').count(),1);
    const videoAttributes=await page.locator('#createBackgroundVideo').evaluate(video=>({
      autoplay:video.autoplay,muted:video.muted,loop:video.loop,playsInline:video.playsInline,
      objectFit:getComputedStyle(video).objectFit,
    }));
    assert.deepEqual(videoAttributes,{autoplay:true,muted:true,loop:true,playsInline:true,objectFit:'cover'});
    assert.equal(await page.locator('.create-background-fade,.create-background-veil').count(),0);
    assert.notEqual(await page.locator('.hero-stage').evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(237, 242, 245, 0.2)');
    const before = await page.evaluate(()=>({
      transform:getComputedStyle(document.querySelector('#createBackgroundVideo')).transform,
      title:document.querySelector('#heroTitle').getBoundingClientRect().toJSON(),
      form:document.querySelector('#challengeForm').getBoundingClientRect().toJSON(),
    }));
    await page.mouse.move(1370,220,{steps:20});
    await page.waitForTimeout(500);
    const after = await page.evaluate(()=>({
      renderer:document.querySelector('#ambientBackground').dataset.renderer,
      transform:getComputedStyle(document.querySelector('#createBackgroundVideo')).transform,
      title:document.querySelector('#heroTitle').getBoundingClientRect().toJSON(),
      form:document.querySelector('#challengeForm').getBoundingClientRect().toJSON(),
    }));
    if(after.renderer==='video') assert.notEqual(after.transform,before.transform,"Mouse movement must create subtle video parallax");
    assert.deepEqual(after.title,before.title,"Mouse interaction must not move text");
    assert.deepEqual(after.form,before.form,"Mouse interaction must not move form");
    await page.screenshot({path:path.join(outputDir,'create-video-background.png')});
    await setPageHidden(page,true);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#createBackgroundVideo').evaluate(video=>video.paused),true,"Hidden tab must pause the background video");
    await setPageHidden(page,false);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#createBackgroundVideo').evaluate(video=>video.paused),true,"Reduced motion must pause the background video");
    assert.equal(await page.locator('#ambientBackground').getAttribute('data-state'),'static');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(`${baseUrl}/solve?session_id=${challenge.session_id}`);
    await page.locator('#workspaceContent').waitFor({state:'visible'});
    await page.locator('#ambientBackground[data-renderer="video"][data-state="running"]').waitFor();
    assert.equal(await page.locator('#opticalCanvas').count(),0);
    const solveVideoAttributes=await page.locator('#solveBackgroundVideo').evaluate(video=>({
      autoplay:video.autoplay,muted:video.muted,loop:video.loop,playsInline:video.playsInline,
      objectFit:getComputedStyle(video).objectFit,
      objectPosition:getComputedStyle(video).objectPosition,
    }));
    assert.deepEqual(solveVideoAttributes,{
      autoplay:true,muted:true,loop:true,playsInline:true,
      objectFit:'cover',objectPosition:'50% 56%',
    });
    const solveBefore=await page.evaluate(()=>({
      transform:getComputedStyle(document.querySelector('#solveBackgroundVideo')).transform,
      brief:document.querySelector('#challengeInstructions').getBoundingClientRect().toJSON(),
      form:document.querySelector('#rewriteAnswerArea').getBoundingClientRect().toJSON(),
    }));
    await page.mouse.move(1300,200,{steps:16});
    await page.waitForTimeout(600);
    const solveAfter=await page.evaluate(()=>({
      transform:getComputedStyle(document.querySelector('#solveBackgroundVideo')).transform,
      brief:document.querySelector('#challengeInstructions').getBoundingClientRect().toJSON(),
      form:document.querySelector('#rewriteAnswerArea').getBoundingClientRect().toJSON(),
    }));
    assert.notEqual(solveAfter.transform,solveBefore.transform,"Solve video must respond subtly to mouse movement");
    assert.deepEqual(solveAfter.brief,solveBefore.brief,"Background interaction must not move challenge content");
    assert.deepEqual(solveAfter.form,solveBefore.form,"Background interaction must not move answer content");
    await page.locator('#explanation').fill('A stable draft while the educational background rests.');
    await page.locator('#ambientBackground[data-state="calm"]').waitFor();
    await page.waitForTimeout(750);
    const focusedVideo=await page.locator('#solveBackgroundVideo').evaluate(video=>({
      playbackRate:video.playbackRate,
      filter:getComputedStyle(video).filter,
      transform:getComputedStyle(video).transform,
    }));
    assert.equal(focusedVideo.playbackRate,.45,"Typing focus must slow the Solve video");
    assert.ok(focusedVideo.filter.includes('brightness(0.55)'),"Typing focus must dim the Solve video");
    await page.mouse.move(1300,200,{steps:8});
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#solveBackgroundVideo').evaluate(video=>getComputedStyle(video).transform),focusedVideo.transform,"Typing focus must suspend mouse parallax");
    assert.equal(await page.locator('#explanation').inputValue(),'A stable draft while the educational background rests.');
    await page.screenshot({path:path.join(outputDir,'solve-focused.png'),fullPage:true});
    await page.locator('#fileSelect').focus();
    await page.locator('#ambientBackground[data-state="running"]').waitFor();
    assert.equal(await page.locator('#solveBackgroundVideo').evaluate(video=>video.playbackRate),1);
    assert.equal(await page.locator('#btnSubmit').isEnabled(),true);
    await page.goto(`${baseUrl}/review?session_id=${challenge.session_id}`);
    await page.locator('.score-value').waitFor();
    await page.locator('#ambientBackground:not([data-renderer="loading"])').waitFor();
    assert.equal(await page.locator('#opticalCanvas').count(),0);
    const reviewVideoAttributes=await page.locator('#reviewBackgroundVideo').evaluate(video=>({
      autoplay:video.autoplay,muted:video.muted,loop:video.loop,playsInline:video.playsInline,
      objectFit:getComputedStyle(video).objectFit,
      objectPosition:getComputedStyle(video).objectPosition,
    }));
    assert.deepEqual(reviewVideoAttributes,{
      autoplay:true,muted:true,loop:true,playsInline:true,
      objectFit:'cover',objectPosition:'70% 50%',
    });
    assert.equal(await page.locator('.review-background-veil').count(),0);
    assert.ok((await page.locator('.score-value').textContent()).includes('88'));
    await page.screenshot({path:path.join(outputDir,'review-foldcraft-video.png'),fullPage:true});
    await setPageHidden(page,true);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#reviewBackgroundVideo').evaluate(video=>video.paused),true,"Hidden tab must pause the Review background video");
    await setPageHidden(page,false);
  } finally { await context.close(); }

  const touch=await preparePage(browser,390,{touch:true});
  try {
    await touch.page.goto(`${baseUrl}/create`);
    await settle(touch.page);
    assert.equal(await touch.page.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches),false);
    await touch.page.locator('#ambientBackground:not([data-renderer="loading"])').waitFor();
    assert.equal(await touch.page.locator('#createBackgroundVideo').count(),1);
    await touch.page.locator('#repoUrl').fill('github.com/owner/repository');
    await touch.page.locator('#btnCreate').tap();
    await touch.page.waitForURL('**/solve?session_id=**');
    await touch.page.locator('#solveBackgroundVideo').waitFor();
    assert.equal(await touch.page.locator('#opticalCanvas').count(),0);
    await touch.page.locator('#explanation').fill('The function filters active items and returns trimmed names.');
    await touch.page.locator('#btnSubmit').tap();
    await touch.page.waitForURL('**/review?session_id=**');
    await touch.page.locator('.score-value').waitFor();
    assert.ok((await touch.page.locator('.score-value').textContent()).includes('88'));
    await checkLayout(touch.page,'touch-review');
  } finally { await touch.context.close(); }

  const fallback=await preparePage(browser,390);
  try {
    const assertLegacyWhiteLayerAbsent=async(expectedBodyColor)=>{
      const surface=await fallback.page.evaluate(()=>{
        const layer=document.querySelector('#ambientBackground');
        return {
          bodyColor:getComputedStyle(document.body).backgroundColor,
          layerImage:getComputedStyle(layer).backgroundImage,
          posters:document.querySelectorAll('video[poster]').length,
          legacyCanvases:document.querySelectorAll('#opticalCanvas,.optical-background-canvas').length,
        };
      });
      assert.equal(surface.bodyColor,expectedBodyColor);
      assert.equal(surface.posters,0,"Retired white poster must not remain in the layer chain");
      assert.equal(surface.legacyCanvases,0,"Retired WebGL background must not remain in the DOM");
      assert.ok(!surface.layerImage.includes('url('),surface);
    };
    await fallback.page.route('**/hf_20260325_120549_0cd82c36-56b3-4dd9-b190-069cfc3a623f.mp4',route=>route.abort());
    await fallback.page.route('**/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4',route=>route.abort());
    await fallback.page.route('**/hf_20260622_204221_5339e40b-e73d-4ab0-9c65-79c18c66fd50.mp4',route=>route.abort());
    await fallback.page.goto(`${baseUrl}/create`);
    await fallback.page.locator('#ambientBackground[data-renderer="fallback"]').waitFor();
    await assertLegacyWhiteLayerAbsent('rgb(21, 28, 37)');
    assert.ok(await fallback.page.locator('#btnCreate').isEnabled());
    await fallback.page.locator('#repoUrl').fill('github.com/owner/repository');
    await fallback.page.locator('#btnCreate').click();
    await fallback.page.waitForURL('**/solve?session_id=**');
    await fallback.page.locator('#ambientBackground[data-renderer="fallback"]').waitFor();
    await assertLegacyWhiteLayerAbsent('rgb(3, 8, 13)');
    await fallback.page.locator('#explanation').fill('Actual source code explanation, even without decorative assets.');
    await fallback.page.locator('#btnSubmit').click();
    await fallback.page.waitForURL('**/review?session_id=**');
    await fallback.page.locator('#ambientBackground[data-renderer="fallback"]').waitFor();
    await assertLegacyWhiteLayerAbsent('rgb(17, 22, 29)');
    await fallback.page.locator('.score-value').waitFor();
    assert.equal(await fallback.page.locator('.feedback-content').textContent(),evaluation.feedback_md);
  } finally { await fallback.context.close(); }
}

(async () => {
  fs.mkdirSync(outputDir,{recursive:true});
  const browser=process.env.EDUAGENT_BROWSER_CDP_URL
    ? await chromium.connectOverCDP(process.env.EDUAGENT_BROWSER_CDP_URL)
    : await chromium.launch({
        executablePath:process.env.EDUAGENT_BROWSER_PATH || '/opt/google/chrome/chrome',
        headless:process.env.EDUAGENT_HEADFUL !== '1',
        args:['--disable-dev-shm-usage'],
      });
  try {
    if(!process.argv.includes('--background-only')) {
      for(const width of [2560,1920,1440,1280,1024,768,390,320]) await capturePages(browser,width);
      await checkJourney(browser);
      await checkCompletionJourney(browser);
      await checkLongContent(browser);
      await checkReducedAndUnavailableMotion(browser);
    }
    await checkCinematicBackgrounds(browser);
    assert.deepEqual(errors,[],'Browser JavaScript errors');
    console.log(`Frontend checks passed; screenshots: ${outputDir}`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
