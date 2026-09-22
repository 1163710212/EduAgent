# Frontend verification

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
Solve checks cover the prompt's third MP4 at a native-friendly 92% viewport fit,
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
