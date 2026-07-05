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
- **Progress charts** — a dedicated tab that turns your log into trends: per-lift **estimated 1RM**
  over time (line), **weekly training volume** and **weekly cardio minutes** (Zone 2 vs intervals)
  as bars, a **bodyweight** trend, and a **sleep-difficulty** trend, plus headline tiles for this
  week's volume, best e1RM, and week streak. Charts are hand-rolled SVG — no libraries, fully
  offline, and theme-aware.
- **Daily check-ins (recovery journal)** — split into two moments that share one daily record:
  a **🌅 morning** check-in for last night's **sleep difficulty** (1 easy – 5 hard), the **morning
  weigh-in**, waking **energy** and **soreness**; and a **🌙 evening** check-in for **alcohol
  drinks**, **stress**, **pre-sleep activity** and notes on the day. Each is one tap from the home
  screen (independent ✓ status) or the Log menu, with a Morning/Evening toggle to flip between them,
  editable from History, and surfaced as trends on Progress — so you can correlate recovery with how
  your training actually goes.
- **Exercise detail** — tap any lift (from Progress or a History session) to drill into its own
  page: estimated-1RM trend, working-weight trend, per-session volume, best-ever tiles, the next
  auto-progression target, and a full session-by-session log.
- **Recovery view (Fitbit-ready)** — a drill-down that blends your check-in data into sleep, alcohol
  and readiness trends and a directional **sleep-vs-training** comparison (volume after easy vs. hard
  sleep). Recovery reads through a source-agnostic layer (`js/recovery.js`): today it uses your
  self-reports; when a **Fitbit** is connected later it will prefer measured sleep stages, resting
  heart rate and HRV — no view changes needed.
- **Data export** — a full **JSON** backup, plus **CSV** exports (one row per set/session, one row
  per check-in) that drop straight into a spreadsheet to slice and refine your program.
- **Guided workout (StrongLifts-style)** — a "Start workout" flow that shows your exact **target
  weight** for every lift, a **plate breakdown** per side, and tap-to-complete **set circles** (tap
  again if you missed reps). A built-in **rest timer** auto-starts after each set with a beep/vibrate
  when it's up. You rate each lift's **difficulty** (Easy / Good / Hard / Failed).
- **Auto-progression & deload** — on success the next target goes up automatically (+5 lb upper,
  +10 lb lower; **double** if you tagged it Easy). Miss the reps and it holds; miss the same lift
  **3 sessions in a row and it deloads 10%**. Weights are in **lbs**, rounded to loadable plates.
  A "next workout" card on the home screen always shows what's coming and its weights.
- **Flexible logging**
  - **Strength**: exercises → sets (weight / reps / RIR), from a template or built freely.
  - **Cardio**: Zone 2 or intervals (duration + optional avg HR).
  - **Other activity**: climbing, easy/hard ride, hike — each mapped to what it *replaces* per the
    plan's substitution guide (e.g. climbing → a pull day + partial cardio; hard ride → intervals).
  - **Skip anything** — nothing is required; the week just reflects what you did.
- **Editable exercise library** — add custom exercises with pattern, muscles, rep range, target RIR.
- **Starter templates** — Full Body A/B and Upper/Lower from the plan.
- **Tunable targets & profile** — bodyweight, units, protein g/kg, max HR, and every weekly target.
- **Cloud sync (optional)** — back up/sync everything through your own tiny free server. Local-first
  (the app keeps working offline), auto-syncs on change, last-write-wins across devices. Auth is a
  single secret token — no accounts, no OAuth. See **[Cloud sync setup](#cloud-sync-self-hosted)** below.
- **Export / import** JSON backups; reset to defaults.
- **Offline PWA** — installable, cached service worker, no network needed after first load.

## Run it

It's a static site — any static host works.

**Locally:**
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

### Auto-deploy to GitHub Pages

`.github/workflows/deploy.yml` publishes the app to GitHub Pages automatically on every push to
the default branch (and on manual dispatch). No build step — the repo is uploaded as-is.

**One-time setup** (required — the CI token isn't allowed to enable Pages itself):

1. Repo → **Settings → Pages → Build and deployment → Source → "GitHub Actions"**.
2. Re-run the latest **Deploy to GitHub Pages** workflow (Actions tab → the run → *Re-run jobs*),
   or push any commit. From then on it deploys on every push, hands-off.
3. Open the Pages URL on your phone → Share → **Add to Home Screen** → runs full-screen & offline.

> **Private repos:** GitHub Pages on a private repo requires a paid plan (Pro/Team/Enterprise).
> On the Free plan, either upgrade or make the repo public to use Pages. Everything else
> (local hosting, the app itself) works regardless.
>
> Service workers require HTTPS (GitHub Pages provides it) or `localhost`. Opening `index.html`
> directly via `file://` won't load ES modules — serve it over HTTP.

## Cloud sync (self-hosted)

Sync is **optional**. The app talks to a tiny personal backend that stores **one JSON document**
(your whole state) behind a **shared secret token** — no accounts, no OAuth. The reference backend
is a **Cloudflare Worker + KV** (free tier, always-on, no credit card).

### 1. Deploy the backend (~5 min, one time)

Full walkthrough in **[`server/README.md`](server/README.md)**. In short, from the `server/` folder:

```bash
npm install -g wrangler          # Cloudflare CLI (or use npx wrangler ...)
wrangler login
wrangler kv namespace create TRAINER_KV   # paste the printed id into wrangler.toml
wrangler secret put SYNC_TOKEN            # set a long random token — keep a copy
wrangler deploy                           # prints your https://trainer-sync.<sub>.workers.dev URL
```

### 2. Connect the app

Open **Setup → ☁ Cloud sync**, enter your **Server URL** and **secret token**, tap **Connect**.
The app pulls on connect and auto-pushes (debounced) on every change. Use **Sync now** anytime.

> Prefer a different host? The client only needs an endpoint that answers
> `GET /state` and `PUT /state` with `Authorization: Bearer <token>`. The same `worker.js` logic
> ports to Deno Deploy, a small Node/Express server, etc. — only the storage call changes.

### How sync behaves

- **Local-first:** your device is the working copy; everything works offline. Changes auto-push
  (debounced) when connected, and the app pulls on connect.
- **Last-write-wins:** whichever side has the newer timestamp wins the whole dataset. A brand-new
  install counts as "oldest," so connecting a second device **pulls** your data rather than
  overwriting it. Editing two devices at the exact same moment can still overwrite one side — fine
  for one-phone use, and the JSON export is always there as a manual backup.
- **Token = password:** anyone with the URL and token can read/write your data. Keep it secret;
  rotate anytime with `wrangler secret put SYNC_TOKEN` and re-enter it in the app.
- Server URL, token, and connection state are stored only on your device, never sent to the server
  as part of your data.

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
js/progression.js     auto-progression + deload + difficulty (guided workout)
js/plates.js          barbell plate calculator (lbs)
js/charts.js          dependency-free SVG line/bar charts (Progress tab)
js/recovery.js        source-agnostic recovery signal (journal now, Fitbit later)
js/timer.js           rest timer (beep + vibrate)
js/templates.js       starter session templates
js/sync.js            two-way sync client (REST, bearer-token)
js/app.js             UI, router, all views & event handling
manifest.webmanifest  PWA manifest
sw.js                 offline service worker
icons/                app icons
server/               Cloudflare Worker sync backend (worker.js, wrangler.toml, README)
```

This is general fitness tooling, not medical advice.
