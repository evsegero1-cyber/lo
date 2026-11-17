import { S } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, tabs, fmt, empty, refresh, pct, chips } from '../ui/dom.js';
import { heatmap, chart } from '../ui/charts.js';
import { habitsForDay, on } from '../summary.js';
import { habitStats, dayValue, isDone, isScheduled } from '../core/calc.js';
import { fmtDateShort, fmtDate, tsToHm, addDays, weekStart, monthKey, keyRange, WD_SHORT, fmtDateTime } from '../core/time.js';
import { HABIT_EXAMPLES, HABIT_CATS, RECOVERY_DIRECTIONS } from '../data/seed.js';
import { vibrate } from '../native.js';

let tab = 'today';
const TYPES = { check: 'Выполнить / не выполнить', count: 'Количество раз', amount: 'Количество или объём', duration: 'Продолжительность (мин)', time: 'Время выполнения' };
const FREQ = { daily: 'Каждый личный день', weekdays: 'По дням недели', workdays: 'Только рабочие дни', offdays: 'Только выходные', per_week: 'N раз в неделю', per_month: 'N раз в месяц', every_n: 'Раз в N дней' };

export function freqText(hb) {
  const f = hb.freq || { type: 'daily' };
  if (f.type === 'weekdays') return (f.days || []).map((d) => WD_SHORT[d]).join(', ') || 'дни не выбраны';
  if (f.type === 'per_week') return `${f.n || 1} раз в неделю`;
  if (f.type === 'per_month') return `${f.n || 1} раз в месяц`;
  if (f.type === 'every_n') return `раз в ${f.n || 1} дн.`;
  return FREQ[f.type] || '';
}
const targetText = (hb) => (hb.type === 'check' || hb.type === 'time' ? '' : `${hb.target || 1} ${hb.unit || (hb.type === 'duration' ? 'мин' : hb.type === 'count' ? 'раз' : '')}`);

function tsForDay(key) {
  if (key === S.cur().key) return Date.now();
  const r = S.range(key);
  return Math.min(Date.now(), r.start + (r.end ? (r.end - r.start) / 2 : 3600e3));
}

/** Быстрая отметка привычки в личный день. */
export async function tapHabit(hb, key = S.cur().key) {
  const logs = S.inDay('habitlog', key, hb.id);
  if (hb.type === 'check' || hb.type === 'time') {
    if (logs.length) { for (const l of logs) await S.delLog(l.id); toast(`«${hb.name}» — отметка снята`); return; }
    await S.putLog({ kind: 'habitlog', ref: hb.id, value: 1, ts: tsForDay(key) });
    vibrate(15);
    return;
  }
  if (hb.type === 'count') {
    const l = await S.putLog({ kind: 'habitlog', ref: hb.id, value: 1, ts: tsForDay(key) });
    vibrate(10);
    toast(`${hb.name}: ${dayValue(hb, [...logs, l])} из ${hb.target || 1}`, { action: 'Отменить', onAction: () => S.delLog(l.id) });
    return;
  }
  valueSheet(hb, key);
}
function valueSheet(hb, key) {
  const logs = S.inDay('habitlog', key, hb.id);
  formSheet({ title: hb.name, fields: [
    { type: 'hint', label: `Сейчас: ${fmt(dayValue(hb, logs), 1)} из ${targetText(hb)}` },
    { name: 'value', label: 'Добавить', unit: hb.unit || (hb.type === 'duration' ? 'мин' : ''), type: 'number', min: 0, max: 1e6, required: true },
  ], onSave: async (v) => { await S.putLog({ kind: 'habitlog', ref: hb.id, value: v.value, ts: tsForDay(key) }); } });
}

export function habitButton(x, key) {
  const { h: hb, value, done } = x;
  const sub = hb.type === 'check' || hb.type === 'time'
    ? (x.logs.length ? (hb.type === 'time' ? 'в ' + tsToHm(x.logs[0].ts) : 'выполнено') : freqText(hb))
    : `${fmt(value, 1)} / ${targetText(hb)}`;
  return h('button', { class: 'habit-btn' + (done ? ' done' : ''), onclick: () => tapHabit(hb, key), oncontextmenu: (e) => { e.preventDefault(); location.hash = '#/habit/' + hb.id; } },
    h('span', { class: 'h-ico' }, hb.icon || '✅'), h('span', { class: 'h-main' }, h('b', null, hb.name), h('small', null, sub)),
    h('span', { class: 'check' + (done ? ' on' : '') }, '✓'));
}

export function habitEdit(hb, preset) {
  const isNew = !hb;
  hb = hb || { kind: 'habit', type: 'check', target: 1, unit: '', icon: '✅', category: 'other', freq: { type: 'daily' }, ...(preset || {}) };
  const f = hb.freq || { type: 'daily' };
  formSheet({ title: isNew ? 'Новая привычка' : 'Привычка', fields: [
    { name: 'name', label: 'Название', required: true, value: hb.name },
    { name: 'icon', label: 'Значок (эмодзи)', value: hb.icon, half: true },
    { name: 'category', label: 'Категория', type: 'select', options: Object.entries(HABIT_CATS).map(([v, l]) => ({ value: v, label: l })), value: hb.category, half: true },
    { name: 'type', label: 'Тип', type: 'select', options: Object.entries(TYPES).map(([v, l]) => ({ value: v, label: l })), value: hb.type },
    { name: 'target', label: 'Цель за день', type: 'number', min: 0, max: 1e6, value: hb.target, half: true, help: 'для количества, объёма и времени' },
    { name: 'unit', label: 'Единица', value: hb.unit, half: true, placeholder: 'раз, мин, стр.' },
    { type: 'section', label: 'Периодичность' },
    { name: 'ftype', label: 'Как часто', type: 'select', options: Object.entries(FREQ).map(([v, l]) => ({ value: v, label: l })), value: f.type },
    { name: 'days', label: 'Дни недели (для «По дням недели»)', type: 'days', value: f.days || [] },
    { name: 'n', label: 'N (для «N раз…» и «Раз в N дней»)', type: 'number', min: 1, max: 31, value: f.n || 1 },
    { name: 'startDate', label: 'Начало', type: 'date', value: hb.startDate || S.cur().key },
    { type: 'section', label: 'Напоминание' },
    { name: 'remOn', label: 'Напоминать', type: 'check', value: !!(hb.remind && hb.remind.on) },
    { name: 'remMode', label: 'Когда', type: 'select', options: [{ value: 'time', label: 'В указанное время' }, { value: 'wake', label: 'Через N минут после планового пробуждения' }, { value: 'sleep', label: 'За N минут до планового сна' }], value: (hb.remind && hb.remind.mode) || 'time' },
    { name: 'remTime', label: 'Время', type: 'time', value: hb.remind && hb.remind.time, half: true },
    { name: 'remOffset', label: 'N минут', type: 'number', min: 0, max: 1440, value: (hb.remind && hb.remind.offset) || 30, half: true },
    ...(isNew ? [] : [{ name: 'archived', label: 'В архиве (не показывать, история сохраняется)', type: 'check', value: !!hb.archived }]),
  ], onSave: async (v) => {
    if (v.ftype === 'weekdays' && !v.days.length) return 'Выберите дни недели';
    if (v.remOn && v.remMode === 'time' && !v.remTime) return 'Укажите время напоминания';
    await S.putDef({ ...hb, name: v.name, icon: v.icon || '✅', category: v.category, type: v.type, target: v.target || 1, unit: v.unit,
      freq: { type: v.ftype, days: v.days, n: v.n || 1, start: v.startDate }, startDate: v.startDate,
      remind: { on: v.remOn, mode: v.remMode, time: v.remTime, offset: v.remOffset }, archived: !!v.archived });
    toast('Сохранено');
  }, onDelete: isNew ? null : async () => {
    for (const l of S.logs('habitlog').filter((x) => x.ref === hb.id)) await S.delLog(l.id);
    await S.delDef(hb.id); if (location.hash.startsWith('#/habit/')) history.back();
  } });
}

function examplesSheet() {
  sheet({ title: 'Примеры привычек', body: (sh) => h('div', null,
    h('p', { class: 'muted small' }, 'Ничего не добавляется автоматически. Выберите пример — откроется редактор, где всё можно изменить.'),
    HABIT_EXAMPLES.map((e) => row(e.name, '＋', { icon: e.icon, sub: `${TYPES[e.type]}${e.freq ? ' · ' + freqText(e) : ''}`, onclick: () => { sh.close(); habitEdit(null, { ...e, freq: e.freq || { type: 'daily' } }); } }))) });
}

function today(category) {
  const key = S.cur().key;
  const items = habitsForDay(key).filter((x) => (category ? x.h.category === category : x.h.category !== 'hygiene'));
  const sched = items.filter((x) => x.sched);
  const flex = sched.filter((x) => ['per_week', 'per_month'].includes((x.h.freq || {}).type));
  const daily = sched.filter((x) => !flex.includes(x));
  const rest = items.filter((x) => !x.sched);
  return h('div', null,
    daily.length ? card(`Сегодня · ${daily.filter((x) => x.done).length} из ${daily.length}`, h('div', null, daily.map((x) => habitButton(x, key)))) : null,
    flex.length ? card('Гибкий график (за неделю / месяц)', h('div', null, flex.map((x) => {
      const keys = (x.h.freq.type === 'per_week' ? keyRange(weekStart(key), key) : keyRange(monthKey(key) + '-01', key));
      const cnt = keys.filter((k) => isDone(x.h, dayValue(x.h, S.inDay('habitlog', k, x.h.id)))).length;
      const b = habitButton(x, key);
      b.querySelector('small').textContent = `${cnt} из ${x.h.freq.n || 1} ${x.h.freq.type === 'per_week' ? 'за неделю' : 'за месяц'}`;
      return b;
    }))) : null,
    rest.length ? card('Не запланировано сегодня', h('div', null, rest.map((x) => habitButton(x, key)))) : null,
    !items.length ? empty(category === 'hygiene' ? 'Процедур нет' : 'Привычек пока нет. Добавьте свою или выберите из примеров.', h('div', { class: 'btns', style: { justifyContent: 'center' } }, btn('＋ Привычка', () => habitEdit(null, category ? { category } : null), 'primary'), category ? null : btn('Примеры', examplesSheet))) : null,
    h('p', { class: 'muted small' }, 'Нажатие — отметить. Долгое нажатие — подробная статистика. Пропуск не наказывается: серия просто начинается заново.'));
}

function allList(category) {
  const list = S.defs('habit').filter((x) => (category ? x.category === category : x.category !== 'hygiene'));
  const groups = {};
  for (const x of list) (groups[x.category] = groups[x.category] || []).push(x);
  return h('div', null,
    h('div', { class: 'btns mb' }, btn('＋ Привычка', () => habitEdit(null, category ? { category } : null), 'primary'), category ? null : btn('Примеры', examplesSheet)),
    ...Object.entries(groups).map(([c, arr]) => card(HABIT_CATS[c] || c, h('div', null, arr.map((x) => row(x.name, x.archived ? h('span', { class: 'badge' }, 'архив') : '›', { icon: x.icon, sub: `${freqText(x)}${targetText(x) ? ' · ' + targetText(x) : ''}`, onclick: () => { location.hash = '#/habit/' + x.id; } }))))),
    list.length ? null : empty('Пусто'));
}

function stats(category) {
  const cur = S.cur().key;
  const keys = S.lastDays(30);
  const list = S.defs('habit').filter((x) => !x.archived && (category ? x.category === category : x.category !== 'hygiene'));
  if (!list.length) return empty('Нет привычек');
  const perDay = keys.map((k) => { const it = habitsForDay(k).filter((x) => list.includes(x.h) && x.sched && !['per_week', 'per_month'].includes((x.h.freq || {}).type)); return it.length ? (it.filter((x) => x.done).length / it.length) * 100 : null; });
  return h('div', null,
    card('Выполнение по дням, %', chart({ labels: keys.map(fmtDateShort), series: [{ name: 'Выполнено', values: perDay, color: 'var(--habit)' }], type: 'bar', unit: '%' })),
    card('По привычкам (30 дней)', h('div', null, list.map((hb) => {
      const st = statsFor(hb, keys, cur);
      return row(hb.name, pct(st.rate), { icon: hb.icon, sub: `серия ${st.current}${st.unit ? ' ' + st.unit : ''} · лучшая ${st.best} · пропусков ${st.missed.length}`, onclick: () => { location.hash = '#/habit/' + hb.id; } });
    }))));
}
export function statsFor(hb, keys, cur) {
  const byDay = {};
  for (const k of keys) byDay[k] = dayValue(hb, S.inDay('habitlog', k, hb.id));
  return habitStats(hb, keys, byDay, cur, (k) => S.isWorkDay(k));
}

function habitPage({ id }) {
  const hb = S.def(id);
  if (!hb) return h('div', null, pageHeader('Привычка', { back: true }), empty('Привычка не найдена'));
  const cur = S.cur().key;
  const keys = S.lastDays(119);
  const st = statsFor(hb, keys, cur);
  const st30 = statsFor(hb, S.lastDays(30), cur);
  const logs = S.logs('habitlog').filter((l) => l.ref === hb.id).slice(-30).reverse();
  return h('div', null,
    pageHeader(`${hb.icon || ''} ${hb.name}`, { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => habitEdit(hb) }, '✎')] }),
    h('div', { class: 'chips mb' }, h('span', { class: 'chip' }, HABIT_CATS[hb.category] || ''), h('span', { class: 'chip' }, freqText(hb)), targetText(hb) ? h('span', { class: 'chip' }, 'цель ' + targetText(hb)) : null),
    h('div', { class: 'grid3 mb' },
      h('div', { class: 'stat' }, h('b', null, st.current + (st.unit ? ' ' + st.unit : '')), h('small', null, 'текущая серия')),
      h('div', { class: 'stat' }, h('b', null, st.best + (st.unit ? ' ' + st.unit : '')), h('small', null, 'лучшая серия')),
      h('div', { class: 'stat' }, h('b', null, pct(st30.rate)), h('small', null, 'за 30 дней'))),
    card('Календарь выполнения', heatmap(keys, (k) => {
      const v = dayValue(hb, S.inDay('habitlog', k, hb.id));
      const sch = isScheduled(hb, k, (x) => S.isWorkDay(x));
      if (k < (hb.startDate || '0')) return { level: null };
      return { level: v ? Math.min(1, v / (hb.type === 'check' || hb.type === 'time' ? 1 : hb.target || 1)) : sch ? 0 : null, title: `${fmtDate(k)}: ${fmt(v, 1)}`, today: k === cur };
    }, 'var(--habit)')),
    card('Отметить за другой день', h('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6].map((i) => { const k = addDays(cur, -i); const v = dayValue(hb, S.inDay('habitlog', k, hb.id)); return h('button', { class: 'chip' + (isDone(hb, v) ? ' on' : ''), onclick: () => tapHabit(hb, k) }, fmtDateShort(k)); }))),
    card('Пропуски', st.missed.length ? h('div', { class: 'chips' }, st.missed.slice(-20).reverse().map((k) => h('span', { class: 'chip' }, k.length > 7 ? fmtDateShort(k) : k))) : h('p', { class: 'muted small' }, 'Пропусков нет')),
    card('История', logs.length ? h('div', null, logs.map((l) => row(hb.type === 'check' ? 'Выполнено' : `${fmt(l.value, 1)} ${hb.unit || ''}`, fmtDateTime(l.ts), { onclick: () => formSheet({ title: 'Запись', fields: [{ name: 'value', label: 'Значение', type: 'number', value: l.value, min: 0 }, { name: 'ts', label: 'Когда', type: 'datetime', value: l.ts }], onSave: (v) => S.putLog({ ...l, value: v.value ?? 1, ts: v.ts }), onDelete: () => S.delLog(l.id) }) }))) : empty('Нет записей')),
  );
}

// ── Гигиена ──
function hygienePage() {
  const key = S.cur().key;
  const items = habitsForDay(key, 'hygiene');
  const groups = { daily: [], week: [], month: [], other: [] };
  for (const x of items) {
    const t = (x.h.freq || {}).type;
    (t === 'per_week' ? groups.week : t === 'per_month' ? groups.month : t === 'daily' ? groups.daily : groups.other).push(x);
  }
  const cnt = (x, keys) => keys.filter((k) => isDone(x.h, dayValue(x.h, S.inDay('habitlog', k, x.h.id)))).length;
  const flexBtn = (x, keys, word) => { const b = habitButton(x, key); b.querySelector('small').textContent = `${cnt(x, keys)} из ${x.h.freq.n || 1} ${word}`; return b; };
  return h('div', null,
    pageHeader('Гигиена и уход', { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => habitEdit(null, { category: 'hygiene', icon: '🧼' }) }, '＋')] }),
    groups.daily.length ? card('Ежедневно', h('div', null, groups.daily.map((x) => habitButton(x, key)))) : null,
    groups.week.length ? card('Еженедельно', h('div', null, groups.week.map((x) => flexBtn(x, keyRange(weekStart(key), key), 'на этой неделе')))) : null,
    groups.month.length ? card('Ежемесячно', h('div', null, groups.month.map((x) => flexBtn(x, keyRange(monthKey(key) + '-01', key), 'в этом месяце')))) : null,
    groups.other.length ? card('По своему графику', h('div', null, groups.other.map((x) => habitButton(x, key)))) : null,
    !items.length ? empty('Процедур нет', btn('＋ Процедура', () => habitEdit(null, { category: 'hygiene', icon: '🧼' }), 'primary')) : null,
    h('p', { class: 'muted small' }, 'Долгое нажатие на процедуру — статистика и редактирование. Любую процедуру можно удалить или изменить её периодичность.'));
}

// ── Восстановление ──
function recoveryPage() {
  const tracked = S.defs('habit').filter((x) => x.recovery);
  return h('div', null,
    pageHeader('Восстановление', { back: true }),
    h('p', { class: 'muted small mb' }, 'Выберите направления, которые хотите отслеживать. Для каждого создаётся привычка категории «Восстановление» — её можно настроить.'),
    card(null, h('div', null, RECOVERY_DIRECTIONS.map((d) => {
      const hb = tracked.find((x) => x.recovery === d.id);
      const sw = h('input', { type: 'checkbox', class: 'switch' });
      sw.checked = !!(hb && !hb.archived);
      sw.onchange = async () => {
        if (sw.checked) {
          if (hb) await S.putDef({ ...hb, archived: false });
          else await S.putDef({ kind: 'habit', name: d.name, icon: d.icon, category: 'recovery', recovery: d.id, type: d.habit.type, target: d.habit.target, unit: d.habit.unit, freq: d.habit.freq || { type: 'daily' }, startDate: S.cur().key });
          toast('Добавлено в привычки');
        } else if (hb) { await S.putDef({ ...hb, archived: true }); toast('Скрыто (история сохранена)'); }
      };
      return h('div', { class: 'row' }, h('div', { class: 'row-ico' }, d.icon), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.name), h('div', { class: 'row-sub' }, d.tip)), sw);
    }))),
    tracked.filter((x) => !x.archived).length ? card('Сегодня', h('div', null, habitsForDay(S.cur().key, 'recovery').filter((x) => !x.h.archived && x.sched).map((x) => habitButton(x, S.cur().key)))) : null);
}

export default {
  good: { tab: 'habits', render: () => h('div', null,
    pageHeader('Полезные привычки', { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => habitEdit(null) }, '＋')] }),
    tabs([{ id: 'today', label: 'Сегодня' }, { id: 'all', label: 'Все' }, { id: 'stats', label: 'Статистика' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'today' ? today() : tab === 'all' ? allList() : stats()) },
  'habit/:id': { tab: 'habits', render: habitPage },
  hygiene: { tab: 'health', render: hygienePage },
  recovery: { tab: 'activity', render: recoveryPage },
};
export { on, chips };
