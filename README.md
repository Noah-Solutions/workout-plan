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
- **Cloud sync (optional)** — sign in with Google and back up/sync everything through a Google
  Sheet you own. Local-first (the app keeps working offline), auto-syncs on change, last-write-wins
  across devices. Serverless — no backend, no client secret; you use your own OAuth Client ID.
  See **[Cloud sync setup](#cloud-sync-google-sheets)** below.
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

## Cloud sync (Google Sheets)

Sync is **optional** and **serverless**: the app talks to the Google Sheets API directly from your
browser using Google Identity Services. There's no backend and no client secret — but because of
that, **you provide your own OAuth Client ID** (one-time, free). Your data lives in a spreadsheet in
*your* Google Drive that only this app can touch (`drive.file` scope).

### One-time Google setup (~10 min)

1. **Create a project** — go to [console.cloud.google.com](https://console.cloud.google.com/),
   click the project dropdown → **New Project** → name it (e.g. *Concurrent Trainer*) → **Create**.
2. **Enable the APIs** — **APIs & Services → Library**, then enable both:
   - **Google Sheets API**
   - **Google Drive API**
3. **OAuth consent screen** — **APIs & Services → OAuth consent screen**:
   - User type **External** → Create.
   - Fill app name + your email where required.
   - **Test users → Add users →** add your own Google address. (Keeping it in "Testing" is fine for
     personal use — you'll just click through an "unverified app" notice once.)
4. **Create the Client ID** — **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins → Add URI** — add the *origin* the app is served from
     (scheme + host, **no path**):
     - `https://noah-solutions.github.io` (your GitHub Pages origin)
     - `http://localhost:8000` (optional, for local testing)
   - No redirect URIs are needed (the token flow uses `postmessage`).
   - **Create**, then copy the **Client ID** (looks like `…-xxxx.apps.googleusercontent.com`).

### In the app

1. Open **Setup → ☁ Cloud sync**, paste the **Client ID**, tap **Save Client ID**.
2. Tap **Sign in with Google**, choose your account, and approve. (First time: if you see
   "Google hasn't verified this app," click **Advanced → Continue** — it's your own project.)
3. The app finds-or-creates a **"Concurrent Trainer Data"** spreadsheet in your Drive and syncs.
   Use **Sync now** anytime, or **Open Sheet ↗** to view/edit your data as a spreadsheet.

### How sync behaves

- **Local-first:** your device is the working copy; everything works offline. Changes auto-push
  (debounced) when you're connected, and the app pulls on sign-in.
- **Last-write-wins:** whichever side has the newer timestamp wins the whole dataset. Simple and
  predictable; editing on two devices at the exact same time can overwrite one side. Fine for
  one-phone use — the JSON export is always there as a manual backup.
- **The sheet is human-readable:** each row has readable columns plus a `Data (do not edit)` JSON
  column that the app reads back, so it round-trips exactly even if you eyeball or tweak the sheet.
- The Client ID and connection state are stored only on your device, never written to the sheet.

> Access tokens are short-lived (~1 hour); the app refreshes them silently while your Google session
> is active, and re-prompts if needed. Nothing sensitive is stored in the app.

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
js/sync.js            Google sign-in + two-way Google Sheets sync (serverless)
js/app.js             UI, router, all views & event handling
manifest.webmanifest  PWA manifest
sw.js                 offline service worker
icons/                app icons
```

This is general fitness tooling, not medical advice.
