import { S, MODULES, uid } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, fmt, empty, refresh, confirmDialog, buildForm, info } from '../ui/dom.js';
import { fmtDate, fmtDateShort, fmtDateTime, hmToMin, spanMinutes, fmtDuration, addDays, WD_FULL, WD_SHORT, tsToHm, keyRange } from '../core/time.js';
import { ACTIVITY_LEVELS } from '../core/calc.js';
import { UNIT_OPTIONS } from '../ui/units.js';
import { exportJson, restoreJson, csvKinds, exportCsv, autoBackupNow } from '../data/backup.js';
import { pickFile, isNative, listBackups, readBackup, notifPermission } from '../native.js';
import { upcoming, services } from '../services.js';
import { dashboardSettings } from './home.js';

const VERSION = '1.0.0';

function group(title, items) {
  return card(title, h('div', null, items.map(([icon, label, sub, href]) => row(label, '›', { icon, sub, onclick: typeof href === 'function' ? href : () => { location.hash = href; } }))));
}

function main() {
  const p = S.settings.profile;
  const b = S.settings.backup;
  return h('div', null, pageHeader('Настройки'),
    group('Я и мой режим', [
      ['👤', 'Профиль', [p.name, p.height ? p.height + ' см' : null, p.birthYear ? p.birthYear + ' г. р.' : null].filter(Boolean).join(' · ') || 'не заполнен', '#/profile'],
      ['🕒', 'Мой режим', 'смены, сон, приёмы пищи, шаблоны дней', '#/schedule'],
      ['🔔', 'Напоминания', S.settings.quiet.all ? 'все уведомления выключены' : 'свои напоминания и тихие режимы', '#/reminders'],
    ]),
    group('Вид и состав', [
      ['🧩', 'Модули', `включено ${MODULES.filter((m) => S.settings.modules[m.id] !== false).length} из ${MODULES.length}`, '#/modules'],
      ['⊞', 'Главная страница', 'карточки, порядок, названия', dashboardSettings],
      ['📏', 'Единицы измерения', Object.values(S.settings.units).join(' · '), unitsSheet],
      ['📈', 'Графики', S.settings.charts.style === 'bar' ? 'столбцы' : 'линии', chartsSheet],
    ]),
    group('Цели модулей', [
      ['💧', 'Вода', `${S.settings.water.goal} мл`, '#/water'], ['🥗', 'Калории и БЖУ', `${S.settings.food.targets.kcal} ккал`, () => { location.hash = '#/food'; }],
      ['🌙', 'Сон', fmtDuration(S.settings.sleep.goalMin), '#/sleep'], ['⚖️', 'Вес', S.settings.body.target ? S.settings.body.target + ' кг' : 'не задан', '#/body'],
      ['🏋️', 'Тренировки и ограничения', '', '#/back'],
    ]),
    group('Данные', [
      ['💾', 'Резервная копия и экспорт', b.last ? 'последняя копия ' + fmtDateTime(b.last) : 'копий ещё не было', '#/data'],
    ]),
    group('О приложении', [['ℹ️', 'LIFE OS', `версия ${VERSION} · офлайн · без ИИ и серверов`, '#/about']]));
}

// ── Профиль ──
function profilePage() {
  const p = S.settings.profile;
  const form = buildForm([
    { name: 'name', label: 'Имя', value: p.name },
    { name: 'sex', label: 'Пол (для расчёта обмена веществ)', type: 'seg', options: [{ value: 'm', label: 'Мужской' }, { value: 'f', label: 'Женский' }], value: p.sex },
    { name: 'birthYear', label: 'Год рождения', type: 'number', min: 1920, max: new Date().getFullYear() - 10, value: p.birthYear, half: true },
    { name: 'height', label: 'Рост, см', type: 'number', min: 100, max: 250, value: p.height, half: true },
    { name: 'activity', label: 'Уровень активности', type: 'select', options: ACTIVITY_LEVELS.map((a) => ({ value: a.id, label: a.label })), value: p.activity },
  ]);
  return h('div', null, pageHeader('Профиль', { back: true }), card(null, form.node),
    btn('Сохранить', async () => { const r = form.read(); if (!r.ok) { toast('Проверьте поля'); return; } await S.saveSettings({ profile: r.values }); toast('Сохранено'); history.back(); }, 'primary wide'),
    h('p', { class: 'muted small mt' }, 'Данные нужны только для расчётов внутри приложения (калорийность, ИМТ) и никуда не передаются.'));
}

// ── Мой режим ──
function scheduleSummary(t) {
  const parts = [];
  if (t.isWork && t.workStart) parts.push(`смена ${t.workStart}–${t.workEnd}`);
  if (t.sleepStart && t.sleepEnd) parts.push(`сон ${t.sleepStart}–${t.sleepEnd} (${fmtDuration(spanMinutes(hmToMin(t.sleepStart), hmToMin(t.sleepEnd)))})`);
  return parts.join(' · ') || 'время не задано';
}
function schedulePage() {
  const sch = S.settings.schedule;
  const tpls = S.settings.templates;
  const cur = S.cur().key;
  const next = keyRange(cur, addDays(cur, 6));
  const opts = tpls.map((t) => ({ value: t.id, label: t.name }));
  const wd = h('div', null, [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const sel = h('select', { class: 'inp', style: { width: '60%' } }, opts.map((o) => h('option', { value: o.value }, o.label)));
    sel.value = sch.weekdays[d] || tpls[0].id;
    sel.onchange = () => S.setSetting('schedule.weekdays', { ...S.settings.schedule.weekdays, [d]: sel.value });
    return h('div', { class: 'row' }, h('div', { class: 'row-main' }, WD_FULL[d]), sel);
  }));
  const overrides = Object.entries(sch.overrides || {}).sort();
  return h('div', null, pageHeader('Мой режим', { back: true }),
    h('p', { class: 'muted small mb' }, 'Приложение не навязывает распорядок: сон, смены, еда и тренировки — в то время, которое задаёте вы. Шаблон дня определяет плановое время; фактический личный день начинается, когда вы отмечаете пробуждение.'),
    card('Шаблоны дней', h('div', null, tpls.map((t) => row(t.name, '›', { icon: h('span', { style: { color: t.color } }, '●'), sub: scheduleSummary(t), onclick: () => { location.hash = '#/template/' + t.id; } })),
      btn('＋ Свой шаблон', async () => { const t = { ...JSON.parse(JSON.stringify(tpls[0])), id: uid('t_'), name: 'Новый шаблон' }; await S.setSetting('templates', [...tpls, t]); location.hash = '#/template/' + t.id; }, 'small mt'))),
    card('Неделя по умолчанию', wd),
    card('Исключения и периоды', h('div', null,
      overrides.map(([k, id]) => row(fmtDate(k, true), (tpls.find((t) => t.id === id) || {}).name || '?', { onclick: async () => { if (await confirmDialog('Удалить исключение?')) { const o = { ...S.settings.schedule.overrides }; delete o[k]; await S.setSetting('schedule.overrides', o); } } })),
      (sch.ranges || []).map((r, i) => row(`${fmtDateShort(r.from)} — ${fmtDateShort(r.to)}`, (tpls.find((t) => t.id === r.tpl) || {}).name || '?', { sub: 'период', onclick: async () => { if (await confirmDialog('Удалить период?')) { await S.setSetting('schedule.ranges', S.settings.schedule.ranges.filter((_, j) => j !== i)); } } })),
      !overrides.length && !(sch.ranges || []).length ? h('p', { class: 'muted small' }, 'Например: отпуск, больничный, смена графика на один день.') : null,
      h('div', { class: 'btns mt' },
        btn('＋ День', () => formSheet({ title: 'Исключение на день', fields: [{ name: 'date', label: 'Дата', type: 'date', required: true, value: cur }, { name: 'tpl', label: 'Шаблон', type: 'select', options: opts }], onSave: (v) => S.setSetting('schedule.overrides', { ...S.settings.schedule.overrides, [v.date]: v.tpl }) }), 'small'),
        btn('＋ Период (отпуск)', () => formSheet({ title: 'Период', fields: [{ name: 'from', label: 'С', type: 'date', required: true, value: cur, half: true }, { name: 'to', label: 'По', type: 'date', required: true, value: addDays(cur, 13), half: true }, { name: 'tpl', label: 'Шаблон', type: 'select', options: opts, value: (tpls.find((t) => t.id === 't_vac') || tpls[0]).id }], onSave: (v) => { if (v.to < v.from) return 'Конец раньше начала'; return S.setSetting('schedule.ranges', [...(S.settings.schedule.ranges || []), v]); } }), 'small')))),
    card('Ближайшие 7 дней', h('div', null, next.map((k) => { const t = S.template(k); const r = S.range(k); return row(`${WD_SHORT[new Date(k + 'T12:00').getDay() || 7]}, ${fmtDateShort(k)}`, t ? t.name : '—', { sub: `${t ? scheduleSummary(t) : ''}${k === cur ? ` · личный день идёт с ${tsToHm(r.start)}` : ''}` }); }))),
    h('p', { class: 'muted small' }, 'Если вы забыли отметить пробуждение, новый личный день начнётся автоматически посередине планового сна по шаблону. Границы дня можно поправить вручную на главной (нажмите на строку «Личный день»).'));
}

function templatePage({ id }) {
  const tpls = S.settings.templates;
  const t = tpls.find((x) => x.id === id);
  if (!t) return h('div', null, pageHeader('Шаблон', { back: true }), empty('Шаблон не найден'));
  const meals = JSON.parse(JSON.stringify(t.meals || []));
  const rest = JSON.parse(JSON.stringify(t.rest || []));
  const form = buildForm([
    { name: 'name', label: 'Название', required: true, value: t.name },
    { name: 'color', label: 'Цвет', type: 'color', value: t.color },
    { name: 'isWork', label: 'Рабочий день (есть смена)', type: 'check', value: t.isWork },
    { name: 'workStart', label: 'Начало смены', type: 'time', value: t.workStart, half: true },
    { name: 'workEnd', label: 'Окончание смены', type: 'time', value: t.workEnd, half: true },
    { name: 'sleepStart', label: 'Отход ко сну', type: 'time', value: t.sleepStart, half: true },
    { name: 'sleepEnd', label: 'Пробуждение', type: 'time', value: t.sleepEnd, half: true },
    { type: 'hint', label: 'Продолжительность сна считается автоматически. Сон может быть днём — например, 07:00–15:00.' },
    { name: 'workoutTime', label: 'Время тренировки (необяз.)', type: 'time', value: t.workoutTime, half: true },
    { name: 'habitsTime', label: 'Время привычек (необяз.)', type: 'time', value: t.habitsTime, half: true },
    { name: 'remindFrom', label: 'Напоминания с', type: 'time', value: t.remindFrom, half: true },
    { name: 'remindTo', label: 'Напоминания до', type: 'time', value: t.remindTo, half: true },
    { type: 'hint', label: 'Окно напоминаний необязательно: вне его обычные уведомления не приходят (важные — приходят).' },
  ]);
  const mealsBox = h('div');
  const drawMeals = () => mealsBox.replaceChildren(...meals.map((m, i) => {
    const n = h('input', { class: 'inp', value: m.name, placeholder: 'Название' }); n.oninput = () => { m.name = n.value; };
    const tm = h('input', { class: 'inp', type: 'time', value: m.time || '', style: { width: '120px' } }); tm.oninput = () => { m.time = tm.value; };
    return h('div', { class: 'split mb' }, n, tm, h('button', { class: 'icon-btn', onclick: () => { meals.splice(i, 1); drawMeals(); } }, '✕'));
  }), btn('＋ Приём пищи', () => { meals.push({ name: 'Приём пищи', time: '' }); drawMeals(); }, 'small'));
  drawMeals();
  const restBox = h('div');
  const drawRest = () => restBox.replaceChildren(...rest.map((r, i) => {
    const a = h('input', { class: 'inp', type: 'time', value: r.from || '' }); a.oninput = () => { r.from = a.value; };
    const b = h('input', { class: 'inp', type: 'time', value: r.to || '' }); b.oninput = () => { r.to = b.value; };
    return h('div', { class: 'split mb' }, a, '—', b, h('button', { class: 'icon-btn', onclick: () => { rest.splice(i, 1); drawRest(); } }, '✕'));
  }), btn('＋ Период отдыха', () => { rest.push({ from: '', to: '' }); drawRest(); }, 'small'));
  drawRest();
  return h('div', null, pageHeader(t.name, { back: true }),
    card(null, form.node), card('Приёмы пищи', mealsBox), card('Периоды отдыха', restBox),
    h('div', { class: 'btns' },
      btn('Сохранить', async () => {
        const r = form.read(); if (!r.ok) { toast('Проверьте поля'); return; }
        const v = r.values;
        if (v.isWork && (!v.workStart || !v.workEnd)) { toast('Укажите начало и окончание смены'); return; }
        if ((v.sleepStart && !v.sleepEnd) || (!v.sleepStart && v.sleepEnd)) { toast('Укажите и отход ко сну, и пробуждение'); return; }
        await S.setSetting('templates', S.settings.templates.map((x) => (x.id === t.id ? { ...x, ...v, meals: meals.filter((m) => m.name.trim()), rest: rest.filter((q) => q.from && q.to) } : x)));
        toast('Шаблон сохранён'); history.back();
      }, 'primary'),
      tpls.length > 1 ? btn('Удалить шаблон', async () => {
        const used = Object.values(S.settings.schedule.weekdays).includes(t.id) || Object.values(S.settings.schedule.overrides || {}).includes(t.id) || (S.settings.schedule.ranges || []).some((r) => r.tpl === t.id);
        if (used) { toast('Шаблон используется в неделе или исключениях — сначала замените его'); return; }
        if (await confirmDialog(`Удалить шаблон «${t.name}»?`, { danger: true })) { await S.setSetting('templates', tpls.filter((x) => x.id !== t.id)); history.back(); }
      }, 'danger ghost') : null));
}

// ── Напоминания ──
const MODE_T = { time: 'В указанное время', interval: 'Каждые N минут', wake: 'После планового пробуждения', sleep: 'До планового сна' };
function reminderEdit(r) {
  const isNew = !r;
  r = r || { kind: 'reminder', enabled: true, mode: 'time', dayType: 'any', days: [] };
  formSheet({ title: isNew ? 'Новое напоминание' : 'Напоминание', fields: [
    { name: 'text', label: 'Текст', required: true, value: r.text },
    { name: 'mode', label: 'Когда', type: 'select', options: Object.entries(MODE_T).map(([v, l]) => ({ value: v, label: l })), value: r.mode },
    { name: 'time', label: 'Время (для «в указанное время»)', type: 'time', value: r.time, half: true },
    { name: 'offset', label: 'Сдвиг, мин (для пробуждения/сна)', type: 'number', min: 0, max: 1440, value: r.offset ?? 30, half: true },
    { name: 'every', label: 'Интервал, мин', type: 'number', min: 15, max: 1440, value: r.every ?? 120, half: true },
    { name: 'from', label: 'С (интервал)', type: 'time', value: r.from, half: true },
    { name: 'to', label: 'До (интервал)', type: 'time', value: r.to },
    { name: 'days', label: 'Дни недели (не выбрано — все)', type: 'days', value: r.days || [] },
    { name: 'dayType', label: 'Тип дня', type: 'seg', options: [{ value: 'any', label: 'Любой' }, { value: 'work', label: 'Рабочий' }, { value: 'off', label: 'Выходной' }], value: r.dayType || 'any' },
    { name: 'once', label: 'Разово в дату (необяз.)', type: 'date', value: r.once },
    { name: 'important', label: 'Важное (приходит в режиме «только важные»)', type: 'check', value: r.important },
    { name: 'enabled', label: 'Включено', type: 'check', value: r.enabled },
  ], onSave: async (v) => {
    if (v.mode === 'time' && !v.time) return 'Укажите время';
    await S.putDef({ ...r, ...v, once: v.once || null });
  }, onDelete: isNew ? null : () => S.delDef(r.id) });
}
function remindersPage() {
  const q = S.settings.quiet;
  const status = h('span', { class: 'badge' }, 'проверка…');
  notifPermission(false).then((p) => { status.textContent = p === 'granted' ? 'разрешены' : p === 'denied' ? 'запрещены в системе' : p === 'unsupported' ? 'не поддерживаются' : 'не запрошены'; status.className = 'badge ' + (p === 'granted' ? 'ok' : 'warn'); });
  const sw = (key, label, help) => { const c = h('input', { type: 'checkbox', class: 'switch' }); c.checked = !!q[key]; c.onchange = () => S.saveSettings({ quiet: { [key]: c.checked } }); return h('label', { class: 'field field-check' }, h('span', null, label, help ? h('small', { class: 'muted block' }, help) : null), c); };
  const mr = h('input', { type: 'checkbox', class: 'switch' }); mr.checked = !!S.settings.mealRemind; mr.onchange = () => S.setSetting('mealRemind', mr.checked);
  const up = upcoming(2).slice(0, 12);
  const list = S.defs('reminder');
  return h('div', null, pageHeader('Напоминания', { back: true }),
    card('Уведомления', h('div', null,
      h('div', { class: 'split' }, h('span', null, 'Статус: ', status), btn('Разрешить', async () => { const p = await notifPermission(true); toast(p === 'granted' ? 'Уведомления разрешены' : 'Разрешение не получено — включите в настройках Android'); await services.reschedule(); refresh(); }, 'small')),
      isNative() ? null : h('p', { class: 'hint warn mt' }, 'В браузере уведомления срабатывают, только пока приложение открыто. В APK — системные локальные уведомления, работают без интернета.'))),
    card('Тихие режимы', h('div', { class: 'form' },
      sw('sleep', 'Не беспокоить во время сна', 'По плановому сну из шаблона дня'),
      sw('work', 'Не беспокоить во время работы', 'По смене из шаблона'),
      sw('importantOnly', 'Только важные', 'Лекарства и напоминания, отмеченные как важные'),
      sw('all', 'Отключить все уведомления'))),
    card('Мои напоминания', h('div', null, list.map((r) => row(r.text, r.enabled ? '' : h('span', { class: 'badge' }, 'выкл.'), { sub: `${MODE_T[r.mode]}${r.time ? ' ' + r.time : ''}${r.mode === 'interval' ? ' ' + r.every + ' мин' : ''}${r.important ? ' · важное' : ''}`, onclick: () => reminderEdit(r) })),
      list.length ? null : h('p', { class: 'muted small' }, 'Приложение не присылает ничего, что вы не настроили сами.'),
      btn('＋ Напоминание', () => reminderEdit(null), 'small mt'))),
    card('Из модулей', h('div', null,
      row('Вода', S.settings.water.remind && S.settings.water.remind.on ? `каждые ${S.settings.water.remind.every} мин` : 'выкл.', { onclick: () => { location.hash = '#/water'; } }),
      row('Привычки', `${S.defs('habit').filter((x) => x.remind && x.remind.on && !x.archived).length} с напоминанием`, { onclick: () => { location.hash = '#/good'; } }),
      row('Лекарства', `${S.defs('med').filter((m) => m.remind && !m.archived).length} с напоминанием`, { onclick: () => { location.hash = '#/medical'; } }),
      h('label', { class: 'field field-check mt' }, h('span', null, 'Приёмы пищи по шаблону дня', h('small', { class: 'muted block' }, 'Время берётся из «Моего режима»')), mr))),
    card('Ближайшие 48 часов', up.length ? h('div', null, up.map((x) => row(x.text, fmtDateTime(x.at), { sub: x.source }))) : empty('Нет запланированных напоминаний')));
}

// ── Модули ──
function modulesPage() {
  return h('div', null, pageHeader('Модули', { back: true }),
    h('p', { class: 'muted small mb' }, 'Отключённый модуль исчезает из меню, главной и аналитики. Данные сохраняются — модуль можно включить обратно. Название можно изменить.'),
    card(null, h('div', null, MODULES.map((m) => {
      const c = h('input', { type: 'checkbox', class: 'switch' }); c.checked = S.settings.modules[m.id] !== false;
      c.onchange = () => S.saveSettings({ modules: { [m.id]: c.checked } });
      const name = (S.settings.moduleNames || {})[m.id];
      return h('div', { class: 'row' }, h('div', { class: 'row-main', onclick: () => formSheet({ title: 'Название модуля', fields: [{ name: 'n', label: 'Название', value: name || m.name }], onSave: (v) => S.setSetting('moduleNames', { ...(S.settings.moduleNames || {}), [m.id]: v.n && v.n !== m.name ? v.n : undefined }) }) },
        h('div', { class: 'row-title' }, name || m.name, ' ✎'), name ? h('div', { class: 'row-sub' }, m.name) : null), c);
    }))));
}

function unitsSheet() {
  formSheet({ title: 'Единицы измерения', fields: Object.entries(UNIT_OPTIONS).map(([k, opts]) => ({ name: k, label: { weight: 'Вес', volume: 'Объём', length: 'Длина', energy: 'Энергия' }[k], type: 'select', options: opts, value: S.settings.units[k] })),
    onSave: (v) => S.saveSettings({ units: v }) });
}
function chartsSheet() {
  formSheet({ title: 'Графики', fields: [
    { name: 'style', label: 'Основной вид', type: 'seg', options: [{ value: 'line', label: 'Линии' }, { value: 'bar', label: 'Столбцы' }], value: S.settings.charts.style },
    { name: 'ma', label: 'Скользящее среднее на графике веса', type: 'check', value: S.settings.charts.ma !== false },
  ], onSave: (v) => S.saveSettings({ charts: v }) });
}

// ── Данные ──
async function restoreFlow(text) {
  let mode = null;
  await new Promise((resolve) => sheet({ title: 'Восстановление', body: h('p', { class: 'muted pre' }, 'Как восстановить данные из копии?\n\n«Объединить» — добавит записи из копии к текущим (совпадающие обновятся). «Заменить всё» — текущие данные будут удалены.'), onClose: resolve, actions: [
    { label: 'Объединить', onClick: () => { mode = 'merge'; resolve(); } },
    { label: 'Заменить всё', cls: 'danger', onClick: () => { mode = 'replace'; resolve(); } }] }));
  if (!mode) return;
  if (mode === 'replace' && !(await confirmDialog('Все текущие данные будут заменены данными из копии. Продолжить?', { danger: true, ok: 'Заменить' }))) return;
  try { const r = await restoreJson(text, mode); toast(`Восстановлено: новых ${r.added}, обновлено ${r.updated}`); location.hash = '#/'; }
  catch (e) { info('Не удалось восстановить', String(e.message || e)); }
}
function dataPage() {
  const b = S.settings.backup;
  const kinds = csvKinds();
  const autos = h('div');
  if (isNative()) listBackups().then((l) => autos.replaceChildren(...(l.length ? l.slice(0, 10).map((f) => row(f.name.replace('.json', ''), 'восстановить', { onclick: async () => restoreFlow(await readBackup(f)) })) : [h('p', { class: 'muted small' }, 'Автокопий пока нет')])));
  const total = S.logsMap.size;
  return h('div', null, pageHeader('Данные', { back: true }),
    card('Хранение', h('div', null, row('Записей', fmt(total)), row('Справочников (продукты, упражнения…)', fmt(S.defsMap.size)),
      h('p', { class: 'muted small' }, 'Все данные хранятся только на этом устройстве в локальной базе. Нет серверов, регистрации и интернета. Чтобы не потерять данные при смене телефона или удалении приложения — делайте резервные копии.'))),
    card('Резервная копия', h('div', null,
      row('Последняя ручная копия', b.last ? fmtDateTime(b.last) : 'нет'),
      h('div', { class: 'btns mt' }, btn('💾 Создать копию', async () => { await exportJson({ withPhotos: true }); toast('Копия создана'); refresh(); }, 'primary'), btn('Без фото (меньше)', async () => { await exportJson({ withPhotos: false }); refresh(); }, 'ghost')),
      h('p', { class: 'muted small' }, isNative() ? 'Откроется меню «Поделиться» — сохраните файл в «Файлы», на Диск или отправьте себе в мессенджер.' : 'Файл .json скачается в папку загрузок.'))),
    card('Восстановление', h('div', null, btn('📂 Восстановить из файла', async () => { const f = await pickFile(); if (f) await restoreFlow(f.text); }, 'wide'),
      h('p', { class: 'muted small' }, 'Перенос на другое устройство: создайте копию здесь, установите LIFE OS на новом телефоне и восстановите из файла.'))),
    isNative() ? card('Автоматическое копирование', h('div', null,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Как часто'), (() => { const s = h('select', { class: 'inp' }, [['daily', 'Каждый день'], ['weekly', 'Раз в неделю'], ['off', 'Выключено']].map(([v, l]) => h('option', { value: v }, l))); s.value = b.auto; s.onchange = () => S.saveSettings({ backup: { auto: s.value } }); return s; })()),
      row('Последняя автокопия', b.lastAuto ? fmtDateTime(b.lastAuto) : 'нет', { sub: b.autoWhere ? 'папка: ' + b.autoWhere : 'хранятся 7 последних' }),
      btn('Сделать автокопию сейчас', async () => { const ok = await autoBackupNow(); toast(ok ? 'Готово' : 'Не удалось записать файл'); refresh(); }, 'small'), h('div', { class: 'form-section mt' }, 'Автокопии'), autos)) : null,
    card('Экспорт', h('div', null,
      row('Всё в JSON', '›', { sub: 'полная копия — для переноса и архива', onclick: () => exportJson({ withPhotos: false }) }),
      ...kinds.map((k) => row(`${k.name} — CSV`, k.count ? fmt(k.count) : '—', { sub: 'таблица для Excel: дата, календарная дата, личный день', onclick: () => (k.count ? exportCsv(k.id) : toast('Нет записей')) })))),
    card('Опасная зона', h('div', null, btn('Удалить все данные', async () => {
      if (!(await confirmDialog('Удалить ВСЕ записи, настройки и фото с этого устройства? Сначала сделайте резервную копию.', { danger: true, ok: 'Удалить всё' }))) return;
      if (!(await confirmDialog('Точно? Это необратимо.', { danger: true, ok: 'Да, удалить' }))) return;
      await S.wipe(); location.hash = '#/welcome';
    }, 'danger ghost wide'))));
}

function aboutPage() {
  return h('div', null, pageHeader('LIFE OS', { back: true }),
    card(null, h('div', null, h('div', { class: 'logo' }, 'LIFE OS'), h('p', { class: 'muted' }, `Версия ${VERSION}. Персональная система управления здоровьем и образом жизни.`),
      row('Работа', 'полностью офлайн'), row('ИИ и внешние сервисы', 'нет'), row('Регистрация', 'нет'), row('Хранение', 'локальная база IndexedDB на устройстве'), row('Уведомления', isNative() ? 'локальные (Android)' : 'только пока открыта вкладка'))),
    card('Принципы', h('div', { class: 'pre muted small' }, 'Ваш режим — ваш: никаких обязательных «сна в 21:00» и «завтрака в 8 утра».\nНичего не обязательно: модули, цели и напоминания включаете вы.\nСрыв не обнуляет прогресс.\nВся статистика — только по введённым данным.\nПриложение не ставит диагнозы и не назначает лечение.')),
    card('Что важно знать', h('div', { class: 'pre muted small' }, '• Изображения техники упражнений: встроены текстовые описания; свои фото или схемы можно прикрепить к любому упражнению.\n• Пищевая ценность встроенных продуктов — ориентировочная, её можно исправить.\n• Шаги не считываются автоматически с датчиков — их вносят вручную (без доступа к сервисам и интернету).')));
}

export default {
  settings: { tab: 'settings', render: main },
  profile: { tab: 'settings', live: true, render: profilePage },
  schedule: { tab: 'settings', render: schedulePage },
  'template/:id': { tab: 'settings', live: true, render: templatePage },
  reminders: { tab: 'settings', render: remindersPage },
  modules: { tab: 'settings', render: modulesPage },
  data: { tab: 'settings', render: dataPage },
  about: { tab: 'settings', render: aboutPage },
};
