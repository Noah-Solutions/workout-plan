// app.js — UI, router, and event handling
import {
  load, get, update, uid, exerciseById, exportJSON, importJSON, resetAll,
  MUSCLES, PATTERNS, PATTERN_LABEL,
} from './store.js';
import {
  aggregateWeek, weekRange, fmtWeekLabel, fmtDate, todayISO,
  proteinTarget, ACTIVITY_MAP,
} from './week.js';
import { suggestNext, commitExerciseState, fmtWeight, lastPerformance } from './progression.js';
import { TEMPLATES } from './templates.js';
import * as store from './store.js';
import * as sync from './sync.js';

load();

// Auto-push local changes to the cloud sheet (debounced) when connected.
store.onChange(() => sync.scheduleAutoPush());
let lastSyncMsg = '';
sync.onStatus((status, detail) => {
  if (status === 'synced') { lastSyncMsg = `Synced (${detail.direction}) · ${new Date().toLocaleTimeString()}`; toast(detail.direction === 'pulled' ? 'Pulled from Sheet' : 'Synced to Sheet'); }
  else if (status === 'error') { lastSyncMsg = 'Sync error: ' + detail; }
  else if (status === 'signed-out') { lastSyncMsg = ''; }
  if (currentTab === 'setup') renderSetup();
  if (currentTab === 'week' && (status === 'synced')) renderWeek();
});

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('viewTitle');
const weekLabelEl = document.getElementById('weekLabel');
const modalRoot = document.getElementById('modalRoot');

let currentTab = 'week';
// draft state for the log-session builder
let draft = null;

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
  if (b.dataset.tab === 'log') { draft = null; }
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
  if (draft) return renderDraft();
  viewEl.innerHTML = h`
    <p class="muted small mb">What did you do? Pick a type — you can add, skip, or improvise anything.</p>
    <div class="logchoice">
      <button class="logchoice__btn" data-log="strength">
        <span class="logchoice__ico">🏋️</span>
        <span><span class="logchoice__t">Strength session</span><span class="logchoice__d">Log lifts, sets, reps & RIR — with auto-progression targets</span></span>
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
  viewEl.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => startDraft(b.dataset.log)));
}

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
function renderHistory() {
  const sessions = [...get().sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!sessions.length) {
    viewEl.innerHTML = `<div class="empty"><div class="empty__ico">📭</div>No sessions yet. Tap <b>Log</b> to record your first one.</div>`;
    return;
  }
  viewEl.innerHTML = sessions.map((s) => historyItem(s)).join('');
  viewEl.querySelectorAll('[data-del-session]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.delSession;
    update((st) => { st.sessions = st.sessions.filter((x) => x.id !== id); });
    toast('Deleted'); renderHistory();
  }));
}

function historyItem(s) {
  let ico = '🏋️', title = 'Strength', detail = '';
  if (s.kind === 'strength') {
    const totalSets = (s.entries || []).reduce((n, e) => n + e.sets.length, 0);
    const names = (s.entries || []).map((e) => (exerciseById(e.exerciseId)?.name) || e.exSnapshot?.name || '?');
    title = `Strength · ${totalSets} sets`;
    detail = names.join(', ');
  } else if (s.kind === 'cardio') {
    ico = s.cardioType === 'interval' ? '🔥' : '🚴';
    title = `${s.cardioType === 'interval' ? 'Intervals' : 'Zone 2'} · ${s.durationMin} min`;
    detail = s.avgHR ? `avg ${s.avgHR} bpm` : '';
  } else if (s.kind === 'activity') {
    const m = ACTIVITY_MAP[s.activity] || ACTIVITY_MAP.other;
    ico = m.icon; title = `${m.label} · ${s.durationMin} min`; detail = m.note;
  }
  if (s.note) detail += (detail ? ' · ' : '') + '“' + esc(s.note) + '”';
  return h`<div class="hist-item">
    <div class="hist-item__ico">${ico}</div>
    <div class="hist-item__body">
      <div class="hist-item__t">${esc(title)}</div>
      <div class="hist-item__d">${detail}</div>
      <div class="hist-item__date">${fmtDate(s.date)}</div>
    </div>
    <button class="setrow__del" data-del-session="${s.id}">🗑</button>
  </div>`;
}

// ================= SETUP =================
function syncCardHTML() {
  const configured = sync.isConfigured();
  const connected = store.getConnected();
  const clientId = store.getClientId();
  const url = sync.sheetUrl();
  const statusLine = lastSyncMsg ? `<div class="small muted mt">${esc(lastSyncMsg)}</div>` : '';
  const gisNote = sync.gisReady() ? '' : `<div class="small muted mt">⚠ Google sign-in library not loaded (offline or blocked). Sync will work once you're back online.</div>`;

  const body = !configured
    ? h`<p class="small muted">Sign in with Google to back up and sync all your data through a Google Sheet you own.
        First paste your OAuth <b>Client ID</b> (one-time setup — see the README's “Cloud Sync” section).</p>
      <label class="field"><span>Google OAuth Client ID</span>
        <input id="gClientId" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${esc(clientId)}" /></label>
      <button class="btn btn--primary" id="gSaveClient">Save Client ID</button>`
    : !connected
    ? h`<p class="small muted">Ready to connect. You'll pick your Google account and grant access to a single spreadsheet the app creates.</p>
      <button class="btn btn--accent" id="gSignIn">🔗 Sign in with Google</button>
      <button class="linkbtn mt" id="gEditClient">Change Client ID</button>`
    : h`<div class="row-between">
        <div><b>Connected</b><div class="small muted">Last-write-wins · auto-syncs on change</div></div>
        <span class="pill pill--up">● Google</span>
      </div>
      <div class="btn-row mt">
        <button class="btn btn--sm" id="gSyncNow">↻ Sync now</button>
        ${url ? `<a class="btn btn--sm btn--ghost" href="${url}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;line-height:1.6">Open Sheet ↗</a>` : ''}
      </div>
      <button class="linkbtn mt" id="gSignOut">Sign out</button>`;

  return h`<div class="card">
    <div class="card__title"><h2>☁ Cloud sync</h2><span class="card__hint">Google Sheets</span></div>
    ${body}${statusLine}${gisNote}
  </div>`;
}

function wireSyncCard() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('gSaveClient', 'click', () => {
    const v = document.getElementById('gClientId').value.trim();
    if (!v) { toast('Paste your Client ID'); return; }
    store.setClientId(v); sync.initClient(); toast('Client ID saved'); renderSetup();
  });
  on('gEditClient', 'click', () => { store.setConnected(false); store.setClientId(''); renderSetup(); });
  on('gSignIn', 'click', async () => {
    try { await sync.signIn(); renderSetup(); }
    catch (e) { toast('Sign-in cancelled or failed'); }
  });
  on('gSignOut', 'click', () => { sync.signOut(); renderSetup(); });
  on('gSyncNow', 'click', async () => { try { await sync.syncNow(); } catch (e) { toast('Sync failed — check setup'); } });
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

// Try to silently restore a Google session and sync (only if previously connected).
// GIS loads async, so wait for it briefly before attempting resume.
function attemptResume(triesLeft) {
  if (!store.getConnected() || !sync.isConfigured()) return;
  if (!sync.gisReady()) {
    if (triesLeft > 0) setTimeout(() => attemptResume(triesLeft - 1), 400);
    return;
  }
  sync.initClient();
  sync.tryResume().then((ok) => { if (ok) sync.syncNow().catch(() => {}); });
}
window.addEventListener('load', () => attemptResume(15));

// service worker for offline / installable
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
