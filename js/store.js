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

function defaults() {
  return {
    version: 1,
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
    } else {
      state = defaults();
      save();
    }
  } catch (err) {
    console.error('Failed to load state, resetting', err);
    state = defaults();
  }
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Save failed', err);
  }
}

export function get() { return state || load(); }

export function update(fn) {
  const s = get();
  fn(s);
  save();
  return s;
}

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
