// plates.js — barbell plate math (lbs)
import { get } from './store.js';

// Which plates go on EACH side to reach `total` on the bar.
// Returns { perSide: [45,25,...], loadable: bool, remainder }
export function platesFor(total, barWeight, available) {
  const s = get();
  const bar = barWeight != null ? barWeight : s.settings.barWeightLb;
  const plates = (available || s.settings.platesLb).slice().sort((a, b) => b - a);
  let perSideWeight = (Number(total) - bar) / 2;
  const perSide = [];
  if (perSideWeight <= 0) return { perSide: [], loadable: Number(total) >= bar, remainder: Math.max(0, bar - Number(total)) };
  for (const p of plates) {
    while (perSideWeight >= p - 1e-9) { perSide.push(p); perSideWeight -= p; }
  }
  return { perSide, loadable: perSideWeight < 1e-9, remainder: Math.round(perSideWeight * 10) / 10 };
}

// Compact human string, e.g. "45 · 25 · 10 · 2.5"
export function platesLabel(total, barWeight, available) {
  const { perSide, loadable, remainder } = platesFor(total, barWeight, available);
  if (!perSide.length) return loadable ? 'bar only' : `${total} (below bar)`;
  const str = perSide.map(fmtPlate).join(' · ');
  return loadable ? str : `${str}  (+${remainder} short)`;
}

function fmtPlate(p) { return Number.isInteger(p) ? String(p) : p.toFixed(1); }
