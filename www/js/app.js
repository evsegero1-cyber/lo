// LIFE OS — точка входа: маршрутизация, навигация, фоновые службы.

import { S } from './data/store.js';
import { h, closeTopSheet, toast } from './ui/dom.js';
import { onBackButton, onResume, exitApp, startWebNotifier } from './native.js';
import { services } from './services.js';
import home from './pages/home.js';
import hubs from './pages/hubs.js';
import water from './pages/water.js';
import food from './pages/food.js';
import sleep from './pages/sleep.js';
import body from './pages/body.js';
import workouts from './pages/workouts.js';
import habits from './pages/habits.js';
import bad from './pages/bad.js';
import mind from './pages/mind.js';
import health from './pages/health.js';
import goals from './pages/goals.js';
import analytics from './pages/analytics.js';
import settings from './pages/settings.js';
import onboarding from './pages/onboarding.js';

const ROUTES = Object.assign({}, home, hubs, water, food, sleep, body, workouts, habits, bad, mind, health, goals, analytics, settings, onboarding);

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  health: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>',
  activity: '<circle cx="14" cy="4.5" r="1.8"/><path d="m8 21 3-6 3 2v4"/><path d="m6 12 3-4 4 1 2 4h3"/><path d="m11 15-1-4"/>',
  habits: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  analytics: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
};
const TABS = [['home', 'Главная', '#/'], ['health', 'Здоровье', '#/health'], ['activity', 'Активность', '#/activity'], ['habits', 'Привычки', '#/habits'], ['analytics', 'Аналитика', '#/analytics'], ['settings', 'Настройки', '#/settings']];

let current = null;
const app = document.getElementById('app');
const nav = document.getElementById('nav');

function parse() {
  const raw = (location.hash || '#/').slice(2);
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(query || ''));
  // поиск самого длинного совпадения 'a/b' → 'a/:id'
  for (let n = parts.length; n >= 0; n--) {
    const key = parts.slice(0, n).join('/');
    if (ROUTES[key] && n === parts.length) return { key, route: ROUTES[key], params: { ...q } };
    if (n === parts.length - 1 && ROUTES[key + '/:id']) return { key: key + '/:id', route: ROUTES[key + '/:id'], params: { ...q, id: decodeURIComponent(parts[n]) } };
  }
  return { key: '', route: ROUTES[''], params: q };
}

export function render(keepScroll = false) {
  if (!S.settings.onboarded && !location.hash.startsWith('#/welcome')) { location.replace('#/welcome'); return; }
  const r = parse();
  current = r;
  const y = window.scrollY;
  let node;
  try { node = r.route.render(r.params); }
  catch (e) { console.error(e); node = h('div', { class: 'card' }, h('h3', null, 'Ошибка отображения'), h('p', { class: 'muted small' }, String(e && e.stack || e))); }
  const view = h('div', { class: keepScroll ? '' : 'view' }, node);
  app.replaceChildren(view);
  window.scrollTo(0, keepScroll ? y : 0);
  const tab = r.route.tab || 'home';
  nav.style.display = r.route.noNav ? 'none' : '';
  for (const b of nav.children) b.classList.toggle('on', b.dataset.tab === tab);
  document.title = 'LIFE OS';
}

function buildNav() {
  nav.replaceChildren(...TABS.map(([id, label, href]) => {
    const b = h('button', { dataset: { tab: id }, onclick: () => { if (location.hash === href) window.scrollTo({ top: 0, behavior: 'smooth' }); else location.hash = href; } });
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[id]}</svg><span>${label}</span>`;
    return b;
  }));
}

let rt = null;
// не перерисовываем экран, пока пользователь вводит текст на нём
const typing = () => { const a = document.activeElement; return !!(a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
function scheduleRerender() {
  if (current && current.route.live) return; // экраны с вводом в процессе не перерисовываем
  if (typing()) { clearTimeout(rt); rt = setTimeout(scheduleRerender, 1500); return; }
  clearTimeout(rt);
  rt = setTimeout(() => render(true), 40);
}

async function main() {
  try { await S.init(); }
  catch (e) {
    app.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Не удалось открыть локальную базу'), h('p', { class: 'muted' }, String(e.message || e))));
    return;
  }
  buildNav();
  window.addEventListener('hashchange', () => render(false));
  window.addEventListener('lifeos-refresh', (e) => render(e.detail && e.detail.keepScroll));
  S.on(() => { scheduleRerender(); services.changed(); });
  render();
  onBackButton(() => {
    if (closeTopSheet()) return;
    if (location.hash && location.hash !== '#/' && location.hash !== '#') history.back();
    else exitApp();
  });
  // обновление часов/личного дня на главной раз в минуту
  setInterval(() => { if (current && current.route.tick && !typing() && !document.hidden) render(true); }, 30000);
  onResume(() => { render(true); services.resume(); });
  startWebNotifier();
  services.start();
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('Ошибка: ' + (e.reason && e.reason.message || e.reason)); });
}

main();
