import { S } from '../data/store.js';
import { h, card, row, btn, ring, toast, formSheet, sheet, pageHeader, tabs, fmt, chips, empty, refresh } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { waterDay } from '../summary.js';
import { fmtDateShort, tsToHm, fmtDateTime } from '../core/time.js';
import { avg } from '../core/calc.js';
import { toDisp, fromDisp, unitLabel } from '../ui/units.js';
import { vibrate } from '../native.js';

let drinkSel = null;
let tab = 'today';

export async function addWater(ml, drinkId) {
  const d = S.def(drinkId || drinkSel || S.settings.water.defaultDrink) || S.defs('drink')[0];
  const last = S.logs('water').at(-1);
  if (last && Date.now() - last.updated < 1500 && last.ml === ml) {
    toast('Похоже на двойное нажатие — не продублировано', { action: 'Добавить', onAction: () => doAdd(ml, d) });
    return;
  }
  await doAdd(ml, d);
}
async function doAdd(ml, d) {
  const l = await S.putLog({ kind: 'water', ml, drink: d ? d.id : null, effective: Math.round(ml * (d ? d.coef ?? 1 : 1)) });
  vibrate(12);
  toast(`+${fmt(toDisp('volume', ml))} ${unitLabel('volume')} · ${d ? d.name : ''}`, { action: 'Отменить', onAction: () => S.delLog(l.id) });
}

export function customWater() {
  formSheet({ title: 'Свой объём', fields: [
    { name: 'ml', label: 'Объём', unit: unitLabel('volume'), type: 'number', min: 1, max: 5000, required: true },
    { name: 'drink', label: 'Напиток', type: 'select', options: S.defs('drink').map((d) => ({ value: d.id, label: d.name })), value: drinkSel || S.settings.water.defaultDrink },
    { name: 'ts', label: 'Когда', type: 'datetime', value: Date.now() },
  ], onSave: async (v) => {
    const ml = Math.round(fromDisp('volume', v.ml));
    if (ml > 5000) return 'Слишком большой объём';
    const d = S.def(v.drink);
    await S.putLog({ kind: 'water', ml, drink: v.drink, effective: Math.round(ml * (d ? d.coef ?? 1 : 1)), ts: v.ts || Date.now() });
  } });
}

function editEntry(l) {
  formSheet({ title: 'Запись', fields: [
    { name: 'ml', label: 'Объём', unit: unitLabel('volume'), type: 'number', min: 1, max: 5000, required: true, value: toDisp('volume', l.ml) },
    { name: 'drink', label: 'Напиток', type: 'select', options: S.defs('drink').map((d) => ({ value: d.id, label: d.name })), value: l.drink },
    { name: 'ts', label: 'Когда', type: 'datetime', value: l.ts },
  ], onSave: async (v) => {
    const d = S.def(v.drink); const ml = Math.round(fromDisp('volume', v.ml));
    await S.putLog({ ...l, ml, drink: v.drink, effective: Math.round(ml * (d ? d.coef ?? 1 : 1)), ts: v.ts });
  }, onDelete: () => S.delLog(l.id) });
}

export function quickButtons(n) {
  const q = (S.settings.water.quick || []).slice(0, n || 99);
  return h('div', { class: 'quick' }, q.map((ml) => btn(`+${fmt(toDisp('volume', ml))}`, () => addWater(ml))), btn('Своё', customWater, 'ghost'));
}

function settingsSheet() {
  const w = S.settings.water;
  formSheet({ title: 'Настройки воды', fields: [
    { name: 'goal', label: 'Суточная цель', unit: unitLabel('volume'), type: 'number', min: 0, max: 10000, value: toDisp('volume', w.goal), help: 'Индивидуальная цель. Можно поставить 0, чтобы не отслеживать выполнение.' },
    { name: 'quick', label: 'Кнопки быстрого добавления', unit: unitLabel('volume') + ', через запятую', type: 'text', value: (w.quick || []).map((x) => toDisp('volume', x)).join(', ') },
    { type: 'section', label: 'Напоминания' },
    { name: 'remind', label: 'Напоминать пить воду', type: 'check', value: !!(w.remind && w.remind.on), help: 'Только в часы бодрствования по вашему режиму. Тихие режимы учитываются.' },
    { name: 'every', label: 'Интервал', unit: 'мин', type: 'number', min: 15, max: 720, value: (w.remind && w.remind.every) || 120, half: true },
    { name: 'from', label: 'С (необяз.)', type: 'time', value: (w.remind && w.remind.from) || '', half: true },
    { name: 'to', label: 'До (необяз.)', type: 'time', value: (w.remind && w.remind.to) || '' },
  ], onSave: async (v) => {
    const quick = String(v.quick).split(/[,;\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => x > 0 && x <= 5000).map((x) => Math.round(fromDisp('volume', x)));
    await S.saveSettings({ water: { goal: Math.round(fromDisp('volume', v.goal || 0)), quick: quick.length ? quick : [100, 200, 300, 500, 1000], remind: { on: v.remind, every: v.every || 120, from: v.from, to: v.to } } });
    toast('Сохранено');
  }, extra: h('div', { class: 'mt' }, btn('Напитки и коэффициенты', drinksSheet, 'wide')) });
}

function drinksSheet() {
  sheet({ title: 'Напитки', body: (sh) => {
    const box = h('div');
    const draw = () => {
      box.replaceChildren(...S.defs('drink').map((d) => row(d.name, `×${d.coef}`, { icon: h('span', { style: { color: d.color } }, '●'), onclick: () => drinkEdit(d, draw) })),
        h('p', { class: 'hint mt' }, 'Коэффициент — какая доля объёма идёт в зачёт водной цели. Это ваша настройка, а не медицинская норма.'),
        btn('＋ Новый напиток', () => drinkEdit(null, draw), 'wide mt'));
    };
    draw();
    return box;
  } });
}
function drinkEdit(d, done) {
  formSheet({ title: d ? 'Напиток' : 'Новый напиток', fields: [
    { name: 'name', label: 'Название', required: true, value: d && d.name },
    { name: 'coef', label: 'Коэффициент зачёта', type: 'number', min: 0, max: 1.5, value: d ? d.coef : 1 },
    { name: 'color', label: 'Цвет', type: 'color', value: d ? d.color : '#4cc3ff' },
    { name: 'def', label: 'По умолчанию для быстрых кнопок', type: 'check', value: d && S.settings.water.defaultDrink === d.id },
  ], onSave: async (v) => {
    const x = await S.putDef({ ...(d || { kind: 'drink' }), name: v.name, coef: v.coef ?? 1, color: v.color });
    if (v.def) await S.saveSettings({ water: { defaultDrink: x.id } });
    done();
  }, onDelete: d ? async () => { await S.delDef(d.id); done(); } : null });
}

function today() {
  const key = S.cur().key;
  const w = waterDay(key);
  const drinks = S.defs('drink');
  if (!drinkSel) drinkSel = S.settings.water.defaultDrink;
  const sel = chips(drinks.map((d) => ({ value: d.id, label: d.name })), drinkSel, false);
  sel.addEventListener('click', () => { drinkSel = sel.getValue(); });
  return h('div', null,
    card(null, h('div', { class: 'dash-mini' },
      ring(w.goal ? w.ml / w.goal : 0, { size: 104, stroke: 10, color: 'var(--water)', label: fmt(toDisp('volume', w.ml)), sub: w.goal ? `из ${fmt(toDisp('volume', w.goal))} ${unitLabel('volume')}` : unitLabel('volume') }),
      h('div', { class: 'info' },
        h('div', { class: 'muted small' }, 'Личный день ', fmtDateShort(key)),
        w.goal ? h('div', { class: 'big' }, w.ml >= w.goal ? 'Цель достигнута' : `Ещё ${fmt(toDisp('volume', w.goal - w.ml))}`) : h('div', { class: 'muted' }, 'Цель не задана'),
        w.raw !== w.ml ? h('div', { class: 'muted small' }, `Всего выпито ${fmt(toDisp('volume', w.raw))} ${unitLabel('volume')}, в зачёт цели — с учётом коэффициентов`) : null)), { cls: 'hero' }),
    card('Напиток', sel),
    card('Добавить', quickButtons()),
    card('Записи за день', w.logs.length ? h('div', null, [...w.logs].reverse().map((l) => row(`${fmt(toDisp('volume', l.ml))} ${unitLabel('volume')}`, tsToHm(l.ts), { sub: (S.def(l.drink) || {}).name || '', onclick: () => editEntry(l) }))) : empty('Пока ничего. Пейте в своём темпе — никакой «нормы через силу».')),
  );
}

function stats() {
  const k7 = S.lastDays(7), k30 = S.lastDays(30);
  const v7 = k7.map((k) => waterDay(k).ml), v30 = k30.map((k) => waterDay(k).ml);
  const goal = S.settings.water.goal;
  const has30 = v30.filter((v) => v > 0);
  const cur = S.cur().key;
  const done = k30.filter((k, i) => k < cur && v30[i] > 0 && v30[i] >= goal).length;
  const byDrink = {};
  for (const k of k30) for (const l of waterDay(k).logs) { const n = (S.def(l.drink) || {}).name || 'Другое'; byDrink[n] = (byDrink[n] || 0) + l.ml; }
  return h('div', null,
    h('div', { class: 'grid3 mb' },
      h('div', { class: 'stat' }, h('b', null, fmt(toDisp('volume', avg(v7.filter((v) => v > 0)) || 0))), h('small', null, 'среднее за 7 дн.')),
      h('div', { class: 'stat' }, h('b', null, fmt(toDisp('volume', avg(has30) || 0))), h('small', null, 'среднее за 30 дн.')),
      h('div', { class: 'stat' }, h('b', null, `${done}/${has30.length}`), h('small', null, 'дней с целью'))),
    card('Неделя', chart({ labels: k7.map(fmtDateShort), series: [{ name: 'Вода', values: v7.map((v) => toDisp('volume', v)), color: 'var(--water)' }], type: 'bar', goal: goal ? toDisp('volume', goal) : null, unit: unitLabel('volume') })),
    card('Месяц', chart({ labels: k30.map(fmtDateShort), series: [{ name: 'Вода', values: v30.map((v) => toDisp('volume', v)), color: 'var(--water)' }], type: 'bar', goal: goal ? toDisp('volume', goal) : null, unit: unitLabel('volume') })),
    card('Напитки за 30 дней', Object.keys(byDrink).length ? h('div', null, Object.entries(byDrink).sort((a, b) => b[1] - a[1]).map(([n, v]) => row(n, `${fmt(toDisp('volume', v))} ${unitLabel('volume')}`))) : empty('Нет данных')),
    card('История', historyList()),
  );
}
function historyList() {
  const logs = S.logs('water').slice(-60).reverse();
  if (!logs.length) return empty('История пуста');
  return h('div', null, logs.map((l) => row(`${fmt(toDisp('volume', l.ml))} ${unitLabel('volume')} · ${(S.def(l.drink) || {}).name || ''}`, fmtDateTime(l.ts), { sub: 'личный день ' + fmtDateShort(S.pdayOf(l.ts).key), onclick: () => editEntry(l) })));
}

export default {
  water: { tab: 'health', render: () => h('div', null,
    pageHeader('Вода', { back: true, actions: [h('button', { class: 'icon-btn', onclick: settingsSheet, 'aria-label': 'Настройки' }, '⚙')] }),
    tabs([{ id: 'today', label: 'Сегодня' }, { id: 'stats', label: 'Статистика и история' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'today' ? today() : stats()) },
};
