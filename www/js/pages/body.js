import { S, uid } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, tabs, fmt, empty, refresh, confirmDialog } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { fmtDateShort, fmtDateTime, dateKey, addDays } from '../core/time.js';
import { bmi, bmiCategory, BMI_LIMITS, movingAverage, weightTrend, avg } from '../core/calc.js';
import { toDisp, fromDisp, unitLabel } from '../ui/units.js';
import { pickImage } from '../native.js';

let tab = 'weight';
let period = 90;
const GOALS = { lose: 'Похудение', maintain: 'Поддержание веса', gain: 'Набор мышечной массы', recomp: 'Улучшение композиции тела' };

export function lastWeight() { return S.logs('weight').at(-1) || null; }

export function addWeight(l) {
  const isNew = !l;
  formSheet({ title: isNew ? 'Взвешивание' : 'Изменить взвешивание', fields: [
    { name: 'value', label: 'Вес', unit: unitLabel('weight'), type: 'number', min: toDisp('weight', 20), max: toDisp('weight', 400), required: true, value: l ? toDisp('weight', l.value) : (lastWeight() ? toDisp('weight', lastWeight().value) : '') },
    { name: 'ts', label: 'Когда', type: 'datetime', value: l ? l.ts : Date.now() },
    { name: 'note', label: 'Заметка', placeholder: 'например: после сна, натощак', value: l && l.note },
  ], onSave: async (v) => {
    const kg = Math.round(fromDisp('weight', v.value) * 100) / 100;
    if (isNew) {
      const dup = S.logs('weight').find((x) => Math.abs(x.ts - v.ts) < 10 * 60000 && Math.abs(x.value - kg) < 0.05);
      if (dup) return 'Такое взвешивание уже записано';
    }
    await S.putLog({ ...(l || { kind: 'weight' }), value: kg, ts: v.ts, note: v.note });
  }, onDelete: isNew ? null : () => S.delLog(l.id) });
}

function settingsSheet() {
  const b = S.settings.body;
  formSheet({ title: 'Цели по телу', fields: [
    { name: 'goal', label: 'Цель', type: 'select', options: Object.entries(GOALS).map(([v, l]) => ({ value: v, label: l })), value: b.goal },
    { name: 'target', label: 'Желаемый вес', unit: unitLabel('weight'), type: 'number', min: toDisp('weight', 30), max: toDisp('weight', 300), value: b.target ? toDisp('weight', b.target) : '' },
  ], onSave: async (v) => { await S.saveSettings({ body: { goal: v.goal, target: v.target ? fromDisp('weight', v.target) : null } }); } });
}

function weightTab() {
  const all = S.logs('weight');
  const last = all.at(-1);
  const cur = S.cur().key;
  const entries = all.map((w) => ({ key: S.pdayOf(w.ts).key, value: w.value }));
  const tr = weightTrend(entries, cur);
  const target = S.settings.body.target;
  const height = S.settings.profile.height;
  const b = last && height ? bmi(last.value, height) : null;
  // график: по дням — среднее за день
  const keys = period ? S.lastDays(period) : (all.length ? (() => { const a = []; for (let k = S.pdayOf(all[0].ts).key; k <= cur; k = addDays(k, 1)) a.push(k); return a; })() : []);
  const byDay = {};
  for (const e of entries) (byDay[e.key] = byDay[e.key] || []).push(e.value);
  const vals = keys.map((k) => (byDay[k] ? avg(byDay[k]) : null));
  const ma = movingAverage(vals, 7);
  const first = all.length ? all[0].value : null;
  return h('div', null,
    card(null, h('div', null,
      h('div', { class: 'split' }, h('div', null, h('div', { class: 'muted small' }, 'Текущий вес'), h('div', { class: 'big' }, last ? `${fmt(toDisp('weight', last.value), 1)} ${unitLabel('weight')}` : '—'), last ? h('div', { class: 'muted small' }, fmtDateTime(last.ts)) : null),
        btn('＋ Взвеситься', () => addWeight(null), 'primary')),
      h('div', { class: 'grid3 mt' },
        h('div', { class: 'stat' }, h('b', null, target ? fmt(toDisp('weight', target), 1) : '—'), h('small', null, 'желаемый')),
        h('div', { class: 'stat' }, h('b', null, tr ? `${tr.diff > 0 ? '+' : ''}${fmt(toDisp('weight', tr.diff), 1)}` : '—'), h('small', null, 'неделя к неделе')),
        h('div', { class: 'stat' }, h('b', null, first != null && last ? `${last.value - first > 0 ? '+' : ''}${fmt(toDisp('weight', last.value - first), 1)}` : '—'), h('small', null, 'с начала'))),
      h('p', { class: 'muted small mt' }, tr
        ? `Сравниваются средние за 7 дней (${tr.nLast} изм.) и предыдущие 7 дней (${tr.nPrev} изм.). Колебания веса в 0,5–1,5 кг за день из-за воды и еды — норма, поэтому выводы по одному взвешиванию не делаются.`
        : 'Для оценки динамики нужно минимум по 2 взвешивания за эту и прошлую неделю. Одно измерение — не повод для выводов.')), { cls: 'hero' }),
    card('Динамика', h('div', null,
      h('div', { class: 'chips mb' }, [[30, '30 дн.'], [90, '3 мес.'], [180, '6 мес.'], [365, 'год'], [0, 'всё']].map(([p, l]) => h('button', { class: 'chip' + (period === p ? ' on' : ''), onclick: () => { period = p; refresh(); } }, l))),
      chart({ labels: keys.map(fmtDateShort), series: [{ name: 'Вес', values: vals.map((v) => (v == null ? null : toDisp('weight', v))), color: 'var(--body)', type: 'line', noDots: keys.length > 60 }, ...(S.settings.charts.ma !== false ? [{ name: 'Среднее за 7 дн.', values: ma.map((v) => (v == null ? null : toDisp('weight', v))), color: '#a597ff', dashed: true, noDots: true }] : [])], zero: false, goal: target ? toDisp('weight', target) : null, unit: unitLabel('weight'), connect: true, type: 'line' }))),
    card('Индекс массы тела', h('div', null,
      b ? row(`ИМТ ${fmt(b, 1)}`, bmiCategory(b)) : h('p', { class: 'muted small' }, height ? 'Добавьте взвешивание' : 'Укажите рост в Настройки → Профиль'),
      h('p', { class: 'muted small' }, BMI_LIMITS))),
    card('История', all.length ? h('div', null, [...all].reverse().slice(0, 50).map((w) => row(`${fmt(toDisp('weight', w.value), 1)} ${unitLabel('weight')}`, fmtDateTime(w.ts), { sub: w.note || null, onclick: () => addWeight(w) }))) : empty('Взвешиваний пока нет')),
  );
}

// ── Замеры ──
function addMeasure() {
  const ms = S.settings.body.metrics;
  formSheet({ title: 'Замеры', fields: [
    { type: 'hint', label: 'Заполните только то, что измерили. Пустые поля не сохраняются.' },
    ...ms.map((m) => ({ name: m.id, label: m.name, unit: m.unit === 'cm' ? unitLabel('length') : m.unit, type: 'number', min: 0, max: 1000, half: true })),
    { name: 'ts', label: 'Когда', type: 'datetime', value: Date.now() },
  ], onSave: async (v) => {
    let n = 0;
    for (const m of ms) {
      if (v[m.id] == null) continue;
      const val = m.unit === 'cm' ? fromDisp('length', v[m.id]) : v[m.id];
      if (m.id === 'fat' && (val < 2 || val > 70)) return 'Процент жира — от 2 до 70';
      await S.putLog({ kind: 'measure', metric: m.id, value: Math.round(val * 10) / 10, ts: v.ts });
      n++;
    }
    if (!n) return 'Введите хотя бы одно значение';
    toast(`Сохранено замеров: ${n}`);
  } });
}
function metricEdit(m) {
  const isNew = !m;
  formSheet({ title: isNew ? 'Новый показатель' : 'Показатель', fields: [
    { name: 'name', label: 'Название', required: true, value: m && m.name, placeholder: 'например: шея, икра, пульс в покое' },
    { name: 'unit', label: 'Единица', value: m ? m.unit : 'cm', help: '«cm» — длина (конвертируется в дюймы при смене единиц), любое другое — как есть' },
  ], onSave: async (v) => {
    const list = [...S.settings.body.metrics];
    if (isNew) list.push({ id: uid('m_'), name: v.name, unit: v.unit || '' });
    else Object.assign(list.find((x) => x.id === m.id), { name: v.name, unit: v.unit });
    await S.setSetting('body.metrics', list);
  }, onDelete: isNew ? null : async () => { await S.setSetting('body.metrics', S.settings.body.metrics.filter((x) => x.id !== m.id)); } });
}
function measureTab() {
  const ms = S.settings.body.metrics;
  return h('div', null,
    btn('＋ Внести замеры', addMeasure, 'primary wide mb'),
    ...ms.map((m) => {
      const logs = S.logs('measure').filter((l) => l.metric === m.id);
      const last = logs.at(-1), first = logs[0];
      const u = m.unit === 'cm' ? unitLabel('length') : m.unit;
      const conv = (v) => (m.unit === 'cm' ? toDisp('length', v) : v);
      return card(m.name, h('div', null,
        h('div', { class: 'split' }, h('div', { class: 'big' }, last ? `${fmt(conv(last.value), 1)} ${u}` : '—'),
          h('div', { class: 'muted small right' }, logs.length > 1 ? `${last.value - first.value > 0 ? '+' : ''}${fmt(conv(last.value - first.value), 1)} ${u} с ${fmtDateShort(dateKey(first.ts))}` : '')),
        logs.length > 1 ? chart({ labels: logs.map((l) => fmtDateShort(dateKey(l.ts))), series: [{ name: m.name, values: logs.map((l) => conv(l.value)), color: 'var(--body)' }], zero: false, height: 120, type: 'line' }) : null,
        logs.length ? h('div', { class: 'mt' }, [...logs].reverse().slice(0, 5).map((l) => row(`${fmt(conv(l.value), 1)} ${u}`, fmtDateTime(l.ts), { onclick: () => formSheet({ title: m.name, fields: [{ name: 'value', label: 'Значение', type: 'number', value: conv(l.value), required: true }, { name: 'ts', label: 'Когда', type: 'datetime', value: l.ts }], onSave: (v) => S.putLog({ ...l, value: m.unit === 'cm' ? fromDisp('length', v.value) : v.value, ts: v.ts }), onDelete: () => S.delLog(l.id) }) }))) : null),
      { action: h('button', { class: 'btn small ghost', onclick: () => metricEdit(m) }, '✎') });
    }),
    btn('＋ Свой показатель', () => metricEdit(null), 'wide ghost'),
    h('p', { class: 'muted small mt' }, 'Процент жира указывайте, только если есть измерение (весы-анализатор, калипер, DEXA). Разные методы дают разные значения — сравнивайте один и тот же метод.'));
}

// ── Фото ──
async function addPhoto() {
  const data = await pickImage(1280, 0.8);
  if (!data) return;
  const blob = await S.putBlob(data);
  await S.putLog({ kind: 'photo', blobs: [blob], ts: Date.now() });
  toast('Фото сохранено локально');
}
function photosTab() {
  const ph = S.logs('photo').slice().reverse();
  const grid = h('div', { class: 'photo-grid' });
  for (const p of ph) {
    const img = h('img', { alt: '', onclick: () => viewPhoto(p) });
    S.getBlob(p.blobs[0]).then((d) => { if (d) img.src = d; });
    grid.appendChild(h('div', null, img, h('div', { class: 'muted small center' }, fmtDateShort(dateKey(p.ts)))));
  }
  return h('div', null, btn('📷 Добавить фото', addPhoto, 'primary wide mb'),
    ph.length ? card(null, grid) : empty('Фото прогресса хранятся только на устройстве и в ваших резервных копиях.'),
    h('p', { class: 'muted small' }, 'Совет: снимайте при одинаковом свете, в одной позе и в одно время относительно пробуждения.'));
}
function viewPhoto(p) {
  const img = h('img', { style: { width: '100%', borderRadius: '14px' } });
  S.getBlob(p.blobs[0]).then((d) => { if (d) img.src = d; });
  sheet({ title: fmtDateTime(p.ts), full: true, body: h('div', null, img, p.note ? h('p', null, p.note) : null), actions: [
    { label: 'Удалить', cls: 'danger ghost', onClick: async () => { if (await confirmDialog('Удалить фото?', { danger: true })) { await S.delLog(p.id); return true; } return false; } },
    { label: 'Заметка', onClick: () => formSheet({ title: 'Заметка к фото', fields: [{ name: 'note', label: 'Заметка', type: 'textarea', value: p.note }], onSave: (v) => S.putLog({ ...p, note: v.note }) }) },
  ] });
}

export default {
  body: { tab: 'health', render: () => h('div', null,
    pageHeader('Вес и тело', { back: true, actions: [h('button', { class: 'icon-btn', onclick: settingsSheet }, '⚙')] }),
    h('div', { class: 'mb' }, h('span', { class: 'badge accent' }, '🎯 ', GOALS[S.settings.body.goal] || '')),
    tabs([{ id: 'weight', label: 'Вес' }, { id: 'measure', label: 'Замеры' }, { id: 'photos', label: 'Фото' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'weight' ? weightTab() : tab === 'measure' ? measureTab() : photosTab()) },
};
export { GOALS };
