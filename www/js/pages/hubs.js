import { S } from '../data/store.js';
import { h, pageHeader, fmt } from '../ui/dom.js';
import { waterDay, foodDay, sleepDay, moodDay, activityDay, habitsDay, openSleep, on } from '../summary.js';
import { fmtDuration } from '../core/time.js';
import { medsToday } from './health.js';
import { badStats, fmtSince } from './bad.js';
import { lastWeight } from './body.js';
import { toDisp, unitLabel } from '../ui/units.js';

const mname = (id, def) => (S.settings.moduleNames || {})[id] || def;

function hub(title, items) {
  const vis = items.filter((i) => !i.module || on(i.module));
  const hidden = items.length - vis.length;
  return h('div', null, pageHeader(title),
    h('div', { class: 'hub' }, vis.map((i) => h('button', { class: 'hub-item', onclick: () => { location.hash = i.href; } },
      h('div', { class: 'ico', style: { color: i.color } }, i.icon), h('b', null, mname(i.module, i.name)), h('small', null, i.sub ? i.sub() : '')))),
    hidden ? h('p', { class: 'muted small mt center' }, `Скрыто модулей: ${hidden}. Включить — Настройки → Модули.`) : null);
}

export default {
  health: { tab: 'health', render: () => {
    const key = S.cur().key;
    return hub('Здоровье', [
      { module: 'water', name: 'Вода', icon: '💧', href: '#/water', color: 'var(--water)', sub: () => { const w = waterDay(key); return `${fmt(toDisp('volume', w.ml))} из ${fmt(toDisp('volume', w.goal))} ${unitLabel('volume')}`; } },
      { module: 'food', name: 'Питание', icon: '🥗', href: '#/food', sub: () => { const f = foodDay(key); return `${fmt(f.kcal)} ккал · Б ${fmt(f.protein)} г`; } },
      { module: 'sleep', name: 'Сон', icon: '🌙', href: '#/sleep', sub: () => { const o = openSleep(); if (o) return 'спите сейчас'; const s = sleepDay(key); return s.total ? fmtDuration(s.total) : 'нет записи'; } },
      { module: 'body', name: 'Вес и тело', icon: '⚖️', href: '#/body', sub: () => { const w = lastWeight(); return w ? `${fmt(toDisp('weight', w.value), 1)} ${unitLabel('weight')}` : 'нет взвешиваний'; } },
      { module: 'mind', name: 'Самочувствие', icon: '🧠', href: '#/mind', sub: () => { const m = moodDay(key); return m.mood ? `настроение ${fmt(m.mood, 1)}/5` : 'настроение, дневник, практики'; } },
      { module: 'hygiene', name: 'Гигиена и уход', icon: '🧼', href: '#/hygiene', sub: () => { const d = habitsDay(key).items.filter((x) => x.h.category === 'hygiene' && (x.h.freq || {}).type === 'daily'); return d.length ? `${d.filter((x) => x.done).length} из ${d.length} сегодня` : 'процедуры'; } },
      { module: 'health', name: 'Медицина', icon: '🩺', href: '#/medical', sub: () => { const m = medsToday(); return m.length ? `лекарств сегодня: ${m.length}` : 'обследования, анализы, лекарства'; } },
    ]);
  } },
  activity: { tab: 'activity', render: () => {
    const key = S.cur().key;
    const a = activityDay(key);
    return hub('Активность', [
      { module: 'workouts', name: 'Тренировки', icon: '🏋️', href: '#/workouts', sub: () => (S.logs('workout').find((w) => !w.end) ? 'идёт тренировка' : `сегодня: ${a.workouts}`) },
      { module: 'activity', name: 'Ходьба, бег, вело', icon: '🏃', href: '#/cardio', sub: () => `${fmt(a.minutes)} мин · ${fmt(a.steps)} шагов` },
      { module: 'workouts', name: 'Библиотека упражнений', icon: '📚', href: '#/library', sub: () => `${S.defs('exercise').length} упражнений` },
      { module: 'back', name: 'Спина и мобильность', icon: '🦴', href: '#/back', sub: () => ((S.settings.restrictions.risks || []).length ? 'ограничения учтены' : 'осанка, ограничения') },
      { module: 'recovery', name: 'Восстановление', icon: '🔋', href: '#/recovery', sub: () => 'прогулки, растяжка, отдых' },
    ]);
  } },
  habits: { tab: 'habits', tick: true, render: () => {
    const key = S.cur().key;
    return hub('Привычки и цели', [
      { module: 'habits', name: 'Полезные привычки', icon: '✅', href: '#/good', color: 'var(--habit)', sub: () => { const d = habitsDay(key); const it = d.items.filter((x) => x.h.category !== 'hygiene' && x.sched); return it.length ? `${it.filter((x) => x.done).length} из ${it.length} сегодня` : 'конструктор привычек'; } },
      { module: 'bad', name: 'Вредные привычки', icon: '⛔', href: '#/bad', sub: () => { const b = S.defs('bad').filter((x) => !x.archived)[0]; return b ? `${b.name}: ${fmtSince(badStats(b).sinceLastMs)}` : 'отказ и сокращение'; } },
      { module: 'goals', name: 'Цели', icon: '🎯', href: '#/goals', sub: () => `активных: ${S.defs('goal').filter((g) => !g.done).length}` },
      { module: 'goals', name: 'Достижения', icon: '🏅', href: '#/goals', sub: () => `${Object.keys(S.settings.achievements || {}).length} получено` },
    ]);
  } },
};
