// Расчёт моментов срабатывания напоминаний с учётом режима сна/работы и тихих режимов.

import { addDays, atTime, dateKey, hmToMin, inWindow, minutesOfDay, weekday, spanMinutes, templateFor } from './time.js';

/**
 * reminder = {
 *   id, text, enabled, important,
 *   mode: 'time' | 'interval' | 'wake' | 'sleep',
 *   time: 'HH:MM'            — для mode 'time'
 *   every: минуты, from:'HH:MM', to:'HH:MM' — для 'interval' (пустые from/to = время бодрствования по режиму)
 *   offset: минуты          — для 'wake' (после планового пробуждения) и 'sleep' (до планового отхода ко сну)
 *   days: [1..7] | null      — дни недели (null — все)
 *   dayType: 'any'|'work'|'off'
 *   once: 'YYYY-MM-DD' | null — разовое
 * }
 * quiet = { all:bool, sleep:bool, work:bool, importantOnly:bool }
 */
export function occurrences(reminder, { fromTs, days = 7, schedule, templates, quiet = {}, isWorkTpl }) {
  if (!reminder.enabled || quiet.all) return [];
  if (quiet.importantOnly && !reminder.important) return [];
  const out = [];
  const startKey = addDays(dateKey(fromTs), -1);
  for (let i = 0; i <= days; i++) {
    const key = addDays(startKey, i);
    if (reminder.once && reminder.once !== key) continue;
    if (reminder.days && reminder.days.length && !reminder.days.includes(weekday(key))) continue;
    const tpl = templateFor(key, schedule, templates);
    const work = tpl ? (isWorkTpl ? isWorkTpl(tpl) : !!tpl.isWork) : false;
    if (reminder.dayType === 'work' && !work) continue;
    if (reminder.dayType === 'off' && work) continue;
    for (const ts of rawTimes(reminder, key, tpl)) {
      if (ts < fromTs) continue;
      if (blocked(ts, quiet, reminder, schedule, templates)) continue;
      out.push(ts);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function rawTimes(r, key, tpl) {
  const wake = hmToMin(tpl && tpl.sleepEnd);
  const bed = hmToMin(tpl && tpl.sleepStart);
  switch (r.mode) {
    case 'time': {
      const m = hmToMin(r.time);
      return m == null ? [] : [atTime(key, m)];
    }
    case 'wake':
      return wake == null ? [] : [atTime(key, wake + (Number(r.offset) || 0))];
    case 'sleep': {
      if (bed == null) return [];
      // отход ко сну относится к «дню», начавшемуся с пробуждения этой даты
      const base = wake != null && bed <= wake ? bed + 1440 : bed;
      return [atTime(key, base - (Number(r.offset) || 0))];
    }
    case 'interval': {
      const every = Math.max(15, Number(r.every) || 120);
      let from = hmToMin(r.from), to = hmToMin(r.to);
      if (from == null || to == null) { from = wake; to = bed; }
      if (from == null || to == null) return [];
      const len = spanMinutes(from, to);
      const res = [];
      for (let m = every; m < len; m += every) res.push(atTime(key, from + m));
      return res;
    }
    default: return [];
  }
}

function blocked(ts, quiet, r, schedule, templates) {
  const m = minutesOfDay(ts);
  // окно действия напоминаний из шаблона режима (важные — проходят всегда)
  const own = templateFor(dateKey(ts), schedule, templates);
  if (!r.important && own && own.remindFrom && own.remindTo) {
    const f = hmToMin(own.remindFrom), t = hmToMin(own.remindTo);
    if (f != null && t != null && f !== t && !inWindow(m, f, t)) return true;
  }
  if (!quiet.sleep && !quiet.work) return false;
  // проверяем шаблон этой и предыдущей даты (окна через полночь)
  for (const k of [dateKey(ts), addDays(dateKey(ts), -1)]) {
    const tpl = templateFor(k, schedule, templates);
    if (!tpl) continue;
    const s = hmToMin(tpl.sleepStart), e = hmToMin(tpl.sleepEnd);
    const ws = hmToMin(tpl.workStart), we = hmToMin(tpl.workEnd);
    const sameDay = k === dateKey(ts);
    if (quiet.sleep && s != null && e != null && windowHits(m, s, e, sameDay)) return true;
    if (quiet.work && tpl.isWork && ws != null && we != null && windowHits(m, ws, we, sameDay)) return true;
  }
  return false;
}

// окно, начавшееся в дату k: в «тот же день» — часть до полуночи (или целиком), в «следующий» — хвост после полуночи
function windowHits(m, s, e, sameDay) {
  if (s < e) return sameDay && m >= s && m < e;
  return sameDay ? m >= s : m < e;
}

export { inWindow };
