import { S } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, pageHeader, tabs, fmt, empty, refresh, pct, ring, info } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { waterDay, foodDay, sleepDay, activityDay, habitsDay, badDay, moodDay, directionRates, on } from '../summary.js';
import { fmtDateShort, fmtDate, fmtDuration, addDays, keyRange, weekStart, monthKey, daysBetween } from '../core/time.js';
import { avg, sum, progressIndex, oneRepMax } from '../core/calc.js';
import { toDisp, unitLabel } from '../ui/units.js';
import { saveFile } from '../native.js';

let period = 'week';
let tab = 'charts';
let reportType = 'week', reportOffset = 0;
const PERIODS = [['day', 'Личный день'], ['week', 'Неделя'], ['month', 'Месяц'], ['3m', '3 мес.'], ['6m', 'Полгода'], ['year', 'Год'], ['all', 'Всё время']];
const LEN = { week: 7, month: 30, '3m': 90, '6m': 182, year: 365 };

function firstKey() {
  let min = Date.now();
  for (const k of ['water', 'food', 'sleep', 'weight', 'workout', 'activity', 'habitlog', 'baduse', 'mood']) { const a = S.logs(k); if (a.length && a[0].ts < min) min = a[0].ts; }
  return S.pdayOf(min).key;
}
function periodKeys(p) {
  const cur = S.cur().key;
  if (p === 'all') return keyRange(firstKey(), cur);
  return keyRange(addDays(cur, -((LEN[p] || 7) - 1)), cur);
}
/** Группировка дней: по дням (≤ 62), по неделям (≤ 1 года), по месяцам. */
function buckets(keys) {
  if (keys.length <= 62) return keys.map((k) => ({ label: fmtDateShort(k), keys: [k] }));
  const byW = keys.length <= 400;
  const m = new Map();
  for (const k of keys) { const g = byW ? weekStart(k) : monthKey(k); if (!m.has(g)) m.set(g, []); m.get(g).push(k); }
  return [...m.entries()].map(([g, ks]) => ({ label: byW ? fmtDateShort(g) : g.slice(5) + '.' + g.slice(2, 4), keys: ks }));
}
const meanOf = (ks, f) => { const v = ks.map(f).filter((x) => x != null && !isNaN(x)); return v.length ? avg(v) : null; };
const sumOf = (ks, f) => ks.reduce((a, k) => a + (f(k) || 0), 0);

function dayView() {
  const k = S.cur().key;
  const w = waterDay(k), f = foodDay(k), s = sleepDay(k), a = activityDay(k), hd = habitsDay(k), m = moodDay(k);
  return card(`Личный день · ${fmtDate(k)}`, h('div', null,
    on('water') ? row('Вода', `${fmt(toDisp('volume', w.ml))} / ${fmt(toDisp('volume', w.goal))} ${unitLabel('volume')}`) : null,
    on('food') ? row('Калории', `${fmt(f.kcal)} / ${S.settings.food.targets.kcal} ккал`, { sub: `Б ${fmt(f.protein)} · Ж ${fmt(f.fat)} · У ${fmt(f.carbs)} · сахар ${fmt(f.sugar)} · клетчатка ${fmt(f.fiber)}` }) : null,
    on('sleep') ? row('Сон', s.total ? fmtDuration(s.total) : '—') : null,
    row('Активность', `${fmt(a.minutes)} мин · ${a.workouts} тренировок · ${fmt(a.steps)} шагов`),
    hd.total ? row('Привычки', `${hd.done} из ${hd.total}`) : null,
    ...badDay(k).map((x) => row(x.b.name, `${fmt(x.amount, 1)}${x.limit != null ? ' / ' + x.limit : ''}`)),
    on('mind') ? row('Настроение', m.mood ? `${fmt(m.mood, 1)}/5` : '—') : null));
}

function charts() {
  if (period === 'day') return dayView();
  const keys = periodKeys(period);
  const B = buckets(keys);
  const L = B.map((b) => b.label);
  const cur = S.cur().key;
  const out = [];
  const style = S.settings.charts.style;
  if (on('body')) {
    const wv = B.map((b) => meanOf(b.keys, (k) => { const ws = S.inDay('weight', k); return ws.length ? avg(ws.map((x) => x.value)) : null; }));
    out.push(card('Вес', chart({ labels: L, series: [{ name: 'Вес', values: wv.map((v) => (v == null ? null : toDisp('weight', v))), color: 'var(--body)' }], type: 'line', zero: false, connect: true, unit: unitLabel('weight'), goal: S.settings.body.target ? toDisp('weight', S.settings.body.target) : null })));
  }
  if (on('water')) out.push(card('Вода (в среднем за день)', chart({ labels: L, series: [{ name: 'Вода', values: B.map((b) => meanOf(b.keys, (k) => waterDay(k).ml || null)), color: 'var(--water)' }], type: style === 'line' ? 'line' : 'bar', goal: S.settings.water.goal || null, unit: 'мл', connect: true })));
  if (on('food')) {
    const fd = B.map((b) => b.keys.map(foodDay).filter((d) => d.count));
    const m = (n) => fd.map((ds) => (ds.length ? avg(ds.map((d) => d[n])) : null));
    out.push(card('Калорийность', chart({ labels: L, series: [{ name: 'Ккал', values: m('kcal'), color: 'var(--food)' }], type: 'bar', goal: S.settings.food.targets.kcal || null, unit: 'ккал' })));
    out.push(card('БЖУ, г', chart({ labels: L, series: [{ name: 'Белки', values: m('protein'), color: '#ff8f5a' }, { name: 'Жиры', values: m('fat'), color: '#ffd166' }, { name: 'Углеводы', values: m('carbs'), color: '#4cc3ff' }], type: 'line', connect: true, unit: 'г' })));
  }
  if (on('sleep')) out.push(card('Сон, ч', chart({ labels: L, series: [{ name: 'Сон', values: B.map((b) => meanOf(b.keys, (k) => { const t = sleepDay(k).total; return t ? t / 60 : null; })), color: 'var(--sleep)' }, { name: 'Качество', values: B.map((b) => meanOf(b.keys, (k) => sleepDay(k).quality)), color: 'var(--mood)', type: 'line', dashed: true }], type: 'bar', goal: S.settings.sleep.goalMin ? S.settings.sleep.goalMin / 60 : null })));
  if (on('workouts') || on('activity')) {
    out.push(card('Физическая активность, мин', chart({ labels: L, series: [{ name: 'Минут', values: B.map((b) => sumOf(b.keys, (k) => activityDay(k).minutes) || null), color: 'var(--act)' }], type: 'bar' })));
    out.push(card('Количество тренировок', chart({ labels: L, series: [{ name: 'Тренировок', values: B.map((b) => sumOf(b.keys, (k) => activityDay(k).workouts)), color: '#2ec4a6' }], type: 'bar', allowZero: true })));
    const strength = strengthChart(keys);
    if (strength) out.push(strength);
  }
  if (on('habits') || on('hygiene')) out.push(card('Выполнение привычек, %', chart({ labels: L, series: [{ name: 'Выполнено', values: B.map((b) => { let t = 0, d = 0; for (const k of b.keys) { if (k >= cur) continue; const x = habitsDay(k); t += x.total; d += x.done; } return t ? (d / t) * 100 : null; }), color: 'var(--habit)' }], type: 'bar', unit: '%' })));
  if (on('bad')) {
    const bads = S.defs('bad').filter((b) => !b.archived);
    if (bads.length) out.push(card('Динамика вредных привычек (в среднем за день)', chart({ labels: L, series: bads.slice(0, 4).map((b, i) => ({ name: b.name, values: B.map((bk) => meanOf(bk.keys.filter((k) => k >= b.startDate), (k) => badDay(k).find((x) => x.b.id === b.id).amount)), color: ['var(--bad)', '#ff8f5a', '#ffd166', '#a597ff'][i] })), type: 'line', connect: true, allowZero: true })));
  }
  if (on('mind')) out.push(card('Настроение и самочувствие (1–5)', chart({ labels: L, series: [{ name: 'Настроение', values: B.map((b) => meanOf(b.keys, (k) => moodDay(k).mood)), color: 'var(--mood)' }, { name: 'Энергия', values: B.map((b) => meanOf(b.keys, (k) => moodDay(k).energy)), color: 'var(--act)' }, { name: 'Самочувствие после сна', values: B.map((b) => meanOf(b.keys, (k) => { const s = sleepDay(k).main; return s ? s.feeling : null; })), color: '#a597ff', dashed: true }], type: 'line', zero: false, connect: true })));
  if (keys.length > 62) out.unshift(h('p', { class: 'muted small mb' }, keys.length <= 400 ? 'Значения сгруппированы по неделям.' : 'Значения сгруппированы по месяцам.'));
  return h('div', null, ...out);
}

function strengthChart(keys) {
  const from = S.range(keys[0]).start;
  const best = {};
  for (const w of S.logs('workout')) {
    if (w.ts < from || !w.end) continue;
    for (const it of w.items || []) {
      if (it.metric !== 'reps_weight') continue;
      const e1 = Math.max(0, ...it.sets.filter((s) => s.done !== false).map((s) => oneRepMax(s.weight, s.reps) || 0));
      if (!e1) continue;
      (best[it.exId] = best[it.exId] || []).push({ ts: w.ts, e1 });
    }
  }
  const top = Object.entries(best).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  if (!top.length) return null;
  const allTs = [...new Set(top.flatMap(([, a]) => a.map((x) => S.pdayOf(x.ts).key)))].sort();
  return card('Силовые показатели (расчётный 1ПМ)', chart({ labels: allTs.map(fmtDateShort), series: top.map(([id, arr], i) => ({ name: (S.def(id) || {}).name || id, values: allTs.map((k) => { const x = arr.filter((q) => S.pdayOf(q.ts).key === k); return x.length ? toDisp('weight', Math.max(...x.map((q) => q.e1))) : null; }), color: ['var(--act)', '#4cc3ff', '#ffd166'][i] })), type: 'line', zero: false, connect: true, unit: unitLabel('weight') }));
}

// ── Индекс прогресса ──
function progressTab() {
  const keys = period === 'day' ? periodKeys('week') : periodKeys(period);
  const dirs = directionRates(keys);
  const idx = progressIndex(dirs);
  return h('div', null,
    card('Общий показатель прогресса', h('div', null,
      h('div', { class: 'dash-mini' }, ring((idx || 0) / 100, { size: 100, stroke: 10, color: 'var(--accent)', label: idx == null ? '—' : idx + '', sub: 'из 100' }),
        h('div', { class: 'info muted small' }, `Период: ${period === 'day' ? 'неделя (для одного дня индекс не считается)' : PERIODS.find((p) => p[0] === period)[1].toLowerCase()}. Текущий незавершённый день не учитывается.`)),
      h('p', { class: 'hint mt' }, 'Как считается: для каждого выбранного направления — доля дней (или недель), когда ваша собственная цель выполнена. Затем взвешенное среднее по весам ниже. Направления без данных не учитываются и не «тянут» вниз. Это показатель последовательности в ваших целях, а не медицинская оценка здоровья.')), { cls: 'hero' }),
    card('Направления', h('div', null, dirs.map((d) => row(d.label, d.rate == null ? 'нет данных' : pct(d.rate), { sub: `вес ${d.weight} · ${d.how}` })),
      btn('Настроить веса направлений', () => formSheet({ title: 'Веса направлений', fields: [{ type: 'hint', label: 'Вес 0 — направление не участвует. 1 — обычный, 2–3 — важнее.' }, ...dirs.map((d) => ({ name: d.id, label: d.label, type: 'number', min: 0, max: 5, value: d.weight, half: true }))], onSave: (v) => S.saveSettings({ progress: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? 0])) }) }), 'small mt'))));
}

// ── Отчёты ──
function reportRange() {
  const cur = S.cur().key;
  if (reportType === 'week') { const s = addDays(weekStart(cur), -7 * reportOffset); return [s, addDays(s, 6)]; }
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, m - 1 - reportOffset, 1);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const e = addDays(`${new Date(d.getFullYear(), d.getMonth() + 1, 1).getFullYear()}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 1).getMonth() + 1).padStart(2, '0')}-01`, -1);
  return [s, e];
}
function summarize(a, b) {
  const cur = S.cur().key;
  const keys = keyRange(a, b > cur ? cur : b);
  const past = keys.filter((k) => k < cur);
  const fd = keys.map(foodDay).filter((d) => d.count);
  const sl = keys.map((k) => sleepDay(k).total).filter((x) => x > 0);
  const ws = S.logs('weight').filter((w) => keys.includes(S.pdayOf(w.ts).key));
  let ht = 0, hdn = 0; for (const k of past) { const x = habitsDay(k); ht += x.total; hdn += x.done; }
  const bads = S.defs('bad').map((bd) => ({ name: bd.name, unit: bd.unit, total: sum(keys, (k) => (badDay(k).find((x) => x.b.id === bd.id) || {}).amount || 0), clean: keys.filter((k) => k >= bd.startDate && k < cur && !((badDay(k).find((x) => x.b.id === bd.id) || {}).amount)).length }));
  return {
    days: keys.length,
    water: meanOf(keys, (k) => waterDay(k).ml || null), waterGoal: past.filter((k) => waterDay(k).ml >= S.settings.water.goal && S.settings.water.goal).length,
    kcal: fd.length ? avg(fd.map((d) => d.kcal)) : null, protein: fd.length ? avg(fd.map((d) => d.protein)) : null, foodDays: fd.length,
    sleep: sl.length ? avg(sl) : null, sleepDays: sl.length,
    workouts: sumOf(keys, (k) => activityDay(k).workouts), minutes: sumOf(keys, (k) => activityDay(k).minutes), steps: sumOf(keys, (k) => activityDay(k).steps),
    weightFirst: ws.length ? ws[0].value : null, weightLast: ws.length ? ws.at(-1).value : null, weighs: ws.length,
    habits: ht ? hdn / ht : null, mood: meanOf(keys, (k) => moodDay(k).mood), bads,
  };
}
const delta = (a, b, d = 0, unit = '') => (a == null || b == null ? '' : ` (${a - b >= 0 ? '+' : ''}${fmt(a - b, d)}${unit} к прошлому)`);
function reportText(r, p, title) {
  const L = [title, ''];
  if (on('water') && r.water != null) L.push(`Вода: в среднем ${fmt(r.water)} мл/день${delta(r.water, p.water)}; цель достигнута ${r.waterGoal} дн.`);
  if (on('food') && r.kcal != null) L.push(`Питание: ${fmt(r.kcal)} ккал/день${delta(r.kcal, p.kcal)}, белок ${fmt(r.protein)} г; дневник заполнен ${r.foodDays} из ${r.days} дн.`);
  if (on('sleep') && r.sleep != null) L.push(`Сон: в среднем ${fmtDuration(r.sleep)}${p.sleep != null ? ` (${r.sleep - p.sleep >= 0 ? '+' : '−'}${fmtDuration(Math.abs(r.sleep - p.sleep))} к прошлому)` : ''}; записан ${r.sleepDays} дн.`);
  if (on('workouts') || on('activity')) L.push(`Активность: тренировок ${r.workouts}${delta(r.workouts, p.workouts)}, ${fmt(r.minutes)} мин, шагов ${fmt(r.steps)}.`);
  if (on('body') && r.weighs) L.push(`Вес: ${fmt(r.weightFirst, 1)} → ${fmt(r.weightLast, 1)} кг (взвешиваний: ${r.weighs}). ${r.weighs < 3 ? 'Мало измерений для выводов.' : ''}`);
  if (r.habits != null) L.push(`Привычки: выполнено ${pct(r.habits)} запланированного${p.habits != null ? ` (было ${pct(p.habits)})` : ''}.`);
  for (const b of r.bads) { const pb = p.bads.find((x) => x.name === b.name); L.push(`${b.name}: ${fmt(b.total, 1)} ${b.unit || ''}${pb ? ` (было ${fmt(pb.total, 1)})` : ''}, дней без — ${b.clean}.`); }
  if (on('mind') && r.mood != null) L.push(`Настроение: в среднем ${fmt(r.mood, 1)}/5${delta(r.mood, p.mood, 1)}.`);
  if (L.length === 2) L.push('Нет данных за этот период.');
  L.push('', 'Отчёт построен только по введённым данным. Это не медицинское заключение.');
  return L.join('\n');
}
function reportsTab() {
  const [a, b] = reportRange();
  const len = daysBetween(a, b) + 1;
  const pa = reportType === 'week' ? addDays(a, -7) : (() => { const [y, m] = a.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; })();
  const pb = addDays(a, -1);
  const r = summarize(a, b), p = summarize(pa, pb);
  const title = `LIFE OS · ${reportType === 'week' ? 'недельный' : 'месячный'} отчёт ${fmtDateShort(a)} — ${fmtDateShort(b)}`;
  const text = reportText(r, p, title);
  void len;
  return h('div', null,
    h('div', { class: 'split mb' }, tabs([{ id: 'week', label: 'Неделя' }, { id: 'month', label: 'Месяц' }], reportType, (t) => { reportType = t; reportOffset = 0; refresh(); })),
    h('div', { class: 'split mb' }, btn('‹', () => { reportOffset++; refresh(); }, 'small'), h('b', null, `${fmtDateShort(a)} — ${fmtDateShort(b)}`), btn('›', () => { reportOffset = Math.max(0, reportOffset - 1); refresh(); }, 'small' + (reportOffset ? '' : ' ghost'))),
    card(null, h('div', { class: 'pre' }, text.split('\n').slice(2).join('\n'))),
    btn('Поделиться / сохранить отчёт', () => saveFile(`lifeos-report_${a}_${b}.txt`, text, 'text/plain'), 'wide'));
}

export default {
  analytics: { tab: 'analytics', render: () => h('div', null,
    pageHeader('Аналитика'),
    tabs([{ id: 'charts', label: 'Графики' }, { id: 'progress', label: 'Прогресс' }, { id: 'reports', label: 'Отчёты' }], tab, (t) => { tab = t; refresh(false); }),
    tab !== 'reports' ? h('div', { class: 'chips mb' }, PERIODS.map(([id, l]) => h('button', { class: 'chip' + (period === id ? ' on' : ''), onclick: () => { period = id; refresh(); } }, l))) : null,
    tab === 'charts' ? charts() : tab === 'progress' ? progressTab() : reportsTab(),
    h('p', { class: 'muted small mt' }, 'Все графики строятся только по вашим записям — без подстановки данных.')) },
};
export { toast, info, empty };
