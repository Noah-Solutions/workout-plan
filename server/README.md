# Concurrent Trainer — sync backend (Cloudflare Workers + KV)

A minimal personal-use sync server. It stores **one JSON document** (your whole app state) in
Cloudflare KV, behind a **shared secret token**. Free tier, always-on, no credit card.

```
GET  /state   -> stored JSON (or {})      Authorization: Bearer <SYNC_TOKEN>
PUT  /state   -> replace stored JSON       Authorization: Bearer <SYNC_TOKEN>
```

## Deploy (~5 min, one time)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node installed.

```bash
cd server

# 1. Install the Cloudflare CLI (or use `npx wrangler ...` for each command below)
npm install -g wrangler

# 2. Log in (opens a browser)
wrangler login

# 3. Create the KV namespace, then paste the printed id into wrangler.toml
#    (replace REPLACE_WITH_YOUR_KV_ID)
wrangler kv namespace create TRAINER_KV

# 4. Set your secret token — make it long and random, e.g.:
#    openssl rand -hex 24
#    Paste it when prompted. KEEP A COPY — you enter the same value in the app.
wrangler secret put SYNC_TOKEN

# 5. Deploy
wrangler deploy
```

`wrangler deploy` prints your URL, e.g. `https://trainer-sync.<your-subdomain>.workers.dev`.

## Connect the app

In the app: **Setup → ☁ Cloud sync**

- **Server URL:** the `https://trainer-sync.<your-subdomain>.workers.dev` from step 5
- **Secret token:** the exact value you set in step 4

Tap **Connect**. The app pulls on connect and auto-pushes (debounced) on every change.

## Notes

- **One user only.** A single token guards read+write. Anyone with the token and URL can read/write
  your data, so treat the token like a password. Rotate it anytime with `wrangler secret put SYNC_TOKEN`
  (then update it in the app).
- **Last-write-wins.** The server just stores the latest blob; the app decides push vs pull by
  comparing timestamps. Editing on two devices simultaneously can overwrite one side.
- **CORS is open (`*`)** because access is token-gated and uses no cookies. Fine for personal use.
- **Free limits** are far beyond one person: KV free tier is ~100k reads + 1k writes/day.
- **Local test:** `wrangler dev` runs it at `http://localhost:8787` (use that URL + your token in the
  app while testing locally).
