// Время, даты и система «личного дня».
// Чистые функции без DOM — покрыты тестами (tests/time.test.js).

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const pad = (n) => String(n).padStart(2, '0');

/** Календарная дата (локальное время) в виде 'YYYY-MM-DD'. */
export function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Локальная полночь даты 'YYYY-MM-DD' в мс. */
export function keyToTs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n).getTime());
}

export function daysBetween(a, b) {
  // количество календарных дней от a до b (b - a)
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

/** День недели 1..7 (Пн=1 … Вс=7) для ключа даты. */
export function weekday(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 ? 7 : w;
}

/** 'HH:MM' → минуты от полуночи. Пустое/некорректное → null. */
export function hmToMin(s) {
  if (s == null || s === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function minToHm(min) {
  if (min == null || isNaN(min)) return '';
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
}

/** Метка времени: дата + минуты (минуты могут быть ≥1440 или <0). */
export function atTime(key, minutes) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, minutes).getTime();
}

export function tsToHm(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function minutesOfDay(ts) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** Продолжительность в минутах; если конец раньше начала по часам — переход через полночь. */
export function spanMinutes(startMin, endMin) {
  if (startMin == null || endMin == null) return null;
  let d = endMin - startMin;
  if (d <= 0) d += 1440;
  return d;
}

/** Окно [start,end) в минутах суток содержит минуту m (с учётом перехода через полночь). */
export function inWindow(m, startMin, endMin) {
  if (startMin == null || endMin == null || startMin === endMin) return false;
  if (startMin < endMin) return m >= startMin && m < endMin;
  return m >= startMin || m < endMin;
}

export function fmtDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return '—';
  const m = Math.round(minutes);
  const h = Math.floor(Math.abs(m) / 60), r = Math.abs(m) % 60;
  const s = m < 0 ? '−' : '';
  if (h === 0) return `${s}${r} мин`;
  return r ? `${s}${h} ч ${r} мин` : `${s}${h} ч`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WD_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WD_FULL = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export function fmtDate(key, withWd = false) {
  const [y, m, d] = key.split('-').map(Number);
  const s = `${d} ${MONTHS[m - 1]}`;
  return withWd ? `${WD_SHORT[weekday(key)]}, ${s}` : s;
}
export function fmtDateShort(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}
export function fmtDateTime(ts) {
  return `${fmtDateShort(dateKey(ts))} ${tsToHm(ts)}`;
}
/** Значение для <input type="datetime-local"> */
export function toLocalInput(ts) {
  const d = new Date(ts);
  return `${dateKey(ts)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

// ───────────────────────── Шаблоны режима ─────────────────────────

/**
 * schedule = { weekdays: {1:'tplId',…,7:'tplId'}, overrides: {'YYYY-MM-DD': 'tplId'},
 *              ranges: [{from:'YYYY-MM-DD', to:'YYYY-MM-DD', tpl:'tplId'}] }
 */
export function templateIdFor(key, schedule) {
  if (!schedule) return null;
  if (schedule.overrides && schedule.overrides[key]) return schedule.overrides[key];
  for (const r of schedule.ranges || []) {
    if (r.from <= key && key <= r.to) return r.tpl;
  }
  return (schedule.weekdays || {})[weekday(key)] || null;
}

export function templateFor(key, schedule, templates) {
  const id = templateIdFor(key, schedule);
  return (templates || []).find((t) => t.id === id) || (templates || [])[0] || null;
}

/**
 * Автоматическая граница личного дня для даты — середина планового сна шаблона.
 * Для сна 07:00–15:00 это 11:00, для 23:00–07:00 — 03:00.
 * Если сон в шаблоне не задан — fallbackMin (по умолчанию 04:00).
 */
export function boundaryMinutes(tpl, fallbackMin = 240) {
  const s = hmToMin(tpl && tpl.sleepStart), e = hmToMin(tpl && tpl.sleepEnd);
  if (s == null || e == null) return fallbackMin;
  const len = spanMinutes(s, e);
  return (s + Math.floor(len / 2)) % 1440;
}

// ───────────────────────── Личный день ─────────────────────────
//
// Личный день начинается с пробуждения после основного сна (или с ручной отметки
// «новый день»). Если пробуждение не записано, используется автоматическая граница
// (середина планового сна) — чтобы день не растягивался бесконечно.
//
// Правила:
//  1. Реальные старты: пробуждения после основного сна + ручные старты.
//     Старт ближе MIN_GAP_REAL к предыдущему принятому — игнорируется
//     (дробный сон, ошибочное нажатие).
//  2. Автограница принимается, только если с предыдущего старта прошло ≥ AUTO_AFTER
//     и до следующего реального старта ≥ AUTO_BEFORE (иначе этот день и так
//     начнётся с реального пробуждения). Автограницы можно отключать вручную (suppressed).
//  3. Ключ дня = календарная дата старта; при совпадении с предыдущим — следующая дата.

export const MIN_GAP_REAL = 6 * HOUR;
export const AUTO_AFTER = 16 * HOUR;
export const AUTO_BEFORE = 12 * HOUR;

/**
 * @param {object} o
 * @param {number} o.from, o.to — интервал, для которого нужны старты
 * @param {Array<{ts:number, kind:string}>} o.real — пробуждения/ручные старты
 * @param {(key:string)=>number} o.boundaryFor — минуты автограницы для даты
 * @param {Set<string>|string[]} [o.suppressed] — даты, где автограница отключена
 * @returns {Array<{ts:number,key:string,kind:string}>}
 */
export function computeDayStarts({ from, to, real = [], boundaryFor, suppressed }) {
  const sup = suppressed instanceof Set ? suppressed : new Set(suppressed || []);
  const lo = from - 4 * DAY, hi = to + 2 * DAY;
  const reals = real.filter((r) => r.ts >= lo && r.ts <= hi).sort((a, b) => a.ts - b.ts);
  const autos = [];
  for (let k = dateKey(lo); k <= dateKey(hi); k = addDays(k, 1)) {
    if (sup.has(k)) continue;
    const ts = atTime(k, boundaryFor ? boundaryFor(k) : 240);
    if (ts >= lo && ts <= hi) autos.push({ ts, kind: 'auto' });
  }
  const events = [...reals.map((r) => ({ ts: r.ts, kind: r.kind || 'wake' })), ...autos].sort((a, b) => a.ts - b.ts || (a.kind === 'auto') - (b.kind === 'auto'));
  const accepted = [];
  let ri = 0; // индекс следующего реального старта
  for (const ev of events) {
    const last = accepted[accepted.length - 1];
    if (ev.kind === 'auto') {
      while (ri < reals.length && reals[ri].ts <= ev.ts) ri++;
      const next = reals[ri];
      if (last && ev.ts - last.ts < AUTO_AFTER) continue;
      if (next && next.ts - ev.ts < AUTO_BEFORE) continue;
      accepted.push({ ts: ev.ts, kind: 'auto' });
    } else {
      if (last && ev.ts - last.ts < MIN_GAP_REAL) {
        // если предыдущий старт был автоматическим — реальный пробуждение важнее
        if (last.kind === 'auto') { accepted[accepted.length - 1] = { ts: ev.ts, kind: ev.kind }; }
        continue;
      }
      accepted.push({ ts: ev.ts, kind: ev.kind });
    }
  }
  let prevKey = null;
  for (const a of accepted) {
    let k = dateKey(a.ts);
    if (prevKey && k <= prevKey) k = addDays(prevKey, 1);
    a.key = k;
    prevKey = k;
  }
  return accepted;
}

/** Личный день, к которому относится момент ts. */
export function pdayAt(ts, starts) {
  let lo = 0, hi = starts.length - 1, idx = -1;
  while (lo <= hi) { // двоичный поиск последнего старта ≤ ts
    const mid = (lo + hi) >> 1;
    if (starts[mid].ts <= ts) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return null;
  const s = starts[idx];
  const next = starts[idx + 1];
  return { key: s.key, start: s.ts, end: next ? next.ts : null, kind: s.kind };
}

/** Диапазон личного дня по ключу. */
export function pdayRange(key, starts) {
  const i = starts.findIndex((s) => s.key === key);
  if (i < 0) return null;
  return { key, start: starts[i].ts, end: starts[i + 1] ? starts[i + 1].ts : null, kind: starts[i].kind };
}

/** Список ключей личных дней, пересекающихся с периодом [from, to]. */
export function pdaysInPeriod(from, to, starts) {
  const res = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], e = starts[i + 1] ? starts[i + 1].ts : Infinity;
    if (e > from && s.ts <= to) res.push(s.key);
  }
  return res;
}

/** Ключи календарных дат от a до b включительно. */
export function keyRange(a, b) {
  const out = [];
  for (let k = a; k <= b; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Начало недели (понедельник) для ключа. */
export function weekStart(key) {
  return addDays(key, 1 - weekday(key));
}
export function monthKey(key) { return key.slice(0, 7); }
