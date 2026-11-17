import { S, MODULES } from '../data/store.js';
import { h, btn, card, buildForm, toast, seg } from '../ui/dom.js';
import { ACTIVITY_LEVELS } from '../core/calc.js';

let step = 0;
let preset = 'night';
const PRESETS = {
  night: { label: 'Ночные смены', sub: 'смена 20:30–06:30 (Пн–Пт), сон 07:00–15:00', work: ['20:30', '06:30'], sleep: ['07:00', '15:00'], offSleep: ['07:00', '15:00'], meals: ['15:30', '19:30', '01:00'] },
  day: { label: 'Дневной график', sub: 'работа 09:00–18:00 (Пн–Пт), сон 23:00–07:00', work: ['09:00', '18:00'], sleep: ['23:00', '07:00'], offSleep: ['00:00', '08:30'], meals: ['07:30', '13:00', '19:00'] },
  free: { label: 'Свой график', sub: 'оставлю шаблоны как есть и настрою в «Моём режиме»' },
};

function applyPreset(id) {
  const p = PRESETS[id];
  if (!p.work) return;
  const t = S.settings.templates.map((x) => {
    if (x.id === 't_work') return { ...x, workStart: p.work[0], workEnd: p.work[1], sleepStart: p.sleep[0], sleepEnd: p.sleep[1], meals: [{ name: 'Завтрак', time: p.meals[0] }, { name: 'Обед', time: p.meals[1] }, { name: 'Ужин', time: p.meals[2] }, { name: 'Перекус', time: '' }] };
    if (x.id === 't_off') return { ...x, sleepStart: p.offSleep[0], sleepEnd: p.offSleep[1], meals: [{ name: 'Завтрак', time: p.meals[0] }, { name: 'Обед', time: p.meals[1] }, { name: 'Ужин', time: p.meals[2] }, { name: 'Перекус', time: '' }] };
    return x;
  });
  return S.setSetting('templates', t);
}

function render() {
  const wrap = h('div', { class: 'onb' });
  if (step === 0) {
    wrap.append(h('div', { class: 'logo center' }, 'LIFE OS'), h('p', { class: 'center muted' }, 'Персональная система здоровья и образа жизни'),
      card(null, h('div', { class: 'pre small' }, '🔒 Полностью офлайн: без регистрации, серверов и ИИ. Данные — только на устройстве.\n🌙 Подстраивается под ваш режим, в том числе ночные смены: день начинается, когда вы просыпаетесь.\n🧩 Ничего не обязательно: модули, цели и напоминания выбираете вы.\n🤝 Срыв не обнуляет прогресс.')),
      btn('Начать настройку', () => { step = 1; rerender(); }, 'primary wide'),
      btn('Пропустить — настрою позже', finish, 'ghost wide mt'));
  } else if (step === 1) {
    const p = S.settings.profile;
    const form = buildForm([
      { name: 'name', label: 'Как к вам обращаться', value: p.name },
      { name: 'sex', label: 'Пол (для расчёта калорий)', type: 'seg', options: [{ value: 'm', label: 'Мужской' }, { value: 'f', label: 'Женский' }], value: p.sex },
      { name: 'birthYear', label: 'Год рождения', type: 'number', min: 1920, max: new Date().getFullYear() - 10, value: p.birthYear, half: true },
      { name: 'height', label: 'Рост, см', type: 'number', min: 100, max: 250, value: p.height, half: true },
      { name: 'weight', label: 'Текущий вес, кг (необязательно)', type: 'number', min: 20, max: 400 },
      { name: 'activity', label: 'Активность', type: 'select', options: ACTIVITY_LEVELS.map((a) => ({ value: a.id, label: a.label })), value: p.activity },
    ]);
    wrap.append(h('h2', null, 'Профиль'), h('p', { class: 'muted small' }, 'Всё можно пропустить и изменить позже.'), card(null, form.node),
      btn('Далее', async () => {
        const r = form.read(); if (!r.ok) { toast('Проверьте поля'); return; }
        const { weight, ...prof } = r.values;
        await S.saveSettings({ profile: prof });
        if (weight) await S.putLog({ kind: 'weight', value: weight });
        step = 2; rerender();
      }, 'primary wide'));
  } else if (step === 2) {
    const sel = seg(Object.entries(PRESETS).map(([v, x]) => ({ value: v, label: x.label })), preset, (v) => { preset = v; desc.textContent = PRESETS[v].sub; });
    const desc = h('p', { class: 'muted small' }, PRESETS[preset].sub);
    wrap.append(h('h2', null, 'Мой режим'), h('p', { class: 'muted small' }, 'Это плановый распорядок: от него зависят тихие часы уведомлений и автоматическая граница дня, если вы забудете отметить пробуждение. Точные часы, дни недели и отпуск настраиваются в «Моём режиме».'),
      card(null, h('div', null, sel, desc)),
      btn('Далее', async () => { await applyPreset(preset); step = 3; rerender(); }, 'primary wide'));
  } else {
    const box = h('div');
    for (const m of MODULES) {
      const c = h('input', { type: 'checkbox', class: 'switch' }); c.checked = S.settings.modules[m.id] !== false;
      c.onchange = () => S.saveSettings({ modules: { [m.id]: c.checked } });
      box.appendChild(h('label', { class: 'field field-check row' }, h('span', null, m.name), c));
    }
    wrap.append(h('h2', null, 'Что отслеживать'), h('p', { class: 'muted small' }, 'Отключённые модули не мешают. Включить их можно в любой момент.'), card(null, box),
      btn('Готово', finish, 'primary wide'));
  }
  return wrap;
}
let host = null;
function rerender() { if (host) host.replaceChildren(render()); }
async function finish() { await S.saveSettings({ onboarded: true }); step = 0; location.replace('#/'); }

export default {
  welcome: { noNav: true, live: true, render: () => { host = h('div'); host.append(render()); return host; } },
};
