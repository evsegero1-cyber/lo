// Сборка веб-части: копирует мост Capacitor и формирует service worker для офлайн-работы веб-версии.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const www = path.join(root, 'www');

const cap = path.join(root, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
fs.mkdirSync(path.join(www, 'vendor'), { recursive: true });
if (fs.existsSync(cap)) fs.copyFileSync(cap, path.join(www, 'vendor', 'capacitor.js'));
else if (!fs.existsSync(path.join(www, 'vendor', 'capacitor.js'))) {
  console.warn('Нет @capacitor/core — выполните npm install. Веб-версия будет работать без нативных функций.');
  fs.writeFileSync(path.join(www, 'vendor', 'capacitor.js'), '// Capacitor не установлен\n');
}

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f !== 'sw.js') files.push(path.relative(www, p).split(path.sep).join('/'));
  }
})(www);
const hash = crypto.createHash('sha1');
for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(www, f)));
const ver = hash.digest('hex').slice(0, 10);
const sw = `// Сгенерировано scripts/build.js
const CACHE = 'lifeos-${ver}';
const FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)])};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
`;
fs.writeFileSync(path.join(www, 'sw.js'), sw);
console.log(`Веб-часть собрана: ${files.length} файлов, версия ${ver}`);
