import { S } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, pageHeader, fmt, empty, info, pct } from '../ui/dom.js';
import { chart, hbars } from '../ui/charts.js';
import { badHabitStats, triggerAnalysis, dailyLimit, sum } from '../core/calc.js';
import { fmtDateShort, fmtDateTime, fmtDuration, DAY, HOUR, dateKey } from '../core/time.js';
import { BAD_CATS, TRIGGERS } from '../data/seed.js';
import { vibrate } from '../native.js';

const STRAT = { quit: 'Полный отказ', reduce: 'Постепенное сокращение', frequency: 'Контроль частоты', limit: 'Ограничение количества' };
export const ALCOHOL_WARNING = 'Если вы употребляете алкоголь регулярно и много, резкий самостоятельный отказ может быть опасен: возможны тяжёлые симптомы отмены (тремор, потливость, тревога, судороги, белая горячка). Если при перерыве появляются такие симптомы или утром тянет «опохмелиться» — не прекращайте резко сами, обратитесь к врачу (нарколог, терапевт). LIFE OS не заменяет медицинскую помощь.';

const uses = (b) => S.logs('baduse').filter((u) => u.ref === b.id && u.type !== 'craving');
const cravings = (b) => S.logs('baduse').filter((u) => u.ref === b.id && u.type === 'craving');
export const badStats = (b) => badHabitStats(b, uses(b), Date.now(), (ts) => S.pdayOf(ts).key);

export function fmtSince(ms) {
  const d = Math.floor(ms / DAY), hh = Math.floor((ms % DAY) / HOUR), mm = Math.floor((ms % HOUR) / 60000);
  if (d) return `${d} д ${hh} ч`;
  if (hh) return `${hh} ч ${mm} мин`;
  return `${mm} мин`;
}

export function badEdit(b) {
  const isNew = !b;
  b = b || { kind: 'bad', cat: 'smoking', strategy: 'quit', startDate: S.cur().key, baselinePerDay: null, costPerUnit: null, unit: 'сиг.', triggers: [], icon: '🚬' };
  formSheet({ title: isNew ? 'Новая привычка для работы' : b.name, fields: [
    { name: 'cat', label: 'Категория', type: 'select', options: Object.entries(BAD_CATS).map(([v, x]) => ({ value: v, label: `${x.icon} ${x.name}` })), value: b.cat },
    { name: 'name', label: 'Название', value: b.name, placeholder: 'например: Сигареты' },
    { name: 'startDate', label: 'Дата начала работы над привычкой', type: 'date', value: b.startDate, required: true },
    { type: 'section', label: 'Исходная ситуация' },
    { name: 'baselinePerDay', label: 'Обычно в день', type: 'number', min: 0, max: 1000, value: b.baselinePerDay, half: true },
    { name: 'unit', label: 'Единица', value: b.unit, half: true, placeholder: 'сиг., банок, порц.' },
    { name: 'costPerUnit', label: 'Цена за единицу, ₽', type: 'number', min: 0, max: 100000, value: b.costPerUnit, half: true },
    { name: 'baselineNote', label: 'Частота (свободно)', value: b.baselineNote, half: true, placeholder: 'например: 3–4 раза в неделю' },
    { type: 'section', label: 'Стратегия' },
    { name: 'strategy', label: 'Подход', type: 'select', options: Object.entries(STRAT).map(([v, l]) => ({ value: v, label: l })), value: b.strategy },
    { name: 'targetPerDay', label: 'Сокращение: цель в день', type: 'number', min: 0, max: 1000, value: b.targetPerDay, half: true },
    { name: 'targetDate', label: 'к дате', type: 'date', value: b.targetDate, half: true },
    { name: 'limitPerDay', label: 'Ограничение: максимум в день', type: 'number', min: 0, max: 1000, value: b.limitPerDay, half: true },
    { name: 'maxPerWeek', label: 'Частота: эпизодов в неделю', type: 'number', min: 0, max: 100, value: b.maxPerWeek, half: true },
    { type: 'section', label: 'Понимание привычки' },
    { name: 'triggers', label: 'Мои триггеры', type: 'chips', options: [...new Set([...TRIGGERS, ...(b.triggers || [])])], value: b.triggers || [], allowAdd: true },
    { name: 'reasons', label: 'Причины возникновения / что даёт привычка', type: 'textarea', rows: 2, value: b.reasons },
    { name: 'why', label: 'Зачем я это меняю', type: 'textarea', rows: 2, value: b.why, placeholder: 'Будет показано в трудный момент' },
    { name: 'plan', label: 'Что делаю вместо (план на момент тяги)', type: 'textarea', rows: 2, value: b.plan, placeholder: 'например: 10 вдохов, вода, выйти пройтись' },
  ], onSave: async (v) => {
    if (v.strategy === 'reduce' && (v.targetPerDay == null || !v.targetDate)) return 'Для сокращения укажите цель в день и дату';
    if (v.strategy === 'limit' && v.limitPerDay == null) return 'Укажите максимум в день';
    if (v.strategy === 'frequency' && v.maxPerWeek == null) return 'Укажите допустимое число эпизодов в неделю';
    const c = BAD_CATS[v.cat];
    const saved = await S.putDef({ ...b, ...v, name: v.name || c.name, icon: c.icon, unit: v.unit || c.unit });
    if (v.cat === 'alcohol' && (isNew || b.cat !== 'alcohol')) info('Важно о безопасности', ALCOHOL_WARNING);
    if (isNew) location.hash = '#/badhabit/' + saved.id;
  }, onDelete: isNew ? null : async () => {
    for (const u of S.logs('baduse').filter((x) => x.ref === b.id)) await S.delLog(u.id);
    await S.delDef(b.id); location.hash = '#/bad';
  } });
}

/** Запись употребления / срыва или преодолённой тяги. */
export function recordUse(b, type = 'use', l) {
  const isNew = !l;
  const craving = type === 'craving';
  formSheet({ title: craving ? '💪 Тяга — справился' : isNew ? 'Запись употребления' : 'Изменить запись', saveLabel: 'Записать', fields: [
    craving ? null : { name: 'amount', label: `Количество, ${b.unit || 'ед.'}`, type: 'number', min: 0.1, max: 1000, value: l ? l.amount : 1, required: true, half: true },
    craving ? null : { name: 'cost', label: 'Потрачено, ₽', type: 'number', min: 0, max: 1e6, value: l ? l.cost : null, half: true, help: b.costPerUnit ? `пусто — ${b.costPerUnit} ₽ за ед.` : null },
    { name: 'intensity', label: 'Сила тяги', type: 'scale', min: 1, max: 10, value: l && l.intensity },
    { name: 'triggers', label: 'Что спровоцировало', type: 'chips', options: [...new Set([...(b.triggers || []), ...TRIGGERS])], value: (l && l.triggers) || [], allowAdd: true },
    { name: 'note', label: craving ? 'Что помогло' : 'Ситуация, мысли, что поможет в следующий раз', type: 'textarea', rows: 2, value: l && l.note },
    { name: 'ts', label: 'Когда', type: 'datetime', value: l ? l.ts : Date.now() },
  ].filter(Boolean), onSave: async (v) => {
    const rec = await S.putLog({ ...(l || { kind: 'baduse', ref: b.id, type }), ...v, amount: craving ? 0 : v.amount });
    vibrate(15);
    if (craving) toast('Отлично! Каждая преодолённая тяга — это навык 💪');
    else if (isNew) {
      const st = badStats(b);
      toast(st.daysTotal > 1 ? `Записано. Прогресс не обнулён: ${st.cleanDays30} дн. без употребления за последние ${st.days30}.` : 'Записано без осуждения. Разберём, что сработало триггером.', { ms: 5000 });
    }
    return rec;
  }, onDelete: isNew ? null : () => S.delLog(l.id) });
}

function card1(b) {
  const st = badStats(b);
  const lim = dailyLimit(b, S.cur().key);
  return card(null, h('div', null,
    h('div', { class: 'split', onclick: () => { location.hash = '#/badhabit/' + b.id; } },
      h('div', null, h('b', null, `${b.icon || '⛔'} ${b.name}`), h('div', { class: 'muted small' }, STRAT[b.strategy])), h('span', { class: 'muted' }, '›')),
    h('div', { class: 'grid3 mt' },
      h('div', { class: 'stat' }, h('b', null, fmtSince(st.sinceLastMs)), h('small', null, st.lastTs ? 'с последнего раза' : 'без употребления')),
      h('div', { class: 'stat' }, h('b', null, lim != null ? `${fmt(st.todayAmount, 1)}/${fmt(lim, 1)}` : fmt(st.todayAmount, 1)), h('small', null, 'сегодня')),
      h('div', { class: 'stat' }, h('b', { class: st.saved >= 0 ? 'ok' : '' }, b.costPerUnit ? `${fmt(st.saved)} ₽` : '—'), h('small', null, 'сэкономлено'))),
    h('div', { class: 'btns mt' }, btn('＋ Употребление / срыв', () => recordUse(b, 'use'), 'small'), btn('💪 Устоял', () => recordUse(b, 'craving'), 'small primary'))));
}

function listPage() {
  const list = S.defs('bad').filter((b) => !b.archived);
  return h('div', null,
    pageHeader('Вредные привычки', { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => badEdit(null) }, '＋')] }),
    list.length ? list.map(card1) : empty('Добавьте привычку, с которой хотите работать: курение, алкоголь, энергетики, сахар, переедание, недосып, малоподвижность или свою.', btn('＋ Добавить', () => badEdit(null), 'primary')),
    h('p', { class: 'muted small' }, 'Срыв не обнуляет прогресс: учитываются все дни без употребления, сокращение относительно исходного уровня и сэкономленные деньги.'));
}

function detailPage({ id }) {
  const b = S.def(id);
  if (!b) return h('div', null, pageHeader('Привычка', { back: true }), empty('Не найдено'));
  const st = badStats(b);
  const keys = S.lastDays(30);
  const lim = keys.map((k) => dailyLimit(b, k));
  const vals = keys.map((k) => (k < b.startDate ? null : st.byDay[k] || 0));
  const u = uses(b), cr = cravings(b);
  const ta = triggerAnalysis([...u, ...cr]);
  const weekEp = u.filter((x) => Date.now() - x.ts < 7 * DAY).length;
  const hist = [...u, ...cr].sort((a, c) => c.ts - a.ts).slice(0, 40);
  // периоды воздержания
  const pts = [new Date(b.startDate + 'T00:00').getTime(), ...u.map((x) => x.ts).filter((t) => t >= new Date(b.startDate + 'T00:00').getTime()), Date.now()];
  const periods = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] >= DAY) periods.push([pts[i - 1], pts[i], i === pts.length - 1]);
  return h('div', null,
    pageHeader(`${b.icon || ''} ${b.name}`, { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => badEdit(b) }, '✎')] }),
    b.cat === 'alcohol' ? h('div', { class: 'hint warn mb', onclick: () => info('Безопасность', ALCOHOL_WARNING) }, '⚠️ При возможной физической зависимости не прекращайте употребление резко самостоятельно — обратитесь к врачу. Подробнее…') : null,
    card(null, h('div', null,
      h('div', { class: 'muted small' }, st.lastTs ? 'С последнего употребления' : 'Без употребления с начала'),
      h('div', { class: 'big' }, fmtSince(st.sinceLastMs)),
      h('div', { class: 'btns mt' }, btn('＋ Употребление / срыв', () => recordUse(b, 'use')), btn('💪 Тяга — устоял', () => recordUse(b, 'craving'), 'primary'))), { cls: 'hero' }),
    b.why || b.plan ? card('Мой план', h('div', null, b.why ? row('Зачем', null, { sub: b.why }) : null, b.plan ? row('Что делаю вместо', null, { sub: b.plan }) : null)) : null,
    h('div', { class: 'grid2 mb' },
      h('div', { class: 'stat' }, h('b', null, fmtDuration(st.longestMs / 60000)), h('small', null, 'самый долгий перерыв')),
      h('div', { class: 'stat' }, h('b', null, `${st.cleanDays30}/${st.days30}`), h('small', null, 'дней без употребления (30)')),
      h('div', { class: 'stat' }, h('b', null, `${fmt(st.avg7, 1)} ${b.unit || ''}`), h('small', null, `в день за 7 дн.${b.baselinePerDay ? ' (было ' + b.baselinePerDay + ')' : ''}`)),
      h('div', { class: 'stat' }, h('b', { class: st.reduction > 0 ? 'ok' : '' }, st.reduction != null ? pct(Math.max(-9.99, st.reduction)) : '—'), h('small', null, 'сокращение от исходного')),
      h('div', { class: 'stat' }, h('b', { class: st.saved >= 0 ? 'ok' : '' }, b.costPerUnit ? `${fmt(st.saved)} ₽` : '—'), h('small', null, `сэкономлено за ${st.daysTotal} дн.`)),
      h('div', { class: 'stat' }, h('b', null, `${fmt(Math.max(0, st.avoided), 0)} ${b.unit || ''}`), h('small', null, 'не употреблено'))),
    b.strategy === 'frequency' ? card('Контроль частоты', row('Эпизодов за 7 дней', `${weekEp} из ${b.maxPerWeek ?? '—'}`)) : null,
    card('Употребление по дням', chart({ labels: keys.map(fmtDateShort), series: [{ name: b.unit || 'кол-во', values: vals, color: 'var(--bad)', type: 'bar' }, ...(b.strategy !== 'frequency' ? [{ name: 'допустимо', values: lim, color: 'var(--ok)', type: 'line', dashed: true, noDots: true }] : [])], allowZero: true, empty: 'Нет употреблений за 30 дней — так держать' })),
    card('Триггеры (употребления и тяга)', hbars(ta.triggers.slice(0, 8), { color: 'var(--bad)' })),
    card('Время суток', chart({ labels: Array.from({ length: 24 }, (_, i) => String(i)), series: [{ name: 'эпизодов', values: ta.hours, color: '#ff8f5a' }], type: 'bar', height: 120, empty: 'Нет данных' })),
    card('Периоды воздержания (от суток)', periods.length ? h('div', null, periods.slice(-10).reverse().map(([a, c, ongoing]) => row(fmtDuration((c - a) / 60000), ongoing ? h('span', { class: 'badge ok' }, 'идёт') : null, { sub: `${fmtDateShort(dateKey(a))} — ${ongoing ? 'сейчас' : fmtDateShort(dateKey(c))}` }))) : h('p', { class: 'muted small' }, 'Пока нет')),
    card('История', hist.length ? h('div', null, hist.map((x) => row(x.type === 'craving' ? '💪 Тяга преодолена' : `${fmt(x.amount, 1)} ${b.unit || ''}`, fmtDateTime(x.ts), { sub: [x.triggers && x.triggers.join(', '), x.intensity ? 'тяга ' + x.intensity + '/10' : null, x.note].filter(Boolean).join(' · ') || null, onclick: () => recordUse(b, x.type, x) }))) : empty('Записей нет')),
    card('Исходные данные', h('div', null, row('Начало работы', fmtDateShort(b.startDate)), row('Исходно в день', b.baselinePerDay != null ? `${b.baselinePerDay} ${b.unit || ''}` : '—'), b.baselineNote ? row('Частота', b.baselineNote) : null, row('Цена за единицу', b.costPerUnit ? `${b.costPerUnit} ₽` : '—'), row('Потрачено с начала', `${fmt(st.spent)} ₽`), b.reasons ? row('Причины', null, { sub: b.reasons }) : null)),
    h('p', { class: 'muted small' }, 'Сэкономлено = (исходное количество в день × дни × цена) − фактические траты. Значение может быть отрицательным — это честный расчёт, а не оценка.'),
  );
}

export default {
  bad: { tab: 'habits', tick: true, render: listPage },
  'badhabit/:id': { tab: 'habits', tick: true, render: detailPage },
};
export { sum };
