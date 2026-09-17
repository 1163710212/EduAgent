# Frontend verification

These checks exercise responsive rendering, actual animation playback, reduced
motion, a failed animation-library load, and the Create → Solve → Review flow
for both explanation and completion challenges, including draft restoration,
file switching and long content, with intercepted API responses. No GitHub/LLM
requests or database writes occur.

Start a local server from `backend/`:

```sh
.venv-local/bin/uvicorn app.main:app --port 8126 --lifespan off
```

Then from this directory, with Node 18+ and Chrome installed:

```sh
npm install
EDUAGENT_BASE_URL=http://127.0.0.1:8126 npm run check
```

Set `EDUAGENT_BROWSER_PATH` if Chrome is not at `/opt/google/chrome/chrome`.
`EDUAGENT_SCREENSHOT_DIR` controls screenshot output (default: `screenshots/`).
`EDUAGENT_PLAYWRIGHT_MODULE` optionally points to an existing playwright-core
installation. Set `EDUAGENT_HEADFUL=1` to use a display or `xvfb-run`.
