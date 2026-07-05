// progression.js — autoregulated progression engine
// Implements the plan's rule: when you hit the TOP of the rep range at target RIR
// for all working sets, add load (upper ~2.5-5 lb, lower ~5-10 lb) and reset to
// the bottom of the range; otherwise add a rep, or hold.
import { get } from './store.js';

const LOWER_PATTERNS = new Set(['squat', 'hinge']);

function loadIncrement(ex) {
  if (ex.unit === 'bw') return 0;      // bodyweight -> progress by reps
  if (ex.unit === 'sec') return 5;     // timed core -> +5 sec
  return LOWER_PATTERNS.has(ex.pattern) ? 10 : 5; // lower vs upper body
}

// Find the most recent logged sets for an exercise.
export function lastPerformance(exId) {
  const s = get();
  for (let i = s.sessions.length - 1; i >= 0; i--) {
    const sess = s.sessions[i];
    if (sess.kind !== 'strength') continue;
    const entry = (sess.entries || []).find((e) => e.exerciseId === exId);
    if (entry && entry.sets && entry.sets.length) {
      return { date: sess.date, sets: entry.sets };
    }
  }
  return null;
}

// Decide the suggestion for the NEXT session of this exercise.
export function suggestNext(ex) {
  const [lo, hi] = ex.repRange;
  const last = lastPerformance(ex.id);
  const baseWeight = ex.targetWeight != null ? ex.targetWeight : (ex.lastWeight || 0);

  if (!last) {
    return {
      status: 'start', label: 'Start',
      weight: baseWeight, reps: lo, unit: ex.unit,
      text: `Start ${fmtWeight(baseWeight, ex.unit)} × ${lo}–${hi} @ RIR ${ex.targetRIR}`,
    };
  }

  const working = last.sets.filter((st) => Number(st.reps) > 0);
  if (!working.length) {
    return { status: 'hold', label: 'Hold', weight: baseWeight, reps: lo, unit: ex.unit,
      text: `Repeat ${fmtWeight(baseWeight, ex.unit)} × ${lo}–${hi}` };
  }

  const minReps = Math.min(...working.map((st) => Number(st.reps)));
  const maxRir = Math.max(...working.map((st) => (st.rir === '' || st.rir == null ? 0 : Number(st.rir))));
  const lastWeightUsed = mode(working.map((st) => Number(st.weight) || 0)) || baseWeight;
  const inc = loadIncrement(ex);

  // All sets reached the top of the range at or below target RIR -> add load.
  const hitTop = minReps >= hi && maxRir <= ex.targetRIR;
  if (hitTop) {
    if (ex.unit === 'bw' || ex.unit === 'sec') {
      const next = ex.unit === 'sec' ? lastWeightUsed + inc : 0;
      return {
        status: 'up', label: 'Progress',
        weight: next, reps: ex.unit === 'sec' ? hi : hi + 2, unit: ex.unit,
        text: ex.unit === 'sec'
          ? `Add time → ${next}s target`
          : `Add reps → aim ${hi + 2}+ / set`,
      };
    }
    const nextWeight = round(lastWeightUsed + inc);
    return {
      status: 'up', label: `+${inc}${ex.unit}`,
      weight: nextWeight, reps: lo, unit: ex.unit,
      text: `Add load → ${fmtWeight(nextWeight, ex.unit)} × ${lo} (reset to bottom of range)`,
    };
  }

  // Hit reps but left too much in the tank -> keep weight, push closer to target RIR.
  if (minReps >= hi && maxRir > ex.targetRIR) {
    return {
      status: 'hold', label: 'Push harder',
      weight: lastWeightUsed, reps: hi, unit: ex.unit,
      text: `Same load, aim RIR ${ex.targetRIR} (was RIR ${maxRir})`,
    };
  }

  // Made progress within the range -> add a rep next time.
  const targetReps = Math.min(hi, minReps + 1);
  return {
    status: 'rep', label: '+1 rep',
    weight: lastWeightUsed, reps: targetReps, unit: ex.unit,
    text: `Add a rep → ${fmtWeight(lastWeightUsed, ex.unit)} × ${targetReps}`,
  };
}

// After logging, update the exercise's lastWeight so the library stays current.
export function commitExerciseState(ex, sets) {
  const working = (sets || []).filter((st) => Number(st.reps) > 0);
  if (!working.length) return;
  if (ex.unit === 'bw') return;
  const w = mode(working.map((st) => Number(st.weight) || 0));
  if (w) ex.lastWeight = w;
}

function mode(arr) {
  if (!arr.length) return 0;
  const counts = {};
  let best = arr[0], bestN = 0;
  arr.forEach((v) => { counts[v] = (counts[v] || 0) + 1; if (counts[v] > bestN) { bestN = counts[v]; best = v; } });
  return best;
}

function round(w) {
  // round to nearest 2.5 for lb/kg microplate-friendliness
  return Math.round(w / 2.5) * 2.5;
}

export function fmtWeight(w, unit) {
  if (unit === 'bw') return 'BW';
  if (unit === 'sec') return `${w}s`;
  const n = Number(w);
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}`;
}

// ---------- guided (StrongLifts-style) workout model ----------

// Today's prescribed work for an exercise: weight, sets, reps.
export function guidedTarget(ex) {
  const targetReps = ex.repRange ? ex.repRange[0] : 5;
  return {
    weight: ex.targetWeight != null ? ex.targetWeight : (ex.lastWeight || 0),
    sets: ex.workSets || 3,
    reps: targetReps,
    unit: ex.unit,
    increment: ex.increment != null ? ex.increment : loadIncrement(ex),
  };
}

// Per-set weight/rep pyramid ramping up to the top set (= targetWeight).
// Modeled on how established programs ramp:
//   - fixed-rep strength lifts (e.g. 5x5) use Madcow 5x5's scheme: equal 12.5%
//     jumps ending at the top set (5 sets -> 50/62.5/75/87.5/100%),
//   - wide-rep-range accessories use a classic ascending pyramid: 10% jumps
//     with reps sliding from the top of the range down to the bottom
//     (e.g. 8-12 over 3 sets -> 80%x12 / 90%x10 / 100%x8).
// Bodyweight, timed, and single-set lifts stay flat (the warm-up ramp covers those).
export function pyramidSets(ex, topWeight) {
  const t = guidedTarget(ex);
  const n = t.sets;
  const top = topWeight != null ? topWeight : t.weight;
  const flat = () => Array.from({ length: n }, () => ({ weight: top, reps: t.reps }));
  if (ex.unit === 'bw' || ex.unit === 'sec' || n <= 1 || !top) return flat();

  const [lo, hi] = ex.repRange || [t.reps, t.reps];
  const strength = hi - lo <= 1;            // 5x5-style: same reps every set
  const step = strength ? 0.125 : 0.10;     // Madcow interval vs pyramid interval
  const sets = [];
  for (let i = 0; i < n; i++) {
    const pct = 1 - step * (n - 1 - i);
    const reps = strength ? t.reps : Math.round(hi - (hi - lo) * (i / (n - 1)));
    sets.push({ weight: i === n - 1 ? top : Math.max(0, roundToStep(top * pct, ex.unit)), reps });
  }
  return sets;
}

const DIFFICULTY = ['easy', 'good', 'hard', 'failed'];

// Apply the result of a completed exercise to its progression state, mutating the
// exercise in place. Returns { outcome, from, to, delta } for the summary.
//   success  = every work set met its target reps AND difficulty !== 'failed'
//   success  -> top set +increment (double if "easy"); reset fail streak
//   miss     -> repeat weight; +1 fail streak; at 3 fails -> deload 10% (reset streak)
// With pyramid sets the whole ramp is anchored to the top set, so progression
// only ever moves the top-set weight (topWeight = the day's planned top set).
export function applyWorkoutResult(ex, sets, difficulty, topWeight) {
  const tgt = guidedTarget(ex);
  const working = (sets || []).filter((st) => Number(st.reps) > 0);
  const usedWeight = ex.unit === 'bw' || ex.unit === 'sec'
    ? (topWeight != null ? topWeight : tgt.weight)
    : (topWeight != null ? topWeight
      : (working.length ? Math.max(...working.map((st) => Number(st.weight) || 0)) : 0) || tgt.weight);
  ex.lastWeight = usedWeight;

  const enough = working.length >= tgt.sets;
  const allHit = enough && working.every((st) =>
    Number(st.reps) >= Number(st.target != null ? st.target : tgt.reps));
  const success = allHit && difficulty !== 'failed';

  const from = usedWeight;

  // personal record: a successful set at a higher weight than ever before
  let pr = false;
  if (success && (ex.unit === 'lb' || ex.unit === 'kg' || ex.unit === 'sec')) {
    if (usedWeight > (ex.bestWeight || 0)) pr = true;
    ex.bestWeight = Math.max(ex.bestWeight || 0, usedWeight);
  }

  // bodyweight / timed: progress by reps or seconds, no deload machinery
  if (ex.unit === 'bw') {
    ex.failStreak = 0;
    ex.targetWeight = 0;
    return { outcome: success ? 'progress' : 'hold', from: 0, to: 0, delta: 0, byReps: true, pr: false };
  }

  if (success) {
    const inc = (difficulty === 'easy' ? 2 : 1) * (ex.increment != null ? ex.increment : loadIncrement(ex));
    ex.failStreak = 0;
    ex.targetWeight = roundToStep(usedWeight + inc, ex.unit);
    return { outcome: 'progress', from, to: ex.targetWeight, delta: ex.targetWeight - from, pr };
  }

  ex.failStreak = (ex.failStreak || 0) + 1;
  if (ex.failStreak >= 3) {
    ex.failStreak = 0;
    ex.targetWeight = roundToStep(usedWeight * 0.9, ex.unit);
    return { outcome: 'deload', from, to: ex.targetWeight, delta: ex.targetWeight - from };
  }
  ex.targetWeight = usedWeight; // repeat same weight next time
  return { outcome: 'hold', from, to: usedWeight, delta: 0, fails: ex.failStreak };
}

function roundToStep(w, unit) {
  if (unit === 'sec') return Math.round(w / 5) * 5;
  return Math.round(w / 5) * 5; // nearest 5 lb (loadable with a 2.5 plate per side)
}

// Warm-up ramp for a barbell working weight: empty bar, then ~50/70/90%.
// Ephemeral guidance (not saved / not counted toward volume or progression).
export function warmupSets(work, bar) {
  work = Number(work); bar = Number(bar) || 45;
  if (!work || work <= bar + 10) return []; // light loads need no ramp
  const steps = [{ p: 0, r: 5 }, { p: 0.5, r: 5 }, { p: 0.7, r: 3 }, { p: 0.9, r: 2 }];
  const seen = new Set();
  const out = [];
  for (const { p, r } of steps) {
    let w = p === 0 ? bar : Math.round((work * p) / 5) * 5;
    if (w < bar) w = bar;
    if (w >= work || seen.has(w)) continue;
    seen.add(w);
    out.push({ weight: w, reps: r });
  }
  return out;
}
