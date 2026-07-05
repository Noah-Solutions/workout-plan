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
// workSets/reps + increment/targetWeight/failStreak drive the guided (StrongLifts-style)
// workout flow: show target weight, tick sets, auto-progress or deload.
function seedExercises() {
  const e = (name, pattern, muscles, repRange, targetRIR, weight, unit, workSets, increment) => ({
    id: uid(), name, pattern, muscles, type: 'strength',
    repRange, targetRIR, unit: unit || 'lb',
    lastWeight: weight,          // last weight actually used
    targetWeight: weight,        // weight to lift NEXT session (what the guided screen shows)
    bestWeight: weight,          // best (heaviest) successful weight -> PR detection
    workSets: workSets || 3,     // number of work sets
    increment: increment == null ? (pattern === 'squat' || pattern === 'hinge' ? 10 : 5) : increment,
    failStreak: 0,               // consecutive failed sessions -> deload at 3
    custom: false, archived: false,
  });
  return [
    e('Back Squat', 'squat', ['Quads', 'Glutes'], [5, 5], 2, 115, 'lb', 5, 10),
    e('Bench Press', 'push', ['Chest', 'Triceps', 'Shoulders'], [5, 5], 2, 105, 'lb', 5, 5),
    e('Barbell Row', 'pull', ['Back', 'Biceps'], [5, 5], 2, 95, 'lb', 5, 5),
    e('Romanian Deadlift', 'hinge', ['Hamstrings', 'Glutes'], [5, 5], 2, 165, 'lb', 5, 10),
    e('Overhead Press', 'push', ['Shoulders', 'Triceps'], [5, 5], 2, 80, 'lb', 5, 5),
    e('Deadlift', 'hinge', ['Hamstrings', 'Glutes', 'Back'], [5, 5], 2, 185, 'lb', 1, 10),
    e('Pull-up', 'pull', ['Back', 'Biceps'], [6, 10], 1, 0, 'bw', 3, 0),
    e('Barbell Curl', 'pull', ['Biceps'], [8, 12], 1, 30, 'lb', 3, 5),
    e('Triceps Pushdown', 'push', ['Triceps'], [10, 15], 1, 30, 'lb', 3, 5),
    e('Leg Curl', 'hinge', ['Hamstrings'], [10, 15], 1, 50, 'lb', 3, 5),
    e('Plank', 'core', ['Core'], [30, 60], 2, 0, 'sec', 3, 5),
    e('Goblet Squat', 'squat', ['Quads', 'Glutes'], [8, 12], 2, 50, 'lb', 3, 5),
    e('Lat Pulldown', 'pull', ['Back', 'Biceps'], [8, 12], 1, 90, 'lb', 3, 5),
  ];
}

function nowISO() { return new Date().toISOString(); }

// One-time seed-weight recalibration: the original defaults didn't match the
// user's actual working weights. Maps exercise name -> [old seed, new seed];
// applied in load() only to lifts that were never logged and still sit at the
// old default, so it can never overwrite real training progress.
const SEED_RECAL = {
  'Bench Press': [95, 105],
  'Barbell Row': [90, 95],
  'Romanian Deadlift': [155, 165],
  'Overhead Press': [75, 80],
  'Barbell Curl': [45, 30],
};

function recalibrateSeedWeights(s) {
  if (s.seedRecalV2) return false;
  s.seedRecalV2 = true;
  const logged = new Set();
  (s.sessions || []).forEach((sess) => (sess.entries || []).forEach((en) => logged.add(en.exerciseId)));
  let changed = false;
  (s.exercises || []).forEach((ex) => {
    const r = SEED_RECAL[ex.name];
    if (!r || ex.custom || logged.has(ex.id)) return;
    const [oldW, newW] = r;
    if (ex.targetWeight !== oldW || ex.lastWeight !== oldW) return; // user already adjusted it
    ex.targetWeight = ex.lastWeight = newW;
    ex.bestWeight = newW; // old best was just the seed, never actually lifted
    ex._u = nowISO();     // per-record stamp so the bump propagates via merge sync
    changed = true;
  });
  return changed;
}

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
      barWeightLb: 45,                       // Olympic barbell
      platesLb: [45, 35, 25, 10, 5, 2.5],    // plates available per side (lbs)
      pyramidWorkSets: false,                // false = straight sets (5x5-style); true = ramp to a top set
      restTimer: { enabled: true, seconds: 90, sound: true, vibrate: true },
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
    // daily recovery check-in. 'YYYY-MM-DD' -> {
    //   bw (bodyweight, kg), bedTime/wakeTime ('HH:MM'), sleepMin (derived),
    //   sleepDiff (1-5, 1=easy 5=hard), rhr (resting HR, bpm), waist (cm),
    //   drinks (alcohol count, attributed to the day consumed), caffeine (drinks),
    //   kcal (rough calories), energy/soreness/stress (1-5), pain (array of body
    //   areas), flags (array: sick/travel/rest), preSleep/amNote/notes (text),
    //   _u (per-record updatedAt for merge sync) }
    journal: {},
    // tombstones for deleted sessions: id -> ISO time of deletion. Lets a
    // deletion win over the same session arriving from another device.
    deleted: {},
    // device-measured recovery (future Fitbit sync). 'YYYY-MM-DD' -> {
    //   sleepMinutes, sleepScore (0-100), restingHR, hrv, ... }. Empty until a
    //   sync layer populates it; recovery.js already prefers it over self-reports.
    fitbit: {},
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
      state.settings.restTimer = Object.assign({}, d.settings.restTimer, state.settings.restTimer || {});
      if (!state.settings.platesLb) state.settings.platesLb = d.settings.platesLb;
      if (state.settings.barWeightLb == null) state.settings.barWeightLb = d.settings.barWeightLb;
      state.proteinLog = state.proteinLog || {};
      state.journal = state.journal || {};
      state.fitbit = state.fitbit || {};
      state.deleted = state.deleted || {};
      state.exercises = state.exercises || d.exercises;
      state.sessions = state.sessions || [];
      // backfill new per-exercise guided-workout fields
      (state.exercises || []).forEach((ex) => {
        if (ex.targetWeight == null) ex.targetWeight = ex.lastWeight || 0;
        if (ex.bestWeight == null) ex.bestWeight = ex.lastWeight || 0;
        if (ex.workSets == null) ex.workSets = ex.pattern === 'core' ? 3 : 3;
        if (ex.increment == null) ex.increment = (ex.pattern === 'squat' || ex.pattern === 'hinge') ? 10 : 5;
        if (ex.failStreak == null) ex.failStreak = 0;
      });
      if (state.rev == null) state.rev = 0;
      // Backfill ONLY for pre-schema states missing the key entirely (they have real
      // data -> treat as current). A present-but-empty '' means a fresh, unmodified
      // install and must stay empty so it loses last-write-wins to server data.
      if (state.updatedAt === undefined) state.updatedAt = nowISO();
      if (recalibrateSeedWeights(state) && state.updatedAt) {
        // count as a real local change so the new targets sync out; skipped on a
        // never-modified install, which must keep losing last-write-wins.
        state.rev = (state.rev || 0) + 1;
        state.updatedAt = nowISO();
      }
      save(true);
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

// save-failure listeners — persisting to localStorage can fail (quota); the UI
// must tell the user instead of silently dropping their logs.
const saveErrListeners = [];
export function onSaveError(cb) { saveErrListeners.push(cb); }

export function save(silent) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Save failed', err);
    saveErrListeners.forEach((f) => { try { f(err); } catch (e) {} });
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

// Adopt remote state wholesale (fresh installs only). Does NOT notify
// listeners, so pulling never triggers a push-back loop.
function adoptRemote(remote) {
  const s = get();
  if (Array.isArray(remote.sessions)) s.sessions = remote.sessions;
  if (Array.isArray(remote.exercises)) s.exercises = remote.exercises;
  if (remote.proteinLog && typeof remote.proteinLog === 'object') s.proteinLog = remote.proteinLog;
  if (remote.journal && typeof remote.journal === 'object') s.journal = remote.journal;
  if (remote.fitbit && typeof remote.fitbit === 'object') s.fitbit = remote.fitbit;
  if (remote.deleted && typeof remote.deleted === 'object') s.deleted = remote.deleted;
  if (remote.settings && typeof remote.settings === 'object') {
    const d = defaults();
    s.settings = Object.assign({}, d.settings, remote.settings);
    s.settings.targets = Object.assign({}, d.settings.targets, remote.settings.targets || {});
  }
  if (remote.updatedAt) s.updatedAt = remote.updatedAt;
  if (remote.rev != null) s.rev = remote.rev;
  save(true);
}

function ts(v) { return v ? (Date.parse(v) || 0) : 0; }
function sameJSON(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Field-level merge of a pulled remote state into local state, so two devices
// logging on the same day no longer clobber each other (the old model was
// whole-state last-write-wins). Sessions & exercises merge by id, journal /
// proteinLog / fitbit by date; the newer per-record stamp wins (sessions use
// `updatedAt`, exercises & journal entries `_u`), falling back to whichever
// side's overall updatedAt is newer. Session deletions propagate via the
// `deleted` tombstone map. Saves silently (no auto-push loop) and returns
// { changedLocal, pushNeeded } so the sync layer can push the merged result.
export function mergeRemote(remote) {
  const s = get();
  if (!remote || typeof remote !== 'object' || !remote.updatedAt) {
    return { changedLocal: false, pushNeeded: !!s.updatedAt }; // empty server -> just push
  }
  // A never-modified fresh install adopts the server wholesale — merging would
  // duplicate the seed exercise library under freshly generated ids.
  if (!s.updatedAt) { adoptRemote(remote); return { changedLocal: true, pushNeeded: false }; }

  const remoteNewer = ts(remote.updatedAt) > ts(s.updatedAt);
  let changedLocal = false; // merged result differs from what we had
  let pushNeeded = false;   // merged result differs from the server copy

  // tombstones: union
  const del = Object.assign({}, remote.deleted || {}, s.deleted || {});
  if (!sameJSON(del, s.deleted || {})) changedLocal = true;
  if (!sameJSON(del, remote.deleted || {})) pushNeeded = true;
  s.deleted = del;

  // merge two arrays of {id,...} records; newer per-record `stamp` wins
  const mergeById = (localArr, remoteArr, stamp) => {
    const out = new Map();
    (remoteArr || []).forEach((r) => { if (r && r.id) { out.set(r.id, r); } });
    const localIds = new Set();
    (localArr || []).forEach((l) => {
      if (!l || !l.id) return;
      localIds.add(l.id);
      const r = out.get(l.id);
      if (!r) { out.set(l.id, l); pushNeeded = true; return; }
      if (sameJSON(l, r)) return;
      const lt = ts(l[stamp]), rt = ts(r[stamp]);
      const useLocal = lt === rt ? !remoteNewer : lt > rt;
      if (useLocal) { out.set(l.id, l); pushNeeded = true; } else { changedLocal = true; }
    });
    (remoteArr || []).forEach((r) => { if (r && r.id && !localIds.has(r.id)) changedLocal = true; });
    return [...out.values()];
  };

  // A tombstone only kills a session that hasn't been touched SINCE the
  // deletion — so an undo (which bumps updatedAt past the tombstone) survives
  // even when the deletion already reached the server.
  s.sessions = mergeById(s.sessions, remote.sessions, 'updatedAt')
    .filter((x) => !(del[x.id] && ts(del[x.id]) >= ts(x.updatedAt)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1
      : (a.startedAt || a.loggedAt || '') < (b.startedAt || b.loggedAt || '') ? -1 : 1));
  s.exercises = mergeById(s.exercises, remote.exercises, '_u');

  // merge date-keyed maps; `stampKey` null -> conflicts fall back to overall-newer side
  const mergeByDate = (localMap, remoteMap, stampKey, preferRemoteOnConflict) => {
    const l = localMap || {}, r = remoteMap || {};
    const out = {};
    new Set([...Object.keys(l), ...Object.keys(r)]).forEach((d) => {
      if (l[d] == null) { out[d] = r[d]; changedLocal = true; return; }
      if (r[d] == null) { out[d] = l[d]; pushNeeded = true; return; }
      if (sameJSON(l[d], r[d])) { out[d] = l[d]; return; }
      let useLocal;
      if (preferRemoteOnConflict) useLocal = false;
      else if (stampKey) {
        const lt = ts(l[d][stampKey]), rt = ts(r[d][stampKey]);
        useLocal = lt === rt ? !remoteNewer : lt > rt;
      } else useLocal = !remoteNewer;
      out[d] = useLocal ? l[d] : r[d];
      if (useLocal) pushNeeded = true; else changedLocal = true;
    });
    return out;
  };

  s.journal = mergeByDate(s.journal, remote.journal, '_u', false);
  s.proteinLog = mergeByDate(s.proteinLog, remote.proteinLog, null, false);
  s.fitbit = mergeByDate(s.fitbit, remote.fitbit, null, true); // device data: server wins

  // settings are one blob: overall-newer side wins
  if (remote.settings && typeof remote.settings === 'object' && !sameJSON(remote.settings, s.settings)) {
    if (remoteNewer) {
      const d = defaults();
      s.settings = Object.assign({}, d.settings, remote.settings);
      s.settings.targets = Object.assign({}, d.settings.targets, remote.settings.targets || {});
      changedLocal = true;
    } else pushNeeded = true;
  }

  s.rev = Math.max(s.rev || 0, remote.rev || 0) + (pushNeeded ? 1 : 0);
  s.updatedAt = pushNeeded ? nowISO() : (remoteNewer ? remote.updatedAt : s.updatedAt);
  save(true);
  return { changedLocal, pushNeeded };
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
  state.journal = state.journal || {};
  state.fitbit = state.fitbit || {};
  state.deleted = state.deleted || {};
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
