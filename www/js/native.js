// Мост к нативным возможностям Android (Capacitor). В браузере — честные веб-заменители.

const cap = () => window.capacitorExports;
export const isNative = () => { try { return !!(cap() && cap().Capacitor.isNativePlatform()); } catch (e) { return false; } };

const cache = {};
export function plugin(name) {
  if (!isNative()) return null;
  try {
    if (!cap().Capacitor.isPluginAvailable(name)) return null;
    return (cache[name] = cache[name] || cap().registerPlugin(name));
  } catch (e) { return null; }
}

/** Сохранить/отправить файл. На Android — системное окно «Поделиться» (Диск, Telegram, Файлы…). */
export async function saveFile(name, text, mime = 'application/json') {
  const FS = plugin('Filesystem'), SH = plugin('Share');
  if (FS && SH) {
    const r = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    try { await SH.share({ title: name, files: [r.uri], dialogTitle: 'Сохранить или отправить файл' }); }
    catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
    return 'shared';
  }
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

/** Тихое сохранение файла в папку Документы/LifeOS (только Android). */
export async function writeDocument(name, text) {
  const FS = plugin('Filesystem');
  if (!FS) return false;
  try {
    await FS.writeFile({ path: 'LifeOS/' + name, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
    return true;
  } catch (e) {
    // На части устройств нет доступа к Документам — пишем во внутреннюю папку приложения
    try { await FS.writeFile({ path: 'backups/' + name, data: text, directory: 'DATA', encoding: 'utf8', recursive: true }); return 'data'; }
    catch (e2) { console.warn(e2); return false; }
  }
}
export async function listBackups() {
  const FS = plugin('Filesystem');
  if (!FS) return [];
  const out = [];
  for (const [dir, path] of [['DOCUMENTS', 'LifeOS'], ['DATA', 'backups']]) {
    try { const r = await FS.readdir({ path, directory: dir }); for (const f of r.files || []) out.push({ dir, path: path + '/' + (f.name || f), name: f.name || f, mtime: f.mtime || 0 }); } catch (e) { /* нет папки */ }
  }
  return out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name));
}
export async function readBackup(b) {
  const FS = plugin('Filesystem');
  const r = await FS.readFile({ path: b.path, directory: b.dir, encoding: 'utf8' });
  return r.data;
}
export async function deleteBackup(b) {
  const FS = plugin('Filesystem');
  await FS.deleteFile({ path: b.path, directory: b.dir });
}

/** Выбор файла пользователем (для восстановления). */
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      const rd = new FileReader();
      rd.onload = () => resolve({ name: f.name, text: rd.result });
      rd.onerror = () => resolve(null);
      rd.readAsText(f);
    };
    inp.click();
  });
}

/** Фото: выбор из галереи/камеры, сжатие до maxSide и JPEG. Возвращает dataURL. */
export function pickImage(maxSide = 1280, quality = 0.82) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return resolve(null);
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(null);
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    inp.click();
  });
}

// ── Уведомления ──

export async function notifPermission(request = false) {
  const LN = plugin('LocalNotifications');
  if (LN) {
    let p = await LN.checkPermissions();
    if (p.display !== 'granted' && request) p = await LN.requestPermissions();
    return p.display;
  }
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default' && request) return await Notification.requestPermission();
  return Notification.permission;
}

/** items: [{id:int, title, body, at:ts}] — заменяет всё запланированное ранее. */
export async function scheduleAll(items) {
  const LN = plugin('LocalNotifications');
  if (LN) {
    try {
      const pend = await LN.getPending();
      if (pend.notifications && pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
    } catch (e) { console.warn(e); }
    if (!items.length) return 'native';
    try { await LN.createChannel({ id: 'lifeos', name: 'Напоминания LIFE OS', importance: 4, visibility: 1, vibration: true }); } catch (e) { /* старый Android */ }
    await LN.schedule({ notifications: items.map((n) => ({ id: n.id, title: n.title, body: n.body, schedule: { at: new Date(n.at), allowWhileIdle: true }, channelId: 'lifeos' })) });
    return 'native';
  }
  // Веб: уведомления срабатывают, только пока вкладка открыта.
  webQueue = items;
  return 'web';
}
let webQueue = [];
let webTimer = null;
export function startWebNotifier() {
  if (isNative() || webTimer) return;
  webTimer = setInterval(() => {
    const now = Date.now();
    const due = webQueue.filter((n) => n.at <= now && n.at > now - 70000);
    webQueue = webQueue.filter((n) => n.at > now);
    for (const n of due) {
      try { if (window.Notification && Notification.permission === 'granted') new Notification(n.title, { body: n.body }); } catch (e) { /* */ }
    }
  }, 30000);
}

export function onBackButton(fn) {
  const A = plugin('App');
  if (A) A.addListener('backButton', fn);
}
export function onResume(fn) {
  const A = plugin('App');
  if (A) A.addListener('resume', fn);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
}
export function exitApp() { const A = plugin('App'); if (A) A.exitApp(); }

export function vibrate(ms = 15) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* */ } }
