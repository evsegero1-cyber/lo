// Лёгкие SVG-графики без внешних библиотек. Касание показывает значения.
import { h, s, fmt } from './dom.js';
import { S } from '../data/store.js';

const W = 340, PAD_L = 34, PAD_R = 8, PAD_T = 12, PAD_B = 22;

function niceRange(min, max, zero) {
  if (zero) min = Math.min(0, min);
  if (min === max) { max = max + (Math.abs(max) * 0.1 || 1); min = zero ? min : min - (Math.abs(min) * 0.1 || 1); }
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const k = [1, 2, 2.5, 5, 10].find((m) => span / (step * m) <= 5) || 10;
  const st = step * k;
  return { min: Math.floor(min / st) * st, max: Math.ceil(max / st) * st, step: st };
}

/**
 * opts: { labels:[], series:[{name, values:[], color, type?:'line'|'bar', dashed}], height, goal, unit, zero, stacked, fmtY, empty }
 */
export function chart(opts) {
  const height = opts.height || 170;
  const labels = opts.labels || [];
  const series = (opts.series || []).filter((x) => x && x.values);
  const all = [];
  const style = opts.type || (S.settings.charts || {}).style || 'line';
  if (opts.stacked) {
    for (let i = 0; i < labels.length; i++) all.push(series.reduce((a, se) => a + (se.values[i] || 0), 0));
  } else for (const se of series) for (const v of se.values) if (v != null && isFinite(v)) all.push(v);
  if (opts.goal != null) all.push(opts.goal);
  const hasData = series.some((se) => se.values.some((v) => v != null && v !== 0)) || (opts.allowZero && series.some((se) => se.values.some((v) => v != null)));
  if (!labels.length || !hasData) return h('div', { class: 'chart-empty' }, opts.empty || 'Нет данных за период');
  const zero = opts.zero ?? true;
  const rng = niceRange(Math.min(...all), Math.max(...all), zero && style !== 'line' ? true : zero);
  const iw = W - PAD_L - PAD_R, ih = height - PAD_T - PAD_B;
  const n = labels.length;
  const x = (i) => PAD_L + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const bw = Math.max(2, Math.min(22, (iw / n) * 0.7));
  const xb = (i) => PAD_L + ((i + 0.5) * iw) / n;
  const y = (v) => PAD_T + ih - ((v - rng.min) / (rng.max - rng.min)) * ih;
  const fy = opts.fmtY || ((v) => fmt(v, rng.step < 1 ? 1 : 0));
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', preserveAspectRatio: 'none' });
  // сетка
  for (let v = rng.min; v <= rng.max + 1e-9; v += rng.step) {
    svg.appendChild(s('line', { x1: PAD_L, x2: W - PAD_R, y1: y(v), y2: y(v), class: 'grid' }));
    svg.appendChild(s('text', { x: PAD_L - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, fy(v)));
  }
  // подписи X
  const every = Math.ceil(n / 6);
  const anyBar = style === 'bar' || series.some((se) => se.type === 'bar');
  for (let i = 0; i < n; i += every) svg.appendChild(s('text', { x: anyBar ? xb(i) : x(i), y: height - 6, class: 'axis', 'text-anchor': 'middle' }, labels[i]));
  if (opts.goal != null) {
    svg.appendChild(s('line', { x1: PAD_L, x2: W - PAD_R, y1: y(opts.goal), y2: y(opts.goal), class: 'goal' }));
  }
  const base = new Array(n).fill(0);
  series.forEach((se, si) => {
    const t = se.type || style;
    const col = se.color || 'var(--accent)';
    if (t === 'bar') {
      const sub = opts.stacked ? 1 : series.filter((q) => (q.type || style) === 'bar').length;
      const idx = opts.stacked ? 0 : series.filter((q) => (q.type || style) === 'bar').indexOf(se);
      const w = bw / sub;
      se.values.forEach((v, i) => {
        if (v == null || v === 0) return;
        const y0 = opts.stacked ? base[i] : Math.max(0, rng.min);
        const top = y(y0 + v), bot = y(y0);
        svg.appendChild(s('rect', { x: xb(i) - bw / 2 + idx * w, y: Math.min(top, bot), width: Math.max(1, w - 1), height: Math.max(1, Math.abs(bot - top)), rx: 2, fill: col, class: 'bar-r' }));
        if (opts.stacked) base[i] += v;
      });
    } else {
      let d = '', pen = false;
      const pts = [];
      se.values.forEach((v, i) => {
        if (v == null || !isFinite(v)) { if (!opts.connect) pen = false; return; }
        const px = anyBar ? xb(i) : x(i), py = y(v);
        d += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
        pen = true; pts.push([px, py]);
      });
      if (se.area && pts.length > 1) {
        const a = d + `L${pts[pts.length - 1][0]} ${y(Math.max(rng.min, 0))}L${pts[0][0]} ${y(Math.max(rng.min, 0))}Z`;
        svg.appendChild(s('path', { d: a, fill: col, opacity: 0.12 }));
      }
      svg.appendChild(s('path', { d, fill: 'none', stroke: col, 'stroke-width': se.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': se.dashed ? '4 4' : null, class: 'line' }));
      if (pts.length <= 40 && !se.noDots) for (const [px, py] of pts) svg.appendChild(s('circle', { cx: px, cy: py, r: 2.6, fill: col }));
    }
  });
  // всплывающая подсказка
  const cursor = s('line', { y1: PAD_T, y2: PAD_T + ih, class: 'cursor', visibility: 'hidden' });
  svg.appendChild(cursor);
  const tip = h('div', { class: 'chart-tip' });
  const wrap = h('div', { class: 'chart-wrap' }, svg, tip);
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let i = anyBar ? Math.floor(((px - PAD_L) / iw) * n) : Math.round(((px - PAD_L) / iw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const cx = anyBar ? xb(i) : x(i);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    tip.innerHTML = '';
    tip.appendChild(h('b', null, labels[i]));
    for (const se of series) {
      const v = se.values[i];
      tip.appendChild(h('div', null, h('i', { style: { background: se.color || 'var(--accent)' } }), `${se.name ? se.name + ': ' : ''}${v == null ? '—' : (opts.fmtTip || ((q) => fmt(q, 1)))(v)}${opts.unit ? ' ' + opts.unit : ''}`));
    }
    tip.style.left = Math.min(70, Math.max(0, (cx / W) * 100 - 15)) + '%';
    tip.classList.add('show');
  };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') show(e); });
  svg.addEventListener('pointerleave', () => { tip.classList.remove('show'); cursor.setAttribute('visibility', 'hidden'); });
  const legend = series.filter((se) => se.name).length > 1 || opts.goal != null
    ? h('div', { class: 'legend' }, series.filter((se) => se.name).map((se) => h('span', null, h('i', { style: { background: se.color || 'var(--accent)' } }), se.name)), opts.goal != null ? h('span', null, h('i', { class: 'goal-i' }), 'цель') : null)
    : null;
  return h('div', { class: 'chart-box' }, wrap, legend);
}

/** Точечная диаграмма для сопоставлений. */
export function scatter(points, { xLabel = '', yLabel = '', height = 180, color = 'var(--accent)' } = {}) {
  const p = points.filter((q) => q.x != null && q.y != null);
  if (p.length < 2) return h('div', { class: 'chart-empty' }, 'Мало совпадающих дней для сравнения');
  const xr = niceRange(Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x)), false);
  const yr = niceRange(Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y)), false);
  const iw = W - PAD_L - PAD_R, ih = height - PAD_T - PAD_B - 6;
  const X = (v) => PAD_L + ((v - xr.min) / (xr.max - xr.min)) * iw;
  const Y = (v) => PAD_T + ih - ((v - yr.min) / (yr.max - yr.min)) * ih;
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart' });
  for (let v = yr.min; v <= yr.max + 1e-9; v += yr.step) { svg.appendChild(s('line', { x1: PAD_L, x2: W - PAD_R, y1: Y(v), y2: Y(v), class: 'grid' })); svg.appendChild(s('text', { x: PAD_L - 4, y: Y(v) + 3, class: 'axis', 'text-anchor': 'end' }, fmt(v, 1))); }
  for (let v = xr.min; v <= xr.max + 1e-9; v += xr.step) svg.appendChild(s('text', { x: X(v), y: PAD_T + ih + 12, class: 'axis', 'text-anchor': 'middle' }, fmt(v, 1)));
  for (const q of p) svg.appendChild(s('circle', { cx: X(q.x), cy: Y(q.y), r: 3.5, fill: color, opacity: 0.75 }));
  svg.appendChild(s('text', { x: W - PAD_R, y: height - 2, class: 'axis', 'text-anchor': 'end' }, xLabel));
  svg.appendChild(s('text', { x: PAD_L, y: 9, class: 'axis' }, yLabel));
  return h('div', { class: 'chart-box' }, svg);
}

/** Календарная сетка (недели по столбцам). cell(key) → {level:0..1|null, title} */
export function heatmap(keys, cell, color = 'var(--accent)') {
  if (!keys.length) return h('div');
  const grid = h('div', { class: 'heat' });
  const first = keys[0];
  const wd = new Date(first + 'T12:00').getDay();
  const offset = wd === 0 ? 6 : wd - 1;
  for (let i = 0; i < offset; i++) grid.appendChild(h('i', { class: 'heat-c none' }));
  for (const k of keys) {
    const c = cell(k) || {};
    const el = h('i', { class: 'heat-c' + (c.level == null ? ' none' : ''), title: c.title || k });
    if (c.level != null) { el.style.background = color; el.style.opacity = String(0.15 + 0.85 * Math.max(0, Math.min(1, c.level))); }
    if (c.today) el.classList.add('today');
    grid.appendChild(el);
  }
  return h('div', { class: 'heat-wrap' }, h('div', { class: 'heat-days' }, ['Пн', '', 'Ср', '', 'Пт', '', 'Вс'].map((d) => h('span', null, d))), grid);
}

/** Горизонтальная гистограмма (например, триггеры). */
export function hbars(items, { color = 'var(--accent)', unit = '' } = {}) {
  if (!items.length) return h('div', { class: 'chart-empty' }, 'Нет данных');
  const max = Math.max(...items.map((i) => i[1]));
  return h('div', { class: 'hbars' }, items.map(([label, v]) => h('div', { class: 'hbar' },
    h('span', { class: 'hbar-l' }, label), h('div', { class: 'hbar-t' }, h('div', { style: { width: (v / max) * 100 + '%', background: color } })), h('span', { class: 'hbar-v' }, fmt(v, 1) + (unit ? ' ' + unit : '')))));
}
