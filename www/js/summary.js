// Сводки по личным дням — общие для главной, аналитики, отчётов и целей.
// Всё считается только по реально введённым записям.

import { S } from './data/store.js';
import { sum, avg, sumNutrients, dayValue, isDone, isScheduled, habitStats, badHabitStats, dailyLimit } from './core/calc.js';
import { addDays, keyRange, weekStart, DAY } from './core/time.js';

export const on = (m) => S.settings.modules[m] !== false;

export function waterDay(key) {
  const logs = S.inDay('water', key);
  return { ml: sum(logs, (l) => l.effective ?? l.ml), raw: sum(logs, (l) => l.ml), goal: S.settings.water.goal, logs };
}

export function foodDay(key) {
  const logs = S.inDay('food', key);
  const n = sumNutrients(logs);
  const vegGrams = sum(logs.filter((l) => l.cat === 'veg' || l.cat === 'fruit'), (l) => l.grams);
  return { ...n, logs, vegServings: vegGrams / 80, count: logs.length };
}

/** Цель по калориям выполнена — зависит от сценария. */
export function foodGoalMet(f) {
  const t = S.settings.food.targets.kcal;
  if (!f.count || !t) return null;
  const sc = S.settings.food.scenario;
  if (sc === 'lose') return f.kcal <= t * 1.05;
  if (sc === 'gain') return f.kcal >= t * 0.95;
  return Math.abs(f.kcal - t) <= t * 0.1;
}

export function sleepDay(key) {
  const r = S.range(key);
  // сон, закончившийся в этот личный день (основной — на его старте) + дневные периоды
  const logs = S.logs('sleep').filter((s) => s.end && s.end >= r.start - 60000 && (r.end == null || s.end < r.end));
  const total = sum(logs, (s) => (s.end - s.start) / 60000);
  const main = logs.find((s) => s.main);
  return { total, logs, main, quality: main ? main.quality : null, goal: S.settings.sleep.goalMin };
}
export function openSleep() { return S.logs('sleep').find((s) => !s.end) || null; }

export function activityDay(key) {
  const acts = S.inDay('activity', key);
  const wos = S.inDay('workout', key).filter((w) => w.end);
  const minutes = sum(acts, (a) => a.minutes) + sum(wos, (w) => w.minutes);
  const steps = sum(acts, (a) => a.steps);
  const kcal = sum(acts, (a) => a.kcal) + sum(wos, (w) => w.kcal);
  return { minutes, steps, kcal, workouts: wos.length, acts, wos };
}

export function habitsForDay(key, category) {
  const list = S.defs('habit').filter((h) => !h.archived && (!category || h.category === category));
  const res = [];
  for (const h of list) {
    const sched = isScheduled(h, key, (k) => S.isWorkDay(k));
    const logs = S.inDay('habitlog', key, h.id);
    const value = dayValue(h, logs);
    res.push({ h, sched, value, done: isDone(h, value), logs });
  }
  return res;
}
export function habitsDay(key) {
  if (!on('habits') && !on('hygiene')) return { total: 0, done: 0, items: [] };
  const items = habitsForDay(key).filter((x) => x.sched && (x.h.category === 'hygiene' ? on('hygiene') : on('habits')));
  // привычки «N раз в неделю/месяц» не обязательны в конкретный день — считаем их только если выполнены
  const daily = items.filter((x) => !['per_week', 'per_month'].includes((x.h.freq || {}).type) || x.done);
  return { total: daily.length, done: daily.filter((x) => x.done).length, items };
}

export function badDay(key) {
  const res = [];
  for (const b of S.defs('bad').filter((x) => !x.archived)) {
    const amount = sum(S.inDay('baduse', key, b.id).filter((u) => u.type !== 'craving'), (u) => u.amount || 1);
    const limit = dailyLimit(b, key);
    res.push({ b, amount, limit, ok: limit == null ? null : amount <= limit });
  }
  return res;
}

export function moodDay(key) {
  const logs = S.inDay('mood', key);
  const m = logs.map((l) => l.mood).filter((v) => v != null);
  return { mood: m.length ? avg(m) : null, energy: avg(logs.map((l) => l.energy).filter((v) => v != null)), stress: avg(logs.map((l) => l.stress).filter((v) => v != null)), logs };
}

export function tasksDay(key) { return S.logs('task').filter((t) => t.pday === key); }

/** Цели текущего личного дня для блока «Прогресс за день». */
export function dayGoals(key) {
  const g = [];
  if (on('water') && S.settings.water.goal) { const w = waterDay(key); g.push({ id: 'water', label: 'Вода', done: w.ml >= w.goal, value: Math.min(1, w.ml / w.goal), text: `${Math.round(w.ml)} / ${w.goal} мл`, color: 'var(--water)', href: '#/water' }); }
  if (on('food')) { const f = foodDay(key); const t = S.settings.food.targets.kcal; if (t) g.push({ id: 'food', label: 'Калории', done: !!foodGoalMet(f), value: Math.min(1, f.kcal / t), text: `${Math.round(f.kcal)} / ${t} ккал`, color: 'var(--food)', href: '#/food' }); }
  if (on('sleep') && S.settings.sleep.goalMin) { const s = sleepDay(key); g.push({ id: 'sleep', label: 'Сон', done: s.total >= s.goal - 30, value: Math.min(1, s.total / s.goal), text: s.total ? `${Math.floor(s.total / 60)} ч ${Math.round(s.total % 60)} мин` : 'нет записи', color: 'var(--sleep)', href: '#/sleep' }); }
  if (on('activity') && S.settings.activity.stepsGoal) { const a = activityDay(key); g.push({ id: 'steps', label: 'Шаги', done: a.steps >= S.settings.activity.stepsGoal, value: Math.min(1, a.steps / S.settings.activity.stepsGoal), text: `${a.steps} / ${S.settings.activity.stepsGoal}`, color: 'var(--act)', href: '#/cardio' }); }
  const hd = habitsDay(key);
  if (hd.total) g.push({ id: 'habits', label: 'Привычки', done: hd.done >= hd.total, value: hd.done / hd.total, text: `${hd.done} из ${hd.total}`, color: 'var(--habit)', href: '#/good' });
  if (on('bad')) for (const x of badDay(key)) if (x.limit != null) g.push({ id: 'bad_' + x.b.id, label: x.b.name, done: x.ok, value: x.ok ? 1 : 0, text: x.limit === 0 ? (x.amount ? `${x.amount} — без осуждения, продолжаем` : 'без употребления') : `${x.amount} из ${x.limit} допустимых`, color: 'var(--bad)', href: '#/badhabit/' + x.b.id });
  const tasks = tasksDay(key);
  if (tasks.length) g.push({ id: 'tasks', label: 'Задачи', done: tasks.every((t) => t.done), value: tasks.filter((t) => t.done).length / tasks.length, text: `${tasks.filter((t) => t.done).length} из ${tasks.length}`, color: 'var(--accent)', href: '#/' });
  return g;
}

// ── Доли выполнения по направлениям для индекса прогресса ──
export function directionRates(keys) {
  const cur = S.cur().key;
  const past = keys.filter((k) => k < cur); // текущий день ещё не закончен
  const dirs = [];
  const rate = (arr) => (arr.length ? arr.filter(Boolean).length / arr.length : null);
  const withData = (fn, kind) => past.filter((k) => S.inDay(kind, k).length).map(fn);
  if (on('water')) dirs.push({ id: 'water', label: 'Вода', rate: rate(withData((k) => waterDay(k).ml >= S.settings.water.goal, 'water')), how: 'доля дней с записями о воде, когда цель достигнута' });
  if (on('food')) dirs.push({ id: 'food', label: 'Питание', rate: rate(withData((k) => foodGoalMet(foodDay(k)), 'food')), how: 'доля дней с дневником питания, когда калорийность соответствует сценарию' });
  if (on('sleep')) {
    const days = past.filter((k) => sleepDay(k).total > 0);
    dirs.push({ id: 'sleep', label: 'Сон', rate: rate(days.map((k) => sleepDay(k).total >= S.settings.sleep.goalMin - 30)), how: 'доля дней с записанным сном, когда сон не короче цели (допуск 30 мин)' });
  }
  if (on('habits') || on('hygiene')) {
    let tot = 0, dn = 0;
    for (const k of past) { const d = habitsDay(k); tot += d.total; dn += d.done; }
    dirs.push({ id: 'habits', label: 'Привычки', rate: tot ? dn / tot : null, how: 'выполненные / запланированные отметки привычек' });
  }
  if (on('bad')) {
    const arr = [];
    for (const k of past) for (const x of badDay(k)) {
      if (x.limit == null) continue;
      const st = x.b.startDate; if (st && k < st) continue;
      arr.push(x.ok);
    }
    dirs.push({ id: 'bad', label: 'Вредные привычки', rate: rate(arr), how: 'доля дней в пределах выбранной стратегии (с даты начала работы)' });
  }
  if (on('workouts') && S.settings.activity.weeklyWorkouts) {
    const weeks = [...new Set(past.map(weekStart))];
    const need = S.settings.activity.weeklyWorkouts;
    const arr = weeks.map((w) => { const ks = keyRange(w, addDays(w, 6)); return ks.reduce((a, k) => a + activityDay(k).workouts + S.inDay('activity', k).filter((x) => x.minutes >= 20).length, 0) >= need; });
    dirs.push({ id: 'workouts', label: 'Тренировки', rate: rate(arr), how: `доля недель, где тренировок не меньше ${need}` });
  }
  if (on('mind')) {
    const days = past.filter((k) => moodDay(k).mood != null);
    dirs.push({ id: 'mood', label: 'Самочувствие', rate: rate(days.map((k) => moodDay(k).mood >= 3)), how: 'доля дней с оценкой настроения 3 и выше' });
  }
  const w = S.settings.progress || {};
  return dirs.map((d) => ({ ...d, weight: w[d.id] ?? 1 }));
}

export { habitStats, badHabitStats, DAY };
