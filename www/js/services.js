// Фоновые службы: локальные напоминания, достижения, автокопирование.

import { S } from './data/store.js';
import { occurrences } from './core/remind.js';
import { scheduleAll, isNative } from './native.js';
import { autoBackupIfDue } from './data/backup.js';
import { ACHIEVEMENTS } from './data/seed.js';
import { addDays, dateKey, atTime, hmToMin, DAY } from './core/time.js';
import { habitStats, badHabitStats } from './core/calc.js';
import { waterDay } from './summary.js';
import { toast } from './ui/dom.js';

/** Все источники напоминаний → единый список. */
export function collectReminders() {
  const list = [];
  for (const r of S.defs('reminder')) list.push({ ...r, source: 'Напоминание' });
  const w = S.settings.water.remind;
  if (w && w.on && S.settings.modules.water !== false) list.push({ id: 'water', enabled: true, mode: 'interval', every: w.every || 120, from: w.from || '', to: w.to || '', text: 'Время выпить воды 💧', source: 'Вода' });
  for (const hb of S.defs('habit')) {
    if (hb.archived || !hb.remind || !hb.remind.on) continue;
    const days = hb.freq && hb.freq.type === 'weekdays' ? hb.freq.days : null;
    const dayType = hb.freq && hb.freq.type === 'workdays' ? 'work' : hb.freq && hb.freq.type === 'offdays' ? 'off' : 'any';
    list.push({ id: 'h_' + hb.id, enabled: true, mode: hb.remind.mode || 'time', time: hb.remind.time, offset: hb.remind.offset, days, dayType, text: `${hb.icon || '✅'} ${hb.name}`, source: 'Привычка' });
  }
  for (const m of S.defs('med')) {
    if (m.archived || !m.remind) continue;
    for (const t of m.times || []) list.push({ id: 'm_' + m.id + t, enabled: true, important: true, mode: 'time', time: t, text: `💊 ${m.name}${m.dose ? ' — ' + m.dose : ''}`, source: 'Лекарства' });
  }
  for (const g of S.defs('goal')) {
    if (g.done || !g.remindDate) continue;
    list.push({ id: 'g_' + g.id, enabled: true, mode: 'time', time: g.remindTime || '16:00', once: g.remindDate, text: `🎯 Цель: ${g.name}`, source: 'Цель' });
  }
  return list;
}

function mealOccurrences(fromTs, days) {
  const res = [];
  if (!S.settings.mealRemind || S.settings.modules.food === false) return res;
  for (let i = -1; i <= days; i++) {
    const key = addDays(dateKey(fromTs), i);
    const tpl = S.template(key);
    const wake = hmToMin(tpl && tpl.sleepEnd);
    for (const m of (tpl && tpl.meals) || []) {
      let min = hmToMin(m.time);
      if (min == null) continue;
      if (wake != null && min < wake) min += 1440; // приём пищи после полуночи относится к этому же личному дню
      const ts = atTime(key, min);
      if (ts > fromTs) res.push({ at: ts, text: `🍽 ${m.name}` });
    }
  }
  return res;
}

export function upcoming(days = 2) {
  const now = Date.now();
  const opts = { fromTs: now, days, schedule: S.settings.schedule, templates: S.settings.templates, quiet: S.settings.quiet };
  const items = [];
  for (const r of collectReminders()) for (const at of occurrences(r, opts)) items.push({ at, text: r.text, source: r.source, important: !!r.important });
  if (!S.settings.quiet.all && !S.settings.quiet.importantOnly) {
    for (const m of mealOccurrences(now, days)) {
      const blocked = occurrences({ enabled: true, mode: 'time', time: new Date(m.at).toTimeString().slice(0, 5), once: dateKey(m.at) }, { ...opts, fromTs: m.at - 1000, days: 1 }).length === 0;
      if (!blocked) items.push({ ...m, source: 'Питание' });
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

async function reschedule() {
  const items = upcoming(7).filter((x) => x.at <= Date.now() + 7 * DAY).slice(0, 400);
  try {
    await scheduleAll(items.map((x, i) => ({ id: i + 1, title: 'LIFE OS', body: x.text, at: x.at })));
  } catch (e) { console.warn('Уведомления не запланированы', e); }
}

// ── Достижения ──
export function computeAchievements() {
  const got = {};
  const total = S.logsMap.size;
  if (total) got.first_entry = true;
  const days = S.groupByDay('water');
  let wd = 0;
  for (const k of Object.keys(days)) if (waterDay(k).ml >= S.settings.water.goal) wd++;
  if (wd >= 1) got.water_goal = true;
  if (wd >= 7) got.water_7 = true;
  if (S.logs('sleep').filter((s) => s.end).length >= 7) got.sleep_log_7 = true;
  const w = S.logs('workout').filter((x) => x.end).length;
  if (w >= 1) got.workout_1 = true;
  if (w >= 10) got.workout_10 = true;
  if (S.logs('weight').length >= 10) got.weigh_10 = true;
  if (S.logs('mood').length >= 7) got.mood_7 = true;
  if (S.defs('goal').some((g) => g.done)) got.goal_done = true;
  if (S.settings.backup.last) got.backup = true;
  const cur = S.cur().key;
  const keys = S.lastDays(400);
  for (const hb of S.defs('habit')) {
    const byDay = {};
    const g = S.groupByDay('habitlog', (l) => l.ref === hb.id);
    for (const k of Object.keys(g)) byDay[k] = g[k].reduce((a, l) => a + (Number(l.value) || 1), 0);
    if (!Object.keys(byDay).length) continue;
    const st = habitStats(hb, keys, byDay, cur, (k) => S.isWorkDay(k));
    if (st.best >= 7) got.habit_7 = true;
    if (st.best >= 30) got.habit_30 = true;
  }
  for (const b of S.defs('bad')) {
    const st = badHabitStats(b, S.logs('baduse').filter((u) => u.ref === b.id && u.type !== 'craving'), Date.now(), (ts) => S.pdayOf(ts).key);
    const best = Math.max(st.longestMs, st.sinceLastMs);
    if (best >= DAY) got.clean_1 = true;
    if (best >= 7 * DAY) got.clean_7 = true;
    if (best >= 30 * DAY) got.clean_30 = true;
  }
  return got;
}

async function checkAchievements() {
  const got = computeAchievements();
  const have = S.settings.achievements || {};
  const fresh = Object.keys(got).filter((k) => !have[k]);
  if (!fresh.length) return;
  const upd = { ...have };
  for (const k of fresh) upd[k] = Date.now();
  await S.setSetting('achievements', upd);
  const a = ACHIEVEMENTS.find((x) => x.id === fresh[0]);
  if (a && Object.keys(have).length) toast(`${a.icon} Достижение: ${a.name}`);
}

let t1 = null, t2 = null;
export const services = {
  start() {
    reschedule();
    setTimeout(() => checkAchievements(), 1500);
    setTimeout(() => autoBackupIfDue().catch((e) => console.warn(e)), 4000);
    // пересчёт напоминаний раз в 6 часов (окно — 7 дней вперёд)
    setInterval(reschedule, 6 * 3600e3);
  },
  changed() {
    clearTimeout(t1); t1 = setTimeout(reschedule, 1500);
    clearTimeout(t2); t2 = setTimeout(checkAchievements, 2500);
  },
  resume() { reschedule(); autoBackupIfDue().catch(() => {}); },
  reschedule,
  isNative,
};
