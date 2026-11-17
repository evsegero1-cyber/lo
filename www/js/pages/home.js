import { S, DASHBOARD_CARDS } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, ring, bar, fmt, empty, confirmDialog } from '../ui/dom.js';
import { dayGoals, waterDay, foodDay, sleepDay, activityDay, habitsDay, moodDay, tasksDay, openSleep, on } from '../summary.js';
import { fmtDate, tsToHm, fmtDuration, fmtDateTime, hmToMin, minutesOfDay, inWindow, dateKey, addDays, toLocalInput } from '../core/time.js';
import { quickButtons } from './water.js';
import { goToBed, wakeUp } from './sleep.js';
import { addFoodSheet } from './food.js';
import { habitButton } from './habits.js';
import { badStats, fmtSince, recordUse } from './bad.js';
import { addWeight, lastWeight } from './body.js';
import { moodSheet } from './mind.js';
import { medsToday, takeMed } from './health.js';
import { goalProgress } from './goals.js';
import { startWorkout, addActivity } from './workouts.js';
import { weightTrend } from '../core/calc.js';
import { toDisp, unitLabel } from '../ui/units.js';

const MOOD_E = ['😞', '😕', '😐', '🙂', '😄'];
const cardModule = { water: 'water', food: 'food', sleep: 'sleep', activity: 'workouts', habits: 'habits', bad: 'bad', weight: 'body', mood: 'mind', meds: 'health', goals: 'goals' };
const title = (id) => (S.settings.dashboard.titles || {})[id] || (DASHBOARD_CARDS.find((c) => c.id === id) || {}).title;

function header() {
  const now = Date.now();
  const pd = S.cur();
  const tpl = S.template(pd.key);
  const cal = dateKey(now);
  const m = minutesOfDay(now);
  const atWork = tpl && tpl.isWork && inWindow(m, hmToMin(tpl.workStart), hmToMin(tpl.workEnd));
  const o = openSleep();
  return h('section', { class: 'card hero' },
    h('div', { class: 'day-head' },
      h('div', null,
        h('div', { class: 'clock' }, tsToHm(now)),
        h('div', { class: 'muted small mt' }, fmtDate(cal, true)),
        h('div', { class: 'pday', onclick: dayBoundsSheet }, `Личный день: ${fmtDate(pd.key)} · с ${tsToHm(pd.start)} ✎`)),
      h('div', { style: { textAlign: 'right' } },
        S.settings.profile.name ? h('div', { class: 'muted small' }, `Привет, ${S.settings.profile.name}`) : null,
        tpl ? h('span', { class: 'badge accent mt', style: { marginTop: '6px' } }, tpl.name) : null,
        atWork ? h('div', { class: 'mt' }, h('span', { class: 'badge warn' }, `🏭 смена до ${tpl.workEnd}`)) : null,
        o ? h('div', { class: 'mt' }, h('span', { class: 'badge' }, `🌙 сон ${fmtDuration((now - o.start) / 60000)}`)) : null)),
    on('sleep') ? h('div', { class: 'btns mt' }, o ? btn('☀️ Проснулся — начать день', wakeUp, 'primary wide') : [btn('🌙 Лёг спать', () => goToBed(true)), btn('😴 Короткий сон', () => goToBed(false), 'ghost')]) : null);
}

/** Ручное управление границами личного дня. */
function dayBoundsSheet() {
  const pd = S.cur();
  const starts = S.starts().filter((s) => s.ts <= Date.now()).slice(-6).reverse();
  const kindT = { wake: 'пробуждение', manual: 'вручную', auto: 'автоматически' };
  sheet({ title: 'Границы личного дня', body: (sh) => h('div', null,
    h('p', { class: 'muted small' }, 'Личный день начинается, когда вы просыпаетесь после основного сна. Если пробуждение не отмечено — граница ставится автоматически посередине планового сна по шаблону режима.'),
    row('Текущий день', fmtDate(pd.key), { sub: `начался ${fmtDateTime(pd.start)} (${kindT[pd.kind] || ''})` }),
    h('div', { class: 'btns mt' },
      btn('Начать новый день сейчас', async () => { await S.putLog({ kind: 'daystart', ts: Date.now() }); sh.close(); toast('Новый личный день начат'); }, 'primary'),
      btn('Указать время начала…', () => formSheet({ title: 'Начало личного дня', fields: [{ name: 'ts', label: 'Когда начался день', type: 'datetime', value: pd.start, required: true }], onSave: async (v) => {
        if (v.ts > Date.now()) return 'Время в будущем';
        await S.putLog({ kind: 'daystart', ts: v.ts }); sh.close();
      } }), 'ghost')),
    h('div', { class: 'form-section mt2' }, 'Последние начала дней'),
    ...starts.map((s) => row(fmtDate(s.key), fmtDateTime(s.ts), { sub: kindT[s.kind], onclick: async () => {
      if (s.kind === 'manual') {
        const l = S.logs('daystart').find((x) => x.ts === s.ts);
        if (l && await confirmDialog('Удалить эту ручную границу?')) { await S.delLog(l.id); sh.close(); }
      } else if (s.kind === 'auto') {
        if (await confirmDialog('Отключить автоматическую границу для этой даты? Дни объединятся.')) { await S.setSetting('pday.suppressed', [...(S.settings.pday.suppressed || []), dateKey(s.ts)]); sh.close(); }
      } else toast('Граница по пробуждению — измените время сна в разделе «Сон»');
    } })),
    (S.settings.pday.suppressed || []).length ? btn('Вернуть отключённые автограницы', async () => { await S.setSetting('pday.suppressed', []); sh.close(); }, 'small ghost mt') : null) });
}

function progressCard() {
  const g = dayGoals(S.cur().key);
  if (!g.length) return card(title('progress'), h('p', { class: 'muted small' }, 'Задайте цели (вода, калории, сон, привычки) — здесь появится прогресс дня.'));
  const done = g.filter((x) => x.done).length;
  return card(title('progress'), h('div', { class: 'dash-mini' },
    ring(done / g.length, { size: 86, stroke: 9, color: 'var(--ok)', label: `${done}/${g.length}`, sub: 'целей' }),
    h('div', { class: 'info goal-list' }, g.slice(0, 8).map((x) => h('div', { class: 'goal-row', onclick: () => { location.hash = x.href; } }, h('div', { class: 'split small' }, h('span', { class: x.done ? 'ok' : '' }, (x.done ? '✓ ' : '') + x.label), h('span', { class: 'muted' }, x.text)), bar(x.value, x.color))))));
}

function tasksCard() {
  const key = S.cur().key;
  const tasks = tasksDay(key);
  const inp = h('input', { class: 'inp', placeholder: 'Новая задача на личный день' });
  const add = async () => { const t = inp.value.trim(); if (!t) return; inp.value = ''; inp.blur(); await S.putLog({ kind: 'task', pday: key, text: t, done: false }); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return card(title('tasks'), h('div', null,
    tasks.map((t) => h('div', { class: 'row' }, h('button', { class: 'check' + (t.done ? ' on' : ''), onclick: () => S.putLog({ ...t, done: !t.done }) }, '✓'),
      h('div', { class: 'row-main', style: t.done ? { textDecoration: 'line-through', color: 'var(--muted)' } : null, onclick: () => formSheet({ title: 'Задача', fields: [{ name: 'text', label: 'Текст', required: true, value: t.text }, { name: 'move', label: 'Перенести на следующий личный день', type: 'check' }], onSave: (v) => S.putLog({ ...t, text: v.text, pday: v.move ? addDays(key, 1) : t.pday }), onDelete: () => S.delLog(t.id) }) }, t.text))),
    h('div', { class: 'split mt' }, inp, btn('＋', add, 'primary'))));
}

function waterCard() {
  const w = waterDay(S.cur().key);
  return card(title('water'), h('div', null,
    h('div', { class: 'dash-mini', onclick: () => { location.hash = '#/water'; } }, ring(w.goal ? w.ml / w.goal : 0, { size: 62, stroke: 7, color: 'var(--water)', label: w.goal ? Math.round((w.ml / w.goal) * 100) + '%' : '' }),
      h('div', { class: 'info' }, h('div', { class: 'kpi' }, h('span', { class: 'big', style: { fontSize: '24px' } }, fmt(toDisp('volume', w.ml))), h('small', null, w.goal ? `из ${fmt(toDisp('volume', w.goal))} ${unitLabel('volume')}` : unitLabel('volume'))))),
    h('div', { class: 'mt' }, quickButtons(4))));
}

function foodCard() {
  const f = foodDay(S.cur().key);
  const t = S.settings.food.targets;
  const m = (n, l, c) => h('div', { class: 'macro' }, h('span', { class: 'small' }, l), bar(t[n] ? f[n] / t[n] : 0, c), h('span', { class: 'small' }, `${fmt(f[n])}${t[n] ? '/' + t[n] : ''}`));
  return card(title('food'), h('div', null,
    h('div', { class: 'split', onclick: () => { location.hash = '#/food'; } }, h('div', { class: 'kpi' }, h('span', { class: 'big', style: { fontSize: '24px' } }, fmt(f.kcal)), h('small', null, t.kcal ? `из ${t.kcal} ккал` : 'ккал')), h('span', { class: 'muted small' }, `овощи/фр. ${fmt(f.vegServings, 1)} порц.`)),
    m('protein', 'Белки', '#ff8f5a'), m('fat', 'Жиры', '#ffd166'), m('carbs', 'Углев.', '#4cc3ff'),
    btn('＋ Еда', () => addFoodSheet(), 'small mt')));
}

function sleepCard() {
  const s = sleepDay(S.cur().key);
  const o = openSleep();
  return card(title('sleep'), h('div', { onclick: () => { location.hash = '#/sleep'; } },
    o ? h('p', null, `Сон идёт с ${tsToHm(o.start)}`) : null,
    h('div', { class: 'grid3' },
      h('div', { class: 'stat' }, h('b', null, s.total ? fmtDuration(s.total) : '—'), h('small', null, 'за личный день')),
      h('div', { class: 'stat' }, h('b', null, s.main ? `${tsToHm(s.main.start)}–${tsToHm(s.main.end)}` : '—'), h('small', null, 'основной')),
      h('div', { class: 'stat' }, h('b', null, s.quality ? s.quality + '/5' : '—'), h('small', null, 'качество')))));
}

function activityCard() {
  const a = activityDay(S.cur().key);
  const open = S.logs('workout').find((w) => !w.end);
  return card(title('activity'), h('div', null,
    h('div', { class: 'grid3', onclick: () => { location.hash = '#/workouts'; } },
      h('div', { class: 'stat' }, h('b', null, fmt(a.minutes)), h('small', null, 'минут')),
      h('div', { class: 'stat' }, h('b', null, a.workouts), h('small', null, 'тренировок')),
      h('div', { class: 'stat' }, h('b', null, fmt(a.steps)), h('small', null, 'шагов'))),
    h('div', { class: 'btns mt' }, open ? btn('▶ Продолжить тренировку', () => { location.hash = '#/session/' + open.id; }, 'small primary') : btn('▶ Тренировка', () => startWorkout(null), 'small'), on('activity') ? btn('＋ Кардио/шаги', () => addActivity(null), 'small ghost') : null)));
}

function habitsCard() {
  const key = S.cur().key;
  const d = habitsDay(key);
  const all = d.items.filter((x) => !['per_week', 'per_month'].includes((x.h.freq || {}).type));
  const items = all.filter((x) => x.h.category !== 'hygiene');
  const hy = all.filter((x) => x.h.category === 'hygiene');
  const hyLine = hy.length ? h('div', { class: 'row tap', onclick: () => { location.hash = '#/hygiene'; } }, h('div', { class: 'row-ico' }, '🧼'), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, 'Гигиена и уход'), h('div', { class: 'row-sub' }, `${hy.filter((x) => x.done).length} из ${hy.length} сегодня`)), h('div', { class: 'row-right' }, '›')) : null;
  if (!items.length) return card(title('habits'), h('div', null, h('p', { class: 'muted small', onclick: () => { location.hash = '#/good'; } }, 'Привычек на сегодня нет. Создайте свои в разделе «Привычки».'), hyLine));
  return card(`${title('habits')} · ${items.filter((x) => x.done).length}/${items.length}`, h('div', null, items.slice(0, 8).map((x) => habitButton(x, key)),
    items.length > 8 ? btn(`Все (${items.length})`, () => { location.hash = '#/good'; }, 'small ghost') : null, hyLine));
}

function badCard() {
  const list = S.defs('bad').filter((b) => !b.archived);
  if (!list.length) return null;
  return card(title('bad'), h('div', null, list.map((b) => {
    const st = badStats(b);
    return h('div', { class: 'row' }, h('div', { class: 'row-ico' }, b.icon || '⛔'),
      h('div', { class: 'row-main', onclick: () => { location.hash = '#/badhabit/' + b.id; } }, h('div', { class: 'row-title' }, b.name), h('div', { class: 'row-sub' }, `${fmtSince(st.sinceLastMs)} без · сегодня ${fmt(st.todayAmount, 1)}${st.todayLimit != null ? '/' + st.todayLimit : ''}`)),
      h('div', { class: 'btns' }, h('button', { class: 'btn small', onclick: () => recordUse(b, 'use') }, '＋'), h('button', { class: 'btn small primary', onclick: () => recordUse(b, 'craving') }, '💪')));
  })));
}

function weightCard() {
  const w = lastWeight();
  const tr = weightTrend(S.logs('weight').map((x) => ({ key: S.pdayOf(x.ts).key, value: x.value })), S.cur().key);
  return card(title('weight'), h('div', { class: 'split' },
    h('div', { onclick: () => { location.hash = '#/body'; } }, h('div', { class: 'kpi' }, h('span', { class: 'big', style: { fontSize: '24px' } }, w ? fmt(toDisp('weight', w.value), 1) : '—'), h('small', null, unitLabel('weight'))),
      h('div', { class: 'muted small' }, tr ? `за неделю ${tr.diff > 0 ? '+' : ''}${fmt(toDisp('weight', tr.diff), 1)} (по средним)` : w ? fmtDateTime(w.ts) : 'нет взвешиваний')),
    btn('＋', () => addWeight(null), 'small')));
}

function moodCard() {
  const m = moodDay(S.cur().key);
  return card(title('mood'), h('div', null,
    m.mood ? h('p', { class: 'muted small', style: { marginTop: 0 } }, `Сегодня: ${MOOD_E[Math.round(m.mood) - 1]} ${fmt(m.mood, 1)}/5${m.energy ? ' · энергия ' + fmt(m.energy, 1) : ''}`) : null,
    h('div', { class: 'scale' }, MOOD_E.map((e, i) => h('button', { class: 'scale-btn', style: { fontSize: '22px' }, onclick: () => moodSheet(null, i + 1) }, e)))));
}

function medsCard() {
  const m = medsToday();
  if (!m.length) return null;
  return card(title('meds'), h('div', null, m.map(({ m: x, taken, need }) => row(x.name, h('button', { class: 'btn small ' + (taken.length >= need ? '' : 'primary'), onclick: () => takeMed(x) }, taken.length >= need ? `✓ ${taken.length}/${need}` : `Принял ${taken.length}/${need}`), { sub: x.dose }))));
}

function goalsCard() {
  const g = S.defs('goal').filter((x) => !x.done).slice(0, 4);
  if (!g.length) return null;
  return card(title('goals'), h('div', null, g.map((x) => { const p = goalProgress(x); return h('div', { class: 'macro', onclick: () => { location.hash = '#/goal/' + x.id; } }, h('span', { class: 'small' }, x.name), bar(p.rate), h('span', { class: 'small' }, Math.round(p.rate * 100) + '%')); })));
}

const RENDER = { progress: progressCard, tasks: tasksCard, water: waterCard, food: foodCard, sleep: sleepCard, activity: activityCard, habits: habitsCard, bad: badCard, weight: weightCard, mood: moodCard, meds: medsCard, goals: goalsCard };

export function dashboardSettings() {
  sheet({ title: 'Настройка главной', body: () => {
    const box = h('div');
    const draw = () => {
      const cards = S.settings.dashboard.cards;
      box.replaceChildren(h('p', { class: 'muted small' }, 'Включайте, переименовывайте и меняйте порядок карточек. Карточки отключённых модулей не показываются.'),
        ...cards.map((c, i) => {
          const sw = h('input', { type: 'checkbox', class: 'switch' }); sw.checked = c.on;
          sw.onchange = async () => { await S.setSetting('dashboard.cards', cards.map((x) => (x.id === c.id ? { ...x, on: sw.checked } : x))); };
          const mod = cardModule[c.id];
          return h('div', { class: 'row' },
            h('div', { class: 'btns', style: { flexDirection: 'column', gap: '2px' } },
              h('button', { class: 'drag', disabled: i === 0, onclick: async () => { const a = [...cards]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; await S.setSetting('dashboard.cards', a); draw(); } }, '▲'),
              h('button', { class: 'drag', disabled: i === cards.length - 1, onclick: async () => { const a = [...cards]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; await S.setSetting('dashboard.cards', a); draw(); } }, '▼')),
            h('div', { class: 'row-main', onclick: () => formSheet({ title: 'Название карточки', fields: [{ name: 't', label: 'Название', value: title(c.id) }], onSave: async (v) => { await S.setSetting('dashboard.titles', { ...(S.settings.dashboard.titles || {}), [c.id]: v.t || undefined }); draw(); } }) },
              h('div', { class: 'row-title' }, title(c.id), ' ✎'), mod && !on(mod) ? h('div', { class: 'row-sub' }, 'модуль отключён') : null),
            sw);
        }));
    };
    draw();
    return box;
  } });
}

export default {
  '': { tab: 'home', tick: true, render: () => {
    const cards = S.settings.dashboard.cards.filter((c) => c.on && (!cardModule[c.id] || on(cardModule[c.id])));
    return h('div', null,
      h('header', { class: 'page-head' }, h('h1', null, h('span', { class: 'logo', style: { fontSize: '24px' } }, 'LIFE OS')), h('div', { class: 'page-head-actions' }, h('button', { class: 'icon-btn', onclick: dashboardSettings, 'aria-label': 'Настроить главную' }, '⊞'))),
      header(),
      ...cards.map((c) => RENDER[c.id] && RENDER[c.id]()).filter(Boolean),
      cards.length ? null : empty('Все карточки скрыты', btn('Настроить', dashboardSettings, 'primary')));
  } },
};
export { toLocalInput };
