import { S, uid } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, pageHeader, tabs, fmt, empty, refresh, bar, pct, confirmDialog } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { fmtDateShort, fmtDate, daysBetween, dateKey, DAY } from '../core/time.js';
import { avg, clamp } from '../core/calc.js';
import { ACHIEVEMENTS } from '../data/seed.js';
import { badStats } from './bad.js';
import { statsFor } from './habits.js';

let tab = 'active';
const TYPES = {
  manual: 'Своё значение (вношу прогресс вручную)', milestones: 'По этапам (чек-лист)', weight: 'Вес — дойти до значения',
  bad_clean: 'Дней без вредной привычки', habit_streak: 'Серия полезной привычки', exercise_reps: 'Повторений в упражнении за подход', distance: 'Дистанция за одно занятие, км',
};
const CATS = ['Здоровье', 'Тело', 'Сила', 'Выносливость', 'Сон', 'Питание', 'Привычки', 'Режим', 'Другое'];

export function goalProgress(g) {
  const t = Number(g.target) || 0;
  switch (g.type) {
    case 'milestones': { const m = g.milestones || []; return { value: m.filter((x) => x.done).length, target: m.length, rate: m.length ? m.filter((x) => x.done).length / m.length : 0, text: `${m.filter((x) => x.done).length} из ${m.length} этапов` }; }
    case 'weight': {
      const ws = S.logs('weight');
      if (!ws.length || !t) return { rate: 0, text: 'нет взвешиваний' };
      const last7 = ws.filter((w) => Date.now() - w.ts < 7 * DAY).map((w) => w.value);
      const cur = last7.length ? avg(last7) : ws.at(-1).value;
      const start = g.startValue ?? ws.find((w) => w.ts >= (g.created || 0))?.value ?? ws[0].value;
      const rate = start === t ? 1 : clamp((start - cur) / (start - t), 0, 1);
      return { value: cur, target: t, rate, text: `${fmt(cur, 1)} кг (среднее за 7 дн.) → ${t} кг` };
    }
    case 'bad_clean': { const b = S.def(g.ref); if (!b) return { rate: 0, text: 'привычка удалена' }; const d = badStats(b).sinceLastMs / DAY; return { value: d, target: t, rate: t ? clamp(d / t, 0, 1) : 0, text: `${fmt(d, 1)} из ${t} дн.` }; }
    case 'habit_streak': { const hb = S.def(g.ref); if (!hb) return { rate: 0, text: 'привычка удалена' }; const st = statsFor(hb, S.lastDays(Math.max(60, t + 10)), S.cur().key); return { value: st.current, target: t, rate: t ? clamp(st.current / t, 0, 1) : 0, text: `серия ${st.current} из ${t}` }; }
    case 'exercise_reps': {
      let best = 0;
      for (const w of S.logs('workout')) for (const it of w.items || []) if (it.exId === g.ref) for (const s of it.sets) if (s.done !== false) best = Math.max(best, s.reps || 0);
      return { value: best, target: t, rate: t ? clamp(best / t, 0, 1) : 0, text: `лучший подход ${best} из ${t}` };
    }
    case 'distance': {
      let best = 0;
      for (const a of S.logs('activity')) if (!g.ref || a.ex === g.ref) best = Math.max(best, a.distance || 0);
      return { value: best, target: t, rate: t ? clamp(best / t, 0, 1) : 0, text: `лучшее ${fmt(best, 1)} из ${t} км` };
    }
    default: {
      const logs = S.logs('goalprogress').filter((l) => l.ref === g.id);
      const v = logs.length ? logs.at(-1).value : g.startValue ?? 0;
      const s = g.startValue ?? 0;
      const rate = t === s ? (v >= t ? 1 : 0) : clamp((v - s) / (t - s), 0, 1);
      return { value: v, target: t, rate, text: `${fmt(v, 1)} из ${t} ${g.unit || ''}` };
    }
  }
}

export function goalEdit(g) {
  const isNew = !g;
  g = g ? JSON.parse(JSON.stringify(g)) : { kind: 'goal', type: 'manual', milestones: [], category: 'Здоровье', created: Date.now() };
  const refOpts = [{ value: '', label: '—' },
    ...S.defs('bad').map((b) => ({ value: b.id, label: '⛔ ' + b.name })), ...S.defs('habit').filter((x) => !x.archived).map((x) => ({ value: x.id, label: '✅ ' + x.name })),
    ...S.defs('exercise').filter((e) => e.metric === 'reps' || e.metric === 'reps_weight' || e.cat === 'cardio').map((e) => ({ value: e.id, label: '💪 ' + e.name }))];
  formSheet({ title: isNew ? 'Новая цель' : 'Цель', fields: [
    { name: 'name', label: 'Цель', required: true, value: g.name, placeholder: 'например: подтянуться 10 раз' },
    { name: 'category', label: 'Направление', type: 'select', options: CATS.map((c) => ({ value: c, label: c })), value: g.category },
    { name: 'horizon', label: 'Срок', type: 'seg', options: [{ value: 'short', label: 'Краткосрочная' }, { value: 'long', label: 'Долгосрочная' }], value: g.horizon || 'short' },
    { name: 'type', label: 'Как измерять прогресс', type: 'select', options: Object.entries(TYPES).map(([v, l]) => ({ value: v, label: l })), value: g.type },
    { name: 'ref', label: 'Связь (привычка / упражнение)', type: 'select', options: refOpts, value: g.ref || '', help: 'Для типов «дней без…», «серия», «повторений», «дистанция»' },
    { name: 'startValue', label: 'Начальное значение', type: 'number', value: g.startValue, half: true },
    { name: 'target', label: 'Целевое значение', type: 'number', value: g.target, half: true },
    { name: 'unit', label: 'Единица (для своего значения)', value: g.unit },
    { name: 'milestones', label: 'Промежуточные этапы (каждый с новой строки)', type: 'textarea', rows: 4, value: (g.milestones || []).map((m) => m.text).join('\n') },
    { name: 'deadline', label: 'Срок', type: 'date', value: g.deadline },
    { name: 'remindDate', label: 'Напомнить о цели (дата)', type: 'date', value: g.remindDate, half: true },
    { name: 'remindTime', label: 'Время', type: 'time', value: g.remindTime || '16:00', half: true },
    { name: 'note', label: 'Зачем мне эта цель', type: 'textarea', rows: 2, value: g.note },
  ], onSave: async (v) => {
    if (['bad_clean', 'habit_streak', 'exercise_reps'].includes(v.type) && !v.ref) return 'Выберите связанную привычку или упражнение';
    if (!['milestones'].includes(v.type) && v.target == null) return 'Укажите целевое значение';
    const lines = String(v.milestones || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const ms = lines.map((t) => (g.milestones || []).find((m) => m.text === t) || { id: uid('ms_'), text: t, done: false });
    if (v.type === 'milestones' && !ms.length) return 'Добавьте этапы';
    const hist = [...(g.history || [])];
    if (!isNew && (g.deadline || '') !== (v.deadline || '')) hist.push({ ts: Date.now(), what: 'Срок', from: g.deadline || '—', to: v.deadline || '—' });
    if (!isNew && g.target !== v.target) hist.push({ ts: Date.now(), what: 'Цель', from: g.target ?? '—', to: v.target ?? '—' });
    if (isNew && v.type === 'weight' && v.startValue == null) { const w = S.logs('weight').at(-1); if (w) v.startValue = w.value; }
    await S.putDef({ ...g, ...v, milestones: ms, history: hist });
  }, onDelete: isNew ? null : async () => { await S.delDef(g.id); if (location.hash.startsWith('#/goal/')) history.back(); } });
}

function goalCard(g) {
  const p = goalProgress(g);
  const left = g.deadline ? daysBetween(S.cur().key, g.deadline) : null;
  return card(null, h('div', { onclick: () => { location.hash = '#/goal/' + g.id; } },
    h('div', { class: 'split' }, h('b', null, g.name), h('span', { class: 'muted small' }, pct(p.rate))),
    h('div', { class: 'mt' }, bar(p.rate, g.done ? 'var(--ok)' : 'var(--accent)')),
    h('div', { class: 'split mt muted small' }, h('span', null, p.text), h('span', null, g.done ? '✓ достигнута' : left == null ? '' : left >= 0 ? `осталось ${left} дн.` : 'срок прошёл — можно перенести'))));
}

function list() {
  const all = S.defs('goal');
  const act = all.filter((g) => !g.done), done = all.filter((g) => g.done);
  if (tab === 'achievements') return achievements();
  const show = tab === 'active' ? act : done;
  return h('div', null,
    tab === 'active' ? btn('＋ Новая цель', () => goalEdit(null), 'primary wide mb') : null,
    ...['short', 'long'].map((hz) => { const arr = show.filter((g) => (g.horizon || 'short') === hz); return arr.length ? h('div', null, h('div', { class: 'form-section mb' }, hz === 'short' ? 'Краткосрочные' : 'Долгосрочные'), ...arr.map(goalCard)) : null; }),
    show.length ? null : empty(tab === 'active' ? 'Поставьте первую цель: «пробежать 5 км», «неделя без энергетиков», «нормализовать сон».' : 'Достигнутые цели появятся здесь'));
}

function goalPage({ id }) {
  const g = S.def(id);
  if (!g) return h('div', null, pageHeader('Цель', { back: true }), empty('Цель не найдена'));
  const p = goalProgress(g);
  const logs = S.logs('goalprogress').filter((l) => l.ref === g.id);
  return h('div', null,
    pageHeader(g.name, { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => goalEdit(g) }, '✎')] }),
    card(null, h('div', null, h('div', { class: 'big' }, pct(p.rate)), h('div', { class: 'mt' }, bar(p.rate, 'var(--accent)')), h('p', { class: 'muted small' }, p.text),
      g.deadline ? row('Срок', fmtDate(g.deadline)) : null, row('Направление', `${g.category} · ${g.horizon === 'long' ? 'долгосрочная' : 'краткосрочная'}`), g.note ? h('p', { class: 'muted' }, g.note) : null), { cls: 'hero' }),
    g.type === 'manual' ? card('Прогресс', h('div', null,
      logs.length > 1 ? chart({ labels: logs.map((l) => fmtDateShort(dateKey(l.ts))), series: [{ name: g.unit || 'значение', values: logs.map((l) => l.value), color: 'var(--accent)' }], goal: g.target, zero: false, height: 130, type: 'line' }) : null,
      btn('＋ Внести значение', () => formSheet({ title: 'Текущее значение', fields: [{ name: 'value', label: g.unit || 'Значение', type: 'number', required: true }, { name: 'note', label: 'Заметка' }], onSave: (v) => S.putLog({ kind: 'goalprogress', ref: g.id, ...v }) }), 'wide mt'))) : null,
    (g.milestones || []).length ? card('Этапы', h('div', null, g.milestones.map((m) => h('div', { class: 'row tap', onclick: async () => { const ms = g.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done, date: !x.done ? Date.now() : null } : x)); await S.putDef({ ...g, milestones: ms }); } },
      h('span', { class: 'check' + (m.done ? ' on' : '') }, '✓'), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, m.text), m.done && m.date ? h('div', { class: 'row-sub' }, 'выполнено ' + fmtDateShort(dateKey(m.date))) : null))))) : null,
    (g.history || []).length ? card('История изменений', h('div', null, g.history.slice().reverse().map((x) => row(`${x.what}: ${x.from} → ${x.to}`, fmtDateShort(dateKey(x.ts)))))) : null,
    h('div', { class: 'btns' },
      g.done ? btn('Вернуть в активные', () => S.putDef({ ...g, done: false, doneAt: null }))
        : btn('🎯 Цель достигнута', async () => { await S.putDef({ ...g, done: true, doneAt: Date.now() }); toast('Поздравляем! 🎉'); }, 'primary'),
      g.done ? null : btn('Перенести срок', () => goalEdit(g), 'ghost')),
    h('p', { class: 'muted small mt' }, 'Сроки можно переносить и менять сколько угодно — без штрафов.'));
}

function achievements() {
  const got = S.settings.achievements || {};
  return h('div', null,
    h('p', { class: 'muted small mb' }, 'Достижения отмечают шаги, а не соревнуют. Пропуски ничего не отнимают.'),
    h('div', { class: 'ach' }, ACHIEVEMENTS.map((a) => h('div', { class: 'ach-i' + (got[a.id] ? '' : ' locked') }, h('span', { class: 'e' }, a.icon), h('b', null, a.name), h('small', null, got[a.id] ? fmtDateShort(dateKey(got[a.id])) : a.desc)))));
}

export default {
  goals: { tab: 'habits', render: () => h('div', null,
    pageHeader('Цели и достижения', { back: true }),
    tabs([{ id: 'active', label: 'Активные' }, { id: 'done', label: 'Достигнутые' }, { id: 'achievements', label: 'Достижения' }], tab, (t) => { tab = t; refresh(false); }),
    list()) },
  'goal/:id': { tab: 'habits', render: goalPage },
};
export { confirmDialog };
