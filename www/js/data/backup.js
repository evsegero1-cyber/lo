// Резервное копирование, восстановление и экспорт в JSON/CSV.

import { S } from './store.js';
import { saveFile, writeDocument, listBackups, deleteBackup, isNative } from '../native.js';
import { dateKey, tsToHm, DAY } from '../core/time.js';

const stamp = () => { const d = new Date(); return `${dateKey(d.getTime())}_${tsToHm(d.getTime()).replace(':', '-')}`; };

export async function exportJson({ withPhotos = true } = {}) {
  const data = await S.exportAll({ withPhotos });
  const res = await saveFile(`lifeos-backup_${stamp()}.json`, JSON.stringify(data), 'application/json');
  await S.saveSettings({ backup: { last: Date.now() } });
  return res;
}

export async function restoreJson(text, mode) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Не удалось прочитать файл: это не JSON'); }
  return S.importAll(data, { mode });
}

// ── CSV ──

const CSV_KINDS = {
  water: { name: 'Вода', cols: [['ml', 'Объём, мл'], ['drink', 'Напиток', (v) => (S.def(v) || {}).name || v], ['effective', 'В зачёт цели, мл']] },
  food: { name: 'Питание', cols: [['meal', 'Приём пищи'], ['name', 'Продукт'], ['grams', 'Граммы'], ['kcal', 'Ккал'], ['protein', 'Белки'], ['fat', 'Жиры'], ['carbs', 'Углеводы'], ['sugar', 'Сахар'], ['fiber', 'Клетчатка'], ['salt', 'Соль']] },
  sleep: { name: 'Сон', cols: [['start', 'Начало', fmtTs], ['end', 'Конец', fmtTs], ['main', 'Основной', yn], ['quality', 'Качество'], ['awakenings', 'Пробуждения'], ['feeling', 'Самочувствие'], ['alertness', 'Бодрость'], ['note', 'Заметка']] },
  weight: { name: 'Вес', cols: [['value', 'Вес, кг']] },
  measure: { name: 'Замеры', cols: [['metric', 'Показатель'], ['value', 'Значение']] },
  workout: { name: 'Тренировки', cols: [['name', 'Название'], ['minutes', 'Минут'], ['rpe', 'Тяжесть 1–10'], ['feeling', 'Самочувствие'], ['volume', 'Тоннаж, кг'], ['note', 'Заметка']] },
  activity: { name: 'Активность', cols: [['type', 'Вид'], ['minutes', 'Минут'], ['distance', 'Км'], ['steps', 'Шаги'], ['kcal', 'Ккал']] },
  habitlog: { name: 'Полезные привычки', cols: [['ref', 'Привычка', (v) => (S.def(v) || {}).name || v], ['value', 'Значение']] },
  baduse: { name: 'Вредные привычки', cols: [['ref', 'Привычка', (v) => (S.def(v) || {}).name || v], ['type', 'Тип'], ['amount', 'Количество'], ['cost', 'Стоимость'], ['triggers', 'Триггеры', (v) => (v || []).join('; ')], ['note', 'Заметка']] },
  mood: { name: 'Самочувствие', cols: [['mood', 'Настроение'], ['stress', 'Стресс'], ['energy', 'Энергия'], ['anxiety', 'Тревожность'], ['emotions', 'Эмоции', (v) => (v || []).join('; ')], ['note', 'Заметка']] },
  journal: { name: 'Дневник', cols: [['type', 'Тип'], ['text', 'Текст']] },
  medintake: { name: 'Приём лекарств', cols: [['ref', 'Препарат', (v) => (S.def(v) || {}).name || v], ['dose', 'Доза']] },
  vital: { name: 'Показатели', cols: [['type', 'Показатель'], ['value', 'Значение'], ['value2', 'Значение 2']] },
};
function fmtTs(v) { return v ? new Date(v).toLocaleString('ru-RU') : ''; }
function yn(v) { return v ? 'да' : 'нет'; }
const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export function csvKinds() { return Object.entries(CSV_KINDS).map(([id, k]) => ({ id, name: k.name, count: S.logs(id).length })); }

export function buildCsv(kind) {
  const k = CSV_KINDS[kind];
  const head = ['Дата и время', 'Календарная дата', 'Личный день', ...k.cols.map((c) => c[1])];
  const rows = [head];
  for (const l of S.logs(kind)) {
    rows.push([fmtTs(l.ts), dateKey(l.ts), S.pdayOf(l.ts).key, ...k.cols.map(([f, , fn]) => (fn ? fn(l[f]) : l[f]))]);
  }
  // Excel в русской локали ожидает «;» и BOM
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}
export async function exportCsv(kind) {
  return saveFile(`lifeos-${kind}_${stamp()}.csv`, buildCsv(kind), 'text/csv');
}

// ── Автоматическое резервное копирование (Android: Документы/LifeOS, 7 последних копий) ──

export async function autoBackupIfDue() {
  const b = S.settings.backup || {};
  if (!isNative() || b.auto === 'off') return null;
  const period = b.auto === 'weekly' ? 7 * DAY : DAY;
  if (b.lastAuto && Date.now() - b.lastAuto < period - 3600e3) return null;
  return autoBackupNow();
}
export async function autoBackupNow() {
  const data = await S.exportAll({ withPhotos: true });
  const ok = await writeDocument(`auto_${stamp()}.json`, JSON.stringify(data));
  if (!ok) return false;
  await S.saveSettings({ backup: { lastAuto: Date.now(), autoWhere: ok === 'data' ? 'внутренняя папка приложения' : 'Документы/LifeOS' } });
  try {
    const all = (await listBackups()).filter((f) => f.name.startsWith('auto_')).sort((a, b) => b.name.localeCompare(a.name));
    for (const old of all.slice(7)) await deleteBackup(old);
  } catch (e) { /* */ }
  return true;
}
