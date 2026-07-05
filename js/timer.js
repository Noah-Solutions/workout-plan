// timer.js — rest timer between sets. Renders into a fixed #restBar element so
// it survives view re-renders, and fires a beep + vibrate when time is up.
import { get } from './store.js';

let el = null, iv = null, remaining = 0, total = 0, audioCtx = null;

function ensureEl() { if (!el) el = document.getElementById('restBar'); return el; }
function fmt(s) { const m = Math.floor(s / 60), ss = s % 60; return `${m}:${String(ss).padStart(2, '0')}`; }

function render() {
  if (!ensureEl()) return;
  if (remaining <= 0 && !iv) { el.classList.add('restbar--hidden'); el.innerHTML = ''; return; }
  const pct = total ? Math.max(0, remaining) / total : 0;
  const done = remaining <= 0;
  el.classList.remove('restbar--hidden');
  el.classList.toggle('restbar--done', done);
  el.innerHTML = `
    <div class="restbar__fill" style="width:${(pct * 100).toFixed(1)}%"></div>
    <div class="restbar__row">
      <span class="restbar__label">${done ? '✅ Rest done' : '⏱ Rest'}</span>
      <span class="restbar__time">${fmt(Math.max(0, remaining))}</span>
      <span class="restbar__btns">
        <button class="restbar__btn" data-t="-15">−15</button>
        <button class="restbar__btn" data-t="15">+15</button>
        <button class="restbar__btn restbar__btn--skip" data-t="skip">${done ? 'Close' : 'Skip'}</button>
      </span>
    </div>`;
  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
    const v = b.dataset.t;
    if (v === 'skip') { stop(); return; }
    remaining = Math.max(0, remaining + Number(v));
    if (remaining > total) total = remaining;
    if (remaining > 0 && !iv) tick();
    render();
  });
}

function tick() {
  clearInterval(iv);
  iv = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) finish();
    render();
  }, 1000);
}

export function start(seconds) {
  const st = get().settings.restTimer || {};
  if (st.enabled === false) return;
  total = seconds || st.seconds || 90;
  remaining = total;
  tick();
  render();
}

function finish() {
  clearInterval(iv); iv = null; remaining = 0;
  const st = get().settings.restTimer || {};
  if (st.vibrate !== false && navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (e) {} }
  if (st.sound !== false) beep();
  render();
  setTimeout(() => { if (!iv && remaining <= 0) { ensureEl(); if (el) { el.classList.add('restbar--hidden'); el.innerHTML = ''; } } }, 5000);
}

export function stop() { clearInterval(iv); iv = null; remaining = 0; render(); }
export function isRunning() { return !!iv; }

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [0, 0.18, 0.36].forEach((t) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
      o.start(now + t); o.stop(now + t + 0.17);
    });
  } catch (e) {}
}
