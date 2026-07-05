// recovery.js — a source-agnostic view of daily recovery.
//
// Today the only source is the self-reported daily check-in (state.journal).
// Later, a Fitbit sync layer will populate state.fitbit[date] with measured
// sleep + heart-rate data; this module already prefers that measured data when
// it exists, so the recovery views don't change when the device is connected.
//
// Normalized daily shape (any field may be null when unknown):
//   { date, sleepScore (0-100, higher=better), sleepSource ('fitbit'|'self'|null),
//     sleepMinutes, sleepDifficulty (1 easy–5 hard, self-report only),
//     restingHR, restingHRSource, hrv, drinks, caffeine, energy, soreness,
//     stress, pain (array), flags (array), hasData }
// Measured (fitbit) values are preferred over self-reports field-by-field:
// sleepMinutes and restingHR fall back to the journal's bed/wake-derived
// minutes and manual morning resting HR until a device is connected.
import { get } from './store.js';

// Map a 1–5 self-reported difficulty (1 easy … 5 hard) onto a 0–100 "score"
// (higher = better) so self-reports and future Fitbit sleep scores share a scale.
export function difficultyToScore(diff) {
  if (!diff) return null;
  return Math.round((5 - diff) / 4 * 100); // 1->100, 3->50, 5->0
}

export function dailyRecovery(date) {
  const s = get();
  const j = (s.journal || {})[date] || {};
  const f = (s.fitbit || {})[date] || {};

  const measuredSleep = f.sleepScore != null || f.sleepMinutes != null;
  const sleepScore = f.sleepScore != null ? f.sleepScore
    : (j.sleepDiff ? difficultyToScore(j.sleepDiff) : null);
  const sleepSource = measuredSleep ? 'fitbit' : (j.sleepDiff ? 'self' : null);

  const out = {
    date,
    sleepScore,
    sleepSource,
    sleepMinutes: f.sleepMinutes ?? j.sleepMin ?? null,
    sleepDifficulty: j.sleepDiff ?? null,
    restingHR: f.restingHR ?? j.rhr ?? null,
    restingHRSource: f.restingHR != null ? 'fitbit' : (j.rhr != null ? 'self' : null),
    hrv: f.hrv ?? null,
    drinks: j.drinks ?? null,
    caffeine: j.caffeine ?? null,
    energy: j.energy ?? null,
    soreness: j.soreness ?? null,
    stress: j.stress ?? null,
    pain: Array.isArray(j.pain) && j.pain.length ? j.pain : null,
    flags: Array.isArray(j.flags) && j.flags.length ? j.flags : null,
  };
  out.hasData = sleepScore != null || out.sleepMinutes != null || out.restingHR != null ||
    out.drinks != null || out.caffeine != null || out.energy != null ||
    out.soreness != null || out.stress != null || out.pain != null;
  return out;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Median resting HR over the 28 days before `date` (self-reported or device).
// Needs >= 5 readings to be a usable baseline.
export function rhrBaseline(date) {
  const from = addDays(date, -28);
  const vals = recoveryDates()
    .filter((d) => d >= from && d < date)
    .map((d) => dailyRecovery(d).restingHR)
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  if (vals.length < 5) return null;
  return vals[Math.floor(vals.length / 2)];
}

const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));

// 0–100 readiness for a date, averaged over whatever signals exist:
//   sleep (score and/or duration), yesterday's alcohol & evening stress,
//   waking energy & soreness, and resting HR vs the 28-day baseline.
// Returns null until at least two signals are available — a one-signal
// "score" would be noise dressed up as a number. Directional, not medical.
export function readiness(date) {
  const r = dailyRecovery(date);
  const ry = dailyRecovery(addDays(date, -1));
  const parts = [];

  let sleep = r.sleepScore;
  if (r.sleepMinutes != null) {
    const dur = clamp100(((r.sleepMinutes - 300) / 180) * 100); // 5h -> 0, 8h+ -> 100
    sleep = sleep == null ? dur : Math.round((sleep + dur) / 2);
  }
  if (sleep != null) parts.push({ key: 'sleep', label: 'Sleep', score: sleep });
  if (ry.drinks != null) {
    const a = ry.drinks <= 0 ? 100 : ry.drinks === 1 ? 85 : ry.drinks === 2 ? 65 : ry.drinks === 3 ? 45 : 25;
    parts.push({ key: 'alcohol', label: 'Alcohol (yesterday)', score: a });
  }
  if (r.energy) parts.push({ key: 'energy', label: 'Energy', score: clamp100(((r.energy - 1) / 4) * 100) });
  if (r.soreness) parts.push({ key: 'soreness', label: 'Soreness', score: clamp100(((5 - r.soreness) / 4) * 100) });
  if (ry.stress) parts.push({ key: 'stress', label: 'Stress (yesterday)', score: clamp100(((5 - ry.stress) / 4) * 100) });
  if (r.restingHR != null) {
    const base = rhrBaseline(date);
    if (base != null) {
      // at baseline -> 100; each bpm above baseline costs 8 points
      parts.push({ key: 'rhr', label: 'Resting HR', score: clamp100(100 - (r.restingHR - base) * 8) });
    }
  }

  if (parts.length < 2) return null;
  const score = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  const band = score >= 75 ? 'high' : score >= 55 ? 'good' : score >= 40 ? 'medium' : 'low';
  parts.sort((a, b) => a.score - b.score);
  return { date, score, band, parts, weakest: parts[0] };
}

// Whether any measured (device) recovery data exists yet — drives the
// "connect Fitbit" prompt vs. a live device summary.
export function hasDeviceData() {
  const f = get().fitbit || {};
  return Object.keys(f).length > 0;
}

// All dates (sorted) that have any recovery signal — union of journal + fitbit.
export function recoveryDates() {
  const s = get();
  const set = new Set([...Object.keys(s.journal || {}), ...Object.keys(s.fitbit || {})]);
  return [...set].sort();
}
