// app.js — UI, router, and event handling
import {
  load, get, update, uid, exerciseById, exportJSON, importJSON, resetAll,
  MUSCLES, PATTERNS, PATTERN_LABEL,
} from './store.js';
import {
  aggregateWeek, weekRange, weekStart, toISODate, fmtWeekLabel, fmtDate, todayISO,
  proteinTarget, ACTIVITY_MAP, isHardSet, entryExercise,
} from './week.js';
import { suggestNext, commitExerciseState, fmtWeight, lastPerformance, guidedTarget, applyWorkoutResult, warmupSets, pyramidSets } from './progression.js';
import { TEMPLATES } from './templates.js';
import { platesLabel, platesFor } from './plates.js';
import { lineChart, barChart, legend, mountTips } from './charts.js';
import { dailyRecovery, difficultyToScore, hasDeviceData, recoveryDates, readiness, rhrBaseline } from './recovery.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as timer from './timer.js';

load();

// Auto-sync local changes to the server (debounced pull-merge-push) when connected.
store.onChange(() => sync.scheduleAutoPush());
// Persisting can fail (storage full) — losing logs silently is not acceptable.
store.onSaveError(() => toast('⚠️ Save failed — storage may be full. Export a backup from Setup now.'));
let lastSyncMsg = '';
sync.onStatus((status, detail) => {
  if (status === 'synced') {
    lastSyncMsg = `Synced (${detail.direction}) · ${new Date().toLocaleTimeString()}`;
    const msg = { pulled: 'Pulled from server', merged: 'Merged with server', pushed: 'Synced to server' }[detail.direction];
    if (msg) toast(msg);
  }
  else if (status === 'error') { lastSyncMsg = 'Sync error: ' + detail; }
  else if (status === 'disconnected') { lastSyncMsg = ''; }
  if (currentTab === 'setup') renderSetup();
  if ((currentTab === 'today' || currentTab === 'plan') && status === 'synced' && detail.direction !== 'up-to-date') render();
});

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('viewTitle');
const weekLabelEl = document.getElementById('weekLabel');
const modalRoot = document.getElementById('modalRoot');

let currentTab = 'today';
// draft state for the log-session builder
let draft = null;
// in-progress guided (StrongLifts-style) workout
let workout = null;
// remembered exercise selection on the Progress tab
let progressSel = null;
// Progress segment: 'training' | 'body' | 'recovery'
let progressSeg = 'training';
// Drill-down screens. When set, the owning tab renders a detail screen
// instead of its top level.
let exDetail = null;   // exercise id for the exercise-detail view (Progress)
let dayDetail = null;  // ISO date for the day view (Today / History)

// ---------- helpers ----------
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (vals[i] ?? ''), '');
function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
// Toast with a single action button (e.g. Undo). Longer-lived than a plain toast.
function toastAction(msg, actionLabel, fn) {
  const t = document.createElement('div');
  t.className = 'toast toast--action';
  t.textContent = msg + ' ';
  const b = document.createElement('button');
  b.textContent = actionLabel;
  b.addEventListener('click', () => { t.remove(); fn(); });
  t.appendChild(b);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}
function haptic(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} } }

// approximate real plate colors (lbs) for the plate visual
const PLATE_COLOR = { 45: '#2f6fed', 35: '#e8b100', 25: '#1f9d55', 10: '#8a94ad', 5: '#e0574b', 2.5: '#c86bd6' };
function plateColor(w) { return PLATE_COLOR[w] || '#6d8bff'; }
function ring(pct, label, center, sub, color) {
  const r = 32, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return h`<div class="ring">
    <svg viewBox="0 0 78 78">
      <circle class="ring__track" cx="39" cy="39" r="${r}"></circle>
      <circle class="ring__val" cx="39" cy="39" r="${r}"
        style="stroke:${color};stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"></circle>
    </svg>
    <div class="ring__center">${center}</div>
    <div class="ring__label">${label}${sub ? `<div class="ring__sub">${sub}</div>` : ''}</div>
  </div>`;
}

// ---------- bodyweight units + daily check-in helpers ----------
const KG_PER_LB = 0.45359237;
function toKg(v, unit) { return unit === 'kg' ? v : v * KG_PER_LB; }
function fromKg(kg, unit) { return unit === 'kg' ? kg : kg / KG_PER_LB; }
function bwUnit() { return get().settings.units === 'kg' ? 'kg' : 'lb'; }
function fmtBw(kg) { const u = bwUnit(); return `${fromKg(kg, u).toFixed(1)} ${u}`; }

const SLEEP_LABELS = { 1: 'Easy', 2: 'Good', 3: 'So-so', 4: 'Hard', 5: 'Very hard' };

// 1–5 rating control. name = data-rate group; sel = current value; ends = [loLabel, hiLabel]
function ratingHTML(name, sel, ends) {
  const btns = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="ratebtn ${Number(sel) === n ? 'is-sel' : ''}" data-rate="${name}" data-val="${n}">${n}</button>`).join('');
  const endRow = ends ? `<div class="rating__ends"><span>${esc(ends[0])}</span><span>${esc(ends[1])}</span></div>` : '';
  return `<div class="rating"><div class="rating__btns">${btns}</div>${endRow}</div>`;
}

function openModal(title, bodyHTML) {
  modalRoot.innerHTML = h`<div class="modal-backdrop" data-close>
    <div class="modal">
      <div class="modal__grab"></div>
      ${title ? `<div class="modal__title">${title}</div>` : ''}
      <div id="modalBody">${bodyHTML}</div>
    </div>
  </div>`;
  modalRoot.querySelector('[data-close]').addEventListener('click', (e) => {
    if (e.target.dataset.close !== undefined) closeModal();
  });
}
function closeModal() { modalRoot.innerHTML = ''; }

// ---------- router ----------
const TITLES = { today: 'Today', plan: 'This Week', log: 'Log', progress: 'Progress', history: 'History', setup: 'Setup' };
function setTab(tab) {
  // tapping a tab always lands on that tab's top level (clear any drill-down)
  exDetail = null; dayDetail = null;
  currentTab = tab;
  highlightTab(tab);
  titleEl.textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}
function highlightTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
}

// Open a drill-down without going through setTab (which would clear it).
function gotoProgress() {
  currentTab = 'progress';
  highlightTab('progress');
  render();
  window.scrollTo(0, 0);
}
function openExerciseDetail(id) { exDetail = id; gotoProgress(); }
function openRecoveryDetail() { progressSeg = 'recovery'; exDetail = null; gotoProgress(); }
// Day view: everything logged on one date, editable in one place.
function openDay(date) {
  dayDetail = date;
  if (currentTab !== 'today' && currentTab !== 'history') { currentTab = 'history'; highlightTab('history'); }
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
// Center ＋ button: resume an in-progress workout/draft, otherwise open the log sheet.
document.getElementById('logBtn').addEventListener('click', () => {
  if (workout || draft) setTab('log');
  else openLogSheet();
});
document.getElementById('setupBtn').addEventListener('click', () => setTab('setup'));

function render() {
  const range = weekRange();
  weekLabelEl.textContent = currentTab === 'plan' ? fmtWeekLabel(range)
    : currentTab === 'today' && !dayDetail ? fmtDate(todayISO()) : '';
  if (currentTab === 'today') { if (dayDetail) renderDay(dayDetail); else renderToday(); }
  else if (currentTab === 'plan') renderPlan();
  else if (currentTab === 'log') renderLog();
  else if (currentTab === 'progress') {
    if (exDetail) renderExerciseDetail(exDetail);
    else renderProgress();
  }
  else if (currentTab === 'history') { if (dayDetail) renderDay(dayDetail); else renderHistory(); }
  else if (currentTab === 'setup') renderSetup();
}

// ================= TODAY (home) =================
// Action-first: what should I do right now? Analytics live on the Plan tab.
function renderToday() {
  viewEl.innerHTML = h`
    ${readinessCardHTML()}
    ${nextWorkoutHeroHTML()}
    ${todayChecklistHTML()}
    ${weekStripCardHTML()}
    ${backupNudgeHTML()}
  `;

  const startBtn = document.getElementById('heroStart');
  if (startBtn) startBtn.addEventListener('click', () => startWorkout(nextTemplate()));
  const rdCard = document.getElementById('readinessCard');
  if (rdCard) rdCard.addEventListener('click', openRecoveryDetail);
  viewEl.querySelectorAll('[data-checkin]').forEach((b) => b.addEventListener('click', () => openCheckin(todayISO(), b.dataset.checkin)));
  const pBtn = document.getElementById('addProtein');
  if (pBtn) pBtn.addEventListener('click', () => proteinPrompt());
  viewEl.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => openDay(b.dataset.day)));
  const planLink = document.getElementById('gotoPlan');
  if (planLink) planLink.addEventListener('click', () => setTab('plan'));
  const nudgeBtn = document.getElementById('nudgeExport');
  if (nudgeBtn) nudgeBtn.addEventListener('click', () => { doExport(); renderToday(); });
}

// One card for the day's three habits: morning check-in, evening check-in, protein.
function todayChecklistHTML() {
  const j = get().journal[todayISO()];
  const mDone = morningDone(j), eDone = eveningDone(j);
  const streak = checkinStreak();
  const mStatus = mDone
    ? [j.sleepMin != null ? fmtSleepMin(j.sleepMin) : null, j.sleepDiff ? `Sleep ${j.sleepDiff}/5` : null, j.bw != null ? fmtBw(j.bw) : null].filter(Boolean).join(' · ') || 'Logged'
    : "Last night's sleep";
  const eStatus = eDone
    ? [j.drinks != null ? `${j.drinks} drink${j.drinks === 1 ? '' : 's'}` : null, j.stress ? `stress ${j.stress}/5` : null].filter(Boolean).join(' · ') || 'Logged'
    : 'How the day went';
  const target = proteinTarget();
  const proteinToday = get().proteinLog[todayISO()] || 0;
  const pPct = Math.min(1, proteinToday / target);
  const pDone = proteinToday >= target;
  return h`<div class="card">
    <div class="card__title"><h2>Daily check-ins</h2><span class="card__hint">${streak >= 2 ? `🔥 ${streak}-day streak` : 'recovery journal'}</span></div>
    <div class="checkin-row">
      <span class="checkin-row__ico">🌅</span>
      <div class="checkin-row__body"><div class="checkin-row__t">Morning ${mDone ? '<span class="checkin-tick">✓</span>' : ''}</div><div class="small muted">${esc(mStatus)}</div></div>
      <button class="btn btn--sm ${mDone ? 'btn--ghost' : ''}" data-checkin="morning">${mDone ? 'Edit' : 'Log'}</button>
    </div>
    <div class="checkin-row">
      <span class="checkin-row__ico">🌙</span>
      <div class="checkin-row__body"><div class="checkin-row__t">Evening ${eDone ? '<span class="checkin-tick">✓</span>' : ''}</div><div class="small muted">${esc(eStatus)}</div></div>
      <button class="btn btn--sm ${eDone ? 'btn--ghost' : ''}" data-checkin="evening">${eDone ? 'Edit' : 'Log'}</button>
    </div>
    <div class="checkin-row">
      <span class="checkin-row__ico">🍗</span>
      <div class="checkin-row__body">
        <div class="checkin-row__t">Protein ${pDone ? '<span class="checkin-tick">✓</span>' : ''}</div>
        <div class="mbar__track" style="margin:5px 0 3px"><div class="mbar__fill" style="width:${(pPct * 100).toFixed(0)}%;background:var(--accent-2)"></div></div>
        <div class="small muted">${proteinToday} / ${target} g</div>
      </div>
      <button class="btn btn--sm ${pDone ? 'btn--ghost' : ''}" id="addProtein">${proteinToday ? 'Edit' : 'Log'}</button>
    </div>
  </div>`;
}

// Compact week strip: one tappable dot per day (Mon–Sun) + MVW status line.
function weekStripCardHTML() {
  const a = aggregateWeek();
  const range = weekRange();
  const today = todayISO();
  const byDate = {};
  get().sessions.forEach((x) => {
    const rec = (byDate[x.date] = byDate[x.date] || { lift: false, cardio: false });
    if (x.kind === 'strength') rec.lift = true; else rec.cardio = true;
  });
  const dots = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(range.startISO, i);
    const r = byDate[d];
    const future = d > today;
    const color = future ? 'transparent'
      : r && r.lift && r.cardio ? 'var(--good)'
      : r && r.lift ? 'var(--chart-1)'
      : r && r.cardio ? 'var(--chart-2)'
      : 'var(--card-2)';
    const letter = new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
    dots.push(h`<button class="daydot ${d === today ? 'is-today' : ''}" data-day="${d}" ${future ? 'disabled' : ''}>
      <span class="daydot__dot" style="background:${color}"></span><span class="daydot__l">${letter}</span>
    </button>`);
  }
  const mvw = a.mvw;
  const status = mvw.met
    ? '✅ Minimum viable week met'
    : `Lifts <b>${mvw.liftSessions}</b>/2 · Patterns <b>${mvw.patternsCovered}</b>/4 · Cardio <b>${mvw.totalCardioMin}</b>/75m`;
  return h`<div class="card">
    <div class="card__title"><h2>This week</h2><button class="linkbtn" id="gotoPlan">Weekly plan →</button></div>
    <div class="daydots">${dots.join('')}</div>
    <div class="small muted mt">${status} · tap a day to view or edit it</div>
  </div>`;
}

// ================= PLAN (weekly dashboard) =================
function renderPlan() {
  const a = aggregateWeek();
  const t = a.targets;

  // headline rings: Zone 2, Intervals, Strength coverage
  const z2pct = a.zone2Min / t.zone2MinWeek;
  const intpct = a.intervalSessions / t.intervalSessionsWeek;
  const patternsCovered = PATTERNS.filter((p) => a.patternCount[p] >= t.patternTimesPerWeek).length;
  const patternPct = patternsCovered / PATTERNS.length;

  const rings = h`<div class="ring-row">
    ${ring(z2pct, 'Zone 2', `${a.zone2Min}<span class="ring__sub">/${t.zone2MinWeek}m</span>`, '', 'var(--accent-2)')}
    ${ring(intpct, 'Intervals', `${a.intervalSessions}<span class="ring__sub">/${t.intervalSessionsWeek}</span>`, '', 'var(--warn)')}
    ${ring(patternPct, 'Patterns 2×', `${patternsCovered}<span class="ring__sub">/4</span>`, '', 'var(--accent)')}
  </div>`;

  // Minimum viable week banner
  const mvw = a.mvw;
  const mvwCard = h`<div class="card">
    <div class="mvw ${mvw.met ? 'is-met' : ''}">
      <div class="mvw__badge">${mvw.met ? '✅' : '🎯'}</div>
      <div class="mvw__text">
        <b>${mvw.met ? 'Minimum viable week met' : 'Minimum viable week'}</b>
        <span class="muted">2 full-body lifts hitting all 4 patterns + ~75 min cardio.</span>
        <div class="mt small mvw__stats">
          <span>Lifts <b>${mvw.liftSessions}</b>/2</span>
          <span>Patterns <b>${mvw.patternsCovered}</b>/4</span>
          <span>Cardio <b>${mvw.totalCardioMin}</b>/75m</span>
        </div>
      </div>
    </div>
  </div>`;

  // Pattern chips
  const chips = PATTERNS.map((p) => {
    const n = a.patternCount[p];
    const ok = n >= t.patternTimesPerWeek ? 2 : n >= 1 ? 1 : 0;
    return h`<div class="pchip" data-ok="${ok}"><b>${PATTERN_LABEL[p]}</b><small>${n}×</small></div>`;
  }).join('');

  // Muscle volume bars
  const bars = MUSCLES.map((m) => {
    const n = a.setsPerMuscle[m];
    const pct = Math.min(1, n / t.setsPerMuscle);
    const floorPct = (t.maintenanceSets / t.setsPerMuscle) * 100;
    const color = n >= t.setsPerMuscle ? 'var(--good)' : n >= t.maintenanceSets ? 'var(--accent)' : 'var(--warn)';
    return h`<div class="mbar">
      <div class="mbar__head"><b>${m}</b><span class="mbar__count">${n} / ${t.setsPerMuscle} sets</span></div>
      <div class="mbar__track">
        <div class="mbar__fill" style="width:${(pct * 100).toFixed(0)}%;background:${color}"></div>
        <div class="mbar__floor" style="left:${floorPct}%"></div>
      </div>
    </div>`;
  }).join('');

  // Progression suggestions (exercises with logged history that are ready to move)
  const sugCards = get().exercises
    .filter((ex) => !ex.archived && ex.type === 'strength')
    .map((ex) => ({ ex, s: suggestNext(ex) }))
    .filter((o) => o.s.status === 'up' || o.s.status === 'rep')
    .slice(0, 6);
  const sugHTML = sugCards.length ? sugCards.map((o) => h`<div class="suggest">
      <div>
        <div class="suggest__name">${esc(o.ex.name)}</div>
        <div class="suggest__detail">${esc(o.s.text)}</div>
      </div>
      <span class="pill pill--${o.s.status === 'up' ? 'up' : 'rep'}">${o.s.status === 'up' ? '▲ Progress' : '+1 rep'}</span>
    </div>`).join('')
    : `<div class="muted small">Log a couple of lifts and progression suggestions will appear here.</div>`;

  viewEl.innerHTML = h`
    <div class="card">${rings}</div>
    ${mvwCard}

    <div class="card">
      <div class="card__title"><h2>Movement patterns</h2><span class="card__hint">aim 2× each</span></div>
      <div class="patterns">${chips}</div>
    </div>

    <div class="card">
      <div class="card__title"><h2>Weekly volume</h2><span class="card__hint">hard sets / muscle</span></div>
      ${bars}
      <div class="small muted mt">Marker = ${t.maintenanceSets}-set maintenance floor · full bar = ${t.setsPerMuscle}-set growth target.</div>
    </div>

    <div class="card">
      <div class="card__title"><h2>Progression queue</h2><span class="card__hint">auto-adjusted</span></div>
      ${sugHTML}
    </div>
  `;
}

// ---- "Next workout" hero (StrongLifts-style home) ----
// Alternates the two full-body templates based on the last guided workout.
function nextTemplate() {
  const strengths = get().sessions.filter((s) => s.kind === 'strength' && s.templateName);
  const last = strengths.length ? strengths[strengths.length - 1].templateName : null;
  const a = TEMPLATES[0], b = TEMPLATES[1];
  return last === a.name ? b : a;
}

function nextWorkoutHeroHTML() {
  const tpl = nextTemplate();
  const exs = tpl.exercises
    .map((name) => get().exercises.find((e) => e.name.toLowerCase() === name.toLowerCase() && !e.archived))
    .filter(Boolean);
  const rows = exs.map((ex) => {
    const t = guidedTarget(ex);
    const ramp = pyramidSets(ex);
    // pyramid lifts show the rep slide (e.g. 3×12→8) and their TOP-set weight
    const varies = ramp.length > 1 && ramp[0].reps !== ramp[ramp.length - 1].reps;
    const scheme = varies ? `${t.sets}×${ramp[0].reps}→${ramp[ramp.length - 1].reps}` : `${t.sets}×${t.reps}`;
    const ramps = ramp.length > 1 && ramp.some((s) => s.weight !== ramp[0].weight);
    return h`<div class="hero-ex">
      <span class="hero-ex__name">${esc(ex.name)}</span>
      <span class="hero-ex__scheme">${scheme}</span>
      <span class="hero-ex__wt">${ramps ? '▲ ' : ''}${fmtWeight(t.weight, t.unit)}</span>
    </div>`;
  }).join('');
  return h`<div class="hero">
    <div class="hero__top">
      <div>
        <div class="hero__eyebrow">Next workout</div>
        <div class="hero__title">${esc(tpl.name)}</div>
      </div>
      <span class="hero__badge">${exs.length} lift${exs.length === 1 ? '' : 's'}</span>
    </div>
    <div class="hero__exs">${rows}</div>
    <button class="btn btn--accent hero__start" id="heroStart">Start workout</button>
  </div>`;
}

// ---- readiness (from recovery.js) shown as a home tile ----
const READINESS_BAND = {
  high:   { label: 'Primed',        color: 'var(--good)',   tip: 'Green light — a great day to push.' },
  good:   { label: 'Good to go',    color: 'var(--accent)', tip: 'Train as planned.' },
  medium: { label: 'Take it steady', color: 'var(--warn)',  tip: 'Go, but keep reps in reserve — or make it Zone 2.' },
  low:    { label: 'Recovery day',  color: 'var(--danger)', tip: 'Favor rest or easy Zone 2 — hard lifting today buys fatigue, not fitness.' },
};

function readinessCardHTML() {
  const rd = readiness(todayISO());
  if (!rd) return ''; // needs >= 2 signals; the check-in card already prompts for them
  const b = READINESS_BAND[rd.band];
  return h`<div class="card" id="readinessCard" style="cursor:pointer">
    <div class="readiness">
      ${ring(rd.score / 100, 'Readiness', `${rd.score}`, '', b.color)}
      <div class="readiness__body">
        <b style="color:${b.color}">${b.label}</b>
        <div class="small muted">${b.tip}</div>
        ${rd.weakest.score < 60 ? `<div class="small muted mt">Weakest signal: <b>${esc(rd.weakest.label)}</b></div>` : ''}
      </div>
      <span class="hist-item__chev">›</span>
    </div>
  </div>`;
}

// consecutive days (ending today or yesterday) with any check-in logged
function checkinStreak() {
  const j = get().journal;
  const logged = (d) => morningDone(j[d]) || eveningDone(j[d]);
  let d = todayISO();
  if (!logged(d)) d = addDaysISO(d, -1);
  let n = 0;
  while (logged(d)) { n++; d = addDaysISO(d, -1); }
  return n;
}

// Gentle backup reminder: months of logs living only in localStorage is a
// dataset one cleared cache away from gone. Quiet when cloud sync is on.
const BACKUP_KEY = 'ct_last_backup';
function backupNudgeHTML() {
  if (store.getConnected() && sync.isConfigured()) return '';
  const s = get();
  if (s.sessions.length + Object.keys(s.journal).length < 3) return '';
  const last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
  if (last && Date.now() - last < 30 * 24 * 3600 * 1000) return '';
  return h`<div class="card">
    <div class="row-between">
      <div><b>💾 Back up your data</b>
        <div class="small muted">${last ? 'Over a month since your last backup.' : 'Your logs live only on this device.'}</div></div>
      <button class="btn btn--sm" id="nudgeExport">⬇ Back up</button>
    </div>
  </div>`;
}

// Log or correct protein for any date (defaults to today).
function proteinPrompt(date) {
  date = date || todayISO();
  const isToday = date === todayISO();
  const cur = get().proteinLog[date] || 0;
  const target = proteinTarget();
  openModal(isToday ? 'Protein today (g)' : `Protein · ${relDay(date)}`, h`
    <div class="small muted" style="margin-bottom:8px">Quick-add a meal, or set the day's total. Target: <b>${target} g</b>.</div>
    <div class="btn-row mb">
      ${[10, 20, 30, 40].map((g) => `<button class="btn btn--sm" data-padd="${g}">＋${g}g</button>`).join('')}
    </div>
    <label class="field"><span>Total protein consumed ${isToday ? 'today' : 'that day'}</span>
      <input type="number" id="pval" inputmode="numeric" value="${cur}" /></label>
    <button class="btn btn--primary" id="psave">Save</button>
  `);
  modalRoot.querySelectorAll('[data-padd]').forEach((b) => b.addEventListener('click', () => {
    const el = document.getElementById('pval');
    el.value = Math.max(0, (Number(el.value) || 0) + Number(b.dataset.padd));
    haptic(8);
  }));
  document.getElementById('psave').addEventListener('click', () => {
    const v = Math.max(0, Number(document.getElementById('pval').value) || 0);
    update((s) => { s.proteinLog[date] = v; });
    closeModal(); toast('Protein logged'); render();
  });
}

// ================= LOG =================
// The 'log' tab only ever shows an in-progress workout or draft; picking WHAT
// to log happens in a bottom sheet (openLogSheet) available from any screen.
function renderLog() {
  if (workout) return renderWorkout();
  if (draft) return renderDraft();
  setTab('today');
  openLogSheet();
}

// Bottom sheet with everything you can log, grouped by intent.
function openLogSheet(date) {
  const tpl = nextTemplate();
  openModal('', h`
    <div class="section-label" style="margin-top:0">Train</div>
    <div class="logchoice">
      <button class="logchoice__btn logchoice__btn--hero" data-log="guided">
        <span class="logchoice__ico">🏋️</span>
        <span><span class="logchoice__t">Guided workout</span><span class="logchoice__d">Next up: ${esc(tpl.name)} — targets set, rest timer, auto-progression</span></span>
      </button>
      <button class="logchoice__btn" data-log="strength">
        <span class="logchoice__ico">📝</span>
        <span><span class="logchoice__t">Free-form strength</span><span class="logchoice__d">Any exercises, sets, reps & RIR</span></span>
      </button>
      <button class="logchoice__btn" data-log="zone2">
        <span class="logchoice__ico">🚴</span>
        <span><span class="logchoice__t">Zone 2 cardio</span><span class="logchoice__d">Easy, conversational — aerobic base</span></span>
      </button>
      <button class="logchoice__btn" data-log="interval">
        <span class="logchoice__ico">🔥</span>
        <span><span class="logchoice__t">Intervals</span><span class="logchoice__d">Your one hard cardio day per week</span></span>
      </button>
      <button class="logchoice__btn" data-log="activity">
        <span class="logchoice__ico">🧗</span>
        <span><span class="logchoice__t">Other activity</span><span class="logchoice__d">Climbing, outdoor ride, hike…</span></span>
      </button>
    </div>
    <div class="section-label">Check in</div>
    <div class="logchoice">
      <button class="logchoice__btn" data-log="morning">
        <span class="logchoice__ico">🌅</span>
        <span><span class="logchoice__t">Morning check-in</span><span class="logchoice__d">Sleep, weigh-in & how you woke up</span></span>
      </button>
      <button class="logchoice__btn" data-log="evening">
        <span class="logchoice__ico">🌙</span>
        <span><span class="logchoice__t">Evening check-in</span><span class="logchoice__d">Drinks, stress & notes on the day</span></span>
      </button>
    </div>
  `);
  modalRoot.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => {
    closeModal();
    if (b.dataset.log === 'guided') templatePickerForWorkout();
    else startDraft(b.dataset.log, date);
  }));
}

function templatePickerForWorkout() {
  const body = TEMPLATES.map((t, i) => h`<div class="ex-pick" data-tpl="${i}">
    <div><div class="ex-pick__name">${esc(t.name)}</div><div class="ex-pick__meta">${esc(t.desc)}</div></div>
    <span class="linkbtn">Start</span>
  </div>`).join('');
  openModal('Choose a workout', body);
  modalRoot.querySelectorAll('[data-tpl]').forEach((el) => el.addEventListener('click', () => {
    closeModal(); startWorkout(TEMPLATES[el.dataset.tpl]);
  }));
}

// ================= GUIDED WORKOUT (StrongLifts-style) =================
function startWorkout(tpl) {
  const exs = tpl.exercises
    .map((name) => get().exercises.find((e) => e.name.toLowerCase() === name.toLowerCase() && !e.archived))
    .filter(Boolean);
  workout = {
    templateName: tpl.name,
    date: todayISO(),
    startedAt: new Date().toISOString(),
    exercises: exs.map((ex) => workoutExercise(ex)),
  };
  timer.stop();
  logReturn = null; // a finished/discarded workout always lands on Today
  setTab('log');
}

// Build the in-progress state for one exercise: weight = TOP set; work sets
// pyramid up to it (see pyramidSets), each carrying its own weight & rep target.
function workoutExercise(ex) {
  const t = guidedTarget(ex);
  return {
    exerciseId: ex.id,
    weight: t.weight,          // top-set weight (what progression moves)
    targetReps: t.reps,
    unit: t.unit,
    sets: pyramidSets(ex).map((ps) => ({ weight: ps.weight, target: ps.reps, reps: ps.reps, done: false })),
    warmDone: [],   // ephemeral warm-up completion flags (not saved)
    difficulty: null,
  };
}

function renderWorkout() {
  titleEl.textContent = workout.templateName;
  weekLabelEl.textContent = '';
  const bar = get().settings.barWeightLb;

  // overall progress across all work sets
  let totalSets = 0, doneSets = 0;
  workout.exercises.forEach((w) => { totalSets += w.sets.length; doneSets += w.sets.filter((s) => s.done).length; });
  const progressPct = totalSets ? (doneSets / totalSets) * 100 : 0;

  const blocks = workout.exercises.map((w, wi) => {
    const ex = exerciseById(w.exerciseId) || { name: '?', unit: w.unit };
    const isBar = w.unit !== 'bw' && w.unit !== 'sec';

    // pyramid: does this lift ramp across its work sets?
    const ramps = isBar && w.sets.length > 1 && w.sets.some((s) => s.weight !== w.sets[0].weight);

    // warm-up ramp (barbell only) — ephemeral guidance. When the work sets
    // themselves pyramid, they do most of the warming up, so ramp only to the
    // FIRST work set (usually collapses to just the empty bar).
    const warm = isBar ? warmupSets(ramps ? w.sets[0].weight : w.weight, bar) : [];
    const warmHTML = warm.length ? h`<div class="warmup">
        <span class="warmup__label">Warm-up</span>
        <div class="warmup__dots">${warm.map((ws, i) => h`<button class="warmdot ${w.warmDone[i] ? 'is-done' : ''}" data-warm="${wi}:${i}">
          <b>${ws.weight}</b><small>×${ws.reps}</small></button>`).join('')}</div>
      </div>` : '';

    const setCircles = w.sets.map((st, si) => {
      const tr = st.target != null ? st.target : w.targetReps;
      const dot = h`<button class="setdot ${st.done ? 'is-done' : ''} ${st.done && st.reps < tr ? 'is-miss' : ''}"
        data-set="${wi}:${si}">${st.done ? st.reps : (w.unit === 'sec' ? '⏱' : tr)}</button>`;
      return isBar ? h`<div class="setcol">${dot}<span class="setcol__wt ${si === w.sets.length - 1 ? 'is-top' : ''}">${st.weight}</span></div>` : dot;
    }).join('');
    const allDone = w.sets.every((s) => s.done);
    const diffSel = ['easy', 'good', 'hard', 'failed'].map((d) => h`<button class="diffbtn ${w.difficulty === d ? 'is-sel diff--' + d : ''}" data-diff="${wi}:${d}">${diffLabel(d)}</button>`).join('');
    return h`<div class="wex ${allDone && w.difficulty ? 'is-complete' : ''}">
      <div class="wex__head">
        <div class="wex__name">${esc(ex.name)}</div>
        ${isBar
          ? `<div class="wex__wt"><button class="stepper" data-wt="${wi}:-">−</button><span>${fmtWeight(w.weight, w.unit)}</span><button class="stepper" data-wt="${wi}:+">+</button></div>`
          : `<div class="wex__wt wex__wt--bw">${w.unit === 'bw' ? 'Bodyweight' : 'Timed'}</div>`}
      </div>
      ${isBar ? plateVizHTML(w.weight) : ''}
      ${warmHTML}
      <div class="wex__scheme muted small">${ramps
        ? `Pyramid up to ${fmtWeight(w.weight, w.unit)} · tap a set, tap again if you missed reps`
        : `${w.sets.length} × ${w.targetReps}${w.unit === 'sec' ? 's' : ' reps'} · tap a set, tap again if you missed reps`}</div>
      <div class="setdots">${setCircles}</div>
      <div class="wex__diff ${allDone ? '' : 'is-dim'}">
        <span class="wex__diff-label">How hard?</span>
        <div class="diffbtns">${diffSel}</div>
      </div>
    </div>`;
  }).join('');

  viewEl.innerHTML = h`
    <div class="wtop">
      <button class="linkbtn" id="woCancel">✕ Cancel</button>
      <span class="muted small">${fmtDate(workout.date)}</span>
    </div>
    <div class="wprogress">
      <div class="wprogress__bar"><div class="wprogress__fill" style="width:${progressPct.toFixed(0)}%"></div></div>
      <div class="wprogress__txt">${doneSets} / ${totalSets} sets</div>
    </div>
    ${blocks}
    <button class="btn btn--primary btn--lg" id="woFinish">Finish workout ✓</button>
    <button class="btn btn--ghost mt" id="woAddEx">＋ Add exercise</button>
    <div style="height:64px"></div>
  `;

  // set circle tap: cycle done@target -> done@reps-1 -> ... -> done@0 -> not done
  viewEl.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
    const [wi, si] = b.dataset.set.split(':').map(Number);
    const st = workout.exercises[wi].sets[si];
    const tr = st.target != null ? st.target : workout.exercises[wi].targetReps;
    if (!st.done) { st.done = true; st.reps = tr; timer.start(); haptic(15); }
    else if (st.reps > 0) { st.reps -= 1; haptic(8); }
    else { st.done = false; st.reps = tr; }
    renderWorkout();
  }));
  viewEl.querySelectorAll('[data-warm]').forEach((b) => b.addEventListener('click', () => {
    const [wi, i] = b.dataset.warm.split(':').map(Number);
    workout.exercises[wi].warmDone[i] = !workout.exercises[wi].warmDone[i];
    haptic(8);
    renderWorkout();
  }));
  viewEl.querySelectorAll('[data-wt]').forEach((b) => b.addEventListener('click', () => {
    const [wi, dir] = b.dataset.wt.split(':');
    const w = workout.exercises[wi];
    const step = 5;
    w.weight = Math.max(0, Math.round((w.weight + (dir === '+' ? step : -step)) / 2.5) * 2.5);
    // the stepper moves the TOP set; re-anchor the whole pyramid to it
    const ex = exerciseById(w.exerciseId);
    if (ex) {
      const ramp = pyramidSets(ex, w.weight);
      w.sets.forEach((st, i) => { if (ramp[i]) st.weight = ramp[i].weight; });
    } else {
      w.sets.forEach((st) => { st.weight = w.weight; });
    }
    renderWorkout();
  }));
  viewEl.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    const [wi, d] = b.dataset.diff.split(':');
    workout.exercises[wi].difficulty = d;
    renderWorkout();
  }));
  document.getElementById('woCancel').addEventListener('click', () => {
    openModal('Cancel workout?', `<p class="muted">This discards the in-progress workout. Nothing is saved.</p>
      <div class="btn-row mt"><button class="btn btn--ghost" id="woKeep">Keep going</button><button class="btn btn--danger" id="woDiscard">Discard</button></div>`);
    document.getElementById('woKeep').addEventListener('click', closeModal);
    document.getElementById('woDiscard').addEventListener('click', () => { workout = null; timer.stop(); closeModal(); setTab('today'); });
  });
  document.getElementById('woFinish').addEventListener('click', finishWorkout);
  document.getElementById('woAddEx').addEventListener('click', addExerciseToWorkout);
}

// Colored plate visual for one side of the bar.
function plateVizHTML(total) {
  const { perSide, loadable } = platesFor(total);
  const pills = perSide.map((p) => `<span class="plate" style="--pc:${plateColor(p)}">${Number.isInteger(p) ? p : p.toFixed(1)}</span>`).join('');
  return h`<div class="wex__plates">
    <span class="wex__bar">▬</span>${pills || '<span class="muted small">bar only</span>'}
    <span class="wex__plates-side muted">${loadable ? '/ side' : 'not loadable'}</span>
  </div>`;
}

function addExerciseToWorkout() {
  const exs = get().exercises.filter((e) => !e.archived && e.type === 'strength');
  const body = exs.map((e) => h`<div class="ex-pick" data-pick="${e.id}">
    <div><div class="ex-pick__name">${esc(e.name)}</div><div class="ex-pick__meta">${e.muscles.join(', ')}</div></div>
    <span class="linkbtn">Add</span></div>`).join('');
  openModal('Add exercise', body);
  modalRoot.querySelectorAll('[data-pick]').forEach((el) => el.addEventListener('click', () => {
    const ex = exerciseById(el.dataset.pick);
    workout.exercises.push(workoutExercise(ex));
    closeModal(); renderWorkout();
  }));
}

// Difficulty rating -> approximate reps-in-reserve, so guided sets keep an
// effort signal for analysis instead of a blank RIR.
const DIFF_RIR = { easy: 3, good: 2, hard: 1, failed: 0 };

function finishWorkout() {
  const done = workout.exercises.filter((w) => w.sets.some((s) => s.done));
  if (!done.length) { toast('Complete at least one set'); return; }
  const now = new Date().toISOString();
  const summary = [];
  update((s) => {
    const entries = done.map((w) => {
      const ex = s.exercises.find((e) => e.id === w.exerciseId);
      const rir = w.difficulty != null && DIFF_RIR[w.difficulty] != null ? DIFF_RIR[w.difficulty] : '';
      // keep EVERY planned set — missed ones as reps 0 — so planned-vs-completed
      // compliance survives into history and the CSV. Pyramid sets each carry
      // their own weight and rep target.
      const sets = w.sets.map((st) => ({
        weight: w.unit === 'bw' ? 0 : (st.weight != null ? st.weight : w.weight),
        target: st.target != null ? st.target : w.targetReps,
        reps: st.done ? Number(st.reps) : 0,
        rir: st.done ? rir : '',
        completed: !!st.done,
      }));
      let outcome = null;
      if (ex) {
        outcome = applyWorkoutResult(ex, sets, w.difficulty, w.unit === 'bw' ? 0 : w.weight);
        ex._u = now; // per-record stamp for merge sync
      }
      if (ex && outcome) summary.push({ name: ex.name, ...outcome, unit: w.unit });
      return {
        exerciseId: w.exerciseId,
        exSnapshot: ex ? { name: ex.name, muscles: ex.muscles, pattern: ex.pattern, unit: ex.unit } : null,
        target: { sets: w.sets.length, reps: w.targetReps, weight: w.unit === 'bw' ? 0 : w.weight },
        sets, difficulty: w.difficulty,
      };
    });
    s.sessions.push({
      id: uid(), kind: 'strength', date: workout.date, templateName: workout.templateName,
      entries, note: '', startedAt: workout.startedAt, finishedAt: now, updatedAt: now,
    });
  });
  workout = null;
  timer.stop();
  showWorkoutSummary(summary);
}

function showWorkoutSummary(summary) {
  const prCount = summary.filter((o) => o.pr).length;
  const rows = summary.map((o) => {
    let pill, detail;
    if (o.byReps) { pill = `<span class="pill pill--up">▲ Progress</span>`; detail = 'Add reps next time'; }
    else if (o.outcome === 'progress') { pill = `<span class="pill pill--up">▲ +${o.delta}</span>`; detail = `${fmtWeight(o.from, o.unit)} → <b>${fmtWeight(o.to, o.unit)}</b>`; }
    else if (o.outcome === 'deload') { pill = `<span class="pill pill--rep">▼ Deload</span>`; detail = `${fmtWeight(o.from, o.unit)} → <b>${fmtWeight(o.to, o.unit)}</b> (3 misses)`; }
    else { pill = `<span class="pill pill--hold">Hold</span>`; detail = `Repeat ${fmtWeight(o.to, o.unit)}${o.fails ? ` · miss ${o.fails}/3` : ''}`; }
    const prTag = o.pr ? '<span class="pr-tag">🏆 PR</span> ' : '';
    return h`<div class="suggest"><div><div class="suggest__name">${prTag}${esc(o.name)}</div><div class="suggest__detail">${detail}</div></div>${pill}</div>`;
  }).join('');
  if (prCount) haptic([20, 60, 20, 60, 40]);
  openModal(prCount ? `🏆 ${prCount} new PR${prCount > 1 ? 's' : ''}!` : 'Workout saved 💪', h`
    <p class="small muted">Next targets are set automatically:</p>
    ${rows || '<div class="muted small">Logged.</div>'}
    <button class="btn btn--primary mt" id="woDone">Done</button>
  `);
  document.getElementById('woDone').addEventListener('click', () => { closeModal(); setTab('today'); });
}

function diffLabel(d) { return { easy: '😌 Easy', good: '🙂 Good', hard: '😤 Hard', failed: '✗ Failed' }[d] || d; }

// Where to land when a log flow (draft editor / check-in) saves or cancels:
// back to the screen it was opened from, so editing an old entry from a day
// view or History returns you there instead of dumping you on Today.
let logReturn = null;
function enterLog() {
  if (currentTab !== 'log') logReturn = { tab: currentTab, day: dayDetail };
  setTab('log');
}
function exitLog() {
  const r = logReturn; logReturn = null;
  if (r && r.day) {
    currentTab = r.tab === 'today' ? 'today' : 'history';
    highlightTab(currentTab);
    openDay(r.day);
  } else if (r && r.tab && r.tab !== 'log') {
    setTab(r.tab);
  } else {
    setTab('today');
  }
}

// Start a fresh draft; `date` (optional) backdates it — used by the day view
// to add a forgotten session to a past day.
function startDraft(kind, date) {
  date = date || todayISO();
  if (kind === 'strength') {
    draft = { kind: 'strength', date, entries: [], note: '' };
  } else if (kind === 'zone2' || kind === 'interval') {
    draft = { kind: 'cardio', cardioType: kind, date, durationMin: kind === 'interval' ? 25 : 50, avgHR: '', note: '' };
  } else if (kind === 'activity') {
    draft = { kind: 'activity', activity: 'climbing', date, durationMin: 60, note: '' };
  } else if (kind === 'morning' || kind === 'evening') {
    openCheckin(date, kind);
    return;
  } else return;
  enterLog();
}

// Open the daily check-in for a date & part (pre-filled if one exists). Jumps to Log.
// The morning check-in also surfaces YESTERDAY's alcohol (people rarely log it
// the same evening); it's stored on the day it was drunk, so the
// drinks -> next-morning-sleep correlation stays clean.
function openCheckin(date, part) {
  date = date || todayISO();
  const yd = get().journal[addDaysISO(date, -1)] || {};
  draft = {
    kind: 'journal', part: part || defaultCheckinPart(), date,
    entry: { ...(get().journal[date] || {}) },
    yDrinks: yd.drinks ?? null, yDrinks0: yd.drinks ?? null,
  };
  if (currentTab === 'log') renderDraft(); else enterLog();
}

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function renderDraft() {
  if (draft.kind === 'strength') return renderStrengthDraft();
  if (draft.kind === 'cardio') return renderCardioDraft();
  if (draft.kind === 'activity') return renderActivityDraft();
  if (draft.kind === 'journal') return renderCheckinDraft();
}

// ---- strength draft ----
function renderStrengthDraft() {
  const entriesHTML = draft.entries.map((entry, ei) => {
    const ex = exerciseById(entry.exerciseId);
    if (!ex) return '';
    const sug = suggestNext(ex);
    const rows = entry.sets.map((st, si) => h`<div class="setrow" data-ei="${ei}" data-si="${si}">
      <span class="setrow__n">${si + 1}</span>
      ${ex.unit === 'bw'
        ? `<input disabled value="BW" style="opacity:.5" />`
        : `<input type="number" inputmode="decimal" class="s-weight" placeholder="wt" value="${st.weight ?? ''}" />`}
      <input type="number" inputmode="numeric" class="s-reps" placeholder="reps" value="${st.reps ?? ''}" />
      <input type="number" inputmode="numeric" class="s-rir" placeholder="RIR" value="${st.rir ?? ''}" />
      <button class="setrow__del" data-delset>×</button>
    </div>`).join('');
    return h`<div class="ex-block" data-ex="${ei}">
      <div class="ex-block__head">
        <div>
          <div class="ex-block__name">${esc(ex.name)}</div>
          <div class="ex-block__meta">
            ${PATTERN_LABEL[ex.pattern] || ex.pattern} · ${ex.muscles.map((m) => `<span class="tag">${m}</span>`).join('')}
          </div>
          <div class="ex-block__sugg">💡 ${esc(sug.text)}</div>
        </div>
        <button class="setrow__del" data-delex="${ei}">🗑</button>
      </div>
      <div class="setrow setrow__head">
        <span></span><span>${ex.unit === 'bw' ? '' : 'Weight'}</span><span>Reps</span><span>RIR</span><span></span>
      </div>
      ${rows}
      <button class="btn btn--sm btn--ghost" data-addset="${ei}" style="width:100%;margin-top:4px">＋ Add set</button>
    </div>`;
  }).join('');

  viewEl.innerHTML = h`
    <div class="card">
      <label class="field"><span>Date</span><input type="date" id="dDate" value="${draft.date}" /></label>
      <div class="btn-row mb">
        <button class="btn btn--sm" id="pickTemplate">📋 Use template</button>
        <button class="btn btn--sm" id="addExercise">＋ Add exercise</button>
      </div>
    </div>
    ${draft.entries.length ? entriesHTML : `<div class="empty"><div class="empty__ico">🏋️</div>Add an exercise or start from a template.</div>`}
    <label class="field"><span>Session note (optional)</span><input type="text" id="dNote" placeholder="how it felt…" value="${esc(draft.note)}" /></label>
    <div class="btn-row">
      <button class="btn btn--ghost" id="cancelDraft">Cancel</button>
      <button class="btn btn--primary" id="saveDraft">Save session</button>
    </div>
  `;

  document.getElementById('dDate').addEventListener('change', (e) => { draft.date = e.target.value; });
  document.getElementById('dNote').addEventListener('input', (e) => { draft.note = e.target.value; });
  document.getElementById('addExercise').addEventListener('click', () => exercisePicker());
  document.getElementById('pickTemplate').addEventListener('click', templatePicker);
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; exitLog(); });
  document.getElementById('saveDraft').addEventListener('click', saveStrengthDraft);

  // capture set input edits
  viewEl.querySelectorAll('.setrow').forEach((row) => {
    const ei = row.dataset.ei, si = row.dataset.si;
    if (ei == null) return;
    row.querySelector('.s-weight')?.addEventListener('input', (e) => { draft.entries[ei].sets[si].weight = e.target.value; });
    row.querySelector('.s-reps')?.addEventListener('input', (e) => { draft.entries[ei].sets[si].reps = e.target.value; });
    row.querySelector('.s-rir')?.addEventListener('input', (e) => { draft.entries[ei].sets[si].rir = e.target.value; });
    row.querySelector('[data-delset]')?.addEventListener('click', () => {
      draft.entries[ei].sets.splice(si, 1);
      if (!draft.entries[ei].sets.length) draft.entries[ei].sets.push(blankSet(exerciseById(draft.entries[ei].exerciseId)));
      renderStrengthDraft();
    });
  });
  viewEl.querySelectorAll('[data-addset]').forEach((b) => b.addEventListener('click', () => {
    const ei = b.dataset.addset;
    const ex = exerciseById(draft.entries[ei].exerciseId);
    const last = draft.entries[ei].sets[draft.entries[ei].sets.length - 1];
    draft.entries[ei].sets.push({ weight: last?.weight ?? '', reps: last?.reps ?? '', rir: last?.rir ?? '' });
    renderStrengthDraft();
  }));
  viewEl.querySelectorAll('[data-delex]').forEach((b) => b.addEventListener('click', () => {
    draft.entries.splice(b.dataset.delex, 1); renderStrengthDraft();
  }));
}

function blankSet(ex) {
  const sug = suggestNext(ex);
  return { weight: ex.unit === 'bw' ? '' : (sug.weight || ''), reps: '', rir: ex.targetRIR };
}

function addExerciseToDraft(ex) {
  const sug = suggestNext(ex);
  const nSets = ex.pattern === 'core' ? 3 : 3;
  const sets = [];
  for (let i = 0; i < nSets; i++) sets.push({ weight: ex.unit === 'bw' ? '' : (sug.weight || ''), reps: '', rir: ex.targetRIR });
  draft.entries.push({ exerciseId: ex.id, sets });
}

function exercisePicker() {
  const exs = get().exercises.filter((e) => !e.archived);
  const groups = {};
  exs.forEach((e) => { (groups[e.pattern] = groups[e.pattern] || []).push(e); });
  const order = ['squat', 'hinge', 'push', 'pull', 'core', 'other'];
  const body = order.filter((p) => groups[p]).map((p) => h`
    <div class="section-label">${PATTERN_LABEL[p]}</div>
    ${groups[p].map((e) => h`<div class="ex-pick" data-pick="${e.id}">
      <div><div class="ex-pick__name">${esc(e.name)}</div>
      <div class="ex-pick__meta">${e.muscles.join(', ')} · ${fmtWeight(suggestNext(e).weight, e.unit)}</div></div>
      <span class="linkbtn">Add</span>
    </div>`).join('')}
  `).join('') + `<button class="btn btn--ghost mt" id="newExFromPicker">＋ Create new exercise</button>`;
  openModal('Add exercise', body);
  modalRoot.querySelectorAll('[data-pick]').forEach((el) => el.addEventListener('click', () => {
    addExerciseToDraft(exerciseById(el.dataset.pick)); closeModal(); renderStrengthDraft();
  }));
  document.getElementById('newExFromPicker').addEventListener('click', () => { closeModal(); exerciseEditor(null, (ex) => { addExerciseToDraft(ex); renderStrengthDraft(); }); });
}

function templatePicker() {
  const body = TEMPLATES.map((t, i) => h`<div class="ex-pick" data-tpl="${i}">
    <div><div class="ex-pick__name">${esc(t.name)}</div><div class="ex-pick__meta">${esc(t.desc)}</div></div>
    <span class="linkbtn">Load</span>
  </div>`).join('');
  openModal('Start from a template', body + `<p class="muted small mt">Templates pre-fill exercises with your auto-progression targets. You can edit, add, or remove anything.</p>`);
  modalRoot.querySelectorAll('[data-tpl]').forEach((el) => el.addEventListener('click', () => {
    applyTemplate(TEMPLATES[el.dataset.tpl]); closeModal(); renderStrengthDraft();
  }));
}

function applyTemplate(tpl) {
  draft.entries = [];
  tpl.exercises.forEach((name) => {
    let ex = get().exercises.find((e) => e.name.toLowerCase() === name.toLowerCase() && !e.archived);
    if (ex) addExerciseToDraft(ex);
  });
}

function saveStrengthDraft() {
  const filled = draft.entries.filter((en) => en.sets.some((st) => Number(st.reps) > 0));
  if (!filled.length) { toast('Log at least one set with reps'); return; }
  const editing = !!draft.editId;
  const now = new Date().toISOString();
  update((s) => {
    const entries = filled.map((en) => {
      const ex = exerciseById(en.exerciseId);
      const sets = en.sets.filter((st) => Number(st.reps) > 0).map((st) => ({
        weight: st.weight === '' ? 0 : Number(st.weight), reps: Number(st.reps), rir: st.rir === '' ? '' : Number(st.rir),
      }));
      // editing a past session is a historical correction — don't move current targets
      if (ex && !editing) { commitExerciseState(ex, sets); ex._u = now; }
      return {
        exerciseId: en.exerciseId,
        exSnapshot: ex ? { name: ex.name, muscles: ex.muscles, pattern: ex.pattern, unit: ex.unit }
          : (en.exSnapshot || null),
        sets,
      };
    });
    if (editing) {
      const sess = s.sessions.find((x) => x.id === draft.editId);
      if (sess) { sess.date = draft.date; sess.entries = entries; sess.note = draft.note; sess.updatedAt = now; }
    } else {
      s.sessions.push({ id: uid(), kind: 'strength', date: draft.date, entries, note: draft.note, loggedAt: now, updatedAt: now });
    }
  });
  draft = null; toast(editing ? 'Session updated' : 'Session saved'); exitLog();
}

// ---- cardio draft ----
function distUnit() { return get().settings.units === 'kg' ? 'km' : 'mi'; }

function renderCardioDraft() {
  const isInt = draft.cardioType === 'interval';
  viewEl.innerHTML = h`
    <div class="card">
      <div class="card__title"><h2>${isInt ? '🔥 Intervals' : '🚴 Zone 2 cardio'}</h2></div>
      <p class="muted small">${isInt ? 'Hard efforts — talking broken into a few words.' : 'Easy & conversational. Builds your aerobic base with low fatigue cost.'}</p>
      <label class="field"><span>Date</span><input type="date" id="cDate" value="${draft.date}" /></label>
      <label class="field"><span>Duration (minutes)</span><input type="number" inputmode="numeric" id="cDur" value="${draft.durationMin}" /></label>
      <div class="field-row">
        <label class="field"><span>Average HR (optional)</span><input type="number" inputmode="numeric" id="cHR" value="${draft.avgHR ?? ''}" placeholder="bpm" /></label>
        <label class="field"><span>Distance (${distUnit()}, optional)</span><input type="number" inputmode="decimal" id="cDist" value="${draft.distance ?? ''}" placeholder="0.0" /></label>
      </div>
      <label class="field"><span>Effort (RPE 1 easy – 10 max, optional)</span><input type="number" inputmode="numeric" id="cRpe" min="1" max="10" value="${draft.rpe ?? ''}" placeholder="1–10" /></label>
      <label class="field"><span>Note (optional)</span><input type="text" id="cNote" value="${esc(draft.note)}" /></label>
    </div>
    <div class="btn-row">
      <button class="btn btn--ghost" id="cancelDraft">Cancel</button>
      <button class="btn btn--primary" id="saveCardio">${draft.editId ? 'Update' : 'Save'}</button>
    </div>`;
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; exitLog(); });
  document.getElementById('saveCardio').addEventListener('click', () => {
    const dur = Number(document.getElementById('cDur').value) || 0;
    if (dur <= 0) { toast('Enter a duration'); return; }
    const now = new Date().toISOString();
    const rpeRaw = Number(document.getElementById('cRpe').value);
    const data = {
      kind: 'cardio', cardioType: draft.cardioType, date: document.getElementById('cDate').value,
      durationMin: dur, avgHR: Number(document.getElementById('cHR').value) || null,
      distance: Number(document.getElementById('cDist').value) || null, distanceUnit: distUnit(),
      rpe: rpeRaw >= 1 && rpeRaw <= 10 ? rpeRaw : null,
      note: document.getElementById('cNote').value, updatedAt: now,
    };
    if (data.distance == null) data.distanceUnit = null;
    update((s) => {
      if (draft.editId) {
        const sess = s.sessions.find((x) => x.id === draft.editId);
        if (sess) Object.assign(sess, data);
      } else {
        s.sessions.push({ id: uid(), loggedAt: now, ...data });
      }
    });
    const edited = !!draft.editId;
    draft = null; toast(edited ? 'Cardio updated' : 'Cardio saved'); exitLog();
  });
}

// ---- activity draft ----
function renderActivityDraft() {
  const opts = Object.entries(ACTIVITY_MAP).map(([k, v]) => `<option value="${k}" ${draft.activity === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  const map = ACTIVITY_MAP[draft.activity];
  viewEl.innerHTML = h`
    <div class="card">
      <div class="card__title"><h2>Other activity</h2></div>
      <label class="field"><span>Activity</span><select id="aType">${opts}</select></label>
      <div class="card" style="background:var(--card-2);border:0"><span class="small">↪ ${esc(map.note)}</span></div>
      <label class="field"><span>Date</span><input type="date" id="aDate" value="${draft.date}" /></label>
      <label class="field"><span>Duration (minutes)</span><input type="number" inputmode="numeric" id="aDur" value="${draft.durationMin}" /></label>
      <label class="field"><span>Note (optional)</span><input type="text" id="aNote" value="${esc(draft.note)}" /></label>
    </div>
    <div class="btn-row">
      <button class="btn btn--ghost" id="cancelDraft">Cancel</button>
      <button class="btn btn--primary" id="saveAct">${draft.editId ? 'Update' : 'Save'}</button>
    </div>`;
  document.getElementById('aType').addEventListener('change', (e) => { draft.activity = e.target.value; draft.durationMin = Number(document.getElementById('aDur').value) || draft.durationMin; renderActivityDraft(); });
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; exitLog(); });
  document.getElementById('saveAct').addEventListener('click', () => {
    const dur = Number(document.getElementById('aDur').value) || 0;
    if (dur <= 0) { toast('Enter a duration'); return; }
    const now = new Date().toISOString();
    const data = {
      kind: 'activity', activity: draft.activity, date: document.getElementById('aDate').value,
      durationMin: dur, note: document.getElementById('aNote').value, updatedAt: now,
    };
    update((s) => {
      if (draft.editId) {
        const sess = s.sessions.find((x) => x.id === draft.editId);
        if (sess) Object.assign(sess, data);
      } else {
        s.sessions.push({ id: uid(), loggedAt: now, ...data });
      }
    });
    const edited = !!draft.editId;
    draft = null; toast(edited ? 'Activity updated' : 'Activity saved'); exitLog();
  });
}

// ---- daily check-in / journal draft ----
// The daily check-in is one record per day, captured in two moments:
//   morning  → last night's sleep (times + difficulty), weigh-in, resting HR,
//              waist, energy, soreness, pain areas, yesterday's alcohol
//   evening  → the day itself (drinks, caffeine, calories, stress, flags,
//              pre-sleep activity, notes)
function morningDone(j) {
  return !!(j && (j.sleepDiff || j.bw != null || j.bedTime || j.wakeTime || j.rhr != null ||
    j.waist != null || j.energy || j.soreness || (j.pain || []).length || (j.amNote || '').trim()));
}
function eveningDone(j) {
  return !!(j && (j.drinks != null || j.caffeine != null || j.kcal != null || j.stress ||
    (j.flags || []).length || (j.preSleep || '').trim() || (j.notes || '').trim()));
}
function defaultCheckinPart() { return new Date().getHours() < 14 ? 'morning' : 'evening'; }

const PAIN_AREAS = ['Neck', 'Shoulder', 'Elbow', 'Wrist', 'Lower back', 'Hip', 'Knee', 'Ankle'];
const DAY_FLAGS = [{ k: 'sick', label: '🤒 Sick' }, { k: 'travel', label: '✈️ Travel' }, { k: 'rest', label: '😴 Rest day' }];

// Multi-select chip row; toggles values in draft.entry[name] (an array).
function chipsHTML(name, options, selected) {
  const sel = selected || [];
  return `<div class="rating__btns" style="flex-wrap:wrap">${options.map((o) => {
    const val = o.k || o, label = o.label || o;
    return `<button type="button" class="ratebtn ${sel.includes(val) ? 'is-sel' : ''}" style="flex:0 0 auto;padding:6px 12px;width:auto" data-chip="${name}" data-val="${esc(val)}">${esc(label)}</button>`;
  }).join('')}</div>`;
}

// 'HH:MM' bed/wake times -> minutes asleep (wraps past midnight).
function sleepMinutesFromTimes(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  if ([bh, bm, wh, wm].some((x) => !Number.isFinite(x))) return null;
  let min = (wh * 60 + wm) - (bh * 60 + bm);
  if (min <= 0) min += 24 * 60;
  return min;
}
function fmtSleepMin(min) {
  if (min == null) return '';
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

// waist stored in cm (like bodyweight in kg); shown in the profile's units
const CM_PER_IN = 2.54;
function waistUnit() { return get().settings.units === 'kg' ? 'cm' : 'in'; }
function waistFromCm(cm) { return waistUnit() === 'cm' ? cm : cm / CM_PER_IN; }
function waistToCm(v) { return waistUnit() === 'cm' ? v : v * CM_PER_IN; }

function renderCheckinDraft() {
  const e = draft.entry;
  const part = draft.part || 'morning';
  const u = bwUnit();
  const bwVal = e.bw != null ? fromKg(e.bw, u).toFixed(1) : '';

  const toggle = h`<div class="seg seg--even">
    <button type="button" class="segbtn ${part === 'morning' ? 'is-active' : ''}" data-part="morning">🌅 Morning</button>
    <button type="button" class="segbtn ${part === 'evening' ? 'is-active' : ''}" data-part="evening">🌙 Evening</button>
  </div>`;

  const sleepMin = sleepMinutesFromTimes(e.bedTime, e.wakeTime);
  const waistVal = e.waist != null ? Math.round(waistFromCm(e.waist) * 10) / 10 : '';
  const wu = waistUnit();

  const morning = h`
    <div class="card">
      <div class="card__title"><h2>Sleep</h2><span class="card__hint">last night</span></div>
      <div class="field-row">
        <label class="field"><span>In bed at</span><input type="time" id="jBed" value="${esc(e.bedTime || '')}" /></label>
        <label class="field"><span>Woke at</span><input type="time" id="jWake" value="${esc(e.wakeTime || '')}" /></label>
      </div>
      ${sleepMin != null ? `<div class="small muted" style="margin:-4px 0 10px">≈ <b>${fmtSleepMin(sleepMin)}</b> in bed</div>` : ''}
      <label class="field"><span>Sleep difficulty${e.sleepDiff ? ` · ${SLEEP_LABELS[e.sleepDiff]}` : ''}</span></label>
      ${ratingHTML('sleepDiff', e.sleepDiff, ['1 · easy', '5 · very hard'])}
    </div>
    <div class="card">
      <div class="card__title"><h2>Yesterday</h2><span class="card__hint">catch-up</span></div>
      <label class="field" style="margin:0"><span>Drinks yesterday (alcohol)</span>
        <input type="number" inputmode="numeric" id="jYDrinks" value="${draft.yDrinks ?? ''}" placeholder="0" /></label>
      <div class="small muted mt">Saved to yesterday's record, so alcohol lines up with the night it affected.</div>
    </div>
    <div class="card">
      <div class="card__title"><h2>This morning</h2><span class="card__hint">optional</span></div>
      <label class="field"><span>Bodyweight (${u})</span>
        <input type="number" inputmode="decimal" id="jBw" value="${bwVal}" placeholder="morning weigh-in" /></label>
      <div class="field-row">
        <label class="field"><span>Resting HR (bpm)</span>
          <input type="number" inputmode="numeric" id="jRhr" value="${e.rhr ?? ''}" placeholder="bpm" /></label>
        <label class="field"><span>Waist (${wu})</span>
          <input type="number" inputmode="decimal" id="jWaist" value="${waistVal}" placeholder="optional" /></label>
      </div>
      <label class="field"><span>Energy waking up</span></label>
      ${ratingHTML('energy', e.energy, ['1 · flat', '5 · great'])}
      <label class="field mt"><span>Soreness</span></label>
      ${ratingHTML('soreness', e.soreness, ['1 · none', '5 · very sore'])}
      <label class="field mt"><span>Pain or niggles</span></label>
      ${chipsHTML('pain', PAIN_AREAS, e.pain)}
      <label class="field mt" style="margin-bottom:0"><span>Sleep notes</span>
        <input type="text" id="jAmNote" value="${esc(e.amNote || '')}" placeholder="woke at 3am, vivid dreams…" /></label>
    </div>`;

  const evening = h`
    <div class="card">
      <div class="card__title"><h2>The day</h2><span class="card__hint">this evening</span></div>
      <div class="field-row">
        <label class="field"><span>Drinks (alcohol)</span>
          <input type="number" inputmode="numeric" id="jDrinks" value="${e.drinks ?? ''}" placeholder="0" /></label>
        <label class="field"><span>Caffeine (drinks)</span>
          <input type="number" inputmode="numeric" id="jCaffeine" value="${e.caffeine ?? ''}" placeholder="0" /></label>
      </div>
      <label class="field"><span>Calories (rough, optional)</span>
        <input type="number" inputmode="numeric" id="jKcal" value="${e.kcal ?? ''}" placeholder="kcal" /></label>
      <label class="field"><span>Stress today</span></label>
      ${ratingHTML('stress', e.stress, ['1 · calm', '5 · high'])}
      <label class="field mt"><span>Day flags</span></label>
      ${chipsHTML('flags', DAY_FLAGS, e.flags)}
      <label class="field mt"><span>Pre-sleep activity</span>
        <input type="text" id="jPre" value="${esc(e.preSleep || '')}" placeholder="screens, reading, stretching…" /></label>
    </div>
    <div class="card">
      <label class="field" style="margin:0"><span>Notes on the day</span>
        <textarea id="jNotes" rows="3" placeholder="how the day went, training, food…">${esc(e.notes || '')}</textarea></label>
    </div>`;

  viewEl.innerHTML = h`
    <div class="card">
      <div class="card__title"><h2>${part === 'morning' ? '🌅 Morning check-in' : '🌙 Evening check-in'}</h2><span class="card__hint">${relDay(draft.date)}</span></div>
      <p class="small muted" style="margin:2px 0 12px">${part === 'morning' ? 'How you slept and how you woke up.' : 'How the day itself went.'}</p>
      ${toggle}
      <label class="field" style="margin:0"><span>Date</span><input type="date" id="jDate" value="${draft.date}" /></label>
    </div>
    ${part === 'morning' ? morning : evening}
    <div class="btn-row">
      <button class="btn btn--ghost" id="cancelDraft">Cancel</button>
      <button class="btn btn--primary" id="saveJournal">Save check-in</button>
    </div>
    <div style="height:8px"></div>
  `;

  // capture inputs live so switching Morning/Evening never loses what's typed
  const bindText = (id, key) => { const el = document.getElementById(id); if (el) el.addEventListener('input', (ev) => { draft.entry[key] = ev.target.value; }); };
  bindText('jPre', 'preSleep');
  bindText('jNotes', 'notes');
  bindText('jAmNote', 'amNote');
  const bindNum = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', (ev) => { const v = ev.target.value; draft.entry[key] = v === '' ? null : Math.max(0, Number(v) || 0); });
  };
  bindNum('jDrinks', 'drinks');
  bindNum('jCaffeine', 'caffeine');
  bindNum('jKcal', 'kcal');
  bindNum('jRhr', 'rhr');
  const bwEl = document.getElementById('jBw');
  if (bwEl) bwEl.addEventListener('input', (ev) => { const v = ev.target.value; draft.entry.bw = v === '' ? null : toKg(Number(v) || 0, u); });
  const waistEl = document.getElementById('jWaist');
  if (waistEl) waistEl.addEventListener('input', (ev) => { const v = ev.target.value; draft.entry.waist = v === '' ? null : waistToCm(Number(v) || 0); });
  const ydEl = document.getElementById('jYDrinks');
  if (ydEl) ydEl.addEventListener('input', (ev) => { const v = ev.target.value; draft.yDrinks = v === '' ? null : Math.max(0, Number(v) || 0); });
  // bed/wake times re-render so the "≈ 7h 30m" hint stays live
  const bindTime = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', (ev) => { draft.entry[key] = ev.target.value || null; renderCheckinDraft(); });
  };
  bindTime('jBed', 'bedTime');
  bindTime('jWake', 'wakeTime');

  document.getElementById('jDate').addEventListener('change', (ev) => {
    draft.date = ev.target.value;
    const yd = get().journal[addDaysISO(draft.date, -1)] || {};
    draft.yDrinks = yd.drinks ?? null; draft.yDrinks0 = yd.drinks ?? null;
    renderCheckinDraft();
  });
  viewEl.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => { draft.part = b.dataset.part; renderCheckinDraft(); }));
  viewEl.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.rate, val = Number(b.dataset.val);
    draft.entry[key] = draft.entry[key] === val ? null : val;
    haptic(8); renderCheckinDraft();
  }));
  viewEl.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.chip, val = b.dataset.val;
    const arr = Array.isArray(draft.entry[key]) ? draft.entry[key].slice() : [];
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1); else arr.push(val);
    draft.entry[key] = arr;
    haptic(8); renderCheckinDraft();
  }));
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; exitLog(); });
  document.getElementById('saveJournal').addEventListener('click', saveCheckin);
}

// Merge-save: draft.entry started as a copy of the day's record and inputs
// update it live, so persisting the whole thing preserves the other half.
// Yesterday's drinks (from the morning catch-up) are written to yesterday's
// record so alcohol stays attributed to the day it was consumed.
function saveCheckin() {
  const e = draft.entry;
  const now = new Date().toISOString();
  const entry = {
    bw: e.bw != null ? e.bw : null,
    bedTime: e.bedTime || null,
    wakeTime: e.wakeTime || null,
    sleepMin: sleepMinutesFromTimes(e.bedTime, e.wakeTime),
    sleepDiff: e.sleepDiff || null,
    rhr: e.rhr != null ? e.rhr : null,
    waist: e.waist != null ? Math.round(e.waist * 10) / 10 : null,
    energy: e.energy || null, soreness: e.soreness || null, stress: e.stress || null,
    pain: Array.isArray(e.pain) && e.pain.length ? e.pain : null,
    drinks: e.drinks != null ? e.drinks : null,
    caffeine: e.caffeine != null ? e.caffeine : null,
    kcal: e.kcal != null ? e.kcal : null,
    flags: Array.isArray(e.flags) && e.flags.length ? e.flags : null,
    preSleep: (e.preSleep || '').trim(),
    amNote: (e.amNote || '').trim(),
    notes: (e.notes || '').trim(),
    _u: now,
  };
  const yChanged = draft.yDrinks !== draft.yDrinks0;
  if (!morningDone(entry) && !eveningDone(entry) && !yChanged) { toast('Nothing to save yet'); return; }
  const date = draft.date;
  const partLabel = draft.part === 'evening' ? 'Evening' : 'Morning';
  update((s) => {
    if (morningDone(entry) || eveningDone(entry) || s.journal[date]) s.journal[date] = entry;
    if (yChanged) {
      const yDate = addDaysISO(date, -1);
      s.journal[yDate] = { ...(s.journal[yDate] || {}), drinks: draft.yDrinks, _u: now };
    }
    if (entry.bw != null) s.settings.bodyweightKg = Math.round(entry.bw * 10) / 10; // keep profile fresh
  });
  draft = null; toast(`${partLabel} check-in saved`); exitLog();
}

// ================= PROGRESS =================
function compact(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function e1rm(w, reps) { return w * (1 + reps / 30); }

// Best training metric for one exercise's logged sets:
// weighted -> estimated 1RM (Epley); bodyweight -> top reps; timed -> top seconds.
function exerciseMetric(ex, sets) {
  const working = (sets || []).filter((st) => Number(st.reps) > 0);
  if (!working.length) return null;
  if (ex.unit === 'bw' || ex.unit === 'sec') return Math.max(...working.map((st) => Number(st.reps)));
  return Math.round(Math.max(...working.map((st) => e1rm(Number(st.weight) || 0, Number(st.reps)))));
}
function metricKind(ex) { return ex.unit === 'bw' ? 'reps' : ex.unit === 'sec' ? 'sec' : 'e1RM'; }
function fmtMetric(ex, v) { return ex.unit === 'sec' ? `${v}s` : ex.unit === 'bw' ? `${v} reps` : `${compact(v)} ${ex.unit}`; }

// Build the last N Monday-anchored weeks (oldest first).
function lastNWeeks(n) {
  const base = weekStart(new Date());
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(base); s.setDate(s.getDate() - i * 7);
    const e = new Date(s); e.setDate(e.getDate() + 6);
    weeks.push({
      start: s, startISO: toISODate(s), endISO: toISODate(e),
      label: s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }
  return weeks;
}

// Progress is split into three focused segments instead of one endless scroll:
// Training (volume & strength), Body (weight, waist, protein), Recovery
// (readiness, sleep, load & insights).
function renderProgress() {
  titleEl.textContent = 'Progress';
  const segs = [['training', 'Training'], ['body', 'Body'], ['recovery', 'Recovery']];
  const segBar = `<div class="seg seg--even seg--3">${segs.map(([k, l]) =>
    `<button class="segbtn ${progressSeg === k ? 'is-active' : ''}" data-seg="${k}">${l}</button>`).join('')}</div>`;
  const body = progressSeg === 'body' ? progressBodyHTML()
    : progressSeg === 'recovery' ? progressRecoveryHTML()
    : progressTrainingHTML();
  viewEl.innerHTML = segBar + body;

  viewEl.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => {
    if (progressSeg === b.dataset.seg) return;
    progressSeg = b.dataset.seg; renderProgress(); window.scrollTo(0, 0);
  }));
  viewEl.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    progressSel = b.dataset.ex; renderProgress();
  }));
  viewEl.querySelectorAll('[data-exdetail]').forEach((b) => b.addEventListener('click', () => openExerciseDetail(b.dataset.exdetail)));
  mountTips(viewEl);
}

// ---- Training segment ----
function progressTrainingHTML() {
  const sessions = get().sessions;
  const strengthSessions = sessions.filter((s) => s.kind === 'strength');

  if (!sessions.length) {
    return `<div class="empty"><div class="empty__ico">📈</div>No data to chart yet.<br>Log a few sessions and your progress shows up here.</div>`;
  }

  // ---- headline stats ----
  const weeks12 = lastNWeeks(12);
  const volOfWeek = (w) => sessions.filter((s) => s.kind === 'strength' && s.date >= w.startISO && s.date <= w.endISO)
    .reduce((a, s) => a + sessionVolume(s), 0);
  const thisVol = volOfWeek(weeks12[weeks12.length - 1]);
  const lastVol = volOfWeek(weeks12[weeks12.length - 2]);
  const volDelta = lastVol > 0 ? Math.round(((thisVol - lastVol) / lastVol) * 100) : null;

  // training streak: consecutive most-recent weeks that have any session
  const hasAny = (w) => sessions.some((s) => s.date >= w.startISO && s.date <= w.endISO);
  let streak = 0;
  for (let i = weeks12.length - 1; i >= 0; i--) { if (hasAny(weeks12[i])) streak++; else break; }

  // best estimated 1RM across weighted lifts
  let best = null;
  strengthSessions.forEach((s) => (s.entries || []).forEach((en) => {
    const ex = entryExercise(en);
    if (!ex || ex.unit === 'bw' || ex.unit === 'sec') return;
    const m = exerciseMetric(ex, en.sets);
    if (m != null && (!best || m > best.v)) best = { v: m, name: ex.name, unit: ex.unit };
  }));

  const stats = h`<div class="statgrid">
    <div class="stat">
      <div class="stat__val">${compact(thisVol)}</div>
      <div class="stat__label">Volume (lb)</div>
      ${volDelta != null ? `<div class="stat__sub ${volDelta >= 0 ? 'stat__sub--up' : ''}">${volDelta >= 0 ? '▲' : '▼'} ${Math.abs(volDelta)}% vs last</div>` : '<div class="stat__sub">first week</div>'}
    </div>
    <div class="stat">
      <div class="stat__val">${best ? compact(best.v) : '—'}</div>
      <div class="stat__label">Best e1RM</div>
      <div class="stat__sub">${best ? esc(best.name) : 'log a lift'}</div>
    </div>
    <div class="stat">
      <div class="stat__val">${streak}</div>
      <div class="stat__label">Week streak</div>
      <div class="stat__sub">${strengthSessions.length} lift${strengthSessions.length === 1 ? '' : 's'} total</div>
    </div>
  </div>`;

  // ---- strength progression (per-exercise line chart) ----
  // exercises with >= 2 sessions of usable data, most-logged first
  const perEx = {};
  strengthSessions
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((s) => (s.entries || []).forEach((en) => {
      const ex = entryExercise(en);
      if (!ex) return;
      const m = exerciseMetric(ex, en.sets);
      if (m == null) return;
      (perEx[en.exerciseId] = perEx[en.exerciseId] || { ex, pts: [] }).pts.push({ date: s.date, v: m });
    }));
  const chartable = Object.entries(perEx).filter(([, o]) => o.pts.length >= 2)
    .sort((a, b) => b[1].pts.length - a[1].pts.length);

  let strengthCard;
  if (!chartable.length) {
    strengthCard = h`<div class="card">
      <div class="card__title"><h2>Strength trend</h2><span class="card__hint">est. 1RM</span></div>
      <div class="chart-empty">Log an exercise across at least two sessions to see its curve.</div>
    </div>`;
  } else {
    if (!progressSel || !perEx[progressSel] || perEx[progressSel].pts.length < 2) progressSel = chartable[0][0];
    const seg = chartable.map(([id, o]) =>
      `<button class="segbtn ${id === progressSel ? 'is-active' : ''}" data-ex="${id}">${esc(o.ex.name)}</button>`).join('');
    const o = perEx[progressSel];
    const pts = o.pts.map((p) => ({ t: fmtShort(p.date), full: fmtDate(p.date), v: p.v }));
    strengthCard = h`<div class="card">
      <div class="card__title"><h2>Strength trend</h2><span class="card__hint">${metricKind(o.ex)}</span></div>
      <div class="seg">${seg}</div>
      ${lineChart(pts, { yFmt: (v) => compact(v), valFmt: (v) => fmtMetric(o.ex, v), color: '--chart-1' })}
      <div class="row-between mt"><span></span><button class="linkbtn" data-exdetail="${progressSel}">Full history →</button></div>
    </div>`;
  }

  // ---- weekly training volume (bars) ----
  const weeks8 = lastNWeeks(8);
  const volGroups = weeks8.map((w) => { const v = volOfWeek(w); return { label: w.label, full: `Week of ${w.label}`, total: v, segs: [{ key: 'vol', v }] }; });
  const volCard = h`<div class="card">
    <div class="card__title"><h2>Weekly volume</h2><span class="card__hint">lb lifted · 8 wks</span></div>
    ${volGroups.some((g) => g.total > 0)
      ? barChart(volGroups, [{ key: 'vol', name: 'Volume', color: '--chart-1' }], { yFmt: (v) => compact(v), valFmt: (v) => compact(v) })
      : '<div class="chart-empty">No lifting logged in the last 8 weeks.</div>'}
  </div>`;

  // ---- weekly cardio minutes (stacked: Zone 2 + Intervals) ----
  const cardioSeries = [{ key: 'z2', name: 'Zone 2', color: '--chart-2' }, { key: 'int', name: 'Intervals', color: '--chart-1' }];
  const cardioGroups = weeks8.map((w) => {
    const a = aggregateWeek(new Date(w.start));
    return { label: w.label, full: `Week of ${w.label}`, segs: [{ key: 'z2', v: a.zone2Min }, { key: 'int', v: a.intervalMin }] };
  });
  const cardioCard = h`<div class="card">
    <div class="card__title"><h2>Weekly cardio</h2><span class="card__hint">minutes · 8 wks</span></div>
    ${cardioGroups.some((g) => g.segs.some((s) => s.v > 0))
      ? legend(cardioSeries) + barChart(cardioGroups, cardioSeries, { yFmt: (v) => String(v), valFmt: (v) => `${v}m` })
      : '<div class="chart-empty">No cardio logged in the last 8 weeks.</div>'}
  </div>`;

  return stats + consistencyCard() + strengthCard + volCard + cardioCard;
}

// ---- Body segment: bodyweight, waist & protein adherence ----
function progressBodyHTML() {
  const journal = get().journal;
  const u = bwUnit();

  // bodyweight trend (line, from journal weigh-ins)
  const bwDates = Object.keys(journal).filter((d) => journal[d].bw != null).sort();
  let bwCard = '';
  if (bwDates.length >= 2) {
    const bwPts = bwDates.map((d) => ({ t: fmtShort(d), full: fmtDate(d), v: Math.round(fromKg(journal[d].bw, u) * 10) / 10 }));
    const first = bwPts[0].v, last = bwPts[bwPts.length - 1].v, chg = Math.round((last - first) * 10) / 10;
    bwCard = h`<div class="card">
      <div class="card__title"><h2>Bodyweight</h2><span class="card__hint">${chg >= 0 ? '+' : ''}${chg} ${u} · ${bwPts.length} weigh-ins</span></div>
      ${lineChart(bwPts, { yFmt: (v) => String(v), valFmt: (v) => `${v} ${u}`, color: '--chart-2' })}
    </div>`;
  } else {
    bwCard = h`<div class="card">
      <div class="card__title"><h2>Bodyweight</h2><span class="card__hint">${u}</span></div>
      <div class="chart-empty">Log bodyweight in your daily check-in on two or more days to see the trend.</div>
    </div>`;
  }

  // waist trend (line, from journal measurements)
  const waistDates = Object.keys(journal).filter((d) => journal[d].waist != null).sort();
  let waistCard = '';
  if (waistDates.length >= 2) {
    const wu = waistUnit();
    const wPts = waistDates.map((d) => ({ t: fmtShort(d), full: fmtDate(d), v: Math.round(waistFromCm(journal[d].waist) * 10) / 10 }));
    const wchg = Math.round((wPts[wPts.length - 1].v - wPts[0].v) * 10) / 10;
    waistCard = h`<div class="card">
      <div class="card__title"><h2>Waist</h2><span class="card__hint">${wchg >= 0 ? '+' : ''}${wchg} ${wu} · ${wPts.length} measurements</span></div>
      ${lineChart(wPts, { yFmt: (v) => String(v), valFmt: (v) => `${v} ${wu}`, color: '--chart-1' })}
      <div class="small muted mt">Read with bodyweight: weight up + waist flat skews muscle; both down = fat loss.</div>
    </div>`;
  }

  return bwCard + waistCard + proteinBodyweightCard();
}

// short date for chart x-axis, e.g. "Jul 5"
function fmtShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- 12-week consistency heatmap (GitHub-style, columns = weeks) ----
// Seeing gaps at a glance is the cheapest consistency motivator there is.
function consistencyCard() {
  const s = get();
  const weeks = lastNWeeks(12);
  if (!s.sessions.length) return '';
  // date -> { lift, cardio }
  const byDate = {};
  s.sessions.forEach((x) => {
    const rec = (byDate[x.date] = byDate[x.date] || { lift: false, cardio: false });
    if (x.kind === 'strength') rec.lift = true; else rec.cardio = true;
  });
  const today = todayISO();
  const cells = [];
  weeks.forEach((w) => {
    for (let dow = 0; dow < 7; dow++) {
      const d = addDaysISO(w.startISO, dow);
      const r = byDate[d];
      const future = d > today;
      const color = future ? 'transparent'
        : r && r.lift && r.cardio ? 'var(--good)'
        : r && r.lift ? 'var(--chart-1)'
        : r && r.cardio ? 'var(--chart-2)'
        : 'var(--card-2)';
      const what = r ? [r.lift ? 'lift' : '', r.cardio ? 'cardio' : ''].filter(Boolean).join(' + ') : 'rest';
      cells.push(`<span class="heat__cell" style="background:${color}" title="${esc(fmtDate(d))} · ${what}"></span>`);
    }
  });
  const active = Object.keys(byDate).filter((d) => d >= weeks[0].startISO).length;
  return h`<div class="card">
    <div class="card__title"><h2>Consistency</h2><span class="card__hint">${active} active days · 12 wks</span></div>
    <div class="heat">${cells.join('')}</div>
    <div class="chart__legend">
      <span class="chart__key"><span class="chart__swatch" style="background:var(--chart-1)"></span>Lift</span>
      <span class="chart__key"><span class="chart__swatch" style="background:var(--chart-2)"></span>Cardio</span>
      <span class="chart__key"><span class="chart__swatch" style="background:var(--good)"></span>Both</span>
    </div>
  </div>`;
}

function detailBackBar(label) {
  return h`<div class="wtop"><button class="linkbtn" data-back>← ${esc(label)}</button><span></span></div>`;
}

// ---- exercise detail (drill-down from Progress / History) ----
function renderExerciseDetail(id) {
  const ex = exerciseById(id);
  if (!ex) { exDetail = null; return renderProgress(); }
  titleEl.textContent = ex.name;

  const weighted = ex.unit !== 'bw' && ex.unit !== 'sec';
  const rows = [];
  [...get().sessions].filter((s) => s.kind === 'strength').sort((a, b) => (a.date < b.date ? -1 : 1))
    .forEach((s) => (s.entries || []).forEach((en) => {
      if (en.exerciseId !== id) return;
      const working = (en.sets || []).filter((st) => Number(st.reps) > 0);
      if (!working.length) return;
      const topW = weighted ? Math.max(...working.map((st) => Number(st.weight) || 0)) : Math.max(...working.map((st) => Number(st.reps)));
      const vol = working.reduce((a, st) => a + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0);
      rows.push({ date: s.date, e1: exerciseMetric(ex, en.sets), topW, vol, sets: working, difficulty: en.difficulty });
    }));

  const meta = `${PATTERN_LABEL[ex.pattern] || ex.pattern} · ${ex.muscles.join(', ')}`;
  if (!rows.length) {
    viewEl.innerHTML = detailBackBar('Progress') + h`<div class="card">
      <div class="ex-detail__name">${esc(ex.name)}</div><div class="ex-detail__meta">${esc(meta)}</div></div>
      <div class="empty"><div class="empty__ico">📊</div>No logged sets for this lift yet.</div>`;
    viewEl.querySelector('[data-back]').addEventListener('click', () => { exDetail = null; render(); });
    return;
  }

  const bestE1 = Math.max(...rows.map((r) => r.e1));
  const bestTop = Math.max(...rows.map((r) => r.topW));
  const tgt = guidedTarget(ex);
  const sug = suggestNext(ex);
  const metricUnit = (v) => fmtMetric(ex, v);

  const stats = h`<div class="statgrid">
    <div class="stat"><div class="stat__val">${weighted ? compact(bestE1) : bestE1}</div><div class="stat__label">Best ${metricKind(ex)}</div><div class="stat__sub">${weighted ? esc(metricUnit(bestE1)) : (ex.unit === 'sec' ? 'seconds' : 'reps')}</div></div>
    <div class="stat"><div class="stat__val">${weighted ? compact(bestTop) : bestTop}</div><div class="stat__label">Top set</div><div class="stat__sub">${weighted ? esc(fmtWeight(bestTop, ex.unit)) : (ex.unit === 'sec' ? 'seconds' : 'reps')}</div></div>
    <div class="stat"><div class="stat__val">${rows.length}</div><div class="stat__label">Sessions</div><div class="stat__sub">${esc(fmtDate(rows[rows.length - 1].date))}</div></div>
  </div>`;

  const e1Pts = rows.map((r) => ({ t: fmtShort(r.date), full: fmtDate(r.date), v: r.e1 }));
  const e1Card = rows.length >= 2 ? h`<div class="card">
    <div class="card__title"><h2>${metricKind(ex) === 'e1RM' ? 'Estimated 1RM' : metricKind(ex) === 'reps' ? 'Top reps' : 'Top time'}</h2><span class="card__hint">${rows.length} sessions</span></div>
    ${lineChart(e1Pts, { yFmt: (v) => compact(v), valFmt: metricUnit, color: '--chart-1' })}
  </div>` : '';

  let weightCard = '';
  if (weighted && rows.length >= 2) {
    const wPts = rows.map((r) => ({ t: fmtShort(r.date), full: fmtDate(r.date), v: r.topW }));
    weightCard = h`<div class="card">
      <div class="card__title"><h2>Working weight</h2><span class="card__hint">top set · ${ex.unit}</span></div>
      ${lineChart(wPts, { yFmt: (v) => compact(v), valFmt: (v) => fmtWeight(v, ex.unit), color: '--chart-2' })}
    </div>`;
  }

  let volCard = '';
  if (weighted) {
    const volGroups = rows.slice(-10).map((r) => ({ label: fmtShort(r.date), full: fmtDate(r.date), total: r.vol, segs: [{ key: 'v', v: r.vol }] }));
    volCard = h`<div class="card">
      <div class="card__title"><h2>Volume per session</h2><span class="card__hint">lb · last ${volGroups.length}</span></div>
      ${barChart(volGroups, [{ key: 'v', name: 'Volume', color: '--chart-1' }], { yFmt: compact, valFmt: compact })}
    </div>`;
  }

  const setStr = (r) => r.sets.map((st) => weighted ? `${st.weight}×${st.reps}` : ex.unit === 'sec' ? `${st.reps}s` : `${st.reps}`).join(', ');
  const recent = rows.slice().reverse().slice(0, 12).map((r) => h`<div class="det-ex">
    <div><div class="det-ex__name">${esc(fmtDate(r.date))}${r.difficulty ? ` <span class="tag">${diffLabel(r.difficulty)}</span>` : ''}</div>
      <div class="small muted">${esc(setStr(r))}</div></div>
    <div class="det-ex__sets">${weighted ? esc(metricUnit(r.e1)) : (ex.unit === 'sec' ? r.e1 + 's' : r.e1 + ' reps')}</div>
  </div>`).join('');

  viewEl.innerHTML = detailBackBar('Progress') + h`
    <div class="card">
      <div class="ex-detail__name">${esc(ex.name)}</div>
      <div class="ex-detail__meta">${esc(meta)}</div>
      <div class="ex-detail__next">Next session: <b>${esc(sug.text)}</b></div>
    </div>
    ${stats}
    ${e1Card}${weightCard}${volCard}
    <div class="card">
      <div class="card__title"><h2>Recent sessions</h2><span class="card__hint">newest first</span></div>
      ${recent}
    </div>
  `;
  viewEl.querySelector('[data-back]').addEventListener('click', () => { exDetail = null; render(); });
  mountTips(viewEl);
}

// ---- Recovery segment (Fitbit-ready) ----
function progressRecoveryHTML() {
  const dates = recoveryDates();
  const weeks8 = lastNWeeks(8);

  // weekly averages from the normalized recovery signal
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const weekAgg = weeks8.map((w) => {
    const days = dates.filter((d) => d >= w.startISO && d <= w.endISO).map(dailyRecovery);
    return {
      w,
      sleep: avg(days.map((d) => d.sleepDifficulty).filter((v) => v != null)),
      drinks: days.map((d) => d.drinks).filter((v) => v != null).reduce((a, b) => a + b, 0),
      energy: avg(days.map((d) => d.energy).filter((v) => v != null)),
      soreness: avg(days.map((d) => d.soreness).filter((v) => v != null)),
      stress: avg(days.map((d) => d.stress).filter((v) => v != null)),
    };
  });

  // today's readiness with the per-signal breakdown
  const rd = readiness(todayISO());
  const rdCard = rd ? h`<div class="card">
    <div class="card__title"><h2>Readiness today</h2><span class="card__hint">${rd.parts.length} signals</span></div>
    <div class="readiness">
      ${ring(rd.score / 100, 'Score', `${rd.score}`, '', READINESS_BAND[rd.band].color)}
      <div class="readiness__body">
        <b style="color:${READINESS_BAND[rd.band].color}">${READINESS_BAND[rd.band].label}</b>
        <div class="small muted">${READINESS_BAND[rd.band].tip}</div>
      </div>
    </div>
    ${rd.parts.map((p) => h`<div class="rd-row"><span>${esc(p.label)}</span><b>${p.score}</b></div>`).join('')}
    <p class="small muted mt">Average of the signals you logged — directional, not a medical score.</p>
  </div>` : '';

  const sleepPts = weekAgg.filter((x) => x.sleep != null).map((x) => ({ t: x.w.label, full: `Week of ${x.w.label}`, v: Math.round(x.sleep * 10) / 10 }));
  const sleepCard = h`<div class="card">
    <div class="card__title"><h2>Sleep difficulty</h2><span class="card__hint">weekly avg · 1 easy–5 hard</span></div>
    ${sleepPts.length >= 2 ? lineChart(sleepPts, { yFmt: String, valFmt: (v) => `${v}/5`, color: '--chart-1' })
      : '<div class="chart-empty">A few more nights of check-ins will fill this in.</div>'}
  </div>`;

  // sleep duration: weekly average of bed/wake-derived (or device) minutes
  const durAgg = weeks8.map((w) => {
    const vals = dates.filter((d) => d >= w.startISO && d <= w.endISO)
      .map((d) => dailyRecovery(d).sleepMinutes).filter((v) => v != null);
    return vals.length ? { t: w.label, full: `Week of ${w.label}`, v: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) } : null;
  }).filter(Boolean);
  const sleepDurCard = durAgg.length >= 2 ? h`<div class="card">
    <div class="card__title"><h2>Sleep duration</h2><span class="card__hint">weekly avg</span></div>
    ${lineChart(durAgg, { yFmt: (v) => `${Math.round(v / 60)}h`, valFmt: fmtSleepMin, color: '--chart-2' })}
  </div>` : '';

  // resting HR: daily line (last 30 readings) + baseline note
  const rhrPts = dates.map((d) => ({ d, v: dailyRecovery(d).restingHR })).filter((x) => x.v != null).slice(-30)
    .map((x) => ({ t: fmtShort(x.d), full: fmtDate(x.d), v: x.v }));
  const base = rhrBaseline(todayISO());
  const rhrCard = rhrPts.length >= 2 ? h`<div class="card">
    <div class="card__title"><h2>Resting heart rate</h2><span class="card__hint">${base != null ? `baseline ${base} bpm` : 'bpm'}</span></div>
    ${lineChart(rhrPts, { yFmt: String, valFmt: (v) => `${v} bpm`, color: '--chart-1' })}
    <div class="small muted mt">A morning RHR well above your baseline often precedes illness or under-recovery.</div>
  </div>` : '';

  const drinkGroups = weekAgg.map((x) => ({ label: x.w.label, full: `Week of ${x.w.label}`, total: x.drinks, segs: [{ key: 'd', v: x.drinks }] }));
  const drinkCard = h`<div class="card">
    <div class="card__title"><h2>Alcohol</h2><span class="card__hint">drinks / week</span></div>
    ${drinkGroups.some((g) => g.total > 0) ? barChart(drinkGroups, [{ key: 'd', name: 'Drinks', color: '--chart-2' }], { yFmt: String, valFmt: String })
      : '<div class="chart-empty">No drinks logged yet.</div>'}
  </div>`;

  // latest raw self-ratings, when present
  const latest = dates.length ? dailyRecovery(dates[dates.length - 1]) : null;
  const latestCard = latest && (latest.energy || latest.soreness || latest.stress) ? h`<div class="card">
    <div class="card__title"><h2>Self-ratings</h2><span class="card__hint">latest · ${esc(fmtDate(latest.date))}</span></div>
    <div class="rd-row"><span>Energy</span><b>${latest.energy ? latest.energy + '/5' : '—'}</b></div>
    <div class="rd-row"><span>Soreness</span><b>${latest.soreness ? latest.soreness + '/5' : '—'}</b></div>
    <div class="rd-row"><span>Stress</span><b>${latest.stress ? latest.stress + '/5' : '—'}</b></div>
  </div>` : '';

  // honest sleep -> performance signal: bucket lifting days by that morning's
  // (previous night's) sleep, compare average session volume. Directional only.
  const insight = sleepPerformanceInsight();
  const load = trainingLoadCard();
  const alcohol = alcoholSleepInsight();
  const sorenessCard = sorenessTrainingInsight();

  // Fitbit seam: prompt to connect until measured data lands.
  const device = hasDeviceData() ? '' : h`<div class="card card--seam">
    <div class="card__title"><h2>❤️ Heart rate &amp; sleep</h2><span class="card__hint">coming soon</span></div>
    <p class="small muted">Connect a Fitbit to replace self-rated sleep with <b>measured sleep stages</b>, and add
      <b>resting heart rate</b> and <b>HRV</b> as recovery inputs — for a complete picture of how training and
      recovery interact. This view already blends whatever sources are available.</p>
    <button class="btn btn--sm" id="fitbitSoon" disabled>Connect Fitbit (soon)</button>
  </div>`;

  return rdCard + load + sleepCard + sleepDurCard + rhrCard
    + drinkCard + latestCard + insight + alcohol + sorenessCard + device;
}

// ---- acute:chronic workload ratio (ACWR) ----
// Tonnage in the last 7 days vs the 28-day weekly average. Ratios well above
// ~1.3 flag a sharp load spike (a known overuse-risk signal); well below ~0.8
// flags detraining. Uses lifting tonnage only (timed/bodyweight excluded) —
// directional, not a medical score.
function trainingLoadCard() {
  const s = get();
  const lifts = s.sessions.filter((x) => x.kind === 'strength');
  if (!lifts.length) return '';
  const today = todayISO();
  const d7 = addDaysISO(today, -6), d28 = addDaysISO(today, -27);
  const firstDate = lifts.reduce((a, x) => (x.date < a ? x.date : a), today);
  if (firstDate > addDaysISO(today, -13)) {
    return h`<div class="card">
      <div class="card__title"><h2>Training load</h2><span class="card__hint">acute : chronic</span></div>
      <p class="small muted">After ~2 weeks of logging, this compares your last 7 days of lifting volume with your 4-week norm to flag load spikes and detraining dips.</p>
    </div>`;
  }
  const volIn = (from) => lifts.filter((x) => x.date >= from && x.date <= today).reduce((a, x) => a + sessionVolume(x), 0);
  const acute = volIn(d7);
  const chronicWeekly = volIn(d28) / 4;
  if (chronicWeekly <= 0) return '';
  const ratio = acute / chronicWeekly;
  const zone = ratio > 1.5 ? ['⚠️ Sharp spike', 'var(--warn)', 'Big jump vs your norm — favor recovery this week.']
    : ratio > 1.3 ? ['▲ Ramping fast', 'var(--warn)', 'Load is climbing quickly; keep an eye on sleep & soreness.']
    : ratio >= 0.8 ? ['✓ Steady', 'var(--good)', 'Load is consistent with your 4-week norm.']
    : ['▼ Light week', 'var(--accent-2)', 'Well below your norm — fine if planned (deload / travel).'];
  return h`<div class="card">
    <div class="card__title"><h2>Training load</h2><span class="card__hint">acute : chronic</span></div>
    <div class="rd-row"><span>Last 7 days</span><b>${compact(acute)} lb</b></div>
    <div class="rd-row"><span>4-week average</span><b>${compact(Math.round(chronicWeekly))} lb/wk</b></div>
    <div class="rd-row"><span>Ratio</span><b style="color:${zone[1]}">${ratio.toFixed(2)} · ${zone[0]}</b></div>
    <p class="small muted mt">${zone[2]} Directional only.</p>
  </div>`;
}

// ---- alcohol -> next-morning sleep ----
// Sleep difficulty logged the morning after drinking days vs. dry days.
function alcoholSleepInsight() {
  const j = get().journal;
  const drank = [], dry = [];
  Object.keys(j).forEach((d) => {
    const drinks = j[d] ? j[d].drinks : null;
    if (drinks == null) return;
    const next = j[addDaysISO(d, 1)];
    if (!next || !next.sleepDiff) return;
    (drinks > 0 ? drank : dry).push(next.sleepDiff);
  });
  if (drank.length < 2 || dry.length < 2) {
    return h`<div class="card">
      <div class="card__title"><h2>Alcohol vs sleep</h2></div>
      <p class="small muted">Keep logging drinks and morning sleep — this will compare sleep after drinking vs. dry days. So far: ${drank.length} drinking, ${dry.length} dry day${dry.length === 1 ? '' : 's'} with a next-morning rating.</p>
    </div>`;
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const ad = Math.round(avg(drank) * 10) / 10, an = Math.round(avg(dry) * 10) / 10;
  const delta = Math.round((ad - an) * 10) / 10;
  return h`<div class="card">
    <div class="card__title"><h2>Alcohol vs sleep</h2><span class="card__hint">next-morning rating</span></div>
    <div class="rd-row"><span>After drinking (${drank.length}×)</span><b>${ad}/5 difficulty</b></div>
    <div class="rd-row"><span>After dry days (${dry.length}×)</span><b>${an}/5 difficulty</b></div>
    <p class="small muted mt">Sleep rates <b>${delta >= 0 ? '+' : ''}${delta}</b> ${delta >= 0 ? 'harder' : 'easier'} after drinking, on average. Directional — more data sharpens it.</p>
  </div>`;
}

// ---- soreness the morning after training vs. rest ----
function sorenessTrainingInsight() {
  const s = get();
  const trained = [], rested = [];
  Object.keys(s.journal).forEach((d) => {
    const sore = s.journal[d] ? s.journal[d].soreness : null;
    if (!sore) return;
    const prev = addDaysISO(d, -1);
    const lifted = s.sessions.some((x) => x.kind === 'strength' && x.date === prev);
    (lifted ? trained : rested).push(sore);
  });
  if (trained.length < 2 || rested.length < 2) return '';
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10;
  return h`<div class="card">
    <div class="card__title"><h2>Soreness vs training</h2><span class="card__hint">next morning</span></div>
    <div class="rd-row"><span>After lifting days (${trained.length}×)</span><b>${avg(trained)}/5</b></div>
    <div class="rd-row"><span>After rest days (${rested.length}×)</span><b>${avg(rested)}/5</b></div>
    <p class="small muted mt">A gap that keeps growing can mean recovery isn't keeping up with volume.</p>
  </div>`;
}

// ---- protein adherence vs bodyweight, last 4 weeks ----
function proteinBodyweightCard() {
  const s = get();
  const from = addDaysISO(todayISO(), -27);
  const target = proteinTarget();
  const pDays = Object.keys(s.proteinLog).filter((d) => d >= from && s.proteinLog[d] > 0).sort();
  const bwDays = Object.keys(s.journal).filter((d) => d >= from && s.journal[d].bw != null).sort();
  if (pDays.length < 5 || bwDays.length < 2) return '';
  const avgP = Math.round(pDays.reduce((a, d) => a + s.proteinLog[d], 0) / pDays.length);
  const adherence = target ? Math.round((avgP / target) * 100) : 0;
  const u = bwUnit();
  const chg = Math.round((fromKg(s.journal[bwDays[bwDays.length - 1]].bw, u) - fromKg(s.journal[bwDays[0]].bw, u)) * 10) / 10;
  return h`<div class="card">
    <div class="card__title"><h2>Protein &amp; bodyweight</h2><span class="card__hint">last 4 weeks</span></div>
    <div class="rd-row"><span>Avg protein (${pDays.length} days)</span><b>${avgP} g · ${adherence}% of target</b></div>
    <div class="rd-row"><span>Bodyweight change</span><b>${chg >= 0 ? '+' : ''}${chg} ${u}</b></div>
    <p class="small muted mt">Read together with the volume trend: gaining with high protein &amp; rising volume skews muscle; losing with high protein protects it.</p>
  </div>`;
}

// Compare average session volume on days after easy vs hard sleep. Returns a
// card, or a "need more data" note. Deliberately conservative.
function sleepPerformanceInsight() {
  const lifts = get().sessions.filter((s) => s.kind === 'strength');
  const good = [], poor = [];
  lifts.forEach((s) => {
    const rec = dailyRecovery(s.date);
    const diff = rec.sleepDifficulty;
    if (diff == null) return;
    const vol = sessionVolume(s);
    if (!vol) return;
    if (diff <= 2) good.push(vol); else if (diff >= 4) poor.push(vol);
  });
  if (good.length < 2 || poor.length < 2) {
    return h`<div class="card">
      <div class="card__title"><h2>Sleep vs training</h2></div>
      <p class="small muted">Log sleep on more lifting days and this will compare your training volume after good vs. poor sleep. So far: ${good.length} good-sleep, ${poor.length} poor-sleep sessions.</p>
    </div>`;
  }
  const ag = Math.round(good.reduce((a, b) => a + b, 0) / good.length);
  const ap = Math.round(poor.reduce((a, b) => a + b, 0) / poor.length);
  const pct = ag ? Math.round(((ap - ag) / ag) * 100) : 0;
  return h`<div class="card">
    <div class="card__title"><h2>Sleep vs training</h2><span class="card__hint">avg session volume</span></div>
    <div class="rd-row"><span>After easy sleep (≤2)</span><b>${compact(ag)} lb</b></div>
    <div class="rd-row"><span>After hard sleep (≥4)</span><b>${compact(ap)} lb</b></div>
    <p class="small muted mt">On hard-sleep days you train <b>${pct >= 0 ? '+' : ''}${pct}%</b> ${pct >= 0 ? 'more' : 'less'} volume, on average. Directional — more data sharpens it.</p>
  </div>`;
}

// ================= HISTORY =================
function relDay(iso) {
  const today = todayISO();
  if (iso === today) return 'Today';
  const d = new Date(iso + 'T00:00:00'), y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === toISO(y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// Tonnage (weight × reps) for a strength session. Timed (sec) and bodyweight
// entries are excluded — a 35s plank stored as weight=35 is not 35 lb, and
// counting it would silently corrupt every volume chart and insight.
function sessionVolume(s) {
  if (s.kind !== 'strength') return 0;
  return (s.entries || []).reduce((v, e) => {
    const unit = entryExercise(e)?.unit;
    if (unit === 'sec' || unit === 'bw') return v;
    return v + (e.sets || []).reduce((a, st) => a + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0);
  }, 0);
}

// history filter: all | lifts | cardio | checkins
let histFilter = 'all';

function renderHistory() {
  const sessions = [...get().sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const journal = get().journal;
  const journalDates = Object.keys(journal);
  if (!sessions.length && !journalDates.length) {
    viewEl.innerHTML = `<div class="empty"><div class="empty__ico">📭</div>No sessions yet.<br>Tap <b>＋</b> to log your first workout.</div>`;
    return;
  }

  // summary strip
  const liftCount = sessions.filter((s) => s.kind === 'strength').length;
  const totalVol = sessions.reduce((v, s) => v + sessionVolume(s), 0);
  const cardioMin = sessions.filter((s) => s.kind === 'cardio' || s.kind === 'activity').reduce((m, s) => m + (Number(s.durationMin) || 0), 0);
  const summary = h`<div class="histsum">
    <div class="histsum__item"><b>${liftCount}</b><span>workouts</span></div>
    <div class="histsum__item"><b>${totalVol >= 1000 ? (totalVol / 1000).toFixed(1) + 'k' : totalVol}</b><span>lb lifted</span></div>
    <div class="histsum__item"><b>${cardioMin}</b><span>cardio min</span></div>
  </div>`;

  // filter chips
  const FILTERS = [['all', 'All'], ['lifts', '🏋️ Lifts'], ['cardio', '🚴 Cardio'], ['checkins', '📓 Check-ins']];
  const chips = `<div class="seg">${FILTERS.map(([k, l]) =>
    `<button class="segbtn ${histFilter === k ? 'is-active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>`;

  const wantSession = (s) => histFilter === 'all'
    || (histFilter === 'lifts' && s.kind === 'strength')
    || (histFilter === 'cardio' && (s.kind === 'cardio' || s.kind === 'activity'));
  const wantJournal = histFilter === 'all' || histFilter === 'checkins';

  // merge sessions + daily check-ins into one date-sorted list
  const records = [
    ...sessions.filter(wantSession).map((s) => ({ date: s.date, kind: 'session', s })),
    ...(wantJournal ? journalDates.map((d) => ({ date: d, kind: 'journal', j: journal[d] })) : []),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const groups = [];
  let cur = null;
  records.forEach((r) => {
    if (!cur || cur.date !== r.date) { cur = { date: r.date, items: [] }; groups.push(cur); }
    cur.items.push(r);
  });
  const groupsHTML = groups.length ? groups.map((g) => h`
    <button class="dayhead" data-dayopen="${g.date}"><span>${relDay(g.date)}</span><span class="dayhead__chev">›</span></button>
    ${g.items.map((r) => r.kind === 'journal' ? journalHistoryItem(r.date, r.j) : historyItem(r.s)).join('')}
  `).join('') : `<div class="empty"><div class="empty__ico">🔍</div>Nothing matches this filter yet.</div>`;

  viewEl.innerHTML = summary + chips + groupsHTML;
  viewEl.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('click', () => {
    histFilter = el.dataset.filter; renderHistory();
  }));
  viewEl.querySelectorAll('[data-dayopen]').forEach((el) => el.addEventListener('click', () => openDay(el.dataset.dayopen)));
  viewEl.querySelectorAll('[data-session]').forEach((el) => el.addEventListener('click', () => sessionDetail(el.dataset.session)));
  viewEl.querySelectorAll('[data-journal]').forEach((el) => el.addEventListener('click', () => {
    const d = el.dataset.journal;
    const j = get().journal[d];
    // open the half that actually has data (evening-only entries used to open on morning)
    openCheckin(d, !morningDone(j) && eveningDone(j) ? 'evening' : 'morning');
  }));
}

// ================= DAY VIEW =================
// One screen per date: every session, both check-in halves and protein —
// all editable, plus quick-add for anything forgotten that day.
function renderDay(date) {
  titleEl.textContent = relDay(date);
  weekLabelEl.textContent = fmtDate(date);
  const s = get();
  const daySessions = s.sessions.filter((x) => x.date === date)
    .sort((a, b) => ((a.startedAt || a.loggedAt || '') < (b.startedAt || b.loggedAt || '') ? -1 : 1));
  const j = s.journal[date];
  const backLabel = currentTab === 'today' ? 'Today' : 'History';

  const sessionsHTML = daySessions.length
    ? daySessions.map((x) => historyItem(x)).join('')
    : `<div class="muted small" style="padding:4px 2px 10px">No training logged this day.</div>`;

  const mDone = morningDone(j), eDone = eveningDone(j);
  const mStatus = mDone
    ? [j.sleepMin != null ? fmtSleepMin(j.sleepMin) : null, j.sleepDiff ? `Sleep ${j.sleepDiff}/5` : null, j.bw != null ? fmtBw(j.bw) : null, j.rhr != null ? `RHR ${j.rhr}` : null].filter(Boolean).join(' · ') || 'Logged'
    : 'Not logged';
  const eStatus = eDone
    ? [j.drinks != null ? `${j.drinks} drink${j.drinks === 1 ? '' : 's'}` : null, j.caffeine != null ? `${j.caffeine} caffeine` : null, j.stress ? `stress ${j.stress}/5` : null].filter(Boolean).join(' · ') || 'Logged'
    : 'Not logged';
  const noteLine = j && (j.notes || j.amNote)
    ? `<div class="small muted" style="margin-top:8px">“${esc(j.notes || j.amNote)}”</div>` : '';

  const protein = s.proteinLog[date];
  const target = proteinTarget();

  viewEl.innerHTML = detailBackBar(backLabel) + h`
    <div class="section-label" style="margin-top:8px">Training</div>
    ${sessionsHTML}
    <div class="btn-row mb">
      <button class="btn btn--sm" data-add="strength">＋ Lift</button>
      <button class="btn btn--sm" data-add="zone2">＋ Zone 2</button>
      <button class="btn btn--sm" data-add="interval">＋ Intervals</button>
      <button class="btn btn--sm" data-add="activity">＋ Activity</button>
    </div>

    <div class="section-label">Check-ins</div>
    <div class="card">
      <div class="checkin-row" style="border-top:0">
        <span class="checkin-row__ico">🌅</span>
        <div class="checkin-row__body"><div class="checkin-row__t">Morning ${mDone ? '<span class="checkin-tick">✓</span>' : ''}</div><div class="small muted">${esc(mStatus)}</div></div>
        <button class="btn btn--sm ${mDone ? 'btn--ghost' : ''}" data-checkin="morning">${mDone ? 'Edit' : 'Log'}</button>
      </div>
      <div class="checkin-row">
        <span class="checkin-row__ico">🌙</span>
        <div class="checkin-row__body"><div class="checkin-row__t">Evening ${eDone ? '<span class="checkin-tick">✓</span>' : ''}</div><div class="small muted">${esc(eStatus)}</div></div>
        <button class="btn btn--sm ${eDone ? 'btn--ghost' : ''}" data-checkin="evening">${eDone ? 'Edit' : 'Log'}</button>
      </div>
      ${noteLine}
    </div>

    <div class="section-label">Nutrition</div>
    <div class="card">
      <div class="row-between">
        <div><b>🍗 Protein</b>
          <div class="small muted">${protein != null ? `${protein} g of ${target} g target` : 'Not logged'}</div></div>
        <button class="btn btn--sm ${protein != null ? 'btn--ghost' : ''}" id="dayProtein">${protein != null ? 'Edit' : 'Log'}</button>
      </div>
    </div>
  `;

  viewEl.querySelector('[data-back]').addEventListener('click', () => { dayDetail = null; render(); window.scrollTo(0, 0); });
  viewEl.querySelectorAll('[data-session]').forEach((el) => el.addEventListener('click', () => sessionDetail(el.dataset.session)));
  viewEl.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => startDraft(b.dataset.add, date)));
  viewEl.querySelectorAll('[data-checkin]').forEach((b) => b.addEventListener('click', () => openCheckin(date, b.dataset.checkin)));
  document.getElementById('dayProtein').addEventListener('click', () => proteinPrompt(date));
}

function journalHistoryItem(date, j) {
  const parts = [];
  if (j.sleepMin != null) parts.push(fmtSleepMin(j.sleepMin));
  if (j.sleepDiff) parts.push(`sleep ${j.sleepDiff}/5`);
  if (j.drinks != null) parts.push(`${j.drinks} drink${j.drinks === 1 ? '' : 's'}`);
  if (j.bw != null) parts.push(fmtBw(j.bw));
  if (j.energy) parts.push(`energy ${j.energy}/5`);
  if (j.rhr != null) parts.push(`RHR ${j.rhr}`);
  const detail = parts.join(' · ') + (j.notes ? (parts.length ? ' · ' : '') + '“' + esc(j.notes) + '”' : '');
  return h`<div class="hist-item" data-journal="${date}">
    <div class="hist-item__ico">📓</div>
    <div class="hist-item__body">
      <div class="hist-item__t">Daily check-in</div>
      <div class="hist-item__d">${detail || 'Logged'}</div>
    </div>
    <span class="hist-item__chev">›</span>
  </div>`;
}

function historyItem(s) {
  let ico = '🏋️', title = 'Strength', detail = '', extra = '';
  if (s.kind === 'strength') {
    const totalSets = (s.entries || []).reduce((n, e) => n + e.sets.filter((st) => Number(st.reps) > 0).length, 0);
    const names = (s.entries || []).map((e) => (exerciseById(e.exerciseId)?.name) || e.exSnapshot?.name || '?');
    title = s.templateName || 'Strength';
    detail = names.join(' · ');
    const vol = sessionVolume(s);
    extra = `${totalSets} sets · ${vol >= 1000 ? (vol / 1000).toFixed(1) + 'k' : vol} lb`;
  } else if (s.kind === 'cardio') {
    ico = s.cardioType === 'interval' ? '🔥' : '🚴';
    title = `${s.cardioType === 'interval' ? 'Intervals' : 'Zone 2'} · ${s.durationMin} min`;
    detail = [s.avgHR ? `avg ${s.avgHR} bpm` : '', s.distance ? `${s.distance} ${s.distanceUnit || ''}` : '', s.rpe ? `RPE ${s.rpe}` : ''].filter(Boolean).join(' · ');
  } else if (s.kind === 'activity') {
    const m = ACTIVITY_MAP[s.activity] || ACTIVITY_MAP.other;
    ico = m.icon; title = `${m.label} · ${s.durationMin} min`; detail = m.note;
  }
  if (s.note) detail += (detail ? ' · ' : '') + '“' + esc(s.note) + '”';
  return h`<div class="hist-item" data-session="${s.id}">
    <div class="hist-item__ico">${ico}</div>
    <div class="hist-item__body">
      <div class="hist-item__t">${esc(title)}</div>
      <div class="hist-item__d">${detail}</div>
      ${extra ? `<div class="hist-item__extra">${extra}</div>` : ''}
    </div>
    <span class="hist-item__chev">›</span>
  </div>`;
}

function sessionDetail(id) {
  const s = get().sessions.find((x) => x.id === id);
  if (!s) return;
  let body = '';
  if (s.kind === 'strength') {
    body = (s.entries || []).map((e) => {
      const live = exerciseById(e.exerciseId);
      const name = live?.name || e.exSnapshot?.name || '?';
      const done = (e.sets || []).filter((st) => Number(st.reps) > 0);
      const missed = (e.sets || []).length - done.length;
      const sets = done.map((st) => st.weight ? `${st.weight}×${st.reps}` : `${st.reps}${st.reps > 30 ? 's' : ''}`).join(', ')
        + (missed > 0 ? ` <span class="muted">(+${missed} missed)</span>` : '');
      const diff = e.difficulty ? ` <span class="tag">${diffLabel(e.difficulty)}</span>` : '';
      const chev = live ? '<span class="det-ex__chev">›</span>' : '';
      return h`<div class="det-ex${live ? ' det-ex--tap' : ''}"${live ? ` data-exdetail="${e.exerciseId}"` : ''}>
        <div class="det-ex__name">${esc(name)}${diff}</div><div class="det-ex__sets">${sets}${chev}</div></div>`;
    }).join('');
    const vol = sessionVolume(s);
    body += `<div class="small muted mt">Total volume: <b>${vol.toLocaleString()} lb</b> · tap a lift for its full history</div>`;
  } else {
    const extras = [s.avgHR ? `avg ${s.avgHR} bpm` : '', s.distance ? `${s.distance} ${s.distanceUnit || ''}` : '', s.rpe ? `RPE ${s.rpe}` : ''].filter(Boolean).join(' · ');
    body = `<div class="muted">${esc(s.kind === 'cardio' ? (s.cardioType === 'interval' ? 'Intervals' : 'Zone 2') : (ACTIVITY_MAP[s.activity] || ACTIVITY_MAP.other).label)} · ${s.durationMin} min${extras ? ` · ${extras}` : ''}</div>`;
  }
  if (s.note) body += `<div class="small mt">“${esc(s.note)}”</div>`;
  openModal(`${relDay(s.date)} · ${fmtDate(s.date)}`, h`
    ${body}
    <div class="btn-row mt">
      <button class="btn btn--sm" id="detEdit">✎ Edit</button>
      <button class="btn btn--danger btn--sm" id="detDel">🗑 Delete</button>
    </div>
  `);
  document.getElementById('detEdit').addEventListener('click', () => { closeModal(); editSession(s); });
  document.getElementById('detDel').addEventListener('click', () => {
    const removed = s;
    update((st) => {
      st.sessions = st.sessions.filter((x) => x.id !== id);
      st.deleted[id] = new Date().toISOString(); // tombstone so sync propagates the deletion
    });
    closeModal(); render();
    toastAction('Session deleted', 'Undo', () => {
      update((st) => {
        st.sessions.push(removed);
        st.sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        delete st.deleted[id];
        removed.updatedAt = new Date().toISOString(); // outlive the tombstone on other devices
      });
      render();
      toast('Restored');
    });
  });
  modalRoot.querySelectorAll('[data-exdetail]').forEach((el) => el.addEventListener('click', () => {
    closeModal(); openExerciseDetail(el.dataset.exdetail);
  }));
}

// Load a saved session back into the matching draft editor so mistakes can be
// corrected — bad data you can't fix would poison every later analysis.
function editSession(s) {
  if (s.kind === 'strength') {
    draft = {
      kind: 'strength', editId: s.id, date: s.date, note: s.note || '',
      entries: (s.entries || []).map((en) => ({
        exerciseId: en.exerciseId,
        exSnapshot: en.exSnapshot || null,
        sets: (en.sets || []).filter((st) => Number(st.reps) > 0)
          .map((st) => ({ weight: st.weight ?? '', reps: st.reps ?? '', rir: st.rir ?? '' })),
      })).filter((en) => exerciseById(en.exerciseId)),
    };
    draft.entries.forEach((en) => { if (!en.sets.length) en.sets.push(blankSet(exerciseById(en.exerciseId))); });
  } else if (s.kind === 'cardio') {
    draft = { kind: 'cardio', editId: s.id, cardioType: s.cardioType, date: s.date, durationMin: s.durationMin, avgHR: s.avgHR ?? '', distance: s.distance ?? '', rpe: s.rpe ?? '', note: s.note || '' };
  } else if (s.kind === 'activity') {
    draft = { kind: 'activity', editId: s.id, activity: s.activity, date: s.date, durationMin: s.durationMin, note: s.note || '' };
  } else return;
  workout = null;
  enterLog();
}

// ================= SETUP =================
function syncCardHTML() {
  const connected = store.getConnected() && sync.isConfigured();
  const serverUrl = store.getServerUrl();
  const token = store.getToken();
  const statusLine = lastSyncMsg ? `<div class="small muted mt">${esc(lastSyncMsg)}</div>` : '';

  const body = !connected
    ? h`<p class="small muted">Back up and sync your data through your own free server.
        Deploy the tiny backend in <code>server/</code> (see its README), then paste your
        <b>Server URL</b> and <b>secret token</b> below.</p>
      <label class="field"><span>Server URL</span>
        <input id="svUrl" placeholder="https://trainer-sync.you.workers.dev" value="${esc(serverUrl)}" autocapitalize="off" autocomplete="off" spellcheck="false" /></label>
      <label class="field"><span>Secret token</span>
        <input id="svToken" type="password" placeholder="your SYNC_TOKEN" value="${esc(token)}" autocapitalize="off" autocomplete="off" spellcheck="false" /></label>
      <button class="btn btn--accent" id="svConnect">🔗 Connect</button>`
    : h`<div class="row-between">
        <div><b>Connected</b><div class="small muted">${esc(serverUrl.replace(/^https?:\/\//, ''))}</div></div>
        <span class="pill pill--up">● Synced</span>
      </div>
      <div class="small muted mt">Last-write-wins · auto-syncs on change</div>
      <div class="btn-row mt">
        <button class="btn btn--sm" id="svSyncNow">↻ Sync now</button>
        <button class="btn btn--sm btn--ghost" id="svDisconnect">Disconnect</button>
      </div>`;

  return h`<div class="card">
    <div class="card__title"><h2>☁ Cloud sync</h2><span class="card__hint">your server</span></div>
    ${body}${statusLine}
  </div>`;
}

function wireSyncCard() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('svConnect', 'click', async () => {
    const url = document.getElementById('svUrl').value.trim();
    const token = document.getElementById('svToken').value.trim();
    if (!url || !token) { toast('Enter both the URL and token'); return; }
    store.setServerUrl(url); store.setToken(token);
    try { await sync.connect(); renderSetup(); }
    catch (e) { store.setConnected(false); toast('Connect failed — check URL & token'); renderSetup(); }
  });
  on('svSyncNow', 'click', async () => { try { await sync.syncNow(); } catch (e) { toast('Sync failed'); } });
  on('svDisconnect', 'click', () => { sync.disconnect(); renderSetup(); });
}

function renderSetup() {
  const s = get();
  const t = s.settings.targets;
  viewEl.innerHTML = h`
    ${syncCardHTML()}
    <div class="card">
      <div class="card__title"><h2>Profile</h2></div>
      <div class="field-row">
        <label class="field"><span>Body weight (kg)</span><input type="number" id="sBw" value="${s.settings.bodyweightKg}" /></label>
        <label class="field"><span>Protein g/kg</span><input type="number" step="0.1" id="sPk" value="${s.settings.proteinPerKg}" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Units</span><select id="sUnits"><option ${s.settings.units==='lb'?'selected':''}>lb</option><option ${s.settings.units==='kg'?'selected':''}>kg</option></select></label>
        <label class="field"><span>Max HR</span><input type="number" id="sHR" value="${s.settings.maxHR}" /></label>
      </div>
      <div class="small muted">Protein target: <b>${proteinTarget()} g/day</b>. Zone 2 ≈ ${Math.round(s.settings.maxHR*0.6)}–${Math.round(s.settings.maxHR*0.7)} bpm.</div>
    </div>

    <div class="card">
      <div class="card__title"><h2>Workout & rest timer</h2></div>
      <div class="field-row">
        <label class="field"><span>Barbell weight (lb)</span><input type="number" id="wBar" value="${s.settings.barWeightLb}" /></label>
        <label class="field"><span>Rest timer (sec)</span><input type="number" id="wRest" value="${s.settings.restTimer.seconds}" /></label>
      </div>
      <label class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="checkbox" id="wTimerOn" ${s.settings.restTimer.enabled ? 'checked' : ''} style="width:auto"> <span style="margin:0">Auto-start rest timer after each set</span></label>
      <label class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="checkbox" id="wSound" ${s.settings.restTimer.sound ? 'checked' : ''} style="width:auto"> <span style="margin:0">Beep when rest is over</span></label>
      <label class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <input type="checkbox" id="wVibe" ${s.settings.restTimer.vibrate ? 'checked' : ''} style="width:auto"> <span style="margin:0">Vibrate when rest is over</span></label>
    </div>

    <div class="card">
      <div class="card__title"><h2>Weekly targets</h2><span class="card__hint">tune to you</span></div>
      <div class="field-row">
        <label class="field"><span>Growth sets / muscle</span><input type="number" id="tSets" value="${t.setsPerMuscle}" /></label>
        <label class="field"><span>Maintenance floor</span><input type="number" id="tMaint" value="${t.maintenanceSets}" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Zone 2 min / week</span><input type="number" id="tZ2" value="${t.zone2MinWeek}" /></label>
        <label class="field"><span>Interval sessions</span><input type="number" id="tInt" value="${t.intervalSessionsWeek}" /></label>
      </div>
      <button class="btn btn--primary" id="saveSettings">Save settings</button>
    </div>

    <div class="card">
      <div class="card__title"><h2>Exercise library</h2><button class="linkbtn" id="addLibEx">＋ New</button></div>
      <div id="libList"></div>
    </div>

    <div class="card">
      <div class="card__title"><h2>Priority when compressed</h2></div>
      <ol class="small" style="padding-left:18px;margin:0;line-height:1.8">
        <li><b>Full Body A</b> — protects strength/muscle</li>
        <li><b>Full Body B</b> — each pattern hit 2×</li>
        <li><b>One interval session</b> — best cardio ROI/min</li>
        <li><b>Zone 2</b> — valuable, easiest to swap for daily activity</li>
      </ol>
      <p class="small muted mt">3 days → 2 lifts + intervals. 2 days → 2 full-body lifts (still counts).</p>
    </div>

    <div class="card">
      <div class="card__title"><h2>Data</h2></div>
      <div class="btn-row mb">
        <button class="btn btn--sm" id="expBtn">⬇ JSON backup</button>
        <button class="btn btn--sm" id="impBtn">⬆ Import JSON</button>
      </div>
      <div class="btn-row mb">
        <button class="btn btn--sm" id="csvTrain">⬇ Training CSV</button>
        <button class="btn btn--sm" id="csvJournal">⬇ Journal CSV</button>
      </div>
      <div class="btn-row mb">
        <button class="btn btn--sm" id="csvDaily">⬇ Daily summary CSV</button>
      </div>
      <button class="btn btn--sm btn--danger" id="resetBtn">Reset all data</button>
      <p class="small muted mt">Data lives on this device (offline). JSON is a full backup to restore or move devices. Training CSV = one row per set (with units, session ids &amp; planned-vs-done); Journal CSV = one row per check-in; Daily CSV = one row per day joining recovery, training load &amp; protein — ready for correlation analysis.</p>
    </div>
    <p class="center small muted">Concurrent Trainer · built from your evidence-based plan</p>
  `;
  renderLibList();
  wireSyncCard();

  document.getElementById('saveSettings').addEventListener('click', () => {
    update((st) => {
      st.settings.bodyweightKg = Number(document.getElementById('sBw').value) || st.settings.bodyweightKg;
      st.settings.proteinPerKg = Number(document.getElementById('sPk').value) || st.settings.proteinPerKg;
      st.settings.units = document.getElementById('sUnits').value;
      st.settings.maxHR = Number(document.getElementById('sHR').value) || st.settings.maxHR;
      st.settings.targets.setsPerMuscle = Number(document.getElementById('tSets').value) || t.setsPerMuscle;
      st.settings.targets.maintenanceSets = Number(document.getElementById('tMaint').value) || t.maintenanceSets;
      st.settings.targets.zone2MinWeek = Number(document.getElementById('tZ2').value) || t.zone2MinWeek;
      st.settings.targets.intervalSessionsWeek = Number(document.getElementById('tInt').value) || t.intervalSessionsWeek;
      st.settings.barWeightLb = Number(document.getElementById('wBar').value) || st.settings.barWeightLb;
      st.settings.restTimer.seconds = Number(document.getElementById('wRest').value) || st.settings.restTimer.seconds;
      st.settings.restTimer.enabled = document.getElementById('wTimerOn').checked;
      st.settings.restTimer.sound = document.getElementById('wSound').checked;
      st.settings.restTimer.vibrate = document.getElementById('wVibe').checked;
    });
    toast('Settings saved'); renderSetup();
  });
  document.getElementById('addLibEx').addEventListener('click', () => exerciseEditor(null, () => renderSetup()));
  document.getElementById('expBtn').addEventListener('click', doExport);
  document.getElementById('impBtn').addEventListener('click', doImport);
  document.getElementById('csvTrain').addEventListener('click', exportTrainingCSV);
  document.getElementById('csvJournal').addEventListener('click', exportJournalCSV);
  document.getElementById('csvDaily').addEventListener('click', exportDailyCSV);
  document.getElementById('resetBtn').addEventListener('click', () => {
    openModal('Reset all data?', `<p class="muted">This deletes every logged session and restores default exercises. Export a backup first if unsure.</p>
      <div class="btn-row mt"><button class="btn btn--ghost" data-close-btn>Cancel</button><button class="btn btn--danger" id="confReset">Reset</button></div>`);
    modalRoot.querySelector('[data-close-btn]').addEventListener('click', closeModal);
    document.getElementById('confReset').addEventListener('click', () => { resetAll(); closeModal(); toast('Reset'); setTab('today'); });
  });
}

function renderLibList() {
  const list = document.getElementById('libList');
  const exs = get().exercises.filter((e) => !e.archived);
  list.innerHTML = exs.map((e) => h`<div class="ex-pick" data-edit="${e.id}">
    <div><div class="ex-pick__name">${esc(e.name)} ${e.custom ? '<span class="tag">custom</span>' : ''}</div>
    <div class="ex-pick__meta">${PATTERN_LABEL[e.pattern]} · ${e.muscles.join(', ')} · ${e.repRange[0]}–${e.repRange[1]} reps @ RIR ${e.targetRIR}</div></div>
    <span class="linkbtn">Edit</span>
  </div>`).join('');
  list.querySelectorAll('[data-edit]').forEach((el) => el.addEventListener('click', () => exerciseEditor(el.dataset.edit, () => renderSetup())));
}

function exerciseEditor(id, onSave) {
  const ex = id ? exerciseById(id) : null;
  const muscleChecks = MUSCLES.map((m) => `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 10px 4px 0;font-size:.85rem">
    <input type="checkbox" class="m-chk" value="${m}" ${ex && ex.muscles.includes(m) ? 'checked' : ''} style="width:auto"> ${m}</label>`).join('');
  const patOpts = ['squat','hinge','push','pull','core','other'].map((p) => `<option value="${p}" ${ex && ex.pattern===p?'selected':''}>${PATTERN_LABEL[p]}</option>`).join('');
  const unitOpts = ['lb','kg','bw','sec'].map((u) => `<option value="${u}" ${ex && ex.unit===u?'selected':''}>${u}</option>`).join('');
  openModal(ex ? 'Edit exercise' : 'New exercise', h`
    <label class="field"><span>Name</span><input id="exName" value="${ex ? esc(ex.name) : ''}" placeholder="e.g. Bulgarian Split Squat" /></label>
    <div class="field-row">
      <label class="field"><span>Pattern</span><select id="exPat">${patOpts}</select></label>
      <label class="field"><span>Unit</span><select id="exUnit">${unitOpts}</select></label>
    </div>
    <label class="field"><span>Muscles worked</span><div>${muscleChecks}</div></label>
    <div class="field-row-3">
      <label class="field"><span>Rep min</span><input type="number" id="exLo" value="${ex ? ex.repRange[0] : 8}" /></label>
      <label class="field"><span>Rep max</span><input type="number" id="exHi" value="${ex ? ex.repRange[1] : 12}" /></label>
      <label class="field"><span>Target RIR</span><input type="number" id="exRir" value="${ex ? ex.targetRIR : 2}" /></label>
    </div>
    <label class="field"><span>Current working weight</span><input type="number" id="exWt" value="${ex ? ex.lastWeight : 0}" /></label>
    <div class="btn-row">
      ${ex ? '<button class="btn btn--danger btn--sm" id="exDel">Delete</button>' : ''}
      <button class="btn btn--primary" id="exSave">Save</button>
    </div>
  `);
  document.getElementById('exSave').addEventListener('click', () => {
    const name = document.getElementById('exName').value.trim();
    if (!name) { toast('Name required'); return; }
    const muscles = [...modalRoot.querySelectorAll('.m-chk:checked')].map((c) => c.value);
    const data = {
      name, pattern: document.getElementById('exPat').value, unit: document.getElementById('exUnit').value,
      muscles: muscles.length ? muscles : ['Core'],
      repRange: [Number(document.getElementById('exLo').value) || 8, Number(document.getElementById('exHi').value) || 12],
      targetRIR: Number(document.getElementById('exRir').value) || 2,
      lastWeight: Number(document.getElementById('exWt').value) || 0,
    };
    let saved;
    update((s) => {
      if (ex) { Object.assign(ex, data); saved = ex; }
      else { saved = { id: uid(), type: 'strength', custom: true, archived: false, ...data }; s.exercises.push(saved); }
    });
    closeModal(); toast('Saved'); onSave && onSave(saved);
  });
  if (ex) document.getElementById('exDel').addEventListener('click', () => {
    update((s) => { const e = s.exercises.find((x) => x.id === ex.id); if (e) e.archived = true; });
    closeModal(); toast('Removed'); onSave && onSave();
  });
}

function downloadFile(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV cell escaping (RFC-4180-ish): quote when needed, double interior quotes.
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// weight expressed in kg for cross-exercise analysis; '' when not a load
function weightKg(w, unit) {
  if (w == null || w === '' || (unit !== 'lb' && unit !== 'kg')) return '';
  return Math.round((unit === 'kg' ? Number(w) : Number(w) * KG_PER_LB) * 100) / 100;
}

// One row per logged set (strength) / per session (cardio & activity).
// session_id groups sets back into sessions; unit + weight_kg make loads
// unambiguous; target_reps + completed capture planned-vs-done compliance.
function exportTrainingCSV() {
  const headers = ['date', 'session_id', 'type', 'template', 'started_at', 'exercise', 'pattern', 'unit',
    'set', 'target_reps', 'weight', 'weight_kg', 'reps', 'completed', 'rir', 'difficulty',
    'duration_min', 'avg_hr', 'rpe', 'distance', 'distance_unit', 'note'];
  const rows = [];
  [...get().sessions].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((s) => {
    if (s.kind === 'strength') {
      (s.entries || []).forEach((en) => {
        const ex = entryExercise(en) || {};
        (en.sets || []).forEach((st, i) => {
          const done = st.completed != null ? st.completed : Number(st.reps) > 0;
          rows.push([s.date, s.id, 'strength', s.templateName || '', s.startedAt || s.loggedAt || '',
            ex.name || '?', ex.pattern || '', ex.unit || '',
            i + 1, st.target ?? (en.target ? en.target.reps : ''), st.weight ?? '', weightKg(st.weight, ex.unit),
            st.reps ?? '', done ? 1 : 0, st.rir ?? '', en.difficulty || '', '', '', '', '', '', s.note || '']);
        });
      });
    } else if (s.kind === 'cardio') {
      rows.push([s.date, s.id, s.cardioType === 'interval' ? 'interval' : 'zone2', '', s.loggedAt || '',
        '', '', '', '', '', '', '', '', '', '', '',
        s.durationMin ?? '', s.avgHR ?? '', s.rpe ?? '', s.distance ?? '', s.distanceUnit || '', s.note || '']);
    } else if (s.kind === 'activity') {
      const m = ACTIVITY_MAP[s.activity] || ACTIVITY_MAP.other;
      rows.push([s.date, s.id, 'activity:' + s.activity, '', s.loggedAt || '',
        m.label, '', '', '', '', '', '', '', '', '', '',
        s.durationMin ?? '', '', '', '', '', s.note || '']);
    }
  });
  if (!rows.length) { toast('No sessions to export'); return; }
  downloadFile(toCSV(headers, rows), `concurrent-trainer-training-${todayISO()}.csv`, 'text/csv');
  toast('Training CSV downloaded');
}

// One row per day with any recovery signal (journal or device), via the
// normalized recovery layer — so measured Fitbit fields land in the same
// columns whenever they exist.
function exportJournalCSV() {
  const j = get().journal;
  const u = bwUnit();
  const headers = ['date', 'bodyweight_kg', `bodyweight_${u}`, 'bed_time', 'wake_time', 'sleep_min',
    'sleep_difficulty', 'sleep_score', 'sleep_source', 'resting_hr', 'resting_hr_source', 'hrv',
    'waist_cm', 'drinks', 'caffeine', 'kcal', 'energy', 'soreness', 'stress', 'pain', 'flags',
    'pre_sleep_activity', 'sleep_notes', 'notes'];
  const rows = recoveryDates().map((d) => {
    const e = j[d] || {};
    const r = dailyRecovery(d);
    return [d, e.bw != null ? Math.round(e.bw * 10) / 10 : '', e.bw != null ? Math.round(fromKg(e.bw, u) * 10) / 10 : '',
      e.bedTime || '', e.wakeTime || '', r.sleepMinutes ?? '',
      e.sleepDiff ?? '', r.sleepScore ?? '', r.sleepSource || '', r.restingHR ?? '', r.restingHRSource || '', r.hrv ?? '',
      e.waist ?? '', e.drinks ?? '', e.caffeine ?? '', e.kcal ?? '', e.energy ?? '', e.soreness ?? '', e.stress ?? '',
      (e.pain || []).join('; '), (e.flags || []).join('; '),
      e.preSleep || '', e.amNote || '', e.notes || ''];
  });
  if (!rows.length) { toast('No check-ins to export'); return; }
  downloadFile(toCSV(headers, rows), `concurrent-trainer-journal-${todayISO()}.csv`, 'text/csv');
  toast('Journal CSV downloaded');
}

// One row per day joining recovery + training load + protein — the day-grain
// merge is where the health correlations live, so ship it pre-joined.
function exportDailyCSV() {
  const s = get();
  const dates = new Set([...recoveryDates(), ...s.sessions.map((x) => x.date), ...Object.keys(s.proteinLog)]);
  if (!dates.size) { toast('Nothing to export yet'); return; }
  const headers = ['date', 'bodyweight_kg', 'sleep_min', 'sleep_difficulty', 'resting_hr', 'energy', 'soreness', 'stress',
    'pain', 'drinks', 'caffeine', 'kcal', 'flags', 'protein_g', 'protein_target_g',
    'strength_sessions', 'completed_sets', 'hard_sets', 'volume_lb', 'zone2_min', 'interval_min', 'other_activity_min', 'notes'];
  const target = proteinTarget();
  const rows = [...dates].sort().map((d) => {
    const e = s.journal[d] || {};
    const r = dailyRecovery(d);
    const day = s.sessions.filter((x) => x.date === d);
    let liftN = 0, sets = 0, hard = 0, vol = 0, z2 = 0, intv = 0, other = 0;
    day.forEach((sess) => {
      if (sess.kind === 'strength') {
        liftN += 1;
        vol += sessionVolume(sess);
        (sess.entries || []).forEach((en) => (en.sets || []).forEach((st) => {
          if (Number(st.reps) > 0) sets += 1;
          if (isHardSet(st)) hard += 1;
        }));
      } else if (sess.kind === 'cardio') {
        if (sess.cardioType === 'interval') intv += Number(sess.durationMin) || 0;
        else if (sess.cardioType === 'zone2') z2 += Number(sess.durationMin) || 0;
        else other += Number(sess.durationMin) || 0;
      } else if (sess.kind === 'activity') {
        const m = ACTIVITY_MAP[sess.activity] || ACTIVITY_MAP.other;
        const dur = Number(sess.durationMin) || 0;
        if (m.cardioType === 'zone2') z2 += dur; else if (m.cardioType === 'interval') intv += dur; else other += dur;
      }
    });
    return [d, e.bw != null ? Math.round(e.bw * 10) / 10 : '', r.sleepMinutes ?? '', e.sleepDiff ?? '', r.restingHR ?? '',
      e.energy ?? '', e.soreness ?? '', e.stress ?? '', (e.pain || []).join('; '),
      e.drinks ?? '', e.caffeine ?? '', e.kcal ?? '', (e.flags || []).join('; '),
      s.proteinLog[d] ?? '', target,
      liftN, sets, hard, vol, z2, intv, other, e.notes || ''];
  });
  downloadFile(toCSV(headers, rows), `concurrent-trainer-daily-${todayISO()}.csv`, 'text/csv');
  toast('Daily CSV downloaded');
}

function doExport() {
  downloadFile(exportJSON(), `concurrent-trainer-backup-${todayISO()}.json`, 'application/json');
  localStorage.setItem(BACKUP_KEY, String(Date.now()));
  toast('Backup downloaded');
}
function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const file = inp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importJSON(reader.result); toast('Imported'); setTab('today'); }
      catch (err) { toast('Invalid backup file'); }
    };
    reader.readAsText(file);
  });
  inp.click();
}

// ---------- boot ----------
setTab('today');

// If previously connected, pull-or-push on startup.
if (store.getConnected() && sync.isConfigured()) {
  sync.syncNow().catch(() => {});
}

// service worker for offline / installable
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
