// store.js — persistent state, defaults, and seed library
const KEY = 'ct_state_v1';

export const MUSCLES = ['Quads', 'Hamstrings', 'Glutes', 'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core'];
export const PATTERNS = ['squat', 'hinge', 'push', 'pull'];
export const PATTERN_LABEL = { squat: 'Squat', hinge: 'Hinge', push: 'Push', pull: 'Pull', core: 'Core', other: 'Other' };

let uidCounter = 0;
export function uid() {
  // deterministic-ish unique id without Math.random / Date.now dependency issues
  uidCounter += 1;
  return 'id' + Date.now().toString(36) + '_' + uidCounter.toString(36);
}

// Seed exercises are built from the plan's Option A / Option B lifts.
function seedExercises() {
  const e = (name, pattern, muscles, repRange, targetRIR, lastWeight, unit) => ({
    id: uid(), name, pattern, muscles, type: 'strength',
    repRange, targetRIR, lastWeight, unit: unit || 'lb', custom: false, archived: false,
  });
  return [
    e('Back Squat', 'squat', ['Quads', 'Glutes'], [5, 5], 2, 115, 'lb'),
    e('Bench Press', 'push', ['Chest', 'Triceps', 'Shoulders'], [5, 8], 2, 95, 'lb'),
    e('Barbell Row', 'pull', ['Back', 'Biceps'], [8, 8], 2, 90, 'lb'),
    e('Romanian Deadlift', 'hinge', ['Hamstrings', 'Glutes'], [5, 8], 2, 155, 'lb'),
    e('Overhead Press', 'push', ['Shoulders', 'Triceps'], [5, 8], 2, 75, 'lb'),
    e('Pull-up', 'pull', ['Back', 'Biceps'], [6, 10], 1, 0, 'bw'),
    e('Barbell Curl', 'pull', ['Biceps'], [8, 12], 1, 45, 'lb'),
    e('Triceps Pushdown', 'push', ['Triceps'], [10, 15], 1, 30, 'lb'),
    e('Leg Curl', 'hinge', ['Hamstrings'], [10, 15], 1, 50, 'lb'),
    e('Plank', 'core', ['Core'], [30, 60], 2, 0, 'sec'),
    e('Goblet Squat', 'squat', ['Quads', 'Glutes'], [8, 12], 2, 50, 'lb'),
    e('Lat Pulldown', 'pull', ['Back', 'Biceps'], [8, 12], 1, 90, 'lb'),
  ];
}

function nowISO() { return new Date().toISOString(); }

function defaults() {
  return {
    version: 1,
    rev: 0,                 // bumped on every local mutation
    updatedAt: '',          // empty = never modified locally, so a fresh install never
                            // wins last-write-wins over real server data on first connect.
                            // Set to now on the first real mutation (see update()).
    settings: {
      bodyweightKg: 80,
      units: 'lb',
      proteinPerKg: 1.6,
      maxHR: 190,
      targets: {
        setsPerMuscle: 10,     // growth target per muscle / week
        maintenanceSets: 4,    // maintenance floor
        zone2MinWeek: 135,     // midpoint of 120-150
        intervalSessionsWeek: 1,
        patternTimesPerWeek: 2,
      },
    },
    exercises: seedExercises(),
    sessions: [],           // logged workouts
    proteinLog: {},         // 'YYYY-MM-DD' -> grams
  };
}

let state = null;

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = JSON.parse(raw);
      // light migration / backfill
      const d = defaults();
      state.settings = Object.assign({}, d.settings, state.settings);
      state.settings.targets = Object.assign({}, d.settings.targets, state.settings.targets || {});
      state.proteinLog = state.proteinLog || {};
      state.exercises = state.exercises || d.exercises;
      state.sessions = state.sessions || [];
      if (state.rev == null) state.rev = 0;
      // Backfill ONLY for pre-schema states missing the key entirely (they have real
      // data -> treat as current). A present-but-empty '' means a fresh, unmodified
      // install and must stay empty so it loses last-write-wins to server data.
      if (state.updatedAt === undefined) state.updatedAt = nowISO();
    } else {
      state = defaults();
      save(true);
    }
  } catch (err) {
    console.error('Failed to load state, resetting', err);
    state = defaults();
  }
  return state;
}

// change listeners (used by the cloud-sync layer to auto-push)
const listeners = [];
export function onChange(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; }
function notify() { listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

export function save(silent) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Save failed', err);
  }
  if (!silent) notify();
}

export function get() { return state || load(); }

// A user mutation: bumps revision + timestamp, then notifies (triggers auto-push).
export function update(fn) {
  const s = get();
  fn(s);
  s.rev = (s.rev || 0) + 1;
  s.updatedAt = nowISO();
  save();
  return s;
}

// Adopt remote state pulled from the cloud. Does NOT bump rev and does NOT
// notify listeners, so pulling never triggers a push-back loop.
export function applyRemote(remote) {
  const s = get();
  if (Array.isArray(remote.sessions)) s.sessions = remote.sessions;
  if (Array.isArray(remote.exercises)) s.exercises = remote.exercises;
  if (remote.proteinLog && typeof remote.proteinLog === 'object') s.proteinLog = remote.proteinLog;
  if (remote.settings && typeof remote.settings === 'object') {
    const d = defaults();
    s.settings = Object.assign({}, d.settings, remote.settings);
    s.settings.targets = Object.assign({}, d.settings.targets, remote.settings.targets || {});
  }
  if (remote.updatedAt) s.updatedAt = remote.updatedAt;
  if (remote.rev != null) s.rev = remote.rev;
  save(true);
}

// Sync server config + connection flag live OUTSIDE synced state (never pushed to the server).
const UKEY = 'ct_server_url';
const TKEY = 'ct_sync_token';
const CKEY = 'ct_sync_connected';
export function getServerUrl() { return localStorage.getItem(UKEY) || ''; }
export function setServerUrl(v) { localStorage.setItem(UKEY, (v || '').trim()); }
export function getToken() { return localStorage.getItem(TKEY) || ''; }
export function setToken(v) { localStorage.setItem(TKEY, (v || '').trim()); }
export function getConnected() { return localStorage.getItem(CKEY) === '1'; }
export function setConnected(v) { localStorage.setItem(CKEY, v ? '1' : '0'); }

export function exportJSON() {
  return JSON.stringify(get(), null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
    throw new Error('Not a valid backup file');
  }
  state = parsed;
  const d = defaults();
  state.settings = Object.assign({}, d.settings, state.settings);
  state.settings.targets = Object.assign({}, d.settings.targets, state.settings.targets || {});
  state.proteinLog = state.proteinLog || {};
  save();
  return state;
}

export function resetAll() {
  state = defaults();
  save();
  return state;
}

export function exerciseById(id) {
  return get().exercises.find((x) => x.id === id);
}
