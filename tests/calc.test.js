import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../www/js/core/calc.js';
import { atTime, dateKey, addDays } from '../www/js/core/time.js';
import { occurrences } from '../www/js/core/remind.js';

test('ИМТ и базовый обмен', () => {
  assert.equal(C.round(C.bmi(80, 180), 1), 24.7);
  assert.equal(C.bmr({ sex: 'm', weight: 80, height: 180, age: 30 }), 1780);
  assert.equal(C.bmr({ sex: 'f', weight: 60, height: 165, age: 30 }), 1320.25);
  const t = C.nutritionTargets({ sex: 'm', weight: 80, height: 180, age: 30, activity: 'mid' }, 'lose');
  assert.ok(t.kcal >= 1780 && t.kcal < 2759);
  assert.equal(t.protein, 144);
});

test('рецепт на 100 г', () => {
  const rice = { kcal: 344, protein: 7, fat: 1, carbs: 78 };
  const chicken = { kcal: 113, protein: 23.6, fat: 1.9, carbs: 0.4 };
  const r = C.recipePer100([{ product: rice, grams: 100 }, { product: chicken, grams: 200 }], 500);
  assert.equal(C.round(r.total.kcal), 570);
  assert.equal(C.round(r.per100.kcal), 114);
});

test('1ПМ и нагрузка', () => {
  assert.equal(C.round(C.oneRepMax(100, 5), 1), 116.7);
  assert.equal(C.oneRepMax(100, 20), null);
  assert.equal(C.volume([{ weight: 50, reps: 10 }, { weight: 60, reps: 8 }]), 980);
  const loads = {}; for (let i = 0; i < 28; i++) loads[addDays('2026-11-17', -i)] = 100;
  assert.equal(C.acwr(loads, '2026-11-17'), 1);
});

test('регулярность сна (через полночь)', () => {
  const s = [];
  for (let i = 0; i < 7; i++) { const k = addDays('2026-11-01', i); s.push({ start: atTime(k, 7 * 60 + (i % 2) * 20), end: atTime(k, 15 * 60) }); }
  const r = C.sleepRegularity(s);
  assert.equal(r.index, 100);
  assert.ok(r.midSd < 15);
  const c = C.circularStats([23 * 60 + 30, 30]);
  assert.ok(C.circDiff(c.mean, 0) < 1);
});

test('привычка: серия не обрывается незаконченным сегодняшним днём', () => {
  const h = { type: 'check', freq: { type: 'daily' } };
  const keys = ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
  const st = C.habitStats(h, keys, { '2026-11-14': 1, '2026-11-15': 1, '2026-11-16': 1 }, '2026-11-17');
  assert.equal(st.current, 3);
  assert.deepEqual(st.missed, ['2026-11-13']);
});

test('привычка N раз в неделю', () => {
  const h = { type: 'check', freq: { type: 'per_week', n: 2 } };
  const keys = []; for (let i = 0; i < 14; i++) keys.push(addDays('2026-11-02', i)); // 2 недели с пн
  const st = C.habitStats(h, keys, { '2026-11-03': 1, '2026-11-05': 1, '2026-11-10': 1 }, '2026-11-15');
  assert.equal(st.done, 1);
  assert.equal(st.curCount, 1);
});

test('привычка по рабочим дням', () => {
  const h = { type: 'count', target: 2, freq: { type: 'workdays' } };
  assert.equal(C.isScheduled(h, '2026-11-21', (k) => k !== '2026-11-21'), false);
  assert.equal(C.isDone(h, 2), true);
});

test('вредная привычка: срыв не обнуляет прогресс, деньги считаются', () => {
  const bad = { startDate: '2026-11-01', baselinePerDay: 20, costPerUnit: 10, strategy: 'quit' };
  const now = atTime('2026-11-10', 12 * 60);
  const uses = [{ ts: atTime('2026-11-05', 20 * 60), amount: 3 }];
  const st = C.badHabitStats(bad, uses, now, dateKey);
  assert.equal(st.daysTotal, 10);
  assert.equal(st.spent, 30);
  assert.equal(st.saved, 2000 - 30);
  assert.equal(st.cleanDays30, 9);
  assert.equal(st.episodes, 1);
  assert.ok(st.longestMs > 4 * 24 * 3600e3);
});

test('постепенное сокращение — линейный план', () => {
  const bad = { strategy: 'reduce', baselinePerDay: 20, targetPerDay: 0, startDate: '2026-11-01', targetDate: '2026-11-21' };
  assert.equal(C.dailyLimit(bad, '2026-11-01'), 20);
  assert.equal(C.dailyLimit(bad, '2026-11-11'), 10);
  assert.equal(C.dailyLimit(bad, '2026-12-01'), 0);
});

test('корреляция и индекс прогресса', () => {
  assert.equal(C.round(C.pearson([[1, 2], [2, 4], [3, 6], [4, 8], [5, 10]]), 3), 1);
  assert.equal(C.pearson([[1, 2], [2, 4]]), null);
  assert.equal(C.progressIndex([{ rate: 1, weight: 1 }, { rate: 0.5, weight: 1 }, { rate: null, weight: 5 }]), 75);
});

test('валидация', () => {
  assert.equal(C.num('12,5').value, 12.5);
  assert.equal(C.num('abc').ok, false);
  assert.equal(C.num('', { required: true }).ok, false);
  assert.equal(C.num('500', { max: 300 }).ok, false);
});

test('напоминания: тишина во время сна и работы', () => {
  const templates = [{ id: 'w', isWork: true, sleepStart: '07:00', sleepEnd: '15:00', workStart: '20:30', workEnd: '06:30' }];
  const schedule = { weekdays: { 1: 'w', 2: 'w', 3: 'w', 4: 'w', 5: 'w', 6: 'w', 7: 'w' } };
  const from = atTime('2026-11-17', 0);
  const water = { enabled: true, mode: 'interval', every: 120 };
  const ts = occurrences(water, { fromTs: from, days: 1, schedule, templates, quiet: { sleep: true, work: true } });
  const hours = ts.filter((t) => dateKey(t) === '2026-11-17').map((t) => new Date(t).getHours());
  assert.deepEqual(hours, [17, 19]); // 15–07 интервал, минус работа 20:30–06:30 и сон
  const noQuiet = occurrences(water, { fromTs: from, days: 1, schedule, templates, quiet: {} });
  assert.ok(noQuiet.length > ts.length);
  const wake = occurrences({ enabled: true, mode: 'wake', offset: 30 }, { fromTs: from, days: 1, schedule, templates, quiet: { sleep: true } });
  assert.equal(new Date(wake[0]).getHours() * 60 + new Date(wake[0]).getMinutes(), 15 * 60 + 30);
  const bed = occurrences({ enabled: true, mode: 'sleep', offset: 30 }, { fromTs: from, days: 0, schedule, templates, quiet: {} });
  assert.equal(new Date(bed[0]).getHours() * 60 + new Date(bed[0]).getMinutes(), 6 * 60 + 30); // 07:00 − 30 мин, на следующее утро
  assert.equal(occurrences({ ...water, important: false }, { fromTs: from, days: 1, schedule, templates, quiet: { importantOnly: true } }).length, 0);
  assert.equal(occurrences(water, { fromTs: from, days: 1, schedule, templates, quiet: { all: true } }).length, 0);
});
