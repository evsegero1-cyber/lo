import { S, uid } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, tabs, fmt, empty, refresh, confirmDialog, chips, buildForm, info } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { activityDay } from '../summary.js';
import { fmtDateShort, fmtDateTime, fmtDuration, tsToHm, dateKey, weekStart, addDays, keyRange, DAY } from '../core/time.js';
import { oneRepMax, volume, sessionLoad, acwr, metKcal, sum, avg, round } from '../core/calc.js';
import { EX_CATS, RISKS } from '../data/seed.js';
import { toDisp, fromDisp, unitLabel } from '../ui/units.js';
import { pickImage, vibrate } from '../native.js';

let tab = 'list';
let libCat = 'all', libQ = '', libShowExcluded = false;

// ── Ограничения ──
export function allowed(ex) {
  const r = S.settings.restrictions || {};
  if ((r.excluded || []).includes(ex.id)) return false;
  if ((ex.risk || []).some((x) => (r.risks || []).includes(x))) return false;
  return true;
}
const kgNow = () => { const w = S.logs('weight').at(-1); return w ? w.value : null; };
const metricLabel = { reps: 'повторения', reps_weight: 'вес × повторения', time: 'время', distance: 'дистанция и время' };

// ── Библиотека ──
function exerciseEdit(ex) {
  const isNew = !ex;
  ex = ex || { kind: 'exercise', cat: 'bodyweight', metric: 'reps', risk: [], steps: [], met: 4 };
  formSheet({ title: isNew ? 'Новое упражнение' : 'Упражнение', fields: [
    { name: 'name', label: 'Название', required: true, value: ex.name },
    { name: 'cat', label: 'Направление', type: 'select', options: Object.entries(EX_CATS).map(([v, l]) => ({ value: v, label: l })), value: ex.cat },
    { name: 'muscles', label: 'Мышцы / что развивает', value: ex.muscles },
    { name: 'metric', label: 'Как записывать', type: 'select', options: Object.entries(metricLabel).map(([v, l]) => ({ value: v, label: l })), value: ex.metric },
    { name: 'risk', label: 'Нагружает (для фильтра противопоказаний)', type: 'chips', options: Object.entries(RISKS).map(([v, l]) => ({ value: v, label: l })), value: ex.risk || [] },
    { name: 'steps', label: 'Техника (каждый шаг с новой строки)', type: 'textarea', rows: 5, value: (ex.steps || []).join('\n') },
    { name: 'met', label: 'Интенсивность MET (для оценки калорий)', type: 'number', min: 1, max: 20, value: ex.met },
  ], onSave: async (v) => { await S.putDef({ ...ex, ...v, steps: String(v.steps || '').split('\n').map((x) => x.trim()).filter(Boolean), custom: true }); },
  onDelete: isNew ? null : async () => { await S.delDef(ex.id); history.back(); } });
}

function library() {
  const r = S.settings.restrictions;
  const q = h('input', { class: 'inp', placeholder: 'Поиск упражнения', value: libQ });
  const list = h('div');
  const draw = () => {
    const t = libQ.toLowerCase();
    const items = S.defs('exercise').filter((e) => (libCat === 'all' || e.cat === libCat) && (!t || e.name.toLowerCase().includes(t) || String(e.muscles || '').toLowerCase().includes(t)) && (libShowExcluded || allowed(e)));
    list.replaceChildren(...items.map((e) => row(e.name, allowed(e) ? null : h('span', { class: 'badge warn' }, 'исключено'), { icon: catIco(e.cat), sub: `${EX_CATS[e.cat] || ''} · ${e.muscles || ''}`, onclick: () => { location.hash = '#/exercise/' + e.id; } })), items.length ? null : empty('Ничего не найдено'));
  };
  q.addEventListener('input', () => { libQ = q.value; draw(); });
  draw();
  const hidden = S.defs('exercise').filter((e) => !allowed(e)).length;
  return h('div', null,
    h('div', { class: 'search' }, q),
    h('div', { class: 'chips mb' }, [['all', 'Все'], ...Object.entries(EX_CATS)].map(([v, l]) => h('button', { class: 'chip' + (libCat === v ? ' on' : ''), onclick: () => { libCat = v; refresh(); } }, l))),
    hidden ? h('label', { class: 'field field-check mb' }, h('span', { class: 'small muted' }, `Показать исключённые (${hidden}) — по вашим ограничениям`), (() => { const c = h('input', { type: 'checkbox', class: 'switch' }); c.checked = libShowExcluded; c.onchange = () => { libShowExcluded = c.checked; draw(); }; return c; })()) : null,
    btn('＋ Своё упражнение', () => exerciseEdit(null), 'wide mb'),
    card(null, list),
    (r.risks || []).length ? h('p', { class: 'muted small' }, 'Учитываются ограничения: ' + r.risks.map((x) => RISKS[x]).join(', ')) : null);
}
const catIco = (c) => ({ strength: '🏋️', bodyweight: '🤸', cardio: '🏃', stretch: '🧘', mobility: '🔄', back: '🦴', balance: '⚖️' })[c] || '💪';

function exerciseHistory(exId) {
  const res = [];
  for (const w of S.logs('workout')) for (const it of w.items || []) if (it.exId === exId) res.push({ w, it });
  return res;
}

function exercisePage({ id }) {
  const ex = S.def(id);
  if (!ex) return h('div', null, pageHeader('Упражнение', { back: true }), empty('Упражнение не найдено'));
  const r = S.settings.restrictions;
  const excluded = (r.excluded || []).includes(ex.id);
  const riskHit = (ex.risk || []).filter((x) => (r.risks || []).includes(x));
  const hist = exerciseHistory(ex.id);
  const photo = h('div');
  if (ex.photo) S.getBlob(ex.photo).then((d) => { if (d) photo.replaceChildren(h('img', { class: 'ex-photo', src: d })); });
  const best = hist.map(({ w, it }) => ({ ts: w.ts, e1: Math.max(0, ...it.sets.filter((s) => s.done !== false).map((s) => oneRepMax(s.weight, s.reps) || 0)), vol: volume(it.sets.filter((s) => s.done !== false)), reps: Math.max(0, ...it.sets.map((s) => s.reps || 0)), sec: sum(it.sets, (s) => s.sec) }));
  return h('div', null,
    pageHeader(ex.name, { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => exerciseEdit(ex) }, '✎')] }),
    excluded || riskHit.length ? h('div', { class: 'hint warn mb' }, excluded ? 'Вы отметили это упражнение как противопоказанное — оно скрыто из конструктора и программ.' : `Нагружает: ${riskHit.map((x) => RISKS[x]).join(', ')} — указано в ваших ограничениях.`) : null,
    card('Описание', h('div', null,
      row('Направление', EX_CATS[ex.cat] || ''), row('Мышцы', ex.muscles || '—'), row('Запись', metricLabel[ex.metric] || ''),
      (ex.risk || []).length ? row('Нагружает', ex.risk.map((x) => RISKS[x]).join(', ')) : null)),
    card('Техника', h('div', null,
      (ex.steps || []).length ? h('ol', { class: 'ex-steps' }, ex.steps.map((s) => h('li', null, s))) : h('p', { class: 'muted' }, 'Описание не задано'),
      photo,
      h('div', { class: 'btns mt' }, btn(ex.photo ? 'Заменить схему/фото' : '📷 Добавить схему или фото техники', async () => {
        const d = await pickImage(1200, 0.82); if (!d) return;
        if (ex.photo) await S.delBlob(ex.photo);
        await S.putDef({ ...ex, photo: await S.putBlob(d) });
      }, 'small')),
      h('p', { class: 'muted small mt' }, 'Встроенные упражнения содержат текстовое описание техники. Свои фото или схемы можно прикрепить — они хранятся только на устройстве. При боли упражнение прекращают.'))),
    card('Прогресс', best.length ? h('div', null,
      ex.metric === 'reps_weight'
        ? chart({ labels: best.map((b) => fmtDateShort(dateKey(b.ts))), series: [{ name: 'Расчётный 1ПМ', values: best.map((b) => (b.e1 ? toDisp('weight', b.e1) : null)), color: 'var(--act)' }], zero: false, unit: unitLabel('weight'), height: 140, type: 'line' })
        : chart({ labels: best.map((b) => fmtDateShort(dateKey(b.ts))), series: [{ name: ex.metric === 'time' ? 'Секунд' : 'Макс. повторений', values: best.map((b) => (ex.metric === 'time' ? b.sec : b.reps) || null), color: 'var(--act)' }], zero: true, height: 140, type: 'bar' }),
      ...hist.slice(-6).reverse().map(({ w, it }) => row(fmtDateTime(w.ts), null, { sub: it.sets.map(setText(ex)).join(' · ') })),
      ex.metric === 'reps_weight' ? h('p', { class: 'muted small' }, '1ПМ рассчитан по формуле Эпли по подходам до 12 повторений — это оценка, а не рекомендация пробовать максимум.') : null)
      : empty('Ещё не выполнялось')),
    h('div', { class: 'btns' },
      btn(excluded ? 'Вернуть в программы' : '⛔ Отметить как противопоказанное', async () => {
        const list = new Set(r.excluded || []);
        excluded ? list.delete(ex.id) : list.add(ex.id);
        await S.setSetting('restrictions.excluded', [...list]);
        toast(excluded ? 'Упражнение снова доступно' : 'Упражнение исключено');
      }, excluded ? '' : 'danger ghost')),
  );
}
const setText = (ex) => (s) => {
  if (ex.metric === 'reps_weight') return `${s.weight ? fmt(toDisp('weight', s.weight), 1) + '×' : ''}${s.reps || 0}`;
  if (ex.metric === 'time') return `${s.sec || 0} с`;
  if (ex.metric === 'distance') return `${s.km || 0} км${s.min ? ' / ' + s.min + ' мин' : ''}`;
  return `${s.reps || 0}`;
};

// ── Шаблоны / программы ──
const PRESETS = [
  { name: 'Всё тело дома (без оборудования)', items: [['Приседания', 3, 12], ['Отжимания от опоры (стол, скамья)', 3, 10], ['Ягодичный мост', 3, 15], ['Австралийские подтягивания', 3, 8], ['Планка', 3, 0, 30], ['Птица-собака', 2, 10]] },
  { name: 'Силовая в зале — А', items: [['Приседания со штангой', 3, 8], ['Жим штанги лёжа', 3, 8], ['Тяга горизонтального блока', 3, 10], ['Жим гантелей сидя', 3, 10], ['Планка', 2, 0, 40]] },
  { name: 'Силовая в зале — Б', items: [['Румынская тяга', 3, 10], ['Тяга верхнего блока', 3, 10], ['Жим гантелей лёжа', 3, 10], ['Выпады', 3, 10], ['Подъём гантелей на бицепс', 2, 12]] },
  { name: 'Спина и осанка (10 мин)', items: [['Кошка — корова', 2, 10], ['Птица-собака', 2, 8], ['Мёртвый жук', 2, 8], ['Сведение лопаток у стены', 2, 10], ['Подтягивание подбородка (чин-таки)', 2, 8], ['Поза ребёнка', 1, 0, 60]] },
  { name: 'Мобильность после смены', items: [['Вращения в плечевых суставах', 1, 10], ['Вращения тазом', 1, 10], ['Мобилизация голеностопа', 1, 10], ['Растяжка сгибателей бедра в выпаде', 2, 0, 30], ['Растяжка икроножных у стены', 2, 0, 30], ['Растяжка грудных у стены', 2, 0, 30]] },
  { name: 'Путь к подтягиваниям', items: [['Австралийские подтягивания', 4, 8], ['Подтягивания', 3, 3], ['Тяга гантели в наклоне', 3, 10], ['Планка', 2, 0, 45]] },
];
async function addPresets() {
  const exs = S.defs('exercise');
  let n = 0;
  for (const p of PRESETS) {
    if (S.defs('wtpl').some((t) => t.name === p.name)) continue;
    const items = p.items.map(([name, sets, reps, sec]) => { const e = exs.find((x) => x.name === name); return e ? { exId: e.id, sets, reps: reps || null, sec: sec || null, weight: null, rest: e.cat === 'strength' ? 120 : 60 } : null; }).filter(Boolean);
    await S.putDef({ kind: 'wtpl', name: p.name, items, preset: true });
    n++;
  }
  toast(n ? `Добавлено шаблонов: ${n}. Противопоказанные упражнения пропускаются при старте.` : 'Шаблоны уже добавлены');
}

function tplEdit(t) {
  const isNew = !t;
  t = t ? JSON.parse(JSON.stringify(t)) : { kind: 'wtpl', name: '', items: [], note: '' };
  sheet({ title: isNew ? 'Новая программа' : 'Программа', full: true, body: (sh) => {
    const name = h('input', { class: 'inp', placeholder: 'Название', value: t.name });
    const note = h('textarea', { class: 'inp', rows: 2, placeholder: 'Заметка (необязательно)' }); note.value = t.note || '';
    const list = h('div');
    const draw = () => {
      list.replaceChildren(...t.items.map((it, i) => {
        const ex = S.def(it.exId);
        const inp = (key, ph, w = '64px') => { const x = h('input', { class: 'inp', inputmode: 'decimal', placeholder: ph, value: it[key] ?? '', style: { width: w, padding: '9px' } }); x.oninput = () => { it[key] = x.value === '' ? null : Number(x.value.replace(',', '.')); }; return x; };
        return h('div', { class: 'card', style: { padding: '10px', marginBottom: '8px' } },
          h('div', { class: 'split' }, h('b', null, ex ? ex.name : 'удалено', ex && !allowed(ex) ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, 'исключено') : null),
            h('div', null, i > 0 ? h('button', { class: 'icon-btn', style: { width: '32px', height: '32px' }, onclick: () => { [t.items[i - 1], t.items[i]] = [t.items[i], t.items[i - 1]]; draw(); } }, '↑') : null,
              h('button', { class: 'icon-btn', style: { width: '32px', height: '32px', marginLeft: '4px' }, onclick: () => { t.items.splice(i, 1); draw(); } }, '✕'))),
          h('div', { class: 'btns mt small muted', style: { alignItems: 'center' } }, 'Подходы', inp('sets', '3', '52px'),
            ex && ex.metric === 'time' ? ['сек', inp('sec', '30')] : ex && ex.metric === 'distance' ? ['км', inp('km', '2')] : ['повт.', inp('reps', '10')],
            ex && ex.metric === 'reps_weight' ? [unitLabel('weight'), inp('weight', '—')] : null,
            'отдых, с', inp('rest', '90')));
      }), t.items.length ? null : h('p', { class: 'muted small' }, 'Добавьте упражнения из библиотеки'));
    };
    const pick = () => pickExercise((ex) => { t.items.push({ exId: ex.id, sets: 3, reps: ex.metric === 'time' || ex.metric === 'distance' ? null : 10, sec: ex.metric === 'time' ? 30 : null, km: ex.metric === 'distance' ? 2 : null, weight: null, rest: ex.cat === 'strength' ? 120 : 60 }); draw(); });
    draw();
    sh.save = async () => {
      if (!name.value.trim()) { toast('Введите название'); return false; }
      if (!t.items.length) { toast('Добавьте упражнения'); return false; }
      await S.putDef({ ...t, name: name.value.trim(), note: note.value.trim(), items: t.items.map((x) => ({ ...x, sets: Math.max(1, Math.min(20, x.sets || 1)) })) });
      return true;
    };
    return h('div', { class: 'form' }, name, list, btn('＋ Упражнение', pick, 'wide'), note);
  }, actions: [
    ...(isNew ? [] : [{ label: 'Удалить', cls: 'danger ghost', onClick: async () => { if (await confirmDialog('Удалить программу? История тренировок сохранится.', { danger: true })) { await S.delDef(t.id); return true; } return false; } }]),
    { label: 'Сохранить', cls: 'primary', onClick: (sh) => sh.save() }] });
}

export function pickExercise(onPick, { cats } = {}) {
  sheet({ title: 'Выберите упражнение', full: true, body: (sh) => {
    const q = h('input', { class: 'inp', placeholder: 'Поиск' });
    const l = h('div', { class: 'mt' });
    const draw = () => {
      const t = q.value.toLowerCase();
      const items = S.defs('exercise').filter((e) => allowed(e) && (!cats || cats.includes(e.cat)) && (!t || e.name.toLowerCase().includes(t)));
      l.replaceChildren(...items.map((e) => row(e.name, null, { icon: catIco(e.cat), sub: EX_CATS[e.cat], onclick: () => { sh.close(); onPick(e); } })));
    };
    q.addEventListener('input', draw); draw();
    return h('div', null, h('div', { class: 'search' }, q), l, h('p', { class: 'muted small' }, 'Противопоказанные упражнения не показываются.'));
  } });
}

// ── Тренировка (сессия) ──
function lastSetsFor(exId) {
  const h2 = exerciseHistory(exId).filter(({ w }) => w.end);
  return h2.length ? h2[h2.length - 1].it.sets : null;
}
export async function startWorkout(tpl) {
  const open = S.logs('workout').find((w) => !w.end);
  if (open) { location.hash = '#/session/' + open.id; return; }
  const items = [];
  let skipped = 0;
  for (const it of (tpl && tpl.items) || []) {
    const ex = S.def(it.exId);
    if (!ex) continue;
    if (!allowed(ex)) { skipped++; continue; }
    const prev = lastSetsFor(ex.id);
    const sets = [];
    for (let i = 0; i < (it.sets || 1); i++) sets.push({ reps: it.reps ?? null, weight: it.weight ?? (prev && prev[i] ? prev[i].weight : null), sec: it.sec ?? null, km: it.km ?? null, min: null, done: false });
    items.push({ exId: ex.id, name: ex.name, metric: ex.metric, rest: it.rest || 90, sets });
  }
  const w = await S.putLog({ kind: 'workout', ts: Date.now(), end: null, name: tpl ? tpl.name : 'Свободная тренировка', tplId: tpl ? tpl.id : null, items });
  if (skipped) toast(`Пропущено противопоказанных упражнений: ${skipped}`);
  location.hash = '#/session/' + w.id;
}

let restTimer = null;
function sessionPage({ id }) {
  const w0 = S.log(id);
  if (!w0) return h('div', null, pageHeader('Тренировка', { back: true }), empty('Тренировка не найдена'));
  const w = JSON.parse(JSON.stringify(w0));
  const root = h('div');
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => S.putLog(w), 400); };
  const timerBox = h('div', { class: 'card hero', style: { position: 'sticky', top: '64px', zIndex: 5, display: 'none' } });
  const startRest = (sec) => {
    clearInterval(restTimer);
    let left = sec;
    timerBox.style.display = '';
    const tick = () => {
      timerBox.replaceChildren(h('div', { class: 'split' }, h('div', null, h('div', { class: 'muted small' }, 'Отдых'), h('div', { class: 'big' }, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)),
        h('div', { class: 'btns' }, btn('+30 с', () => { left += 30; tick(); }, 'small'), btn('Пропустить', () => { clearInterval(restTimer); timerBox.style.display = 'none'; }, 'small ghost'))));
      if (left <= 0) { clearInterval(restTimer); timerBox.style.display = 'none'; vibrate(400); toast('Отдых окончен'); }
      left--;
    };
    tick();
    restTimer = setInterval(tick, 1000);
  };
  const draw = () => {
    const done = sum(w.items, (it) => it.sets.filter((s) => s.done).length), total = sum(w.items, (it) => it.sets.length);
    root.replaceChildren(
      pageHeader(w.name, { back: true }),
      h('div', { class: 'split mb' }, h('span', { class: 'badge accent' }, `начало ${tsToHm(w.ts)} · ${fmtDuration((Date.now() - w.ts) / 60000)}`), h('span', { class: 'badge' }, `подходов ${done}/${total}`)),
      timerBox,
      ...w.items.map((it, i) => {
        const ex = S.def(it.exId) || { name: it.name, metric: it.metric };
        const prev = lastSetsFor(it.exId);
        const field = (s, key, ph) => { const x = h('input', { class: 'inp', inputmode: 'decimal', placeholder: ph, value: s[key] != null ? (key === 'weight' ? toDisp('weight', s[key]) : s[key]) : '' }); x.oninput = () => { const v = x.value === '' ? null : Number(x.value.replace(',', '.')); s[key] = v == null || isNaN(v) ? null : key === 'weight' ? fromDisp('weight', v) : v; save(); }; return x; };
        const cols = ex.metric === 'reps_weight' ? [['weight', unitLabel('weight')], ['reps', 'повт.']] : ex.metric === 'time' ? [['sec', 'сек'], null] : ex.metric === 'distance' ? [['km', 'км'], ['min', 'мин']] : [['reps', 'повт.'], null];
        return card(null, h('div', null,
          h('div', { class: 'split' }, h('b', { onclick: () => { location.hash = '#/exercise/' + it.exId; } }, ex.name, ' ›'), h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmDialog(`Убрать «${ex.name}» из тренировки?`)) { w.items.splice(i, 1); save(); draw(); } } }, '✕')),
          prev ? h('div', { class: 'muted small' }, 'Прошлый раз: ', prev.map(setText(ex)).join(' · ')) : null,
          h('div', { class: 'set-row muted small' }, h('span', { class: 'n' }, '#'), h('span', null, cols[0] ? cols[0][1] : ''), h('span', null, cols[1] ? cols[1][1] : ''), h('span')),
          ...it.sets.map((s, si) => h('div', { class: 'set-row' }, h('span', { class: 'n' }, si + 1), cols[0] ? field(s, cols[0][0], cols[0][1]) : h('span'), cols[1] ? field(s, cols[1][0], cols[1][1]) : h('span'),
            h('button', { class: 'check' + (s.done ? ' on' : ''), onclick: () => { s.done = !s.done; save(); draw(); if (s.done) { vibrate(15); if (it.rest) startRest(it.rest); } } }, '✓'))),
          h('div', { class: 'btns mt' }, btn('＋ Подход', () => { const l = it.sets.at(-1) || {}; it.sets.push({ reps: l.reps ?? null, weight: l.weight ?? null, sec: l.sec ?? null, km: null, min: null, done: false }); save(); draw(); }, 'small'),
            it.sets.length > 1 ? btn('− Подход', () => { it.sets.pop(); save(); draw(); }, 'small ghost') : null,
            h('span', { class: 'muted small' }, `отдых ${it.rest || 0} с`))));
      }),
      btn('＋ Упражнение', () => pickExercise((ex) => { w.items.push({ exId: ex.id, name: ex.name, metric: ex.metric, rest: ex.cat === 'strength' ? 120 : 60, sets: [{ reps: null, weight: null, sec: null, km: null, min: null, done: false }] }); save(); draw(); }), 'wide mb'),
      h('div', { class: 'btns' }, btn('Завершить тренировку', () => finish(w), 'primary'), btn('Отменить', async () => { if (await confirmDialog('Удалить эту тренировку без сохранения?', { danger: true, ok: 'Удалить' })) { clearInterval(restTimer); await S.delLog(w.id); location.replace('#/workouts'); } }, 'danger ghost')),
      h('p', { class: 'muted small mt' }, 'Не тренируйтесь через боль. Если появилась острая боль, головокружение или боль в груди — остановитесь.'),
    );
  };
  draw();
  return root;
}

function finish(w) {
  formSheet({ title: 'Как прошло?', saveLabel: 'Завершить', fields: [
    { name: 'minutes', label: 'Длительность', unit: 'мин', type: 'number', min: 1, max: 600, value: Math.max(1, Math.round((Date.now() - w.ts) / 60000)) },
    { name: 'rpe', label: 'Тяжесть тренировки (1 — очень легко, 10 — максимум)', type: 'scale', min: 1, max: 10, value: w.rpe },
    { name: 'feeling', label: 'Самочувствие после', type: 'scale', min: 1, max: 5, value: w.feeling, captions: ['плохо', 'отлично'] },
    { name: 'pain', label: 'Была боль или дискомфорт в суставах/спине', type: 'check', value: false },
    { name: 'note', label: 'Заметка', type: 'textarea', rows: 2 },
  ], onSave: async (v) => {
    clearInterval(restTimer);
    const items = w.items.map((it) => ({ ...it, sets: it.sets.filter((s) => s.done || s.reps || s.sec || s.km) }));
    const vol = sum(items, (it) => volume(it.sets.filter((s) => s.done !== false)));
    const mets = items.map((it) => (S.def(it.exId) || {}).met).filter(Boolean);
    const kcal = Math.round(metKcal(avg(mets) || 4, kgNow() || 0, v.minutes));
    const end = w.ts + v.minutes * 60000;
    await S.putLog({ ...w, items, end: Math.min(Date.now(), Math.max(end, w.ts + 60000)), minutes: v.minutes, rpe: v.rpe, feeling: v.feeling, pain: v.pain, note: v.note, volume: round(vol), kcal, load: sessionLoad(v.minutes, v.rpe) });
    location.replace('#/workouts');
    if (v.pain) setTimeout(() => info('Боль во время тренировки', 'Не продолжайте упражнения через боль. Если боль повторяется или не проходит — обратитесь к врачу.\n\nВы можете отметить упражнение как противопоказанное: откройте его в библиотеке и нажмите «Отметить как противопоказанное» — оно исчезнет из программ.'), 400);
    else toast('Тренировка сохранена 💪');
  } });
}

// ── Активность (кардио, шаги) ──
export function addActivity(l) {
  const isNew = !l;
  const cardio = S.defs('exercise').filter((e) => ['cardio'].includes(e.cat));
  const opts = [{ value: 'steps', label: 'Шаги за день' }, ...cardio.map((e) => ({ value: e.id, label: e.name })), { value: 'other', label: 'Другое' }];
  formSheet({ title: isNew ? 'Активность' : 'Изменить активность', fields: [
    { name: 'ex', label: 'Вид', type: 'select', options: opts, value: l ? l.ex : (cardio[0] && cardio[0].id) },
    { name: 'name', label: 'Название (для «Другое»)', value: l && l.ex === 'other' ? l.name : '' },
    { name: 'minutes', label: 'Минут', type: 'number', min: 0, max: 1440, value: l && l.minutes, half: true },
    { name: 'distance', label: 'Км', type: 'number', min: 0, max: 500, value: l && l.distance, half: true },
    { name: 'steps', label: 'Шаги', type: 'number', min: 0, max: 100000, value: l && l.steps, half: true },
    { name: 'kcal', label: 'Ккал (необяз.)', type: 'number', min: 0, max: 5000, value: l && l.kcal, half: true, help: 'Пусто — оценка по MET и весу' },
    { name: 'ts', label: 'Когда', type: 'datetime', value: l ? l.ts : Date.now() },
    { name: 'feeling', label: 'Самочувствие после', type: 'scale', min: 1, max: 5, value: l && l.feeling },
  ], onSave: async (v) => {
    if (!v.minutes && !v.steps && !v.distance) return 'Укажите минуты, шаги или дистанцию';
    const ex = S.def(v.ex);
    const name = v.ex === 'steps' ? 'Шаги' : ex ? ex.name : v.name || 'Активность';
    const kcal = v.kcal ?? (ex && v.minutes ? Math.round(metKcal(ex.met, kgNow() || 0, v.minutes)) : 0);
    await S.putLog({ ...(l || { kind: 'activity' }), ex: v.ex, name, minutes: v.minutes || 0, distance: v.distance, steps: v.steps || 0, kcal, ts: v.ts, feeling: v.feeling });
  }, onDelete: isNew ? null : () => S.delLog(l.id) });
}

function listTab() {
  const open = S.logs('workout').find((w) => !w.end);
  const tpls = S.defs('wtpl');
  const hist = [...S.logs('workout').filter((w) => w.end), ...S.logs('activity')].sort((a, b) => b.ts - a.ts).slice(0, 30);
  const a = activityDay(S.cur().key);
  return h('div', null,
    open ? card('Идёт тренировка', h('div', null, row(open.name, `с ${tsToHm(open.ts)}`), btn('Продолжить', () => { location.hash = '#/session/' + open.id; }, 'primary wide')), { cls: 'hero' }) : null,
    card('Сегодня', h('div', null,
      h('div', { class: 'grid3' }, h('div', { class: 'stat' }, h('b', null, fmt(a.minutes)), h('small', null, 'минут')), h('div', { class: 'stat' }, h('b', null, a.workouts), h('small', null, 'тренировок')), h('div', { class: 'stat' }, h('b', null, fmt(a.steps)), h('small', null, 'шагов'))),
      h('div', { class: 'btns mt' }, btn('▶ Свободная тренировка', () => startWorkout(null), 'primary'), btn('＋ Кардио / шаги', () => addActivity(null))))),
    card('Мои программы', h('div', null,
      tpls.length ? tpls.map((t) => row(t.name, h('button', { class: 'btn small primary', onclick: (e) => { e.stopPropagation(); startWorkout(t); } }, '▶'), { sub: `${t.items.length} упражнений`, onclick: () => tplEdit(t) })) : h('p', { class: 'muted small' }, 'Создайте свою программу или добавьте готовые шаблоны — их можно менять.'),
      h('div', { class: 'btns mt' }, btn('＋ Программа', () => tplEdit(null), 'small'), btn('Готовые шаблоны', addPresets, 'small ghost')))),
    card('История', hist.length ? h('div', null, hist.map((x) => x.kind === 'workout'
      ? row(x.name, `${x.minutes || '—'} мин`, { icon: '🏋️', sub: `${fmtDateTime(x.ts)}${x.rpe ? ' · тяжесть ' + x.rpe + '/10' : ''}${x.volume ? ' · ' + fmt(toDisp('weight', x.volume)) + ' ' + unitLabel('weight') : ''}${x.feeling ? ' · самочувствие ' + x.feeling + '/5' : ''}`, onclick: () => workoutView(x) })
      : row(x.name, x.minutes ? `${x.minutes} мин` : `${fmt(x.steps)} шаг.`, { icon: x.ex === 'steps' ? '👣' : '🏃', sub: `${fmtDateTime(x.ts)}${x.distance ? ' · ' + x.distance + ' км' : ''}`, onclick: () => addActivity(x) }))) : empty('Тренировок пока нет. Частоту вы определяете сами.')),
  );
}

function workoutView(w) {
  sheet({ title: w.name, body: h('div', null,
    row('Начало', fmtDateTime(w.ts)), row('Длительность', `${w.minutes || '—'} мин`), w.rpe ? row('Тяжесть', `${w.rpe}/10`) : null, w.feeling ? row('Самочувствие', `${w.feeling}/5`) : null,
    w.volume ? row('Тоннаж', `${fmt(toDisp('weight', w.volume))} ${unitLabel('weight')}`) : null, w.kcal ? row('Оценка ккал', fmt(w.kcal)) : null, w.pain ? h('div', { class: 'hint warn' }, 'Отмечена боль/дискомфорт') : null,
    h('div', { class: 'sep' }), ...(w.items || []).map((it) => { const ex = S.def(it.exId) || { metric: it.metric, name: it.name }; return row(ex.name, null, { sub: it.sets.map(setText(ex)).join(' · ') || '—' }); }),
    w.note ? h('p', { class: 'muted' }, w.note) : null),
  actions: [{ label: 'Удалить', cls: 'danger ghost', onClick: async () => { if (await confirmDialog('Удалить тренировку?', { danger: true })) { await S.delLog(w.id); return true; } return false; } },
    { label: 'Изменить оценку', onClick: () => formSheet({ title: 'Оценка', fields: [{ name: 'minutes', label: 'Минут', type: 'number', min: 1, max: 600, value: w.minutes }, { name: 'rpe', label: 'Тяжесть', type: 'scale', min: 1, max: 10, value: w.rpe }, { name: 'feeling', label: 'Самочувствие', type: 'scale', min: 1, max: 5, value: w.feeling }, { name: 'note', label: 'Заметка', type: 'textarea', value: w.note }], onSave: (v) => S.putLog({ ...w, ...v, load: sessionLoad(v.minutes, v.rpe) }) }) }] });
}

function statsTab() {
  const cur = S.cur().key;
  const weeks = []; let ws = weekStart(cur);
  for (let i = 11; i >= 0; i--) weeks.push(addDays(ws, -7 * i));
  const wk = weeks.map((w) => keyRange(w, addDays(w, 6)).map((k) => activityDay(k)));
  const cnt = wk.map((days) => sum(days, (d) => d.workouts));
  const mins = wk.map((days) => sum(days, (d) => d.minutes));
  const loads = {};
  for (const w of S.logs('workout').filter((x) => x.end)) { const k = S.pdayOf(w.ts).key; loads[k] = (loads[k] || 0) + (w.load || 0); }
  const wl = weeks.map((w) => sum(keyRange(w, addDays(w, 6)), (k) => loads[k] || 0));
  const ratio = acwr(loads, cur);
  const goalW = S.settings.activity.weeklyWorkouts;
  return h('div', null,
    card('Тренировки по неделям', chart({ labels: weeks.map((w) => fmtDateShort(w)), series: [{ name: 'Тренировок', values: cnt, color: 'var(--act)' }], type: 'bar', goal: goalW || null, allowZero: true })),
    card('Минуты активности по неделям', chart({ labels: weeks.map((w) => fmtDateShort(w)), series: [{ name: 'Минут', values: mins, color: '#4cc3ff' }], type: 'bar', goal: S.settings.activity.weeklyMinutes || null })),
    card('Тренировочная нагрузка', h('div', null,
      chart({ labels: weeks.map((w) => fmtDateShort(w)), series: [{ name: 'Нагрузка (мин × тяжесть)', values: wl, color: '#ff8f5a' }], type: 'bar' }),
      row('Соотношение «неделя / месяц»', ratio == null ? '—' : fmt(ratio, 2)),
      h('p', { class: 'muted small' }, 'Нагрузка тренировки = длительность × субъективная тяжесть (1–10). Соотношение — нагрузка последних 7 дней к средней недельной за 28 дней. Около 0,8–1,3 — нагрузка растёт плавно; резкий скачок выше 1,5 — повод добавить отдых. Это ориентир, а не медицинская оценка.'))),
    card('Цели активности', h('div', null,
      row('Тренировок в неделю', goalW ? String(goalW) : 'не задано'), row('Минут активности в неделю', S.settings.activity.weeklyMinutes ? String(S.settings.activity.weeklyMinutes) : 'не задано'), row('Шагов в день', S.settings.activity.stepsGoal ? String(S.settings.activity.stepsGoal) : 'не задано'),
      btn('Изменить', () => formSheet({ title: 'Цели активности', fields: [
        { type: 'hint', label: 'Все цели необязательны. Пустое поле — без цели.' },
        { name: 'weeklyWorkouts', label: 'Тренировок в неделю', type: 'number', min: 0, max: 21, value: goalW },
        { name: 'weeklyMinutes', label: 'Минут активности в неделю', type: 'number', min: 0, max: 5000, value: S.settings.activity.weeklyMinutes },
        { name: 'stepsGoal', label: 'Шагов в день', type: 'number', min: 0, max: 100000, value: S.settings.activity.stepsGoal },
      ], onSave: (v) => S.saveSettings({ activity: { weeklyWorkouts: v.weeklyWorkouts || null, weeklyMinutes: v.weeklyMinutes || null, stepsGoal: v.stepsGoal || null } }) }), 'small mt'))),
  );
}

// ── Спина, осанка, мобильность ──
function backPage() {
  const r = S.settings.restrictions;
  const form = buildForm([
    { name: 'risks', label: 'Мои ограничения — исключать упражнения, нагружающие:', type: 'chips', options: Object.entries(RISKS).map(([v, l]) => ({ value: v, label: l })), value: r.risks || [] },
    { name: 'note', label: 'Заметка об ограничениях', type: 'textarea', rows: 2, value: r.note, placeholder: 'например: протрузия L5-S1, рекомендации врача…' },
  ]);
  const routines = [
    { name: 'Спина и осанка (10 мин)', cats: ['back'] },
    { name: 'Мобильность после смены', cats: ['mobility', 'stretch'] },
  ];
  const exs = S.defs('exercise').filter((e) => ['back', 'mobility'].includes(e.cat));
  const excluded = S.defs('exercise').filter((e) => (r.excluded || []).includes(e.id));
  return h('div', null,
    pageHeader('Спина, осанка, мобильность', { back: true }),
    h('div', { class: 'hint danger mb' }, 'Не выполняйте упражнения через боль. При острой боли, онемении, слабости в ногах или боли после травмы — сначала к врачу. Упражнения здесь — общая профилактика, а не лечение.'),
    card('Ограничения', h('div', null, form.node, btn('Сохранить', async () => { const v = form.read().values; await S.saveSettings({ restrictions: { risks: v.risks, note: v.note } }); toast('Ограничения сохранены'); }, 'primary wide mt'))),
    card('Готовые комплексы', h('div', null, routines.map((rt) => {
      const t = S.defs('wtpl').find((x) => x.name === rt.name);
      return row(rt.name, h('button', { class: 'btn small primary', onclick: async () => { if (!t) await addPresets(); startWorkout(S.defs('wtpl').find((x) => x.name === rt.name)); } }, '▶'), { sub: 'противопоказанные упражнения пропускаются' });
    }))),
    card('Упражнения', h('div', null, exs.map((e) => row(e.name, allowed(e) ? null : h('span', { class: 'badge warn' }, 'исключено'), { icon: catIco(e.cat), sub: e.muscles, onclick: () => { location.hash = '#/exercise/' + e.id; } })))),
    excluded.length ? card('Отмечены как противопоказанные', h('div', null, excluded.map((e) => row(e.name, '›', { onclick: () => { location.hash = '#/exercise/' + e.id; } })))) : null,
    h('p', { class: 'muted small' }, 'Рабочее место: экран на уровне глаз, опора для поясницы, перерыв на движение каждые 45–60 минут — особенно на долгих ночных сменах.'),
  );
}

export default {
  workouts: { tab: 'activity', render: () => h('div', null,
    pageHeader('Тренировки', { back: true, actions: [h('button', { class: 'icon-btn', onclick: () => { location.hash = '#/library'; }, 'aria-label': 'Библиотека' }, '📚')] }),
    tabs([{ id: 'list', label: 'Занятия' }, { id: 'stats', label: 'Прогресс и нагрузка' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'list' ? listTab() : statsTab()) },
  library: { tab: 'activity', render: () => h('div', null, pageHeader('Библиотека упражнений', { back: true }), library()) },
  'exercise/:id': { tab: 'activity', render: exercisePage },
  'session/:id': { tab: 'activity', live: true, render: sessionPage },
  back: { tab: 'activity', render: backPage },
  cardio: { tab: 'activity', render: () => {
    const k14 = S.lastDays(14);
    const acts = S.logs('activity').slice(-40).reverse();
    return h('div', null, pageHeader('Ходьба, бег, велосипед', { back: true }),
      btn('＋ Добавить активность', () => addActivity(null), 'primary wide mb'),
      card('Минуты за 14 дней', chart({ labels: k14.map(fmtDateShort), series: [{ name: 'Минут', values: k14.map((k) => activityDay(k).minutes || null), color: 'var(--act)' }], type: 'bar' })),
      card('Шаги за 14 дней', chart({ labels: k14.map(fmtDateShort), series: [{ name: 'Шаги', values: k14.map((k) => activityDay(k).steps || null), color: '#4cc3ff' }], type: 'bar', goal: S.settings.activity.stepsGoal || null })),
      card('Записи', acts.length ? h('div', null, acts.map((x) => row(x.name, x.minutes ? `${x.minutes} мин` : `${fmt(x.steps)} шаг.`, { sub: `${fmtDateTime(x.ts)}${x.distance ? ' · ' + x.distance + ' км' : ''}${x.kcal ? ' · ~' + x.kcal + ' ккал' : ''}`, onclick: () => addActivity(x) }))) : empty('Записей нет')));
  } },
};
export { DAY, chips };
