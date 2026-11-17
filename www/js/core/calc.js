// Расчёты LIFE OS: питание, тело, сон, тренировки, привычки, статистика.
// Только чистые функции — покрыты тестами (tests/calc.test.js).

import { addDays, daysBetween, weekday, weekStart, monthKey, DAY, minutesOfDay } from './time.js';

export const round = (v, d = 0) => { const p = 10 ** d; return Math.round((Number(v) || 0) * p) / p; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const avg = (arr) => (arr.length ? sum(arr) / arr.length : null);

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function stdev(arr) {
  if (arr.length < 2) return null;
  const a = avg(arr);
  return Math.sqrt(sum(arr, (x) => (x - a) ** 2) / (arr.length - 1));
}

/** Скользящее среднее по последним n точкам (только по реально введённым значениям). */
export function movingAverage(values, n = 7) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const w = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null);
    out.push(w.length ? sum(w) / w.length : null);
  }
  return out;
}

/** Коэффициент корреляции Пирсона; null, если пар меньше 5 или нет разброса. */
export function pearson(pairs) {
  const p = pairs.filter(([x, y]) => x != null && y != null && isFinite(x) && isFinite(y));
  if (p.length < 5) return null;
  const mx = avg(p.map((q) => q[0])), my = avg(p.map((q) => q[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
export function describeCorrelation(r) {
  if (r == null) return 'недостаточно данных';
  const a = Math.abs(r);
  const s = a < 0.1 ? 'связи практически нет' : a < 0.3 ? 'слабая' : a < 0.5 ? 'умеренная' : a < 0.7 ? 'заметная' : 'сильная';
  if (a < 0.1) return s;
  return `${s} ${r > 0 ? 'прямая' : 'обратная'} связь`;
}

// ───────────────────────── Тело ─────────────────────────

export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}
export function bmiCategory(v) {
  if (v == null) return '';
  if (v < 18.5) return 'ниже нормы по ВОЗ';
  if (v < 25) return 'в диапазоне нормы по ВОЗ';
  if (v < 30) return 'избыточная масса по ВОЗ';
  return 'ожирение по классификации ВОЗ';
}
export const BMI_LIMITS = 'ИМТ учитывает только рост и вес. Он не различает мышцы и жир, не учитывает распределение жира, телосложение, возраст и пол. ' +
  'У людей с развитой мускулатурой ИМТ бывает завышен, у людей с малой мышечной массой — занижен. Используйте его как грубый ориентир вместе с объёмом талии и динамикой, а не как диагноз.';

/** Тренд веса: разница средних за последние 7 дней и предыдущие 7 дней. */
export function weightTrend(entries, nowKey) {
  // entries: [{key, value}]
  const last = entries.filter((e) => daysBetween(e.key, nowKey) >= 0 && daysBetween(e.key, nowKey) < 7).map((e) => e.value);
  const prev = entries.filter((e) => daysBetween(e.key, nowKey) >= 7 && daysBetween(e.key, nowKey) < 14).map((e) => e.value);
  if (last.length < 2 || prev.length < 2) return null;
  return { last: avg(last), prev: avg(prev), diff: avg(last) - avg(prev), nLast: last.length, nPrev: prev.length };
}

// ───────────────────────── Питание ─────────────────────────

export const ACTIVITY_LEVELS = [
  { id: 'min', label: 'Минимальная (сидячая работа, без тренировок)', k: 1.2 },
  { id: 'low', label: 'Низкая (1–3 тренировки в неделю или работа на ногах)', k: 1.375 },
  { id: 'mid', label: 'Средняя (3–5 тренировок или физический труд)', k: 1.55 },
  { id: 'high', label: 'Высокая (6–7 тренировок или тяжёлый труд)', k: 1.725 },
  { id: 'vhigh', label: 'Очень высокая (тяжёлый труд + тренировки)', k: 1.9 },
];

/** Базовый обмен по формуле Миффлина — Сан Жеора. */
export function bmr({ sex, weight, height, age }) {
  if (!weight || !height || !age) return null;
  const base = 10 * weight + 6.25 * height - 5 * age;
  return sex === 'f' ? base - 161 : base + 5;
}
export function tdee(profile) {
  const b = bmr(profile);
  if (b == null) return null;
  const lvl = ACTIVITY_LEVELS.find((l) => l.id === profile.activity) || ACTIVITY_LEVELS[1];
  return b * lvl.k;
}

export const SCENARIOS = {
  lose: { label: 'Похудение', kcal: 0.85, protein: 1.8, fat: 0.8 },
  maintain: { label: 'Поддержание веса', kcal: 1.0, protein: 1.4, fat: 0.9 },
  gain: { label: 'Набор мышечной массы', kcal: 1.1, protein: 1.8, fat: 1.0 },
};

/** Рекомендуемые суточные цели по сценарию. Все значения затем можно менять вручную. */
export function nutritionTargets(profile, scenario = 'maintain') {
  const t = tdee(profile);
  if (t == null) return null;
  const sc = SCENARIOS[scenario] || SCENARIOS.maintain;
  let kcal = t * sc.kcal;
  const b = bmr(profile);
  if (scenario === 'lose') kcal = Math.max(kcal, b); // не опускаться ниже базового обмена
  const protein = profile.weight * sc.protein;
  let fat = profile.weight * sc.fat;
  fat = Math.max(fat, (kcal * 0.25) / 9);
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return {
    kcal: round(kcal, -1) || round(kcal), protein: round(protein), fat: round(fat), carbs: round(carbs),
    fiber: 30, sugar: round((kcal * 0.1) / 4), salt: 5,
  };
}

export const NUTRIENTS = ['kcal', 'protein', 'fat', 'carbs', 'sugar', 'fiber', 'salt'];

/** Нутриенты порции: product — значения на 100 г, grams — масса порции. */
export function portion(product, grams) {
  const k = (Number(grams) || 0) / 100;
  const r = {};
  for (const n of NUTRIENTS) r[n] = (Number(product[n]) || 0) * k;
  return r;
}

/** Рецепт: ingredients [{product, grams}], итоговая масса блюда (по умолчанию сумма). */
export function recipePer100(ingredients, cookedWeight) {
  const total = {};
  for (const n of NUTRIENTS) total[n] = 0;
  let raw = 0;
  for (const it of ingredients) {
    if (!it.product) continue;
    const p = portion(it.product, it.grams);
    for (const n of NUTRIENTS) total[n] += p[n];
    raw += Number(it.grams) || 0;
  }
  const w = Number(cookedWeight) > 0 ? Number(cookedWeight) : raw;
  const per100 = {};
  for (const n of NUTRIENTS) per100[n] = w > 0 ? (total[n] / w) * 100 : 0;
  return { total, per100, weight: w };
}

export function sumNutrients(items) {
  const r = {};
  for (const n of NUTRIENTS) r[n] = 0;
  for (const it of items) for (const n of NUTRIENTS) r[n] += Number(it[n]) || 0;
  return r;
}

// ───────────────────────── Сон ─────────────────────────

/** Круговое среднее и разброс времени (минуты суток). */
export function circularStats(minutesList) {
  if (!minutesList.length) return null;
  let sx = 0, sy = 0;
  for (const m of minutesList) { const a = (m / 1440) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
  sx /= minutesList.length; sy /= minutesList.length;
  const R = Math.sqrt(sx * sx + sy * sy);
  let mean = (Math.atan2(sy, sx) / (2 * Math.PI)) * 1440;
  if (mean < 0) mean += 1440;
  const sd = R >= 1 ? 0 : (Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) / (2 * Math.PI)) * 1440;
  return { mean, sd, R };
}

/** Кратчайшая разница двух моментов суток в минутах. */
export function circDiff(a, b) {
  let d = Math.abs(a - b) % 1440;
  return d > 720 ? 1440 - d : d;
}

/**
 * Регулярность сна по основным периодам: разброс середины сна и длительности.
 * sleeps: [{start, end}] (мс). Индекс 0–100: доля ночей, середина которых в пределах ±60 мин от средней.
 */
export function sleepRegularity(sleeps) {
  if (sleeps.length < 3) return null;
  const mids = sleeps.map((s) => minutesOfDay(s.start + (s.end - s.start) / 2));
  const st = circularStats(mids);
  const durs = sleeps.map((s) => (s.end - s.start) / 60000);
  const within = mids.filter((m) => circDiff(m, st.mean) <= 60).length;
  return {
    midMean: st.mean, midSd: st.sd,
    durAvg: avg(durs), durSd: stdev(durs),
    index: Math.round((within / mids.length) * 100), n: sleeps.length,
  };
}

// ───────────────────────── Тренировки ─────────────────────────

/** Оценка 1ПМ по Эпли (для 1–12 повторений). */
export function oneRepMax(weight, reps) {
  if (!weight || !reps) return null;
  if (reps === 1) return weight;
  if (reps > 12) return null;
  return weight * (1 + reps / 30);
}
/** Тоннаж: сумма вес × повторения. */
export function volume(sets) {
  return sum(sets, (s) => (s.weight || 0) * (s.reps || 0));
}
/** Нагрузка сессии (sRPE): длительность (мин) × субъективная тяжесть 1–10. */
export function sessionLoad(durationMin, rpe) {
  if (!durationMin || !rpe) return 0;
  return durationMin * rpe;
}
/** Соотношение острой (7 дн.) и хронической (28 дн., в среднем за неделю) нагрузки. */
export function acwr(loadsByDay, todayKey) {
  // loadsByDay: { key: load }
  let a = 0, c = 0;
  for (let i = 0; i < 28; i++) {
    const v = loadsByDay[addDays(todayKey, -i)] || 0;
    if (i < 7) a += v;
    c += v;
  }
  if (c === 0) return null;
  return a / (c / 4);
}
/** Калории активности через MET: ккал = MET × вес(кг) × часы. */
export function metKcal(met, weightKg, minutes) {
  if (!met || !weightKg || !minutes) return 0;
  return met * weightKg * (minutes / 60);
}

// ───────────────────────── Полезные привычки ─────────────────────────

/**
 * habit.freq: { type: 'daily' | 'weekdays' | 'per_week' | 'per_month' | 'every_n' | 'workdays' | 'offdays',
 *               days?: [1..7], n?: number, start?: 'YYYY-MM-DD' }
 * habit.type: 'check' | 'count' | 'amount' | 'duration' | 'time'; habit.target — цель за день.
 */
export function isScheduled(habit, key, isWorkDay) {
  const f = habit.freq || { type: 'daily' };
  if (habit.startDate && key < habit.startDate) return false;
  switch (f.type) {
    case 'weekdays': return (f.days || []).includes(weekday(key));
    case 'every_n': {
      const st = f.start || habit.startDate || key;
      const d = daysBetween(st, key);
      return d >= 0 && d % Math.max(1, f.n || 1) === 0;
    }
    case 'workdays': return isWorkDay ? !!isWorkDay(key) : true;
    case 'offdays': return isWorkDay ? !isWorkDay(key) : true;
    case 'per_week': case 'per_month': return true; // можно в любой день
    default: return true;
  }
}

export function dayValue(habit, logs) {
  // logs — записи этой привычки за личный день: [{value}]
  if (habit.type === 'check' || habit.type === 'time') return logs.length ? 1 : 0;
  return sum(logs, (l) => l.value);
}
export function isDone(habit, value) {
  if (habit.type === 'check' || habit.type === 'time') return value >= 1;
  const t = Number(habit.target) || 1;
  return value >= t;
}

/**
 * Статистика привычки за период дней keys (по возрастанию), byDay: {key: value}.
 * todayKey — текущий личный день (его невыполнение не обрывает серию).
 */
export function habitStats(habit, keys, byDay, todayKey, isWorkDay) {
  const f = habit.freq || { type: 'daily' };
  if (f.type === 'per_week' || f.type === 'per_month') return periodHabitStats(habit, keys, byDay, todayKey);
  let scheduled = 0, done = 0, cur = 0, best = 0, run = 0;
  const missed = [];
  for (const k of keys) {
    if (!isScheduled(habit, k, isWorkDay)) continue;
    const ok = isDone(habit, byDay[k] || 0);
    if (k === todayKey && !ok) continue; // сегодняшний день ещё не закончен
    scheduled++;
    if (ok) { done++; run++; best = Math.max(best, run); } else { run = 0; missed.push(k); }
  }
  cur = run;
  return { scheduled, done, rate: scheduled ? done / scheduled : null, current: cur, best, missed };
}

function periodHabitStats(habit, keys, byDay, todayKey) {
  const f = habit.freq;
  const n = Math.max(1, f.n || 1);
  const groupOf = f.type === 'per_week' ? weekStart : monthKey;
  const groups = new Map();
  for (const k of keys) {
    if (habit.startDate && k < habit.startDate) continue;
    const g = groupOf(k);
    if (!groups.has(g)) groups.set(g, 0);
    if (isDone(habit, byDay[k] || 0)) groups.set(g, groups.get(g) + 1);
  }
  const curG = groupOf(todayKey);
  let scheduled = 0, done = 0, run = 0, best = 0;
  const missed = [];
  for (const [g, cnt] of groups) {
    const ok = cnt >= n;
    if (g === curG && !ok) continue;
    scheduled++;
    if (ok) { done++; run++; best = Math.max(best, run); } else { run = 0; missed.push(g); }
  }
  return { scheduled, done, rate: scheduled ? done / scheduled : null, current: run, best, missed, unit: f.type === 'per_week' ? 'нед.' : 'мес.', curCount: groups.get(curG) || 0, need: n };
}

// ───────────────────────── Вредные привычки ─────────────────────────

/**
 * bad = { startDate, baselinePerDay, costPerUnit, strategy: 'quit'|'reduce'|'frequency'|'limit',
 *         targetPerDay?, targetDate?, maxPerWeek?, limitPerDay? }
 * uses = [{ts, amount, cost?}] — эпизоды употребления/срывы.
 * nowTs — текущий момент.
 */
export function badHabitStats(bad, uses, nowTs, dayKeyOf) {
  const sorted = [...uses].sort((a, b) => a.ts - b.ts);
  const startKey = bad.startDate;
  const nowKey = dayKeyOf(nowTs);
  const startTs = bad.startTs || (startKey ? new Date(startKey + 'T00:00').getTime() : (sorted[0] ? sorted[0].ts : nowTs));
  const daysTotal = Math.max(0, daysBetween(startKey || dayKeyOf(startTs), nowKey) + 1);
  const after = sorted.filter((u) => u.ts >= startTs);
  const last = after[after.length - 1];
  const sinceLastMs = nowTs - (last ? last.ts : startTs);

  // периоды воздержания (между эпизодами), в мс
  const points = [startTs, ...after.map((u) => u.ts), nowTs];
  const gaps = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i] - points[i - 1]);
  const longestMs = gaps.length ? Math.max(...gaps) : 0;

  const byDay = {};
  for (const u of after) { const k = dayKeyOf(u.ts); byDay[k] = (byDay[k] || 0) + (Number(u.amount) || 1); }
  const spent = sum(after, (u) => (u.cost != null && u.cost !== '' ? Number(u.cost) : (Number(u.amount) || 1) * (Number(bad.costPerUnit) || 0)));
  const totalAmount = sum(after, (u) => Number(u.amount) || 1);
  const baselineAmount = (Number(bad.baselinePerDay) || 0) * daysTotal;
  const baselineCost = baselineAmount * (Number(bad.costPerUnit) || 0);
  const saved = baselineCost - spent;
  const avoided = baselineAmount - totalAmount;

  const last7 = [], last30 = [];
  for (let i = 0; i < 30; i++) {
    const k = addDays(nowKey, -i);
    if (startKey && k < startKey) break;
    const v = byDay[k] || 0;
    if (i < 7) last7.push(v);
    last30.push(v);
  }
  const avg7 = last7.length ? sum(last7) / last7.length : 0;
  const cleanDays30 = last30.filter((v) => v === 0).length;
  const reduction = bad.baselinePerDay > 0 ? 1 - avg7 / bad.baselinePerDay : null;

  return {
    daysTotal, sinceLastMs, longestMs, spent, saved, avoided, totalAmount, episodes: after.length,
    avg7, cleanDays30, days30: last30.length, reduction, byDay, lastTs: last ? last.ts : null,
    todayAmount: byDay[nowKey] || 0, todayLimit: dailyLimit(bad, nowKey),
  };
}

/** Допустимое количество на день по стратегии (null — нет ограничения на день). */
export function dailyLimit(bad, key) {
  switch (bad.strategy) {
    case 'quit': return 0;
    case 'limit': return Number(bad.limitPerDay) || 0;
    case 'reduce': {
      const base = Number(bad.baselinePerDay) || 0, target = Number(bad.targetPerDay) || 0;
      if (!bad.startDate || !bad.targetDate || bad.targetDate <= bad.startDate) return target;
      const total = daysBetween(bad.startDate, bad.targetDate);
      const passed = clamp(daysBetween(bad.startDate, key), 0, total);
      return round(base - ((base - target) * passed) / total, 1);
    }
    default: return null;
  }
}

/** Частота триггеров и часов употребления. */
export function triggerAnalysis(uses) {
  const triggers = {}, hours = new Array(24).fill(0);
  for (const u of uses) {
    for (const t of u.triggers || (u.trigger ? [u.trigger] : [])) triggers[t] = (triggers[t] || 0) + 1;
    hours[new Date(u.ts).getHours()]++;
  }
  return { triggers: Object.entries(triggers).sort((a, b) => b[1] - a[1]), hours };
}

// ───────────────────────── Общий индекс прогресса ─────────────────────────

/**
 * directions: [{id, label, weight, rate}] — rate: доля дней 0..1 с выполненной целью (null — нет данных).
 * Направления без данных исключаются из расчёта (а не считаются нулём).
 */
export function progressIndex(directions) {
  const used = directions.filter((d) => d.rate != null && d.weight > 0);
  const w = sum(used, (d) => d.weight);
  if (!w) return null;
  return Math.round((sum(used, (d) => d.rate * d.weight) / w) * 100);
}

// ───────────────────────── Валидация ─────────────────────────

export function num(v, { min = -Infinity, max = Infinity, required = false } = {}) {
  if (v === '' || v == null) return required ? { ok: false, error: 'Заполните поле' } : { ok: true, value: null };
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n)) return { ok: false, error: 'Нужно число' };
  if (n < min) return { ok: false, error: `Не меньше ${min}` };
  if (n > max) return { ok: false, error: `Не больше ${max}` };
  return { ok: true, value: n };
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export { DAY };
