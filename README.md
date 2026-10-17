# Em Time

A Pomodoro-style focus timer with a task list, a weekly tracker, a two-month heatmap and a smoothed trend line. Light blue, minimal, installable on phone and laptop. Local-first with optional sync through Supabase.

Live: https://dathanbn.github.io/em-time/

## Run locally

```
npm install
cp .env.example .env.local   # optional, enables the Sync card
npm run dev                  # http://localhost:5173/em-time/
```

`?stub` on the URL loads 70 days of sample history; `?stub=empty` shows the first-run state.

## Checks

```
npm run lint
npm run typecheck
npx vitest run
VITE_E2E=1 npm run build && npx playwright test
```

## Layout

- `frontend/src/core/` framework-free logic: timer engine, stats, storage, export/import, sync
- `frontend/src/` Preact UI, hand-drawn SVG charts, platform modules (audio, notifications, wake lock, PWA)
- `frontend/supabase/` SQL migration and setup notes
- `tests/` unit and Playwright tests, screenshots, `qa-report.md`
- `docs/` spec, design brief, architecture, contract

See `MORNING-CHECKLIST.md` for first deploy.
