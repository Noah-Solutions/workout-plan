// worker.js — Concurrent Trainer sync backend (Cloudflare Worker + KV).
//
// A deliberately tiny personal-use API: it stores ONE JSON document (your whole
// app state) behind a shared secret token. Two routes:
//   GET  /state  -> returns the stored JSON (or {} if none yet)
//   PUT  /state  -> replaces the stored JSON (body must be valid JSON)
// Both require:  Authorization: Bearer <SYNC_TOKEN>
//
// Bindings (see wrangler.toml / dashboard):
//   env.TRAINER_KV  — KV namespace for storage
//   env.SYNC_TOKEN  — secret token (set via `wrangler secret put SYNC_TOKEN`)

const KEY = 'state';

const CORS = {
  'Access-Control-Allow-Origin': '*', // token-gated, no cookies -> '*' is fine for personal use
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') {
      return json({ ok: true, service: 'concurrent-trainer-sync' });
    }
    if (url.pathname !== '/state') return json({ error: 'not found' }, 404);

    // --- auth ---
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!env.SYNC_TOKEN) return json({ error: 'server missing SYNC_TOKEN' }, 500);
    if (token !== env.SYNC_TOKEN) return json({ error: 'unauthorized' }, 401);

    if (request.method === 'GET') {
      const data = await env.TRAINER_KV.get(KEY);
      return new Response(data || '{}', { headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'invalid json' }, 400); }
      await env.TRAINER_KV.put(KEY, body);
      return json({ ok: true, updatedAt: parsed.updatedAt || null });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
