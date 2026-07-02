# Course Planner — Frontend

Initial React frontend for the AI Course Planner. Covers the two setup
screens from the spec: the "about you" questionnaire (major, year) and the
time-constraints screen (days off, preferred time blocks, lunch period,
target course hours, max hours/day), plus a review screen and a backend
cold-start ping.

## Setup

Requires Node.js 18+.

```bash
cd course-planner
npm install
cp .env.example .env
```

Open `.env` and set `VITE_API_URL` to your Render backend's base URL
(no trailing slash), e.g.:

```
VITE_API_URL=https://course-planner-api.onrender.com
```

If you don't have a backend deployed yet, leave it blank — the app still
runs fine, it just skips the wake-up ping and logs a console warning.

## Run it

```bash
npm run dev
```

Opens at `http://localhost:5173`.

## Build for production

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally to sanity-check it
```

## What's here

```
src/
  App.jsx                    step state machine + backend wake-up ping
  App.css                    layout, palette, and component styles
  index.css                  fonts, CSS variables, global reset
  lib/api.js                 wakeBackend() — fires once on load
  components/
    ScheduleGridBackdrop.jsx tilted timetable-grid background motif
    StepIndicator.jsx        01/02 progress indicator in the header
  steps/
    QuestionnaireStep.jsx    Step 1 — major, year
    TimeConstraintsStep.jsx  Step 2 — days off, time blocks, lunch, hours
    ReviewStep.jsx           summary shown after submit
```

## Notes / what's intentionally not here yet

- **No routing library.** Only two steps, so it's a local `stage` state
  in `App.jsx` rather than React Router. Worth adding if more screens
  come later.
- **No OpenAI or PostgreSQL code.** Both are backend concerns — an API
  key should never live in frontend code. `ReviewStep` is the handoff
  point where a real request to your backend would go once that
  endpoint exists.
- **The wake-up ping hits `${VITE_API_URL}/health`.** Change the path
  in `src/lib/api.js` if your backend uses a different route.

## Color palette

Derived from the project's brand spec:

| Token         | Value     | Source                  |
|---------------|-----------|--------------------------|
| `--ink-900`   | `#081712` | Page background (derived, darker than spec green) |
| `--panel-700` | `#124734` | RGB 18-71-52 — panel/card surface |
| `--mint-400`  | `#5ff4b7` | RGB 95-244-183 — primary accent |
| `--amber-500` | `#e87500` | RGB 232-117-0 — secondary accent |
| `--steel-400` | `#8a8d8f` | Pantone 877 C — muted text & borders |
