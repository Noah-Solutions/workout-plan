// charts.js — tiny dependency-free SVG charts (line + bar).
// Marks are drawn against CSS custom properties (--chart-1/--chart-2) so they
// re-theme automatically in light/dark. Tooltips are wired after mount via
// mountTips(container); every interactive mark carries a data-tip attribute.

const NS = 'http://www.w3.org/2000/svg';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "nice" axis ticks over [0, max] — clean round steps.
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

// Rounded-top / square-bottom bar path.
function barPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

// ---- line chart ----
// points: [{ t: 'Jul 5', full: 'Sat, Jul 5', v: 123 }]  (chronological)
// opts: { yFmt, valFmt, color }  color is a CSS var name, default --chart-1
export function lineChart(points, opts = {}) {
  const yFmt = opts.yFmt || ((v) => String(v));
  const valFmt = opts.valFmt || yFmt;
  const color = `var(${opts.color || '--chart-1'})`;
  const W = 340, H = 184, padL = 36, padR = 16, padT = 14, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;

  if (!points.length) return '';
  const ys = points.map((p) => p.v);
  const rawMax = Math.max(...ys), rawMin = Math.min(...ys);
  // pad the band a little so the line isn't glued to the edges
  let lo = Math.min(rawMin, rawMax * 0.9);
  let hi = rawMax + (rawMax - lo) * 0.12 || rawMax + 1;
  if (hi === lo) { hi = lo + 1; }
  const ticks = niceTicks(hi, 3).filter((tk) => tk >= lo * 0.999);
  if (ticks[0] > lo) ticks.unshift(Math.round(lo));

  const X = (i) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const Y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;

  // gridlines + y labels
  let grid = '';
  ticks.forEach((tk) => {
    const y = Y(tk);
    if (y < padT - 1 || y > padT + ih + 1) return;
    grid += `<line class="chart__grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="chart__axis" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${esc(yFmt(tk))}</text>`;
  });

  // area + line
  const linePts = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const areaD = `M${X(0).toFixed(1)},${(padT + ih).toFixed(1)} L${points.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' L')} L${X(points.length - 1).toFixed(1)},${(padT + ih).toFixed(1)} Z`;

  // x labels: first, last, and a middle one if room
  const xlabelIdx = points.length <= 1 ? [0] : points.length <= 4
    ? points.map((_, i) => i)
    : [0, Math.round((points.length - 1) / 2), points.length - 1];
  let xlabels = '';
  xlabelIdx.forEach((i) => {
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    xlabels += `<text class="chart__axis" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${esc(points[i].t)}</text>`;
  });

  // dots + hit targets (last dot larger; end value label)
  let dots = '', hits = '';
  points.forEach((p, i) => {
    const x = X(i), y = Y(p.v);
    const last = i === points.length - 1;
    dots += `<circle class="chart__dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${last ? 4 : 3}" fill="${color}"/>`;
    hits += `<circle class="chart__hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" data-tip="<b>${esc(valFmt(p.v))}</b><br>${esc(p.full || p.t)}"/>`;
  });
  const lastY = Y(points[points.length - 1].v);
  const endLabel = `<text class="chart__endlabel" x="${(W - padR).toFixed(1)}" y="${(lastY - 8).toFixed(1)}" text-anchor="end">${esc(valFmt(points[points.length - 1].v))}</text>`;

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <path class="chart__area" d="${areaD}" fill="${color}"/>
    <polyline class="chart__line" points="${linePts}" stroke="${color}"/>
    ${dots}${endLabel}${xlabels}${hits}
  </svg></div>`;
}

// ---- bar chart (single or stacked) ----
// groups: [{ label: 'Jun 9', segs: [{ key, v }] , total }]
// series: [{ key, name, color }]  color = CSS var name
// opts: { yFmt, valFmt, unit }
export function barChart(groups, series, opts = {}) {
  const yFmt = opts.yFmt || ((v) => String(v));
  const valFmt = opts.valFmt || yFmt;
  const W = 340, H = 176, padL = 34, padR = 12, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  if (!groups.length) return '';

  const colorOf = {};
  series.forEach((s) => { colorOf[s.key] = `var(${s.color})`; });

  const totals = groups.map((g) => g.total != null ? g.total : g.segs.reduce((a, s) => a + s.v, 0));
  const hi = Math.max(1, ...totals);
  const ticks = niceTicks(hi, 3);
  let top = ticks[ticks.length - 1] || hi;
  // keep headroom so the value label above the tallest bar never clips
  if (hi > top * 0.9) { const step = (ticks[1] - ticks[0]) || top; top += step; ticks.push(top); }
  const Y = (v) => padT + ih - (v / top) * ih;

  const band = iw / groups.length;
  const bw = Math.min(24, band * 0.6);
  const gap = 2; // surface gap between stacked segments

  let grid = '';
  ticks.forEach((tk) => {
    const y = Y(tk);
    grid += `<line class="chart__grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="chart__axis" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${esc(yFmt(tk))}</text>`;
  });
  grid += `<line class="chart__baseline" x1="${padL}" y1="${(padT + ih).toFixed(1)}" x2="${W - padR}" y2="${(padT + ih).toFixed(1)}"/>`;

  let bars = '', labels = '', hits = '';
  groups.forEach((g, gi) => {
    const cx = padL + band * gi + band / 2;
    const x = cx - bw / 2;
    let yCursor = padT + ih; // stack upward from baseline
    const nonZero = g.segs.filter((s) => s.v > 0);
    nonZero.forEach((seg, si) => {
      const full = ih * (seg.v / top);
      const h = Math.max(0, full - (si > 0 ? gap : 0));
      const y = yCursor - h;
      const isTop = si === nonZero.length - 1;
      bars += `<path d="${barPath(x, y, bw, h, isTop ? 4 : 0)}" fill="${colorOf[seg.key] || 'var(--chart-1)'}"/>`;
      yCursor = y - (isTop ? 0 : gap);
    });
    const total = totals[gi];
    if (total > 0) {
      const topY = Y(total);
      labels += `<text class="chart__barlabel" x="${cx.toFixed(1)}" y="${(topY - 5).toFixed(1)}">${esc(valFmt(total))}</text>`;
      const tipSegs = series.filter((s) => g.segs.some((seg) => seg.key === s.key && seg.v > 0))
        .map((s) => { const seg = g.segs.find((x) => x.key === s.key); return `${esc(s.name)} ${esc(valFmt(seg.v))}`; }).join('<br>');
      const tip = `<b>${esc(g.full || g.label)}</b><br>${tipSegs || esc(valFmt(total))}`;
      hits += `<rect class="chart__hit" x="${(cx - band / 2).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${ih}" data-tip="${tip}"/>`;
    }
    labels += `<text class="chart__axis" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(g.label)}</text>`;
  });

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">
    ${grid}${bars}${labels}${hits}
  </svg></div>`;
}

// Legend row for multi-series charts.
export function legend(series) {
  if (!series || series.length < 2) return '';
  return `<div class="chart__legend">${series.map((s) =>
    `<span class="chart__key"><span class="chart__swatch" style="background:var(${s.color})"></span>${esc(s.name)}</span>`).join('')}</div>`;
}

// Wire tooltips inside a container that holds one or more .chart blocks.
// Each .chart gets its own floating tip; interactive marks carry data-tip (HTML).
export function mountTips(container) {
  container.querySelectorAll('.chart').forEach((chart) => {
    let tip = chart.querySelector('.chart__tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart__tip'; chart.appendChild(tip); }
    const show = (el) => {
      const cr = chart.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      tip.innerHTML = el.getAttribute('data-tip');
      tip.style.left = (er.left + er.width / 2 - cr.left) + 'px';
      tip.style.top = (er.top - cr.top) + 'px';
      tip.classList.add('is-on');
    };
    const hide = () => tip.classList.remove('is-on');
    chart.addEventListener('pointermove', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el); else hide();
    });
    chart.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    chart.addEventListener('pointerleave', hide);
  });
  // dismiss on tap outside any mark
  container.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-tip]')) container.querySelectorAll('.chart__tip.is-on').forEach((t) => t.classList.remove('is-on'));
  });
}
