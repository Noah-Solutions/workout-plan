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
  const baseWeight = ex.lastWeight || 0;

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
