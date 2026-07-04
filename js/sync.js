// sync.js — Google sign-in + two-way sync with a Google Sheet (serverless).
//
// Design: local-first. localStorage is the working copy; the Sheet is the
// sync/backup layer. Conflict resolution is last-write-wins by `updatedAt`.
// Requires the user's own OAuth Client ID (see README) — no client secret is
// used or stored (browser token flow via Google Identity Services).
import { get, applyRemote, getClientId, setConnected, getConnected } from './store.js';

const SHEET_NAME = 'Concurrent Trainer Data';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const TABS = ['Sessions', 'Exercises', 'ProteinLog', 'Meta'];
const SPREADSHEET_ID_KEY = 'ct_google_sheetid';
const SCHEMA = 1;

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let statusListeners = [];

// ---------- status plumbing ----------
export function onStatus(cb) { statusListeners.push(cb); }
function emit(status, detail) { statusListeners.forEach((f) => { try { f(status, detail); } catch (e) {} }); }

export function isSignedIn() { return !!accessToken && Date.now() < tokenExpiry; }
export function isConfigured() { return !!getClientId(); }
export function gisReady() { return !!(window.google && window.google.accounts && window.google.accounts.oauth2); }
export function sheetId() { return localStorage.getItem(SPREADSHEET_ID_KEY) || ''; }
export function sheetUrl() { const id = sheetId(); return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : ''; }

// ---------- pure serialize / deserialize (unit-testable) ----------
// Each data row carries human-readable columns PLUS an authoritative JSON column
// (last column). Import parses the JSON column, so the sheet round-trips exactly
// even if a human edits the readable columns.
export function serializeState(state) {
  const kindLabel = (s) => s.kind === 'strength' ? 'Strength'
    : s.kind === 'cardio' ? (s.cardioType === 'interval' ? 'Intervals' : 'Zone 2')
    : (s.activity || 'Activity');
  const sessSummary = (s) => {
    if (s.kind === 'strength') { const n = (s.entries || []).reduce((a, e) => a + (e.sets ? e.sets.length : 0), 0); return `${n} sets`; }
    return `${s.durationMin || 0} min${s.avgHR ? `, ${s.avgHR} bpm` : ''}`;
  };
  const sessions = [['Date', 'Type', 'Summary', 'Data (do not edit)']]
    .concat((state.sessions || []).map((s) => [s.date || '', kindLabel(s), sessSummary(s), JSON.stringify(s)]));

  const exercises = [['Name', 'Pattern', 'Muscles', 'Reps', 'RIR', 'Weight', 'Data (do not edit)']]
    .concat((state.exercises || []).map((e) => [
      e.name || '', e.pattern || '', (e.muscles || []).join(', '),
      `${e.repRange ? e.repRange[0] : ''}-${e.repRange ? e.repRange[1] : ''}`,
      e.targetRIR ?? '', e.lastWeight ?? '', JSON.stringify(e),
    ]));

  const proteinLog = [['Date', 'Protein (g)']]
    .concat(Object.keys(state.proteinLog || {}).sort().map((d) => [d, state.proteinLog[d]]));

  const meta = [
    ['Key', 'Value'],
    ['schemaVersion', String(SCHEMA)],
    ['updatedAt', state.updatedAt || ''],
    ['rev', String(state.rev || 0)],
    ['settings', JSON.stringify(state.settings || {})],
  ];

  return { Sessions: sessions, Exercises: exercises, ProteinLog: proteinLog, Meta: meta };
}

export function deserializeState(tabs) {
  const parseJsonCol = (rows) => (rows || []).slice(1).map((r) => {
    try { return JSON.parse(r[r.length - 1]); } catch (e) { return null; }
  }).filter(Boolean);

  const sessions = parseJsonCol(tabs.Sessions);
  const exercises = parseJsonCol(tabs.Exercises);

  const proteinLog = {};
  (tabs.ProteinLog || []).slice(1).forEach((r) => {
    if (r[0]) proteinLog[r[0]] = Number(r[1]) || 0;
  });

  const metaMap = {};
  (tabs.Meta || []).slice(1).forEach((r) => { if (r[0]) metaMap[r[0]] = r[1]; });
  let settings = null;
  try { settings = metaMap.settings ? JSON.parse(metaMap.settings) : null; } catch (e) { settings = null; }

  return {
    sessions, exercises, proteinLog, settings,
    updatedAt: metaMap.updatedAt || '',
    rev: metaMap.rev != null ? Number(metaMap.rev) : 0,
    schemaVersion: metaMap.schemaVersion != null ? Number(metaMap.schemaVersion) : 0,
  };
}

// ---------- auth ----------
export function initClient() {
  if (!gisReady()) return false;
  const clientId = getClientId();
  if (!clientId) return false;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {}, // set per-request
  });
  return true;
}

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    if (!tokenClient && !initClient()) { reject(new Error('not-configured')); return; }
    tokenClient.callback = (resp) => {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        setConnected(true);
        resolve(accessToken);
      } else {
        reject(new Error(resp && resp.error ? resp.error : 'no-token'));
      }
    };
    try { tokenClient.requestAccessToken({ prompt }); }
    catch (e) { reject(e); }
  });
}

async function ensureToken() {
  if (isSignedIn()) return accessToken;
  // silent attempt first (no consent popup), then interactive
  try { return await requestToken(''); }
  catch (e) { return await requestToken('consent'); }
}

export async function signIn() {
  emit('working', 'Signing in…');
  await requestToken('consent');
  emit('signed-in');
  await syncNow();
  return true;
}

export function signOut() {
  if (accessToken && gisReady()) {
    try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) {}
  }
  accessToken = null; tokenExpiry = 0; setConnected(false);
  emit('signed-out');
}

// Try to silently restore a session if the user was previously connected.
export async function tryResume() {
  if (!getConnected() || !isConfigured() || !gisReady()) return false;
  try { await requestToken(''); emit('signed-in'); return true; }
  catch (e) { return false; }
}

// ---------- Google API helpers ----------
async function api(url, opts = {}) {
  const token = await ensureToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) { // token died mid-flight — refresh once
    accessToken = null; tokenExpiry = 0;
    const t2 = await ensureToken();
    const res2 = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (!res2.ok) throw new Error(`API ${res2.status}: ${await res2.text()}`);
    return res2.json();
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findOrCreateSheet() {
  const existing = sheetId();
  if (existing) return existing;
  // find an app-created spreadsheet with our name (works across devices via drive.file)
  const q = encodeURIComponent(`name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`);
  if (found.files && found.files.length) {
    localStorage.setItem(SPREADSHEET_ID_KEY, found.files[0].id);
    return found.files[0].id;
  }
  // create with our tabs
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SHEET_NAME },
      sheets: TABS.map((t) => ({ properties: { title: t } })),
    }),
  });
  localStorage.setItem(SPREADSHEET_ID_KEY, created.spreadsheetId);
  return created.spreadsheetId;
}

async function ensureTabs(id) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
  const have = new Set((meta.sheets || []).map((s) => s.properties.title));
  const missing = TABS.filter((t) => !have.has(t));
  if (missing.length) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: missing.map((t) => ({ addSheet: { properties: { title: t } } })) }),
    });
  }
}

async function writeTab(id, tab, values) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tab}!A1:ZZ100000:clear`, { method: 'POST', body: '{}' });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tab}!A1?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values }),
  });
}

async function readTab(id, tab) {
  const r = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tab}!A1:ZZ100000`);
  return r.values || [];
}

// ---------- push / pull / sync ----------
async function push(id) {
  const payload = serializeState(get());
  for (const tab of TABS) await writeTab(id, tab, payload[tab]);
}

async function pullRemote(id) {
  const tabs = {};
  for (const tab of TABS) tabs[tab] = await readTab(id, tab);
  return deserializeState(tabs);
}

// Two-way sync: whichever side has the newer updatedAt wins.
export async function syncNow() {
  if (!isConfigured()) throw new Error('not-configured');
  emit('working', 'Syncing…');
  try {
    const id = await findOrCreateSheet();
    await ensureTabs(id);
    const remote = await pullRemote(id);
    const local = get();
    const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
    const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;
    const remoteEmpty = (!remote.sessions.length && !remote.exercises.length && !remote.updatedAt);

    if (!remoteEmpty && remoteTime > localTime) {
      applyRemote(remote);         // remote is newer -> adopt it locally
      emit('synced', { direction: 'pulled', at: remote.updatedAt });
      return 'pulled';
    }
    await push(id);                // local is newer (or remote empty) -> push up
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
    if (!isSignedIn() && !(await tryResume())) return;
    try {
      const id = await findOrCreateSheet();
      await ensureTabs(id);
      await push(id);
      emit('synced', { direction: 'pushed', at: get().updatedAt });
    } catch (e) { emit('error', e.message || String(e)); }
  }, 2500);
}
