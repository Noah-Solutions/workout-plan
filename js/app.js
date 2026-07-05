// app.js — UI, router, and event handling
import {
  load, get, update, uid, exerciseById, exportJSON, importJSON, resetAll,
  MUSCLES, PATTERNS, PATTERN_LABEL,
} from './store.js';
import {
  aggregateWeek, weekRange, fmtWeekLabel, fmtDate, todayISO,
  proteinTarget, ACTIVITY_MAP,
} from './week.js';
import { suggestNext, commitExerciseState, fmtWeight, lastPerformance, guidedTarget, applyWorkoutResult, warmupSets } from './progression.js';
import { TEMPLATES } from './templates.js';
import { platesLabel, platesFor } from './plates.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as timer from './timer.js';

load();

// Auto-push local changes to the sync server (debounced) when connected.
store.onChange(() => sync.scheduleAutoPush());
let lastSyncMsg = '';
sync.onStatus((status, detail) => {
  if (status === 'synced') { lastSyncMsg = `Synced (${detail.direction}) · ${new Date().toLocaleTimeString()}`; toast(detail.direction === 'pulled' ? 'Pulled from server' : 'Synced to server'); }
  else if (status === 'error') { lastSyncMsg = 'Sync error: ' + detail; }
  else if (status === 'disconnected') { lastSyncMsg = ''; }
  if (currentTab === 'setup') renderSetup();
  if (currentTab === 'week' && status === 'synced') renderWeek();
});

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('viewTitle');
const weekLabelEl = document.getElementById('weekLabel');
const modalRoot = document.getElementById('modalRoot');

let currentTab = 'week';
// draft state for the log-session builder
let draft = null;
// in-progress guided (StrongLifts-style) workout
let workout = null;

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
const TITLES = { week: 'This Week', log: 'Log a Session', history: 'History', setup: 'Setup' };
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  titleEl.textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.tab === 'log' && !workout) { draft = null; }
  setTab(b.dataset.tab);
}));

function render() {
  const range = weekRange();
  weekLabelEl.textContent = currentTab === 'week' ? fmtWeekLabel(range) : '';
  if (currentTab === 'week') renderWeek();
  else if (currentTab === 'log') renderLog();
  else if (currentTab === 'history') renderHistory();
  else if (currentTab === 'setup') renderSetup();
}

// ================= WEEK DASHBOARD =================
function renderWeek() {
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
        <div class="mt small">
          Lifts: <b>${mvw.liftSessions}</b>/2 &nbsp;·&nbsp; Patterns: <b>${mvw.patternsCovered}</b>/4 &nbsp;·&nbsp; Cardio: <b>${mvw.totalCardioMin}</b>/75 min
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

  const protein = proteinTarget();
  const proteinToday = get().proteinLog[todayISO()] || 0;
  const proteinPct = Math.min(1, proteinToday / protein);

  viewEl.innerHTML = h`
    ${nextWorkoutHeroHTML()}
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

    <div class="card">
      <div class="card__title"><h2>Protein today</h2><span class="card__hint">${protein} g target</span></div>
      <div class="mbar__track"><div class="mbar__fill" style="width:${(proteinPct*100).toFixed(0)}%;background:var(--accent-2)"></div></div>
      <div class="row-between mt">
        <span class="muted small">${proteinToday} / ${protein} g (${get().settings.proteinPerKg} g/kg)</span>
        <button class="btn btn--sm" id="addProtein">Log protein</button>
      </div>
    </div>

    <button class="btn btn--primary" id="goLog">＋ Log a session</button>
  `;

  document.getElementById('goLog').addEventListener('click', () => { draft = null; setTab('log'); });
  document.getElementById('addProtein').addEventListener('click', proteinPrompt);
  const startBtn = document.getElementById('heroStart');
  if (startBtn) startBtn.addEventListener('click', () => startWorkout(nextTemplate()));
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
    return h`<div class="hero-ex">
      <span class="hero-ex__name">${esc(ex.name)}</span>
      <span class="hero-ex__scheme">${t.sets}×${t.reps}</span>
      <span class="hero-ex__wt">${fmtWeight(t.weight, t.unit)}</span>
    </div>`;
  }).join('');
  return h`<div class="hero">
    <div class="hero__top">
      <div>
        <div class="hero__eyebrow">NEXT WORKOUT</div>
        <div class="hero__title">${esc(tpl.name)}</div>
      </div>
      <span class="hero__badge">💪</span>
    </div>
    <div class="hero__exs">${rows}</div>
    <button class="btn btn--accent hero__start" id="heroStart">▶ Start workout</button>
  </div>`;
}

function proteinPrompt() {
  const cur = get().proteinLog[todayISO()] || 0;
  openModal('Protein today (g)', h`
    <label class="field"><span>Total protein consumed today</span>
      <input type="number" id="pval" inputmode="numeric" value="${cur}" /></label>
    <button class="btn btn--primary" id="psave">Save</button>
  `);
  document.getElementById('psave').addEventListener('click', () => {
    const v = Math.max(0, Number(document.getElementById('pval').value) || 0);
    update((s) => { s.proteinLog[todayISO()] = v; });
    closeModal(); toast('Protein logged'); render();
  });
}

// ================= LOG =================
function renderLog() {
  if (workout) return renderWorkout();
  if (draft) return renderDraft();
  viewEl.innerHTML = h`
    <div class="logchoice">
      <button class="logchoice__btn logchoice__btn--hero" data-log="guided">
        <span class="logchoice__ico">🏋️</span>
        <span><span class="logchoice__t">Start guided workout</span><span class="logchoice__d">Target weights auto-set · tap-to-complete sets · rest timer · auto-progression</span></span>
      </button>
      <button class="logchoice__btn" data-log="strength">
        <span class="logchoice__ico">📝</span>
        <span><span class="logchoice__t">Free-form strength log</span><span class="logchoice__d">Build a session manually — any exercises, sets, reps & RIR</span></span>
      </button>
      <button class="logchoice__btn" data-log="zone2">
        <span class="logchoice__ico">🚴</span>
        <span><span class="logchoice__t">Zone 2 cardio</span><span class="logchoice__d">Easy, conversational — builds your aerobic base</span></span>
      </button>
      <button class="logchoice__btn" data-log="interval">
        <span class="logchoice__ico">🔥</span>
        <span><span class="logchoice__t">Intervals</span><span class="logchoice__d">Your one hard cardio day per week</span></span>
      </button>
      <button class="logchoice__btn" data-log="activity">
        <span class="logchoice__ico">🧗</span>
        <span><span class="logchoice__t">Other activity</span><span class="logchoice__d">Climbing, outdoor ride, hike — mapped to what it replaces</span></span>
      </button>
    </div>
  `;
  viewEl.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.log === 'guided') templatePickerForWorkout();
    else startDraft(b.dataset.log);
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
    exercises: exs.map((ex) => {
      const t = guidedTarget(ex);
      return {
        exerciseId: ex.id,
        weight: t.weight,
        targetReps: t.reps,
        unit: t.unit,
        sets: Array.from({ length: t.sets }, () => ({ reps: t.reps, done: false })),
        warmDone: [],   // ephemeral warm-up completion flags (not saved)
        difficulty: null,
      };
    }),
  };
  timer.stop();
  setTab('log');
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

    // warm-up ramp (barbell only) — ephemeral guidance
    const warm = isBar ? warmupSets(w.weight, bar) : [];
    const warmHTML = warm.length ? h`<div class="warmup">
        <span class="warmup__label">Warm-up</span>
        <div class="warmup__dots">${warm.map((ws, i) => h`<button class="warmdot ${w.warmDone[i] ? 'is-done' : ''}" data-warm="${wi}:${i}">
          <b>${ws.weight}</b><small>×${ws.reps}</small></button>`).join('')}</div>
      </div>` : '';

    const setCircles = w.sets.map((st, si) => h`<button class="setdot ${st.done ? 'is-done' : ''} ${st.done && st.reps < w.targetReps ? 'is-miss' : ''}"
        data-set="${wi}:${si}">${st.done ? st.reps : (w.unit === 'sec' ? '⏱' : w.targetReps)}</button>`).join('');
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
      <div class="wex__scheme muted small">${w.sets.length} × ${w.targetReps}${w.unit === 'sec' ? 's' : ' reps'} · tap a set, tap again if you missed reps</div>
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

  // set circle tap: cycle done@targetReps -> done@reps-1 -> ... -> done@0 -> not done
  viewEl.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
    const [wi, si] = b.dataset.set.split(':').map(Number);
    const st = workout.exercises[wi].sets[si];
    const tr = workout.exercises[wi].targetReps;
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
    document.getElementById('woDiscard').addEventListener('click', () => { workout = null; timer.stop(); closeModal(); setTab('week'); });
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
    const t = guidedTarget(ex);
    workout.exercises.push({ exerciseId: ex.id, weight: t.weight, targetReps: t.reps, unit: t.unit,
      sets: Array.from({ length: t.sets }, () => ({ reps: t.reps, done: false })), warmDone: [], difficulty: null });
    closeModal(); renderWorkout();
  }));
}

function finishWorkout() {
  const done = workout.exercises.filter((w) => w.sets.some((s) => s.done));
  if (!done.length) { toast('Complete at least one set'); return; }
  const summary = [];
  update((s) => {
    const entries = done.map((w) => {
      const ex = s.exercises.find((e) => e.id === w.exerciseId);
      const sets = w.sets.filter((st) => st.done).map((st) => ({
        weight: w.unit === 'bw' ? 0 : w.weight, reps: Number(st.reps), rir: '',
      }));
      let outcome = null;
      if (ex) outcome = applyWorkoutResult(ex, sets, w.difficulty);
      if (ex && outcome) summary.push({ name: ex.name, ...outcome, unit: w.unit });
      return {
        exerciseId: w.exerciseId,
        exSnapshot: ex ? { name: ex.name, muscles: ex.muscles, pattern: ex.pattern } : null,
        sets, difficulty: w.difficulty,
      };
    });
    s.sessions.push({ id: uid(), kind: 'strength', date: workout.date, templateName: workout.templateName, entries, note: '' });
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
  document.getElementById('woDone').addEventListener('click', () => { closeModal(); setTab('week'); });
}

function diffLabel(d) { return { easy: '😌 Easy', good: '🙂 Good', hard: '😤 Hard', failed: '✗ Failed' }[d] || d; }

function startDraft(kind) {
  if (kind === 'strength') {
    draft = { kind: 'strength', date: todayISO(), entries: [], note: '' };
    renderDraft();
  } else if (kind === 'zone2' || kind === 'interval') {
    draft = { kind: 'cardio', cardioType: kind, date: todayISO(), durationMin: kind === 'interval' ? 25 : 50, avgHR: '', note: '' };
    renderDraft();
  } else if (kind === 'activity') {
    draft = { kind: 'activity', activity: 'climbing', date: todayISO(), durationMin: 60, note: '' };
    renderDraft();
  }
}

function renderDraft() {
  if (draft.kind === 'strength') return renderStrengthDraft();
  if (draft.kind === 'cardio') return renderCardioDraft();
  if (draft.kind === 'activity') return renderActivityDraft();
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
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; renderLog(); });
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
  update((s) => {
    const entries = filled.map((en) => {
      const ex = exerciseById(en.exerciseId);
      const sets = en.sets.filter((st) => Number(st.reps) > 0).map((st) => ({
        weight: st.weight === '' ? 0 : Number(st.weight), reps: Number(st.reps), rir: st.rir === '' ? '' : Number(st.rir),
      }));
      if (ex) commitExerciseState(ex, sets);
      return { exerciseId: en.exerciseId, exSnapshot: ex ? { name: ex.name, muscles: ex.muscles, pattern: ex.pattern } : null, sets };
    });
    s.sessions.push({ id: uid(), kind: 'strength', date: draft.date, entries, note: draft.note });
  });
  draft = null; toast('Session saved'); setTab('week');
}

// ---- cardio draft ----
function renderCardioDraft() {
  const isInt = draft.cardioType === 'interval';
  viewEl.innerHTML = h`
    <div class="card">
      <div class="card__title"><h2>${isInt ? '🔥 Intervals' : '🚴 Zone 2 cardio'}</h2></div>
      <p class="muted small">${isInt ? 'Hard efforts — talking broken into a few words.' : 'Easy & conversational. Builds your aerobic base with low fatigue cost.'}</p>
      <label class="field"><span>Date</span><input type="date" id="cDate" value="${draft.date}" /></label>
      <label class="field"><span>Duration (minutes)</span><input type="number" inputmode="numeric" id="cDur" value="${draft.durationMin}" /></label>
      <label class="field"><span>Average HR (optional)</span><input type="number" inputmode="numeric" id="cHR" value="${draft.avgHR}" placeholder="bpm" /></label>
      <label class="field"><span>Note (optional)</span><input type="text" id="cNote" value="${esc(draft.note)}" /></label>
    </div>
    <div class="btn-row">
      <button class="btn btn--ghost" id="cancelDraft">Cancel</button>
      <button class="btn btn--primary" id="saveCardio">Save</button>
    </div>`;
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; renderLog(); });
  document.getElementById('saveCardio').addEventListener('click', () => {
    const dur = Number(document.getElementById('cDur').value) || 0;
    if (dur <= 0) { toast('Enter a duration'); return; }
    update((s) => s.sessions.push({
      id: uid(), kind: 'cardio', cardioType: draft.cardioType, date: document.getElementById('cDate').value,
      durationMin: dur, avgHR: Number(document.getElementById('cHR').value) || null, note: document.getElementById('cNote').value,
    }));
    draft = null; toast('Cardio saved'); setTab('week');
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
      <button class="btn btn--primary" id="saveAct">Save</button>
    </div>`;
  document.getElementById('aType').addEventListener('change', (e) => { draft.activity = e.target.value; draft.durationMin = Number(document.getElementById('aDur').value) || draft.durationMin; renderActivityDraft(); });
  document.getElementById('cancelDraft').addEventListener('click', () => { draft = null; renderLog(); });
  document.getElementById('saveAct').addEventListener('click', () => {
    const dur = Number(document.getElementById('aDur').value) || 0;
    if (dur <= 0) { toast('Enter a duration'); return; }
    update((s) => s.sessions.push({
      id: uid(), kind: 'activity', activity: draft.activity, date: document.getElementById('aDate').value,
      durationMin: dur, note: document.getElementById('aNote').value,
    }));
    draft = null; toast('Activity saved'); setTab('week');
  });
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

function sessionVolume(s) {
  if (s.kind !== 'strength') return 0;
  return (s.entries || []).reduce((v, e) => v + (e.sets || []).reduce((a, st) => a + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0), 0);
}

function renderHistory() {
  const sessions = [...get().sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!sessions.length) {
    viewEl.innerHTML = `<div class="empty"><div class="empty__ico">📭</div>No sessions yet.<br>Tap <b>Log</b> to start your first workout.</div>`;
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

  // group by day
  const groups = [];
  let cur = null;
  sessions.forEach((s) => {
    if (!cur || cur.date !== s.date) { cur = { date: s.date, items: [] }; groups.push(cur); }
    cur.items.push(s);
  });
  const groupsHTML = groups.map((g) => h`
    <div class="section-label">${relDay(g.date)}</div>
    ${g.items.map((s) => historyItem(s)).join('')}
  `).join('');

  viewEl.innerHTML = summary + groupsHTML;
  viewEl.querySelectorAll('[data-session]').forEach((el) => el.addEventListener('click', () => sessionDetail(el.dataset.session)));
}

function historyItem(s) {
  let ico = '🏋️', title = 'Strength', detail = '', extra = '';
  if (s.kind === 'strength') {
    const totalSets = (s.entries || []).reduce((n, e) => n + e.sets.length, 0);
    const names = (s.entries || []).map((e) => (exerciseById(e.exerciseId)?.name) || e.exSnapshot?.name || '?');
    title = s.templateName || 'Strength';
    detail = names.join(' · ');
    const vol = sessionVolume(s);
    extra = `${totalSets} sets · ${vol >= 1000 ? (vol / 1000).toFixed(1) + 'k' : vol} lb`;
  } else if (s.kind === 'cardio') {
    ico = s.cardioType === 'interval' ? '🔥' : '🚴';
    title = `${s.cardioType === 'interval' ? 'Intervals' : 'Zone 2'} · ${s.durationMin} min`;
    detail = s.avgHR ? `avg ${s.avgHR} bpm` : '';
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
      const name = (exerciseById(e.exerciseId)?.name) || e.exSnapshot?.name || '?';
      const sets = (e.sets || []).map((st) => st.weight ? `${st.weight}×${st.reps}` : `${st.reps}${st.reps > 30 ? 's' : ''}`).join(', ');
      const diff = e.difficulty ? ` <span class="tag">${diffLabel(e.difficulty)}</span>` : '';
      return h`<div class="det-ex"><div class="det-ex__name">${esc(name)}${diff}</div><div class="det-ex__sets">${sets}</div></div>`;
    }).join('');
    const vol = sessionVolume(s);
    body += `<div class="small muted mt">Total volume: <b>${vol.toLocaleString()} lb</b></div>`;
  } else {
    body = `<div class="muted">${esc(s.kind === 'cardio' ? (s.cardioType === 'interval' ? 'Intervals' : 'Zone 2') : (ACTIVITY_MAP[s.activity] || ACTIVITY_MAP.other).label)} · ${s.durationMin} min${s.avgHR ? ` · avg ${s.avgHR} bpm` : ''}</div>`;
  }
  if (s.note) body += `<div class="small mt">“${esc(s.note)}”</div>`;
  openModal(`${relDay(s.date)} · ${fmtDate(s.date)}`, h`
    ${body}
    <button class="btn btn--danger btn--sm mt" id="detDel">🗑 Delete this session</button>
  `);
  document.getElementById('detDel').addEventListener('click', () => {
    update((st) => { st.sessions = st.sessions.filter((x) => x.id !== id); });
    closeModal(); toast('Deleted'); renderHistory();
  });
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
        <button class="btn btn--sm" id="expBtn">⬇ Export</button>
        <button class="btn btn--sm" id="impBtn">⬆ Import</button>
      </div>
      <button class="btn btn--sm btn--danger" id="resetBtn">Reset all data</button>
      <p class="small muted mt">Data lives on this device (offline). Export a JSON backup to keep it safe or move devices.</p>
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
  document.getElementById('resetBtn').addEventListener('click', () => {
    openModal('Reset all data?', `<p class="muted">This deletes every logged session and restores default exercises. Export a backup first if unsure.</p>
      <div class="btn-row mt"><button class="btn btn--ghost" data-close-btn>Cancel</button><button class="btn btn--danger" id="confReset">Reset</button></div>`);
    modalRoot.querySelector('[data-close-btn]').addEventListener('click', closeModal);
    document.getElementById('confReset').addEventListener('click', () => { resetAll(); closeModal(); toast('Reset'); setTab('week'); });
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

function doExport() {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `concurrent-trainer-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
}
function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const file = inp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importJSON(reader.result); toast('Imported'); setTab('week'); }
      catch (err) { toast('Invalid backup file'); }
    };
    reader.readAsText(file);
  });
  inp.click();
}

// ---------- boot ----------
setTab('week');

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
