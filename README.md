# UTD Course Planner

A browser-based course planner for UT Dallas students. Input your major,
time preferences, and grade/professor preferences. Then import (or manually
enter) your completed coursework. Then get a prioritized list of recommended
courses or optionally select your own. See the conflict-free schedule combinations available for
Fall 2026.

Everything runs client-side — course catalogs, professor ratings, and
schedule generation are all computed in the browser from static JSON/CSV
data bundled in `public/`. There is no live API server.

## Setup

Requires Node.js 18+.

```bash
npm install
```


```

## Run it

```bash
npm run dev
```

## Build for production

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally to sanity-check it
```

## Other scripts

```bash
npm run lint       # oxlint
npm run typecheck  # tsc --noEmit
```

## The five steps

```
1. Profile              major, class year, honors status
2. Time Constraints      days off, preferred time blocks, lunch window,
                          target weekly hours, max hours/day, min GPA/RMP
3. Academic History       upload a UTD unofficial transcript PDF (parsed
                          in-browser with pdf.js) or enter completed
                          courses manually
4. Review                 recommended courses for next term, computed from
                          the degree catalog + what's already completed
5. Schedule                every conflict-free section combination for the
                          reviewed course list, respecting Step 2's
                          constraints and professor ratings
```

## What's here

```
src/
  App.tsx                       5-stage state machine + backend wake-up ping
  App.css / index.css           layout, palette, fonts, CSS variables
  components/
    AcademicHistory.tsx         Step 3 — transcript upload + manual entry
    AppShellDecorations.tsx     header StepIndicator, background motifs
    ScheduleCalendar.tsx        weekly grid renderer used in Step 5
    lightswind/                 local UI primitives (button, card, toast, ...)
  steps/
    QuestionnaireStep.tsx       Step 1
    TimeConstraintsStep.tsx     Step 2
    ReviewStep.tsx              Step 4
    ScheduleStep.tsx            Step 5
  lib/
    api.ts                      wakeBackend() — optional backend wake-up ping
    catalog.ts                  major-catalog lookup/parsing helpers
    parseTranscript.ts          in-browser PDF transcript parser (pdf.js)
    recommendCourses.ts         Step 4 recommendation engine
    scheduleCourses.ts          Step 5 conflict-free scheduling engine
    professorRatings.ts         grade-distribution + RateMyProfessors lookup
  data/
    utd_degrees.json            major name -> catalog file mapping

public/
  classes.json                  course name + prereq text, keyed by code
  All_Courses/<PREFIX>.json     raw CourseBook export, one file per subject
  UTD_2022 .. UTD_2026/         parsed degree-catalog JSON, one per year
  raw_data/*.csv                historical grade distributions by term
  raw_data/matched_professor_data.json  grades merged with RMP data

server/
  scrape_utd_degrees.py         scrapes degree/major catalog structure
  scrape_major_pdfs.py          scrapes major requirement PDFs
  scrape_class_details.py       scrapes CourseBook section data
```

The `server/` scripts are offline data-generation tools (run manually to
refresh `public/All_Courses`, `public/UTD_*`, etc.) — they are not a
running API.

## Notes / what's intentionally minimal

- **No routing library.** Step navigation is a local `stage` state machine
  in `App.tsx` rather than React Router.
- **No live backend today.** `src/lib/api.ts` still fires an optional
  wake-up ping to `${VITE_API_URL}/health` on load (useful if a Render
  free-tier backend is ever reintroduced); leaving `VITE_API_URL` blank
  just skips it with a console warning.
- **Transcript parsing happens entirely client-side** via `pdf.js` — no
  file upload to any server.

## Color palette

Derived from the project's brand spec:

| Token         | Value     | Source                  |
|---------------|-----------|--------------------------|
| `--ink-900`   | `#081712` | Page background (derived, darker than spec green) |
| `--panel-700` | `#154734` | Panel/card surface |
| `--panel-600` | `#1f5c43` | Elevated panel surface |
| `--mint-400`  | `#5fe0b7` | Primary accent |
| `--amber-500` | `#e87500` | Secondary accent |
| `--steel-400` | `#8a8d8f` | Pantone 877 C — muted text & borders |
