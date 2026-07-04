# Concurrent Trainer

A flexible, mobile-first training tracker built from an evidence-based concurrent-training plan
(lifting + Zone 2 + intervals for general health & body composition). It runs entirely in your
browser — **no account, no backend, works offline** — and installs to your phone's home screen as
a PWA. All data lives in `localStorage` on your device.

## Why it's built this way

The plan is deliberately **flexible**: hit weekly *targets*, not a rigid calendar. The app mirrors
that — you log whatever you actually did (a lift, a ride, a climb, a skipped day) and it checks the
week against the targets and **auto-adjusts your next session** based on how the last one went.

## Features

- **This Week dashboard** — live progress toward the plan's weekly targets:
  - Zone 2 minutes (target ~120–150/wk), one interval session, each movement pattern hit ~2×.
  - **Hard-set volume per muscle** (a set counts when RIR ≤ 3), with a maintenance-floor marker
    (default 4 sets) and a growth target (default 10 sets).
  - **Minimum viable week** banner: 2 full-body lifts hitting squat/hinge/push/pull + ~75 min cardio.
  - **Progression queue** — exercises ready to move up, computed from your logs.
  - **Protein** target (g/kg × bodyweight) with a daily quick-logger.
- **Auto-progression engine** — when you hit the top of an exercise's rep range at target RIR on all
  sets, it suggests adding load (upper ~5, lower ~10) and resetting to the bottom of the range;
  otherwise it suggests +1 rep or holding. Suggestions pre-fill the next session.
- **Flexible logging**
  - **Strength**: exercises → sets (weight / reps / RIR), from a template or built freely.
  - **Cardio**: Zone 2 or intervals (duration + optional avg HR).
  - **Other activity**: climbing, easy/hard ride, hike — each mapped to what it *replaces* per the
    plan's substitution guide (e.g. climbing → a pull day + partial cardio; hard ride → intervals).
  - **Skip anything** — nothing is required; the week just reflects what you did.
- **Editable exercise library** — add custom exercises with pattern, muscles, rep range, target RIR.
- **Starter templates** — Full Body A/B and Upper/Lower from the plan.
- **Tunable targets & profile** — bodyweight, units, protein g/kg, max HR, and every weekly target.
- **Export / import** JSON backups; reset to defaults.
- **Offline PWA** — installable, cached service worker, no network needed after first load.

## Run it

It's a static site — any static host works.

**Locally:**
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

**On your phone (recommended): GitHub Pages**
1. Push this branch and merge to your default branch (or enable Pages on this branch).
2. Repo → Settings → Pages → deploy from branch → root.
3. Open the Pages URL on your phone → Share → **Add to Home Screen**. It now runs full-screen, offline.

> Service workers require HTTPS (GitHub Pages provides it) or `localhost`. Opening `index.html`
> directly via `file://` won't load ES modules — serve it over HTTP.

## How the numbers work

- **Hard set** = a logged set with reps > 0 and RIR ≤ 3; each set credits every muscle the exercise targets.
- **Pattern coverage** = number of sessions in the week that included ≥1 hard set of that pattern.
- **Week** = Monday–Sunday.
- All targets are editable under **Setup** — the defaults come straight from the plan.

## Project layout

```
index.html            app shell + bottom nav
css/styles.css        mobile-first styling, light/dark aware
js/store.js           persistent state, defaults, seed exercise library
js/week.js            date helpers + weekly aggregation vs targets
js/progression.js     autoregulated progression engine
js/templates.js       starter session templates
js/app.js             UI, router, all views & event handling
manifest.webmanifest  PWA manifest
sw.js                 offline service worker
icons/                app icons
```

This is general fitness tooling, not medical advice.
