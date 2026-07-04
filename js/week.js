// week.js — date helpers + weekly aggregation against targets
import { get, MUSCLES, PATTERNS, exerciseById } from './store.js';

// ---- date helpers (week starts Monday) ----
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO() { return toISODate(new Date()); }

export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dow);
  return d;
}

export function weekRange(refDate) {
  const start = weekStart(refDate || new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end, startISO: toISODate(start), endISO: toISODate(end) };
}

export function fmtWeekLabel(range) {
  const opt = { month: 'short', day: 'numeric' };
  return `${range.start.toLocaleDateString(undefined, opt)} – ${range.end.toLocaleDateString(undefined, opt)}`;
}

export function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// A "hard set" counts toward volume when RIR <= 3 (per the plan).
function isHardSet(set) {
  const rir = set.rir === '' || set.rir == null ? 0 : Number(set.rir);
  const reps = Number(set.reps) || 0;
  return reps > 0 && rir <= 3;
}

// Activities map to training contributions per the plan's substitution guide.
export const ACTIVITY_MAP = {
  climbing:   { label: 'Rock climbing', icon: '🧗', patterns: ['pull'], cardioType: 'moderate', note: 'Counts as a pull day + partial moderate cardio. Still get a squat/hinge session in.' },
  ride_easy:  { label: 'Easy / steady ride', icon: '🚴', patterns: [], cardioType: 'zone2', note: 'Counts toward your Zone 2 base.' },
  ride_hard:  { label: 'Hard / hilly ride', icon: '🚵', patterns: [], cardioType: 'interval', note: 'Counts as your interval day.' },
  hike:       { label: 'Hike', icon: '🥾', patterns: [], cardioType: 'zone2', note: 'Counts toward your Zone 2 base.' },
  other:      { label: 'Other activity', icon: '✨', patterns: [], cardioType: 'moderate', note: 'General activity.' },
};

export function aggregateWeek(refDate) {
  const s = get();
  const range = weekRange(refDate);
  const inWeek = s.sessions.filter((x) => x.date >= range.startISO && x.date <= range.endISO);

  const setsPerMuscle = {};
  MUSCLES.forEach((m) => { setsPerMuscle[m] = 0; });
  const patternCount = {};
  PATTERNS.forEach((p) => { patternCount[p] = 0; });

  let zone2Min = 0;
  let moderateMin = 0;
  let intervalSessions = 0;
  let intervalMin = 0;
  let liftSessions = 0;
  const patternsSeenThisSession = [];

  inWeek.forEach((sess) => {
    if (sess.kind === 'strength') {
      liftSessions += 1;
      const sessionPatterns = new Set();
      (sess.entries || []).forEach((entry) => {
        const ex = exerciseById(entry.exerciseId) || entry.exSnapshot;
        if (!ex) return;
        const hard = (entry.sets || []).filter(isHardSet).length;
        (ex.muscles || []).forEach((m) => {
          if (setsPerMuscle[m] != null) setsPerMuscle[m] += hard;
        });
        if (PATTERNS.includes(ex.pattern) && hard > 0) sessionPatterns.add(ex.pattern);
      });
      sessionPatterns.forEach((p) => { patternCount[p] += 1; });
    } else if (sess.kind === 'cardio') {
      if (sess.cardioType === 'interval') { intervalSessions += 1; intervalMin += Number(sess.durationMin) || 0; }
      else if (sess.cardioType === 'zone2') { zone2Min += Number(sess.durationMin) || 0; }
      else { moderateMin += Number(sess.durationMin) || 0; }
    } else if (sess.kind === 'activity') {
      const map = ACTIVITY_MAP[sess.activity] || ACTIVITY_MAP.other;
      const dur = Number(sess.durationMin) || 0;
      map.patterns.forEach((p) => { if (patternCount[p] != null) patternCount[p] += 1; });
      if (map.cardioType === 'zone2') zone2Min += dur;
      else if (map.cardioType === 'interval') { intervalSessions += 1; intervalMin += dur; }
      else moderateMin += dur;
    }
  });

  const t = s.settings.targets;
  const totalCardioMin = zone2Min + moderateMin + intervalMin;

  // Minimum viable week: 2 full-body lifts hitting all 4 patterns + ~75 min cardio
  const patternsCovered = PATTERNS.filter((p) => patternCount[p] >= 1).length;
  const mvwLift = liftSessions >= 2 && patternsCovered === 4;
  const mvwCardio = totalCardioMin >= 75;
  const mvwMet = mvwLift && mvwCardio;

  return {
    range, inWeek,
    setsPerMuscle, patternCount,
    zone2Min, moderateMin, intervalMin, totalCardioMin,
    intervalSessions, liftSessions,
    targets: t,
    mvw: { met: mvwMet, lift: mvwLift, cardio: mvwCardio, patternsCovered, liftSessions, totalCardioMin },
  };
}

// protein target grams/day
export function proteinTarget() {
  const s = get();
  return Math.round(s.settings.bodyweightKg * s.settings.proteinPerKg);
}
