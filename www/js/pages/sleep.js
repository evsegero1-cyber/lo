import { S } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, tabs, empty, refresh } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { sleepDay, openSleep } from '../summary.js';
import { fmtDateShort, tsToHm, fmtDuration, fmtDateTime, minToHm, DAY, HOUR } from '../core/time.js';
import { sleepRegularity, overlaps, avg, circularStats } from '../core/calc.js';
import { minutesOfDay } from '../core/time.js';
import { SLEEP_TIPS } from '../data/seed.js';
import { vibrate } from '../native.js';

let tab = 'main';

export async function goToBed(main = true) {
  if (openSleep()) { toast('Сон уже идёт'); return; }
  await S.putLog({ kind: 'sleep', start: Date.now(), end: null, main, ts: Date.now() });
  vibrate(20);
  toast(main ? 'Спокойного сна 🌙' : 'Дополнительный сон начат', { action: 'Отменить', onAction: () => { const o = openSleep(); if (o) S.delLog(o.id); } });
}

export async function wakeUp() {
  const o = openSleep();
  if (!o) return;
  const end = Date.now();
  if (end - o.start < 60000) { await S.delLog(o.id); toast('Сон меньше минуты — запись удалена'); return; }
  const l = await S.putLog({ ...o, end, ts: end });
  vibrate(20);
  rateSheet(l, true);
}

function rateSheet(l, fresh) {
  formSheet({ title: fresh ? `Доброе пробуждение · ${fmtDuration((l.end - l.start) / 60000)}` : 'Оценка сна', saveLabel: 'Сохранить', fields: [
    { name: 'quality', label: 'Качество сна', type: 'scale', min: 1, max: 5, value: l.quality, captions: ['плохо', 'отлично'] },
    { name: 'feeling', label: 'Самочувствие после пробуждения', type: 'scale', min: 1, max: 5, value: l.feeling, captions: ['разбит', 'отлично'] },
    { name: 'alertness', label: 'Бодрость', type: 'scale', min: 1, max: 5, value: l.alertness, captions: ['сонный', 'бодрый'] },
    { name: 'awakenings', label: 'Сколько раз просыпался', type: 'number', min: 0, max: 50, value: l.awakenings, placeholder: 'необязательно' },
    { name: 'note', label: 'Заметка', type: 'textarea', rows: 2, value: l.note },
  ], onSave: async (v) => { await S.putLog({ ...S.log(l.id), ...v }); } });
}

export function editSleep(l) {
  const isNew = !l;
  const now = Date.now();
  l = l || { kind: 'sleep', start: now - 8 * HOUR, end: now, main: true };
  formSheet({ title: isNew ? 'Период сна' : 'Редактировать сон', fields: [
    { name: 'start', label: 'Заснул', type: 'datetime', value: l.start, required: true },
    { name: 'end', label: 'Проснулся', type: 'datetime', value: l.end, help: l.end ? null : 'Сон ещё идёт — оставьте пустым' },
    { name: 'main', label: 'Основной сон', type: 'check', value: l.main !== false, help: 'Пробуждение после основного сна начинает новый личный день. Дневной сон и дремота — дополнительные периоды.' },
    { name: 'quality', label: 'Качество', type: 'scale', min: 1, max: 5, value: l.quality, captions: ['плохо', 'отлично'] },
    { name: 'feeling', label: 'Самочувствие после пробуждения', type: 'scale', min: 1, max: 5, value: l.feeling },
    { name: 'alertness', label: 'Бодрость', type: 'scale', min: 1, max: 5, value: l.alertness },
    { name: 'awakenings', label: 'Пробуждения', type: 'number', min: 0, max: 50, value: l.awakenings },
    { name: 'note', label: 'Заметка', type: 'textarea', rows: 2, value: l.note },
  ], onSave: async (v) => {
    if (v.end != null && v.end <= v.start) return 'Пробуждение должно быть позже засыпания';
    if (v.end != null && v.end - v.start > 20 * HOUR) return 'Период длиннее 20 часов — проверьте даты';
    if (v.start > Date.now() + 5 * 60000) return 'Начало сна в будущем';
    const e = v.end ?? Date.now();
    const clash = S.logs('sleep').find((o) => o.id !== l.id && overlaps(v.start, e, o.start, o.end ?? Date.now()));
    if (clash) return `Пересекается с другим периодом сна (${fmtDateTime(clash.start)})`;
    if (v.end == null && S.logs('sleep').some((o) => !o.end && o.id !== l.id)) return 'Уже есть незавершённый сон';
    await S.putLog({ ...l, ...v, ts: v.end ?? v.start });
  }, onDelete: isNew ? null : () => S.delLog(l.id) });
}

function settingsSheet() {
  formSheet({ title: 'Цель сна', fields: [
    { name: 'h', label: 'Продолжительность', unit: 'часы', type: 'number', min: 0, max: 16, value: S.settings.sleep.goalMin / 60, help: 'Индивидуальная цель за личный день (основной + дополнительный сон).' },
  ], onSave: async (v) => { await S.saveSettings({ sleep: { goalMin: Math.round((v.h || 0) * 60) } }); } });
}

export function statusBlock() {
  const o = openSleep();
  if (o) {
    return h('div', null,
      h('div', { class: 'kpi' }, h('span', { class: 'big' }, fmtDuration((Date.now() - o.start) / 60000)), h('small', null, `${o.main ? 'сон' : 'доп. сон'} с ${tsToHm(o.start)}`)),
      btn('☀️ Проснулся', wakeUp, 'primary wide mt'));
  }
  return h('div', { class: 'btns' }, btn('🌙 Лёг спать', () => goToBed(true), 'primary'), btn('😴 Дневной сон', () => goToBed(false)), btn('＋ Вручную', () => editSleep(null), 'ghost'));
}

function mainTab() {
  const key = S.cur().key;
  const d = sleepDay(key);
  const goal = S.settings.sleep.goalMin;
  const last = S.logs('sleep').filter((s) => s.end && s.main).at(-1);
  return h('div', null,
    card('Сейчас', statusBlock(), { cls: 'hero' }),
    card('Текущий личный день', h('div', null,
      h('div', { class: 'grid3' },
        h('div', { class: 'stat' }, h('b', null, d.total ? fmtDuration(d.total) : '—'), h('small', null, 'сон всего')),
        h('div', { class: 'stat' }, h('b', null, goal ? fmtDuration(goal) : '—'), h('small', null, 'цель')),
        h('div', { class: 'stat' }, h('b', null, d.quality ? `${d.quality}/5` : '—'), h('small', null, 'качество'))),
      d.logs.length ? h('div', { class: 'mt' }, d.logs.map((s) => sleepRow(s))) : h('p', { class: 'muted small mt' }, 'Сон этого личного дня ещё не записан.'))),
    last && !last.quality ? card('Оценить последний сон', btn('Оценить', () => rateSheet(last, false), 'wide')) : null,
    card('Рекомендации при ночной работе', h('div', null, SLEEP_TIPS.slice(0, 3).map(([t, x]) => row(t, null, { sub: x })), btn('Все рекомендации', () => tipsSheet(), 'wide ghost mt'))),
  );
}
function sleepRow(s) {
  const dur = s.end ? (s.end - s.start) / 60000 : null;
  return row(`${tsToHm(s.start)} → ${s.end ? tsToHm(s.end) : '…'}`, dur ? fmtDuration(dur) : 'идёт', { icon: s.main ? '🌙' : '😴', sub: `личный день ${fmtDateShort(S.pdayOf(s.end || s.start).key)}${s.quality ? ' · качество ' + s.quality + '/5' : ''}${s.awakenings ? ' · пробуждений ' + s.awakenings : ''}`, onclick: () => editSleep(s) });
}
function tipsSheet() {
  sheet({ title: 'Гигиена сна при ночном графике', body: h('div', null, SLEEP_TIPS.map(([t, x]) => row(t, null, { sub: x })), h('p', { class: 'hint mt' }, 'Это общие рекомендации, а не медицинские назначения. Ориентир — продолжительность, регулярность и ваше самочувствие, а не время на часах.')) });
}

function statsTab() {
  const keys = S.lastDays(30);
  const totals = keys.map((k) => sleepDay(k));
  const mainH = totals.map((d) => { const m = d.logs.filter((s) => s.main).reduce((a, s) => a + (s.end - s.start), 0) / 3600e3; return m || null; });
  const extraH = totals.map((d) => { const m = d.logs.filter((s) => !s.main).reduce((a, s) => a + (s.end - s.start), 0) / 3600e3; return m || null; });
  const qual = totals.map((d) => d.quality ?? null);
  const since = Date.now() - 30 * DAY;
  const mains = S.logs('sleep').filter((s) => s.main && s.end && s.end >= since);
  const reg = sleepRegularity(mains);
  const bed = mains.length ? circularStats(mains.map((s) => minutesOfDay(s.start))) : null;
  const wake = mains.length ? circularStats(mains.map((s) => minutesOfDay(s.end))) : null;
  const durs = totals.filter((d) => d.total > 0).map((d) => d.total);
  const goal = S.settings.sleep.goalMin;
  return h('div', null,
    h('div', { class: 'grid2 mb' },
      h('div', { class: 'stat' }, h('b', null, durs.length ? fmtDuration(avg(durs)) : '—'), h('small', null, 'средний сон за личный день')),
      h('div', { class: 'stat' }, h('b', null, reg ? reg.index + '%' : '—'), h('small', null, 'регулярность')),
      h('div', { class: 'stat' }, h('b', null, bed ? minToHm(bed.mean) : '—'), h('small', null, 'обычно засыпаю')),
      h('div', { class: 'stat' }, h('b', null, wake ? minToHm(wake.mean) : '—'), h('small', null, 'обычно просыпаюсь'))),
    card('Продолжительность, ч (30 дней)', chart({ labels: keys.map(fmtDateShort), series: [{ name: 'Основной', values: mainH, color: 'var(--sleep)' }, { name: 'Дополнительный', values: extraH, color: '#c4b8ff' }], type: 'bar', stacked: true, goal: goal ? goal / 60 : null, unit: 'ч' })),
    card('Качество сна (1–5)', chart({ labels: keys.map(fmtDateShort), series: [{ name: 'Качество', values: qual, color: 'var(--mood)' }], type: 'line', zero: false, connect: true })),
    card('Регулярность', reg ? h('div', null,
      row('Середина сна в среднем', minToHm(reg.midMean)),
      row('Разброс середины сна', `±${fmtDuration(reg.midSd)}`),
      row('Разброс длительности', reg.durSd != null ? `±${fmtDuration(reg.durSd)}` : '—'),
      row('Ночей в пределах ±1 ч от обычного', `${reg.index}% из ${reg.n}`),
      h('p', { class: 'hint mt' }, 'Регулярность считается по вашему собственному ритму: важно постоянство, а не «правильное» время. Основной сон в 07:00–15:00 так же регулярен, как 23:00–07:00.'))
      : empty('Нужно хотя бы 3 записи основного сна за 30 дней')),
    card('История', historyList()),
  );
}
function historyList() {
  const logs = S.logs('sleep').slice(-40).reverse();
  if (!logs.length) return empty('Записей сна пока нет');
  return h('div', null, logs.map((s) => sleepRow(s)));
}

export default {
  sleep: { tab: 'health', tick: true, render: () => h('div', null,
    pageHeader('Сон и восстановление', { back: true, actions: [h('button', { class: 'icon-btn', onclick: settingsSheet }, '⚙')] }),
    tabs([{ id: 'main', label: 'Сегодня' }, { id: 'stats', label: 'Статистика' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'main' ? mainTab() : statsTab()) },
};
