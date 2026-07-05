// sync.js — two-way sync with a personal REST backend (Cloudflare Worker).
//
// Design: local-first. localStorage is the working copy; the server holds one
// JSON blob (the whole state). Conflict resolution is last-write-wins by the
// `updatedAt` timestamp. Auth is a single shared bearer token — no accounts,
// no OAuth. See server/ for the backend.
import { get, applyRemote, getServerUrl, getToken, getConnected, setConnected } from './store.js';

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

// Two-way sync: whichever side has the newer updatedAt wins the whole dataset.
export async function syncNow() {
  if (!isConfigured()) throw new Error('not-configured');
  emit('working', 'Syncing…');
  try {
    const remote = await pull();
    const local = get();
    const remoteTime = remote && remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
    const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;

    if (remoteTime > localTime) {
      applyRemote(remote);        // remote newer -> adopt locally (no push-back)
      emit('synced', { direction: 'pulled', at: remote.updatedAt });
      return 'pulled';
    }
    await push();                 // local newer (or server empty) -> push up
    emit('synced', { direction: 'pushed', at: local.updatedAt });
    return 'pushed';
  } catch (e) {
    emit('error', e.message || String(e));
    throw e;
  }
}

// Debounced auto-push after local changes (only when connected).
let pushTimer = null;
export function scheduleAutoPush() {
  if (!getConnected() || !isConfigured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await push(); emit('synced', { direction: 'pushed', at: get().updatedAt }); }
    catch (e) { emit('error', e.message || String(e)); }
  }, 2000);
}
