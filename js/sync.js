// sync.js — two-way sync with a personal REST backend (Cloudflare Worker).
//
// Design: local-first. localStorage is the working copy; the server holds one
// JSON blob (the whole state). Every sync pulls the server copy, does a
// FIELD-LEVEL MERGE into local (per-session / per-day / per-exercise, newer
// record wins — see store.mergeRemote), then pushes the merged result back if
// it differs from the server. Auth is a single shared bearer token — no
// accounts, no OAuth. See server/ for the backend.
import { get, mergeRemote, getServerUrl, getToken, getConnected, setConnected } from './store.js';

let statusListeners = [];
export function onStatus(cb) { statusListeners.push(cb); }
function emit(status, detail) { statusListeners.forEach((f) => { try { f(status, detail); } catch (e) {} }); }

export function isConfigured() { return !!(getServerUrl() && getToken()); }
export function isConnected() { return getConnected(); }

function endpoint() { return getServerUrl().replace(/\/+$/, '') + '/state'; }

async function pull() {
  const res = await fetch(endpoint(), { headers: { Authorization: `Bearer ${getToken()}` } });
  if (res.status === 401) throw new Error('Unauthorized — check your token');
  if (!res.ok) throw new Error('Server error ' + res.status);
  return res.json();
}

async function push() {
  const res = await fetch(endpoint(), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(get()),
  });
  if (res.status === 401) throw new Error('Unauthorized — check your token');
  if (!res.ok) throw new Error('Server error ' + res.status);
  return res.json();
}

// Verify URL + token, mark connected, then do an initial sync.
export async function connect() {
  emit('working', 'Connecting…');
  try {
    await pull();                 // fails fast on bad URL / token
    setConnected(true);
    await syncNow();
    emit('connected');
    return true;
  } catch (e) {
    emit('error', e.message || String(e));
    throw e;
  }
}

export function disconnect() { setConnected(false); emit('disconnected'); }

// Two-way sync: pull, merge record-by-record, push the merged result back if
// it holds anything the server copy doesn't. Neither device's day is lost.
export async function syncNow() {
  if (!isConfigured()) throw new Error('not-configured');
  emit('working', 'Syncing…');
  try {
    const remote = await pull();
    const { changedLocal, pushNeeded } = mergeRemote(remote);
    if (pushNeeded) await push();
    const direction = pushNeeded && changedLocal ? 'merged'
      : pushNeeded ? 'pushed' : changedLocal ? 'pulled' : 'up-to-date';
    emit('synced', { direction, at: get().updatedAt });
    return direction;
  } catch (e) {
    emit('error', e.message || String(e));
    throw e;
  }
}

// Debounced auto-sync after local changes (only when connected). A full
// pull-merge-push (not a blind push) so we never clobber changes another
// device landed since our last sync.
let pushTimer = null;
export function scheduleAutoPush() {
  if (!getConnected() || !isConfigured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await syncNow(); } catch (e) { /* syncNow already emitted the error */ }
  }, 2000);
}
