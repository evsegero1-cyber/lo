import { S } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, pageHeader, tabs, fmt, empty, refresh, seg } from '../ui/dom.js';
import { chart, scatter } from '../ui/charts.js';
import { moodDay, sleepDay, activityDay, foodDay, waterDay, badDay } from '../summary.js';
import { fmtDateShort, fmtDateTime } from '../core/time.js';
import { pearson, describeCorrelation, avg, sum } from '../core/calc.js';
import { EMOTIONS, BREATHING, MEDITATIONS } from '../data/seed.js';
import { vibrate } from '../native.js';

let tab = 'mood';
let corrX = 'sleep';
const MOOD_E = ['😞', '😕', '😐', '🙂', '😄'];

export function moodSheet(l, preset) {
  const isNew = !l;
  formSheet({ title: isNew ? 'Как вы сейчас?' : 'Самочувствие', fields: [
    { name: 'mood', label: 'Настроение', type: 'scale', min: 1, max: 5, labels: MOOD_E, value: l ? l.mood : preset },
    { name: 'energy', label: 'Энергия', type: 'scale', min: 1, max: 5, value: l && l.energy, captions: ['нет сил', 'много сил'] },
    { name: 'stress', label: 'Стресс', type: 'scale', min: 1, max: 5, value: l && l.stress, captions: ['спокойно', 'сильный'] },
    { name: 'anxiety', label: 'Тревожность (субъективно)', type: 'scale', min: 1, max: 5, value: l && l.anxiety, captions: ['нет', 'сильная'] },
    { name: 'emotions', label: 'Эмоции', type: 'chips', options: [...EMOTIONS], value: (l && l.emotions) || [], allowAdd: true },
    { name: 'note', label: 'Заметка', type: 'textarea', rows: 2, value: l && l.note },
    { name: 'ts', label: 'Когда', type: 'datetime', value: l ? l.ts : Date.now() },
  ], onSave: async (v) => {
    if (v.mood == null && v.energy == null && v.stress == null && v.anxiety == null && !v.note) return 'Отметьте хотя бы один показатель';
    await S.putLog({ ...(l || { kind: 'mood' }), ...v });
    if (isNew) toast('Записано');
  }, onDelete: isNew ? null : () => S.delLog(l.id) });
}

function journalEdit(l, type = 'thought') {
  const isNew = !l;
  formSheet({ title: isNew ? (type === 'event' ? 'Событие' : 'Мысли') : 'Запись дневника', fields: [
    { name: 'type', label: 'Тип', type: 'select', options: [{ value: 'thought', label: 'Дневник мыслей' }, { value: 'event', label: 'Дневник событий' }, { value: 'gratitude', label: 'Благодарность' }], value: l ? l.type : type },
    { name: 'text', label: 'Текст', type: 'textarea', rows: 6, required: true, value: l && l.text },
    { name: 'ts', label: 'Когда', type: 'datetime', value: l ? l.ts : Date.now() },
  ], onSave: (v) => S.putLog({ ...(l || { kind: 'journal' }), ...v }), onDelete: isNew ? null : () => S.delLog(l.id) });
}

function moodTab() {
  const key = S.cur().key;
  const today = moodDay(key);
  const k30 = S.lastDays(30);
  const d30 = k30.map(moodDay);
  const logs = S.logs('mood').slice(-30).reverse();
  const recent14 = S.lastDays(14).map(moodDay).filter((d) => d.mood != null);
  const lowStreak = recent14.length >= 10 && recent14.filter((d) => d.mood <= 2).length >= 10;
  return h('div', null,
    card('Быстрая оценка', h('div', null, h('div', { class: 'scale' }, MOOD_E.map((e, i) => h('button', { class: 'scale-btn', style: { fontSize: '24px' }, onclick: () => moodSheet(null, i + 1) }, e))),
      today.logs.length ? h('p', { class: 'muted small mt' }, `Сегодня оценок: ${today.logs.length}, среднее настроение ${fmt(today.mood, 1)}`) : null), { cls: 'hero' }),
    card('Настроение, энергия и стресс (30 дней)', chart({ labels: k30.map(fmtDateShort), series: [{ name: 'Настроение', values: d30.map((d) => d.mood), color: 'var(--mood)' }, { name: 'Энергия', values: d30.map((d) => d.energy), color: 'var(--act)' }, { name: 'Стресс', values: d30.map((d) => d.stress), color: 'var(--bad)', dashed: true }], type: 'line', zero: false, connect: true })),
    lowStreak ? h('div', { class: 'hint warn mb' }, 'Последние две недели настроение чаще низкое. Это не диагноз — но если тяжёлое состояние держится долго, мешает работе или сну, поговорите с близким человеком или специалистом (психолог, психотерапевт, терапевт). Если появились мысли о том, чтобы причинить себе вред, — сразу обратитесь за помощью к близким или по номеру 112.') : null,
    card('История', logs.length ? h('div', null, logs.map((l) => row(`${l.mood ? MOOD_E[l.mood - 1] + ' ' : ''}${l.emotions && l.emotions.length ? l.emotions.join(', ') : 'Оценка'}`, fmtDateTime(l.ts), { sub: [l.energy ? 'энергия ' + l.energy : null, l.stress ? 'стресс ' + l.stress : null, l.anxiety ? 'тревожность ' + l.anxiety : null, l.note].filter(Boolean).join(' · '), onclick: () => moodSheet(l) }))) : empty('Пока нет оценок')),
    h('p', { class: 'muted small' }, 'Модуль помогает замечать закономерности и не ставит психологических или психиатрических диагнозов.'));
}

function journalTab() {
  const logs = S.logs('journal').slice().reverse();
  const T = { thought: '💭 Мысли', event: '📌 Событие', gratitude: '🙏 Благодарность' };
  return h('div', null,
    h('div', { class: 'btns mb' }, btn('💭 Мысли', () => journalEdit(null, 'thought'), 'primary'), btn('📌 Событие', () => journalEdit(null, 'event')), btn('🙏 Благодарность', () => journalEdit(null, 'gratitude'))),
    logs.length ? card(null, h('div', null, logs.slice(0, 60).map((l) => row(T[l.type] || 'Запись', fmtDateTime(l.ts), { sub: l.text.length > 140 ? l.text.slice(0, 140) + '…' : l.text, onclick: () => journalEdit(l) })))) : empty('Записи хранятся только на устройстве.'));
}

function practicesTab() {
  const done = S.logs('practice').slice(-200);
  const min = sum(done.filter((p) => Date.now() - p.ts < 7 * 864e5), (p) => p.minutes);
  return h('div', null,
    card('Дыхательные упражнения', h('div', null, BREATHING.map((b) => row(b.name, '▶', { icon: '🌬️', sub: b.desc, onclick: () => { location.hash = '#/breath/' + b.id; } })))),
    card('Медитации и расслабление', h('div', null, MEDITATIONS.map((m) => row(m.name, `${m.minutes} мин ▶`, { icon: '🧘', onclick: () => { location.hash = '#/meditate/' + m.id; } })))),
    card('За 7 дней', row('Практик', `${done.filter((p) => Date.now() - p.ts < 7 * 864e5).length} · ${fmt(min, 0)} мин`)));
}

// ── Связи ──
const FACTORS = {
  sleep: { label: 'Сон, ч', get: (k) => { const t = sleepDay(k).total; return t ? t / 60 : null; } },
  activity: { label: 'Активность, мин', get: (k) => activityDay(k).minutes || null },
  kcal: { label: 'Калории', get: (k) => { const f = foodDay(k); return f.count ? f.kcal : null; } },
  water: { label: 'Вода, мл', get: (k) => waterDay(k).ml || null },
  bad: { label: 'Вредные привычки, ед.', get: (k) => { const b = badDay(k); return b.length ? sum(b, (x) => x.amount) : null; } },
};
function corrTab() {
  const keys = S.lastDays(90).filter((k) => k < S.cur().key);
  const mood = Object.fromEntries(keys.map((k) => [k, moodDay(k).mood]));
  const rows = Object.entries(FACTORS).map(([id, f]) => {
    const pairs = keys.map((k) => [f.get(k), mood[k]]);
    const r = pearson(pairs);
    return { id, f, r, n: pairs.filter(([x, y]) => x != null && y != null).length };
  });
  const sel = rows.find((x) => x.id === corrX);
  return h('div', null,
    h('p', { class: 'muted small mb' }, 'Сравнение среднего настроения за личный день с другими показателями за последние 90 дней. Используются только дни, где есть обе записи. Связь не означает причину.'),
    card('Настроение и…', h('div', null, rows.map((x) => row(x.f.label, x.r == null ? '—' : fmt(x.r, 2), { sub: `${describeCorrelation(x.r)} · дней: ${x.n}`, onclick: () => { corrX = x.id; refresh(); } })))),
    card(`Настроение × ${sel.f.label}`, h('div', null, seg(rows.map((x) => ({ value: x.id, label: x.f.label.split(',')[0] })), corrX, (v) => { corrX = v; refresh(); }),
      h('div', { class: 'mt' }, scatter(keys.map((k) => ({ x: sel.f.get(k), y: mood[k] })), { xLabel: sel.f.label, yLabel: 'настроение', color: 'var(--mood)' })))),
  );
}

// ── Живые экраны практик ──
let practiceTimer = null;
function breathPage({ id }) {
  const b = BREATHING.find((x) => x.id === id) || BREATHING[0];
  clearInterval(practiceTimer);
  const circle = h('div', { class: 'breath-circle' }, 'Готовы?');
  const info = h('div', { class: 'center muted' }, b.desc);
  const timer = h('div', { class: 'center big' }, '0:00');
  let running = false, started = 0, phase = 0, left = 0;
  const startBtn = btn('▶ Начать', () => (running ? stop(true) : start()), 'primary wide');
  const start = () => {
    running = true; started = Date.now(); phase = -1; left = 0; startBtn.textContent = '■ Завершить';
    practiceTimer = setInterval(stepFn, 1000); stepFn();
  };
  const stepFn = () => {
    if (left <= 0) {
      phase = (phase + 1) % b.phases.length;
      const [name, sec] = b.phases[phase];
      left = sec;
      circle.textContent = name;
      circle.style.transitionDuration = sec + 's';
      circle.style.transform = name === 'Вдох' ? 'scale(1)' : name === 'Выдох' ? 'scale(.6)' : circle.style.transform;
      vibrate(25);
    }
    circle.textContent = `${b.phases[phase][0]} · ${left}`;
    left--;
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const stop = async (save) => {
    clearInterval(practiceTimer); running = false; startBtn.textContent = '▶ Начать';
    const min = (Date.now() - started) / 60000;
    if (save && min >= 0.5) { await S.putLog({ kind: 'practice', type: 'breath', ref: b.id, name: b.name, minutes: Math.round(min * 10) / 10 }); toast(`Практика записана: ${fmt(min, 1)} мин`); }
    circle.textContent = 'Готово'; circle.style.transform = 'scale(.6)';
  };
  window.addEventListener('hashchange', () => clearInterval(practiceTimer), { once: true });
  return h('div', null, pageHeader(b.name, { back: true }), circle, timer, info, h('div', { class: 'mt2' }, startBtn),
    h('p', { class: 'muted small mt' }, 'Если появилось головокружение — вернитесь к обычному дыханию.'));
}

function meditatePage({ id }) {
  const m = MEDITATIONS.find((x) => x.id === id) || MEDITATIONS[0];
  clearInterval(practiceTimer);
  let idx = -1, started = 0;
  const per = Math.max(20, Math.round((m.minutes * 60) / m.steps.length));
  const stepEl = h('div', { class: 'card hero center', style: { minHeight: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' } }, 'Устройтесь удобно и нажмите «Начать»');
  const timer = h('div', { class: 'timer-big' }, `${m.minutes}:00`);
  const startBtn = btn('▶ Начать', () => (started ? finish() : start()), 'primary wide');
  const start = () => {
    started = Date.now(); startBtn.textContent = '■ Завершить';
    practiceTimer = setInterval(tick, 1000); tick();
  };
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    const left = Math.max(0, m.minutes * 60 - s);
    timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const i = Math.min(m.steps.length - 1, Math.floor(s / per));
    if (i !== idx) { idx = i; stepEl.textContent = m.steps[i]; vibrate(20); }
    if (left === 0) finish();
  };
  const finish = async () => {
    clearInterval(practiceTimer);
    const min = (Date.now() - started) / 60000;
    started = 0; startBtn.textContent = '▶ Начать';
    if (min >= 0.5) { await S.putLog({ kind: 'practice', type: 'meditation', ref: m.id, name: m.name, minutes: Math.round(min * 10) / 10 }); toast('Практика записана'); }
    stepEl.textContent = 'Завершено. Как вы себя чувствуете?';
    setTimeout(() => moodSheet(null), 600);
  };
  window.addEventListener('hashchange', () => clearInterval(practiceTimer), { once: true });
  return h('div', null, pageHeader(m.name, { back: true }), timer, stepEl, startBtn);
}

export default {
  mind: { tab: 'health', render: () => h('div', null,
    pageHeader('Самочувствие', { back: true }),
    tabs([{ id: 'mood', label: 'Настроение' }, { id: 'journal', label: 'Дневник' }, { id: 'practices', label: 'Практики' }, { id: 'corr', label: 'Связи' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'mood' ? moodTab() : tab === 'journal' ? journalTab() : tab === 'practices' ? practicesTab() : corrTab()) },
  'breath/:id': { tab: 'health', live: true, render: breathPage },
  'meditate/:id': { tab: 'health', live: true, render: meditatePage },
};
export { avg };
