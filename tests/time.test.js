import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDayStarts, pdayAt, atTime, boundaryMinutes, hmToMin, spanMinutes, templateIdFor, addDays, daysBetween, weekday, HOUR } from '../www/js/core/time.js';

const tplWork = { id: 'w', sleepStart: '07:00', sleepEnd: '15:00' };
const B = () => boundaryMinutes(tplWork);

test('граница дня — середина планового сна', () => {
  assert.equal(boundaryMinutes(tplWork), 11 * 60);
  assert.equal(boundaryMinutes({ sleepStart: '23:00', sleepEnd: '07:00' }), 3 * 60);
  assert.equal(boundaryMinutes({}), 240);
});

test('базовые функции дат', () => {
  assert.equal(hmToMin('20:30'), 1230);
  assert.equal(hmToMin('25:00'), null);
  assert.equal(spanMinutes(hmToMin('20:30'), hmToMin('06:30')), 600);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-11-01', '2026-12-01'), 30);
  assert.equal(weekday('2026-11-16'), 1); // понедельник
  assert.equal(weekday('2026-11-22'), 7);
});

test('ночной график: проснулся в 15:00, работал ночью, лёг в 07:00', () => {
  const real = [
    { ts: atTime('2026-11-16', 15 * 60), kind: 'wake' },
    { ts: atTime('2026-11-17', 15 * 60), kind: 'wake' },
    { ts: atTime('2026-11-18', 15 * 60), kind: 'wake' },
  ];
  const starts = computeDayStarts({ from: atTime('2026-11-16', 0), to: atTime('2026-11-19', 0), real, boundaryFor: B });
  // 03:00 17-го (на работе) — всё ещё личный день 16-го
  assert.equal(pdayAt(atTime('2026-11-17', 3 * 60), starts).key, '2026-11-16');
  // 06:50 17-го, вернулся домой — 16-е
  assert.equal(pdayAt(atTime('2026-11-17', 6 * 60 + 50), starts).key, '2026-11-16');
  // 16:00 17-го — новый день 17-е
  assert.equal(pdayAt(atTime('2026-11-17', 16 * 60), starts).key, '2026-11-17');
  const d = pdayAt(atTime('2026-11-17', 16 * 60), starts);
  assert.equal(d.start, atTime('2026-11-17', 15 * 60));
  assert.equal(d.end, atTime('2026-11-18', 15 * 60));
});

test('забыл отметить пробуждение — день не растягивается на двое суток', () => {
  const real = [
    { ts: atTime('2026-11-16', 15 * 60), kind: 'wake' },
    { ts: atTime('2026-11-18', 15 * 60), kind: 'wake' },
  ];
  const starts = computeDayStarts({ from: atTime('2026-11-16', 0), to: atTime('2026-11-19', 0), real, boundaryFor: B });
  assert.equal(pdayAt(atTime('2026-11-17', 18 * 60), starts).key, '2026-11-17');
  assert.equal(pdayAt(atTime('2026-11-17', 3 * 60), starts).key, '2026-11-16');
  assert.equal(pdayAt(atTime('2026-11-18', 16 * 60), starts).key, '2026-11-18');
});

test('долго не спал — автограница не обрывает день, если пробуждение близко', () => {
  const real = [
    { ts: atTime('2026-11-16', 15 * 60), kind: 'wake' },
    { ts: atTime('2026-11-17', 21 * 60), kind: 'wake' }, // лёг в 13:00, встал в 21:00
  ];
  const starts = computeDayStarts({ from: atTime('2026-11-16', 0), to: atTime('2026-11-18', 0), real, boundaryFor: B });
  assert.equal(pdayAt(atTime('2026-11-17', 12 * 60), starts).key, '2026-11-16');
  assert.equal(pdayAt(atTime('2026-11-17', 22 * 60), starts).key, '2026-11-17');
});

test('дробный сон — второе пробуждение через 3 часа не начинает новый день', () => {
  const real = [
    { ts: atTime('2026-11-16', 12 * 60), kind: 'wake' },
    { ts: atTime('2026-11-16', 15 * 60), kind: 'wake' },
  ];
  const starts = computeDayStarts({ from: atTime('2026-11-16', 0), to: atTime('2026-11-17', 0), real, boundaryFor: B });
  const keys = starts.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(pdayAt(atTime('2026-11-16', 16 * 60), starts).start, atTime('2026-11-16', 12 * 60));
});

test('без записей сна — автограницы раз в сутки, ключи уникальны', () => {
  const starts = computeDayStarts({ from: atTime('2026-11-10', 0), to: atTime('2026-11-20', 0), real: [], boundaryFor: B });
  const keys = starts.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(pdayAt(atTime('2026-11-15', 10 * 60), starts).key, '2026-11-14');
  assert.equal(pdayAt(atTime('2026-11-15', 12 * 60), starts).key, '2026-11-15');
});

test('отключённая автограница объединяет дни', () => {
  const starts = computeDayStarts({ from: atTime('2026-11-10', 0), to: atTime('2026-11-20', 0), real: [], boundaryFor: B, suppressed: ['2026-11-15'] });
  assert.equal(pdayAt(atTime('2026-11-15', 20 * 60), starts).key, '2026-11-14');
});

test('пробуждение после полуночи и до полуночи в одну дату — разные ключи', () => {
  const real = [
    { ts: atTime('2026-11-16', 1 * 60), kind: 'wake' },
    { ts: atTime('2026-11-16', 23 * 60), kind: 'wake' },
  ];
  const starts = computeDayStarts({ from: atTime('2026-11-16', 0), to: atTime('2026-11-17', 12 * 60), real, boundaryFor: () => 18 * 60, suppressed: ['2026-11-15', '2026-11-16', '2026-11-17'] });
  const a = pdayAt(atTime('2026-11-16', 2 * 60), starts), b = pdayAt(atTime('2026-11-16', 23 * 60 + 30), starts);
  assert.notEqual(a.key, b.key);
});

test('шаблон по дню недели и исключениям', () => {
  const sch = { weekdays: { 1: 'w', 2: 'w', 3: 'w', 4: 'w', 5: 'w', 6: 'o', 7: 'o' }, overrides: { '2026-11-18': 'v' }, ranges: [{ from: '2026-12-01', to: '2026-12-14', tpl: 'v' }] };
  assert.equal(templateIdFor('2026-11-17', sch), 'w');
  assert.equal(templateIdFor('2026-11-21', sch), 'o');
  assert.equal(templateIdFor('2026-11-18', sch), 'v');
  assert.equal(templateIdFor('2026-12-03', sch), 'v');
});
