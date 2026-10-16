# Frontend verification

## Three-question integration

`check-three-questions.cjs` exercises the real HTTP endpoints, graphs, and a temporary
SQLite database. Only the GitHub and LLM adapters are deterministic fixtures; the
browser does not intercept application API requests. Nothing writes to the normal
application database. Start the isolated server from `backend/`:

```sh
PYTHONPATH=.:tests .venv-local/bin/python -m uvicorn three_question_server:app --host 127.0.0.1 --port 8137
```

Then run `npm run check:workflow` from this directory. It covers both question types,
three distinct files, empty-answer validation, one-way progression, persisted
progress, per-question drafts, blocked browser storage, retrying failed assessment,
visible per-question feedback before an explicit Continue, persisted feedback on reload,
no early Review access, locked-answer recovery after a grading failure,
overall-only Review (no individual scores/cards), synthesis retry, and reload without regrading.
Screenshots are captured at 2466, 1440, 1280, 1024, 390 and 320 pixels. Solve checks
also verify a full-width progress row, left brief/right wide response placement,
stacking on smaller screens, non-overlapping headings, and viewport-sized video.
External fonts/video requests
are blocked in this suite to verify the application's fallback presentation.
`EDUAGENT_BASE_URL` defaults to `http://127.0.0.1:8137` for this test; the browser,
Playwright module, and screenshot directory overrides below also apply.

On hosts with a virtual-address-space limit, Chromium may fail before loading any
page with `Oilpan: Out of memory`. If permitted, run `ulimit -v unlimited` in the
test shell; this changes only that shell's soft virtual-address-space limit.

## Existing layout and animation regression

The current checks cover all three independent pages at 2560, 1920, 1440, 1280,
1024, 768, 390 and 320 CSS pixels, both explanation/completion journeys, file switching, validation,
draft restoration, review reload and long content. Challenge API requests are
intercepted; no GitHub/LLM requests or database writes occur.

All three centered shells (header, main, footer) must occupy 90% of the available
page width, including large desktops with no former 1360px cap. Solve's redundant
descriptive copy must be absent while the real challenge instructions, source,
file controls and response counters remain intact.

Create background checks cover its autoplaying, muted, looping MP4, clear unwashed
rendering, fine-pointer parallax, reduced-motion/hidden-page pause and dark-surface fallback.
Solve checks cover the prompt's third MP4 at a 100% viewport fit (about 9% larger than the previous 92%),
with softly blended edges, fine-pointer parallax,
reduced-motion/hidden-page pause, static failure fallback and the 0.45× dimmed,
desaturated focused-answer state. Review checks cover the separate Foldcraft
full-cover video, 70% horizontal focal point, lifecycle pause and dark fallback.
Missing video, image assets or entrance animation must leave business controls and
the learning flow usable.

The background remains root z-index 0 with pointer-events none; main/footer are 1.
Create's primary module has no architectural image, wash, photo credit or depth
script; its neutral background tint remains at 20% over the video.
All three documents load `workflow-theme.css` last. It owns the shared cinematic
tokens, brand rail, step capsule, glass shell, ice work surface, action gradient,
radius scale and responsive visual overrides without touching workflow state.
The shared brand header stays in normal flow, scrolls out of view and has a fully
transparent background with no border, shadow, pause button, status pill or
`AI ready` text. Desktop adds a fading one-pixel continuation line and a bounded
fine-pointer logo lift; the line is removed at mobile width. The stylesheet URL is
versioned so browsers cannot reuse the former opaque-header CSS.
The former cartoon props, art click controls and glyph/particle checks were retired
alongside those deliberately removed features, not silently skipped.
The former generic white optical plate, its WebGL modules and all runtime poster
references are absent from the three-page layer chain.
Create's pale veil/bottom fade and Review's pale veil are also absent; their video
color is now preserved directly beneath the shared glass content system.

## Run

Start a development server from `backend/` (or use your existing instance):

```sh
.venv-local/bin/uvicorn app.main:app --port 8126 --lifespan off
```

From this directory, with Node 18+ and Chrome available:

```sh
npm install
EDUAGENT_BASE_URL=http://127.0.0.1:8126 npm run check
```

Use `npm run check -- --background-only` for the focused background checks.

- `EDUAGENT_BROWSER_PATH`: installed Chrome executable.
- `EDUAGENT_BROWSER_CDP_URL`: attach to an already user-authorized Chromium over
  a localhost CDP tunnel, instead of launching a different browser.
- `EDUAGENT_PLAYWRIGHT_MODULE`: existing playwright-core installation.
- `EDUAGENT_SCREENSHOT_DIR`: output directory, default `screenshots/`.
- `EDUAGENT_HEADFUL=1`: local-launch display mode.

The authorized mimas1 verification used the existing server on port 8012 and a
loopback-only SSH-forwarded CDP connection. Headless Chromium was launched with
Playwright's standard desktop pointer-capability flags:
`--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4`.
Without these, this installed headless Chromium advertises a coarse non-hover
pointer; JS must not fake pointer capabilities just to pass a test. Touch is
separately verified using a native mobile/hasTouch browser context.
