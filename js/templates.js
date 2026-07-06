// templates.js — SEED workout templates only. On first load these are
// materialized into state.templates (store.js) with per-entry sets×reps, and
// from then on workouts are edited in-app (Setup → Workouts, or ✎ on the home
// hero) — StrongLifts-style: sets & reps live in the program, the progressing
// weight lives on the exercise.
// Names must match exercises in the seed library; unmatched names are skipped.
export const SEED_TEMPLATES = [
  {
    name: 'Full Body A — Squat focus',
    short: 'A',
    rotation: true,
    exercises: ['Back Squat', 'Bench Press', 'Barbell Row', 'Barbell Curl', 'Plank'],
  },
  {
    name: 'Full Body B — Hinge focus',
    short: 'B',
    rotation: true,
    exercises: ['Romanian Deadlift', 'Overhead Press', 'Pull-up', 'Leg Curl', 'Plank'],
  },
  {
    name: 'Upper A',
    short: 'U',
    rotation: false,
    exercises: ['Bench Press', 'Overhead Press', 'Barbell Row', 'Pull-up', 'Triceps Pushdown'],
  },
  {
    name: 'Lower A',
    short: 'L',
    rotation: false,
    exercises: ['Back Squat', 'Romanian Deadlift', 'Goblet Squat', 'Leg Curl', 'Plank'],
  },
];
