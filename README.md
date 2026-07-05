# Concurrent Trainer
 
A flexible, mobile-first training tracker built from an evidence-based concurrent-training plan
(lifting + Zone 2 + intervals for general health & body composition). It runs entirely in your
browser — **no account, no backend, works offline** — and installs to your phone's home screen as
a PWA. All data lives in `localStorage` on your device.

## Why it's built this way

The plan is deliberately **flexible**: hit weekly *targets*, not a rigid calendar. The app mirrors
that — you log whatever you actually did (a lift, a ride, a climb, a skipped day) and it checks the
week against the targets and **auto-adjusts your next session** based on how the last one went.

## How the app is organized

Five destinations, each answering one question:

- **Today** (home) — *what should I do right now?* Readiness score, the next workout (one tap to
  start), a daily checklist (morning check-in · evening check-in · protein), and a tappable
  week strip. Action only — no wall of analytics.
- **Plan** — *how is my week tracking?* The weekly-targets dashboard: rings, minimum viable week,
  movement patterns, hard-set volume per muscle, and the progression queue.
- **＋ (center button)** — *log something*, from anywhere. Opens a bottom sheet grouped into
  **Train** (guided workout, free-form strength, Zone 2, intervals, other activity) and
  **Check in** (morning / evening). If a workout or draft is in progress, ＋ resumes it.
- **Progress** — *is it working?* Split into three segments: **Training** (volume, strength
  trends, consistency heatmap), **Body** (bodyweight, waist, protein adherence) and **Recovery**
  (readiness breakdown, sleep, resting HR, training load and the correlation insights).
- **History** — *what did I do, and can I fix it?* A filterable timeline (All / Lifts / Cardio /
  Check-ins). Tapping any date opens a **day view** with everything from that day — sessions,
  both check-in halves and protein — each editable in place, plus quick-add buttons to backfill
  a forgotten session onto that date.

Setup (profile, targets, timer, exercise library, sync, exports) lives behind the **⚙ gear** in
the header. Editing flows return you to wherever you started them — fix a session from a day view
and you land back on that day view.

## Features

- **Daily readiness score** — a 0–100 home-screen tile averaging whatever recovery signals you've
  logged (sleep quality & duration, yesterday's alcohol and stress, waking energy, soreness, and
  resting HR vs. your 28-day baseline) into a plain-language call: *Primed / Good to go / Take it
  steady / Recovery day*, with the weakest signal called out. It appears once ≥2 signals exist,
  tap-through shows the full per-signal breakdown, and it's deliberately directional — an average
  of your own reports, not a medical score.
- **Consistency at a glance** — a GitHub-style **12-week training heatmap** on Progress (lift /
  cardio / both per day) and a **check-in streak** counter on the home card, because gap-spotting
  is the cheapest motivation there is.
- **Plan dashboard** — live progress toward the plan's weekly targets:
  - Zone 2 minutes (target ~120–150/wk), one interval session, each movement pattern hit ~2×.
  - **Hard-set volume per muscle** (a set counts when RIR ≤ 3), with a maintenance-floor marker
    (default 4 sets) and a growth target (default 10 sets).
  - **Minimum viable week** banner: 2 full-body lifts hitting squat/hinge/push/pull + ~75 min cardio.
  - **Progression queue** — exercises ready to move up, computed from your logs.
  - **Protein** target (g/kg × bodyweight) with a daily quick-logger (+10/20/30/40 g per meal, or
    set the day's total).
- **Progress charts** — a dedicated tab, split into **Training / Body / Recovery** segments, that
  turns your log into trends: per-lift **estimated 1RM** over time (line), **weekly training
  volume** and **weekly cardio minutes** (Zone 2 vs intervals) as bars, **bodyweight**, **waist**
  and **sleep-difficulty** trends, plus headline tiles for this week's volume, best e1RM, and week
  streak. Charts are hand-rolled SVG — no libraries, fully offline, and theme-aware.
- **Daily check-ins (recovery journal)** — split into two moments that share one daily record:
  a **🌅 morning** check-in for last night's sleep (**bed & wake times** with auto-computed
  duration, **sleep difficulty** 1 easy – 5 hard), the **morning weigh-in**, **resting heart
  rate**, an optional **waist** measurement, waking **energy**, **soreness**, **pain/niggle
  areas** (per-joint chips) — plus a **"drinks yesterday"** catch-up field that writes alcohol to
  the day it was actually consumed, since most people log it the next morning; and a **🌙 evening**
  check-in for **alcohol**, **caffeine**, rough **calories**, **stress**, **day flags**
  (sick / travel / rest), **pre-sleep activity** and notes. Each is one tap from the home screen
  (independent ✓ status) or the Log menu, editable from History, and surfaced as trends on
  Progress — so you can correlate recovery with how your training actually goes.
- **Exercise detail** — tap any lift (from Progress or a History session) to drill into its own
  page: estimated-1RM trend, working-weight trend, per-session volume, best-ever tiles, the next
  auto-progression target, and a full session-by-session log.
- **Recovery view (Fitbit-ready)** — Progress → Recovery, with the full readiness breakdown and sleep
  difficulty, **sleep duration** and **resting heart rate** charts (RHR annotated with your 28-day
  baseline), alcohol totals, plus a set of conservative, directional insights: **training load
  (acute:chronic workload ratio)** to flag load spikes and detraining dips, **sleep vs training**
  (volume after easy vs. hard sleep), **alcohol vs next-morning sleep**, **soreness after lifting
  vs. rest days**, and **protein adherence vs. bodyweight** over the last 4 weeks. Recovery reads
  through a source-agnostic layer (`js/recovery.js`): today it uses your self-reports (including
  bed/wake-derived sleep minutes and manual resting HR); when a **Fitbit** is connected later it
  will prefer measured sleep stages, resting heart rate and HRV — no view changes needed.
- **Data export** — a full **JSON** backup, plus three **CSV** exports built for analysis:
  **Training** (one row per set, with session ids, exercise units, `weight_kg`, planned reps and a
  completed flag), **Journal** (one row per day of recovery data, including derived sleep minutes,
  sleep score and device columns that fill in when a tracker is connected), and a **Daily summary**
  (one row per day joining recovery, training load, cardio minutes and protein — the day-grain
  merge where health correlations live). A gentle home-screen nudge reminds you to back up when
  it's been a month (quiet when cloud sync is on).
- **Guided workout (5×5-style)** — a "Start workout" flow that shows your exact **target weight**
  for every lift as simple **straight sets** (e.g. 5×5 at one weight), a **plate breakdown** per
  side, a warm-up ramp, and tap-to-complete **set circles** (tap again if you missed reps).
  Prefer ramping? A Setup toggle switches work sets to a **pyramid up to a top set**, following
  how proven programs ramp: fixed-rep strength lifts (5×5) climb in **Madcow-style 12.5% jumps**
  (≈50 / 62.5 / 75 / 87.5 / 100% of the top set), and wide-rep-range accessories use a **classic
  ascending pyramid** in ~10% jumps with reps sliding down the range (e.g. 12 → 10 → 8). When
  pyramiding, each set circle shows its own weight, adjusting the weight re-anchors the whole
  ramp, and the separate warm-up shrinks to the empty bar (the ramp does the warming up). A
  built-in **rest timer** auto-starts after each set with a beep/vibrate when it's up. You rate each lift's **difficulty** (Easy / Good / Hard / Failed) — the rating is
  also stored as an approximate per-set **RIR** so guided sessions keep an effort signal. Sessions
  record **start/finish timestamps** and every **planned set** (missed sets are kept as 0-rep rows),
  so compliance and time-of-day effects are analyzable later.
- **Editable history & day view** — any saved session can be **edited** (fix a typo'd weight,
  wrong duration) or deleted from History, and deletions offer a 6-second **Undo** (safe even if
  the deletion already synced — restores outlive their tombstone). Tapping a date opens a **day
  view** where everything from that day is fixable in one place: sessions, the morning and evening
  check-in halves, and **protein for any past date** — plus quick-add buttons to backfill a
  forgotten lift, cardio session or activity onto that day. Historical entries keep a snapshot of
  the exercise (name, muscles, pattern, unit) taken at save time, so renaming or re-tagging an
  exercise never rewrites past weeks' stats. Corrections don't touch your current progression
  targets.
- **Auto-progression & deload** — on success the next target goes up automatically (+5 lb upper,
  +10 lb lower; **double** if you tagged it Easy). Miss the reps and it holds; miss the same lift
  **3 sessions in a row and it deloads 10%**. Weights are in **lbs**, rounded to loadable plates.
  With pyramid sets on, progression moves the **top set** and the whole ramp re-anchors under it.
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
  (the app keeps working offline), auto-syncs on change, and merges **record-by-record** across
  devices (sessions & exercises by id, check-ins by day) so a morning check-in on your phone and a
  workout on a tablet both survive. Auth is a single secret token — no accounts, no OAuth. See
  **[Cloud sync setup](#cloud-sync-self-hosted)** below.
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

- **Local-first:** your device is the working copy; everything works offline. Changes auto-sync
  (debounced pull-merge-push) when connected, and the app syncs on connect.
- **Record-level merge:** every sync pulls the server copy and merges it field-by-field — sessions
  and exercises by id, check-ins / protein / device data by date — with the newer record winning
  each conflict. Session deletions carry a tombstone so they propagate instead of resurrecting.
  A brand-new install adopts the server copy wholesale, so connecting a second device **pulls**
  your data rather than overwriting it (and avoids duplicating the seed exercise library). The
  worst-case conflict (the *same* record edited on two devices between syncs) resolves to the
  newer edit; the JSON export is always there as a manual backup.
- **Token = password:** anyone with the URL and token can read/write your data. Keep it secret;
  rotate anytime with `wrangler secret put SYNC_TOKEN` and re-enter it in the app.
- Server URL, token, and connection state are stored only on your device, never sent to the server
  as part of your data.

## How the numbers work

- **Hard set** = a logged set with reps > 0 and RIR ≤ 3; each set credits every muscle the exercise targets.
- **Pattern coverage** = number of sessions in the week that included ≥1 hard set of that pattern.
- **Volume (tonnage)** = weight × reps summed over weighted sets only — timed (seconds) and
  bodyweight exercises are excluded so a plank never masquerades as pounds lifted.
- **Alcohol** is attributed to the day it was consumed (log it that evening, or via the morning
  check-in's "drinks yesterday" field), so drinks line up with the night's sleep they affected.
- **Guided-workout RIR** is derived from your difficulty rating (Easy→3, Good→2, Hard→1, Failed→0).
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
