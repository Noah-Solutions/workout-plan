// worker.js — Concurrent Trainer sync backend (Cloudflare Worker + KV).
//
// A deliberately tiny personal-use API: it stores ONE JSON document (your whole
// app state) behind a shared secret token. Two routes:
//   GET  /state  -> returns the stored JSON (or {} if none yet)
//   PUT  /state  -> replaces the stored JSON (body must be valid JSON)
// Both require:  Authorization: Bearer <SYNC_TOKEN>
//
// Bindings (see wrangler.toml / dashboard):
//   env.TRAINER_KV       — KV namespace for storage
//   env.SYNC_TOKEN       — secret token (set via `wrangler secret put SYNC_TOKEN`)
//   env.ALLOWED_ORIGINS  — (optional) comma-separated CORS allowlist; overrides the
//                          built-in default below.

const KEY = 'state';

// Browsers may only read responses from these origins. The bearer token is the
// primary lock; this CORS allowlist is defense-in-depth so a stolen token can't
// be used from another website in a victim's browser.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://noah-solutions.github.io', // your GitHub Pages app
  'http://localhost:8000',            // local dev (python -m http.server)
  'http://127.0.0.1:8000',
  'http://localhost:8787',            // wrangler dev
];

function allowedOrigins(env) {
  if (env && env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

// Build CORS headers for THIS request: only echo Allow-Origin when the caller's
// Origin is on the allowlist. Requests with no Origin (curl, server-to-server)
// get no Allow-Origin header and don't need one.
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') {
      return json({ ok: true, service: 'concurrent-trainer-sync' }, 200, cors);
    }
    if (url.pathname !== '/state') return json({ error: 'not found' }, 404, cors);

    // --- auth ---
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!env.SYNC_TOKEN) return json({ error: 'server missing SYNC_TOKEN' }, 500, cors);
    if (token !== env.SYNC_TOKEN) return json({ error: 'unauthorized' }, 401, cors);

    if (request.method === 'GET') {
      const data = await env.TRAINER_KV.get(KEY);
      return new Response(data || '{}', { headers: { 'Content-Type': 'application/json', ...cors } });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'invalid json' }, 400, cors); }
      await env.TRAINER_KV.put(KEY, body);
      return json({ ok: true, updatedAt: parsed.updatedAt || null }, 200, cors);
    }

    return json({ error: 'method not allowed' }, 405, cors);
  },
};
