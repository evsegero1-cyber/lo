// Высокоуровневое хранилище: всё держится в памяти и сразу записывается в IndexedDB.

import * as db from './db.js';
import { seedProducts, seedExercises, seedDrinks, seedTemplates, seedHygiene } from './seed.js';
import { computeDayStarts, pdayAt, templateFor, boundaryMinutes, DAY, HOUR, dateKey, addDays, keyRange } from '../core/time.js';

export const DASHBOARD_CARDS = [
  { id: 'progress', title: 'Прогресс дня' },
  { id: 'tasks', title: 'Задачи на день' },
  { id: 'water', title: 'Вода' },
  { id: 'food', title: 'Питание' },
  { id: 'sleep', title: 'Сон' },
  { id: 'activity', title: 'Активность' },
  { id: 'habits', title: 'Полезные привычки' },
  { id: 'bad', title: 'Вредные привычки' },
  { id: 'weight', title: 'Вес' },
  { id: 'mood', title: 'Самочувствие' },
  { id: 'meds', title: 'Лекарства' },
  { id: 'goals', title: 'Цели' },
];

export const MODULES = [
  { id: 'water', name: 'Вода' }, { id: 'food', name: 'Питание' }, { id: 'sleep', name: 'Сон' }, { id: 'body', name: 'Вес и тело' },
  { id: 'workouts', name: 'Тренировки' }, { id: 'activity', name: 'Активность (кардио, шаги)' }, { id: 'back', name: 'Спина и мобильность' },
  { id: 'recovery', name: 'Восстановление' }, { id: 'habits', name: 'Полезные привычки' }, { id: 'hygiene', name: 'Гигиена и уход' },
  { id: 'bad', name: 'Вредные привычки' }, { id: 'mind', name: 'Самочувствие и психика' }, { id: 'health', name: 'Здоровье и профилактика' },
  { id: 'goals', name: 'Цели и достижения' },
];

export function defaultSettings() {
  return {
    version: 1,
    onboarded: false,
    profile: { name: '', sex: 'm', birthYear: null, height: null, activity: 'low' },
    units: { weight: 'kg', volume: 'ml', length: 'cm', energy: 'kcal' },
    modules: Object.fromEntries(MODULES.map((m) => [m.id, true])),
    moduleNames: {},
    dashboard: { cards: DASHBOARD_CARDS.map((c) => ({ id: c.id, on: !['meds', 'goals'].includes(c.id) })), titles: {}, showClock: true },
    water: { goal: 2000, quick: [100, 200, 300, 500, 1000], defaultDrink: 'd_water' },
    food: { scenario: 'maintain', targets: { kcal: 2200, protein: 110, fat: 70, carbs: 270, fiber: 30, sugar: 50, salt: 5 }, vegGoal: 5, showSugar: true, showSalt: true, showFiber: true },
    sleep: { goalMin: 480 },
    body: { goal: 'lose', target: null, metrics: [
      { id: 'waist', name: 'Талия', unit: 'cm' }, { id: 'chest', name: 'Грудь', unit: 'cm' }, { id: 'arm', name: 'Рука (бицепс)', unit: 'cm' },
      { id: 'hips', name: 'Бёдра', unit: 'cm' }, { id: 'fat', name: 'Процент жира', unit: '%' },
    ] },
    activity: { stepsGoal: null, weeklyWorkouts: null, weeklyMinutes: null },
    restrictions: { risks: [], excluded: [], note: '' },
    templates: seedTemplates(),
    schedule: { weekdays: { 1: 't_work', 2: 't_work', 3: 't_work', 4: 't_work', 5: 't_work', 6: 't_off', 7: 't_off' }, overrides: {}, ranges: [] },
    pday: { suppressed: [] },
    quiet: { all: false, sleep: true, work: false, importantOnly: false },
    charts: { style: 'line', smooth: true, ma: true },
    progress: { water: 1, food: 1, sleep: 1, habits: 1, bad: 1, workouts: 1, mood: 0 },
    vitals: { show: false, types: [
      { id: 'pulse', name: 'Пульс', unit: 'уд/мин', on: true }, { id: 'bp', name: 'Давление', unit: 'мм рт. ст.', on: true, two: true },
      { id: 'temp', name: 'Температура', unit: '°C', on: true },
    ] },
    backup: { auto: 'daily', last: null, lastAuto: null },
    achievements: {},
  };
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over !== undefined ? over : base;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const r = { ...base };
    for (const k of Object.keys(over)) r[k] = deepMerge(base[k], over[k]);
    return r;
  }
  return over !== undefined ? over : base;
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

class Store {
  constructor() {
    this.settings = defaultSettings();
    this.defsMap = new Map();
    this.logsMap = new Map();
    this.byKind = new Map();
    this.listeners = new Set();
    this.startsCache = null;
    this.ready = false;
  }

  async init() {
    const [kv, defs, logs] = await Promise.all([db.getAll('kv'), db.getAll('defs'), db.getAll('logs')]);
    const s = kv.find((x) => x.k === 'settings');
    const fresh = !s;
    this.settings = deepMerge(defaultSettings(), s ? s.v : {});
    for (const d of defs) this.defsMap.set(d.id, d);
    for (const l of logs) this.logsMap.set(l.id, l);
    if (fresh) await this.seed();
    this.reindex();
    this.ready = true;
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* не критично */ }
  }

  async seed() {
    const all = [...seedProducts(), ...seedExercises(), ...seedDrinks(), ...seedHygiene()];
    for (const d of all) this.defsMap.set(d.id, d);
    await db.putMany('defs', all);
    await this.saveSettings({});
  }

  reindex(kind) {
    if (kind) { this.byKind.delete(kind); return; }
    this.byKind.clear();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (e) { console.error(e); } } }

  // ── настройки ──
  async saveSettings(patch) {
    this.settings = deepMerge(this.settings, patch);
    await db.put('kv', { k: 'settings', v: this.settings });
    if (patch.templates || patch.schedule || patch.pday) this.startsCache = null;
    this.emit({ type: 'settings' });
  }
  /** Полная замена ветки настроек (для массивов и удаления ключей). */
  async setSetting(path, value) {
    const parts = path.split('.');
    let o = this.settings;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = value;
    await db.put('kv', { k: 'settings', v: this.settings });
    if (/^(templates|schedule|pday)/.test(path)) this.startsCache = null;
    this.emit({ type: 'settings' });
  }

  // ── определения (продукты, привычки, упражнения…) ──
  defs(kind, { all = false } = {}) {
    const r = [];
    for (const d of this.defsMap.values()) if (d.kind === kind && (all || !d.deleted)) r.push(d);
    return r.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  }
  def(id) { return this.defsMap.get(id) || null; }
  async putDef(d) {
    if (!d.id) d.id = uid(d.kind[0] + '_');
    d.updated = Date.now();
    this.defsMap.set(d.id, d);
    await db.put('defs', d);
    this.emit({ type: 'def', kind: d.kind });
    return d;
  }
  async delDef(id) {
    const d = this.defsMap.get(id);
    this.defsMap.delete(id);
    await db.del('defs', id);
    this.emit({ type: 'def', kind: d && d.kind });
  }

  // ── записи ──
  logs(kind) {
    if (!this.byKind.has(kind)) {
      const arr = [];
      for (const l of this.logsMap.values()) if (l.kind === kind) arr.push(l);
      arr.sort((a, b) => a.ts - b.ts);
      this.byKind.set(kind, arr);
    }
    return this.byKind.get(kind);
  }
  logsBetween(kind, from, to, ref) {
    const arr = this.logs(kind);
    const r = [];
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].ts < from) lo = m + 1; else hi = m; } // двоичный поиск
    for (let i = lo; i < arr.length; i++) {
      const l = arr[i];
      if (to != null && l.ts >= to) break;
      if (ref && l.ref !== ref) continue;
      r.push(l);
    }
    return r;
  }
  log(id) { return this.logsMap.get(id) || null; }
  async putLog(l) {
    if (!l.id) l.id = uid(l.kind.slice(0, 2) + '_');
    if (l.ts == null) l.ts = Date.now();
    l.tz = -new Date(l.ts).getTimezoneOffset();
    l.date = dateKey(l.ts); // календарная дата — для истории и аналитики
    l.updated = Date.now();
    this.logsMap.set(l.id, l);
    this.reindex(l.kind);
    if (l.kind === 'sleep' || l.kind === 'daystart') this.startsCache = null;
    await db.put('logs', l);
    this.emit({ type: 'log', kind: l.kind });
    return l;
  }
  async delLog(id) {
    const l = this.logsMap.get(id);
    if (!l) return;
    this.logsMap.delete(id);
    this.reindex(l.kind);
    if (l.kind === 'sleep' || l.kind === 'daystart') this.startsCache = null;
    await db.del('logs', id);
    if (l.blobs) for (const b of l.blobs) await db.del('blobs', b);
    this.emit({ type: 'log', kind: l.kind });
  }

  // ── файлы (фото) ──
  async putBlob(data) { const id = uid('b_'); await db.put('blobs', { id, data }); return id; }
  async getBlob(id) { const b = await db.get('blobs', id); return b ? b.data : null; }
  async delBlob(id) { await db.del('blobs', id); }

  // ── режим и личный день ──
  template(key) { return templateFor(key, this.settings.schedule, this.settings.templates); }
  isWorkDay(key) { const t = this.template(key); return !!(t && t.isWork); }

  realStarts() {
    const r = [];
    for (const s of this.logs('sleep')) if (s.main && s.end) r.push({ ts: s.end, kind: 'wake' });
    for (const d of this.logs('daystart')) r.push({ ts: d.ts, kind: 'manual' });
    return r;
  }

  starts() {
    const now = Date.now();
    if (this.startsCache && this.startsCache.to > now + HOUR) return this.startsCache.list;
    let from = now - 60 * DAY;
    for (const kind of ['water', 'food', 'sleep', 'habitlog', 'weight', 'baduse', 'workout', 'mood']) {
      const a = this.logs(kind);
      if (a.length && a[0].ts < from) from = a[0].ts;
    }
    const to = now + 2 * DAY;
    const list = computeDayStarts({
      from, to, real: this.realStarts(),
      boundaryFor: (k) => boundaryMinutes(this.template(k)),
      suppressed: this.settings.pday.suppressed || [],
    });
    this.startsCache = { list, from, to, idx: new Map(list.map((x, i) => [x.key, i])) };
    return list;
  }
  pdayOf(ts) {
    const st = this.starts();
    return pdayAt(ts, st) || { key: dateKey(ts), start: ts, end: null, kind: 'auto' };
  }
  cur() { return this.pdayOf(Date.now()); }
  range(key) {
    const st = this.starts();
    const i = this.startsCache.idx.get(key);
    if (i != null) return { key, start: st[i].ts, end: st[i + 1] ? st[i + 1].ts : null, kind: st[i].kind };
    // день вне известного диапазона — по автогранице
    const s = new Date(key + 'T00:00').getTime() + boundaryMinutes(this.template(key)) * 60000;
    return { key, start: s, end: s + DAY, kind: 'auto' };
  }
  /** Записи вида kind за личный день key. */
  inDay(kind, key, ref) {
    const r = this.range(key);
    return this.logsBetween(kind, r.start, r.end, ref);
  }
  /** Группировка записей по личным дням: {key: [logs]} */
  groupByDay(kind, filter) {
    const res = {};
    for (const l of this.logs(kind)) {
      if (filter && !filter(l)) continue;
      const k = this.pdayOf(l.ts).key;
      (res[k] = res[k] || []).push(l);
    }
    return res;
  }
  /** Последние n личных дней, включая текущий (по возрастанию). */
  lastDays(n) {
    const cur = this.cur().key;
    return keyRange(addDays(cur, -(n - 1)), cur);
  }

  // ── экспорт/импорт ──
  async exportAll({ withPhotos = true } = {}) {
    const blobs = withPhotos ? await db.getAll('blobs') : [];
    return {
      app: 'LIFE OS', format: 1, exported: new Date().toISOString(),
      settings: this.settings, defs: [...this.defsMap.values()], logs: [...this.logsMap.values()], blobs,
    };
  }
  async importAll(data, { mode = 'replace' } = {}) {
    if (!data || data.app !== 'LIFE OS' || !Array.isArray(data.defs) || !Array.isArray(data.logs)) throw new Error('Файл не похож на резервную копию LIFE OS');
    if (mode === 'replace') {
      await db.clearAll();
      this.defsMap.clear(); this.logsMap.clear();
      this.settings = deepMerge(defaultSettings(), data.settings || {});
    } else if (data.settings && mode === 'merge-settings') {
      this.settings = deepMerge(this.settings, data.settings);
    }
    let added = 0, updated = 0;
    for (const d of data.defs) { if (!d || !d.id) continue; this.defsMap.has(d.id) ? updated++ : added++; this.defsMap.set(d.id, d); }
    for (const l of data.logs) {
      if (!l || !l.id || typeof l.ts !== 'number') continue;
      const ex = this.logsMap.get(l.id);
      if (ex && (ex.updated || 0) > (l.updated || 0)) continue; // слияние: новее побеждает
      ex ? updated++ : added++;
      this.logsMap.set(l.id, l);
    }
    await db.putMany('defs', [...this.defsMap.values()]);
    await db.putMany('logs', [...this.logsMap.values()]);
    if (Array.isArray(data.blobs) && data.blobs.length) await db.putMany('blobs', data.blobs.filter((b) => b && b.id));
    await db.put('kv', { k: 'settings', v: this.settings });
    this.reindex(); this.startsCache = null;
    this.emit({ type: 'import' });
    return { added, updated };
  }
  async wipe() {
    await db.clearAll();
    this.defsMap.clear(); this.logsMap.clear();
    this.settings = defaultSettings();
    await this.seed();
    this.reindex(); this.startsCache = null;
    this.emit({ type: 'import' });
  }
}

export const S = new Store();
