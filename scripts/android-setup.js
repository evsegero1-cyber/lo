// Донастройка Android-проекта после `npx cap add android`: иконки, разрешения, цвета.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(res)) { console.error('Нет android/ — сначала выполните npx cap add android'); process.exit(1); }

for (const dir of fs.readdirSync(path.join(root, 'android-res'))) {
  if (!dir.startsWith('mipmap-')) continue;
  const dst = path.join(res, dir);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) fs.copyFileSync(path.join(root, 'android-res', dir, f), path.join(dst, f));
  const fg = path.join(dst, 'ic_launcher_foreground.png');
  if (fs.existsSync(fg)) fs.unlinkSync(fg);
}
// убираем адаптивную иконку Capacitor по умолчанию
const anydpi = path.join(res, 'mipmap-anydpi-v26');
if (fs.existsSync(anydpi)) fs.rmSync(anydpi, { recursive: true, force: true });

const colors = path.join(res, 'values', 'colors.xml');
if (fs.existsSync(colors)) {
  let x = fs.readFileSync(colors, 'utf8');
  x = x.replace(/(name="colorPrimary">)[^<]*/, '$1#0B0D12').replace(/(name="colorPrimaryDark">)[^<]*/, '$1#0B0D12').replace(/(name="colorAccent">)[^<]*/, '$1#7C6CFF');
  fs.writeFileSync(colors, x);
}

// Разрешения: уведомления (Android 13+), точные будильники для напоминаний, перезапуск после перезагрузки
const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let mx = fs.readFileSync(manifest, 'utf8');
for (const perm of ['android.permission.POST_NOTIFICATIONS', 'android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.VIBRATE']) {
  if (!mx.includes(perm)) mx = mx.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`);
}
// INTERNET оставляем: WebView Capacitor отдаёт файлы приложения через локальный адрес https://localhost.
// Внешних запросов приложение не делает (запрещено политикой CSP в index.html).
fs.writeFileSync(manifest, mx);

// Тёмный фон окна при запуске
const styles = path.join(res, 'values', 'styles.xml');
if (fs.existsSync(styles)) {
  let s = fs.readFileSync(styles, 'utf8');
  if (!s.includes('android:windowBackground')) s = s.replace(/(<style name="AppTheme.NoActionBar"[^>]*>)/, '$1\n        <item name="android:windowBackground">#0B0D12</item>');
  fs.writeFileSync(styles, s);
}
console.log('Android-проект настроен: иконки, разрешения, цвета');
