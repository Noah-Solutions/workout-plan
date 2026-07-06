// templates.js — starter session templates from the plan (Option A & Option B)
// Names must match exercises in the library; unmatched names are skipped.
// `rotation: true` marks the days that make up the recurring program shown on
// the home screen; `short` is the code used in the program strip (A / B / …).
export const TEMPLATES = [
  {
    name: 'Full Body A — Squat focus',
    short: 'A',
    rotation: true,
    desc: 'Squat · Bench · Row · Curl · Plank',
    exercises: ['Back Squat', 'Bench Press', 'Barbell Row', 'Barbell Curl', 'Plank'],
  },
  {
    name: 'Full Body B — Hinge focus',
    short: 'B',
    rotation: true,
    desc: 'RDL · Overhead Press · Pull-up · Leg Curl · Plank',
    exercises: ['Romanian Deadlift', 'Overhead Press', 'Pull-up', 'Leg Curl', 'Plank'],
  },
  {
    name: 'Upper A',
    short: 'U',
    desc: '2 pushes + 2 pulls',
    exercises: ['Bench Press', 'Overhead Press', 'Barbell Row', 'Pull-up', 'Triceps Pushdown'],
  },
  {
    name: 'Lower A',
    short: 'L',
    desc: '2 squat + 2 hinge patterns',
    exercises: ['Back Squat', 'Romanian Deadlift', 'Goblet Squat', 'Leg Curl', 'Plank'],
  },
];
