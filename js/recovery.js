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
