// Сгенерировано scripts/build.js
const CACHE = 'lifeos-346cb01ba8';
const FILES = ["./","./css/app.css","./icons/icon-192.png","./icons/icon-512.png","./index.html","./js/app.js","./js/core/calc.js","./js/core/remind.js","./js/core/time.js","./js/data/backup.js","./js/data/db.js","./js/data/seed.js","./js/data/store.js","./js/native.js","./js/pages/analytics.js","./js/pages/bad.js","./js/pages/body.js","./js/pages/food.js","./js/pages/goals.js","./js/pages/habits.js","./js/pages/health.js","./js/pages/home.js","./js/pages/hubs.js","./js/pages/mind.js","./js/pages/onboarding.js","./js/pages/settings.js","./js/pages/sleep.js","./js/pages/water.js","./js/pages/workouts.js","./js/services.js","./js/summary.js","./js/ui/charts.js","./js/ui/dom.js","./js/ui/units.js","./manifest.webmanifest","./vendor/capacitor.js"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
