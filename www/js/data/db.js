// Локальное хранилище на IndexedDB (встроено в WebView Android и браузеры).
// Данные лежат только на устройстве и сохраняются после закрытия приложения.

const DB_NAME = 'lifeos';
const DB_VER = 1;
let dbp = null;

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB недоступна')); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('defs')) db.createObjectStore('defs', { keyPath: 'id' }).createIndex('kind', 'kind');
      if (!db.objectStoreNames.contains('logs')) {
        const s = db.createObjectStore('logs', { keyPath: 'id' });
        s.createIndex('kind', 'kind');
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База данных заблокирована другой вкладкой'));
  });
  return dbp;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    let result;
    Promise.resolve(fn(st)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакция прервана'));
  }));
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = (store) => tx(store, 'readonly', (st) => req2p(st.getAll()));
export const get = (store, key) => tx(store, 'readonly', (st) => req2p(st.get(key)));
export const put = (store, obj) => tx(store, 'readwrite', (st) => { st.put(obj); });
export const putMany = (store, arr) => tx(store, 'readwrite', (st) => { for (const o of arr) st.put(o); });
export const del = (store, key) => tx(store, 'readwrite', (st) => { st.delete(key); });
export const clear = (store) => tx(store, 'readwrite', (st) => { st.clear(); });

export async function clearAll() {
  for (const s of ['kv', 'defs', 'logs', 'blobs']) await clear(s);
}
