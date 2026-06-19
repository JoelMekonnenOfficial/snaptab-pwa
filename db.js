/* db.js — IndexedDB wrapper for SnapTab.
 *
 *   Stores
 *   ------
 *   receipts : keyPath 'id' (uuid). index 'date'.
 *   photos   : keyPath 'id' (matches receipt id). value: { id, blob, filename, mime }
 *   prefs    : keyPath 'k' for user preferences.
 *   merchants: keyPath 'name' for autocomplete history.
 *   tags     : keyPath 'name' for autocomplete history.
 */

const DB_NAME = 'snaptab';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('receipts')) {
        const store = db.createObjectStore('receipts', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('prefs')) {
        db.createObjectStore('prefs', { keyPath: 'k' });
      }
      if (!db.objectStoreNames.contains('merchants')) {
        db.createObjectStore('merchants', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('tags')) {
        db.createObjectStore('tags', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return _dbPromise;
}

function tx(storeNames, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

/* ------------- Receipts ------------- */

export async function putReceipt(rec) {
  const t = await tx('receipts', 'readwrite');
  await wrap(t.objectStore('receipts').put(rec));
  return rec;
}

export async function getReceipt(id) {
  const t = await tx('receipts');
  return wrap(t.objectStore('receipts').get(id));
}

export async function deleteReceipt(id) {
  const t = await tx(['receipts', 'photos'], 'readwrite');
  await Promise.all([
    wrap(t.objectStore('receipts').delete(id)),
    wrap(t.objectStore('photos').delete(id)),
  ]);
}

export async function getAllReceipts() {
  const t = await tx('receipts');
  return wrap(t.objectStore('receipts').getAll());
}

/* ------------- Photos ------------- */

export async function putPhoto(id, blob, filename, mime) {
  const t = await tx('photos', 'readwrite');
  await wrap(t.objectStore('photos').put({ id, blob, filename, mime }));
}

export async function getPhoto(id) {
  const t = await tx('photos');
  return wrap(t.objectStore('photos').get(id));
}

export async function getAllPhotos() {
  const t = await tx('photos');
  return wrap(t.objectStore('photos').getAll());
}

/* ------------- Preferences ------------- */

export async function getPref(k, fallback = null) {
  const t = await tx('prefs');
  const row = await wrap(t.objectStore('prefs').get(k));
  return row ? row.v : fallback;
}

export async function setPref(k, v) {
  const t = await tx('prefs', 'readwrite');
  await wrap(t.objectStore('prefs').put({ k, v }));
}

export async function getAllPrefs() {
  const t = await tx('prefs');
  const rows = await wrap(t.objectStore('prefs').getAll());
  const out = {};
  for (const r of rows) out[r.k] = r.v;
  return out;
}

/* ------------- Merchants / tags autocomplete ------------- */

export async function rememberMerchant(name) {
  if (!name) return;
  const t = await tx('merchants', 'readwrite');
  await wrap(t.objectStore('merchants').put({ name, lastUsed: Date.now() }));
}

export async function listMerchants() {
  const t = await tx('merchants');
  const rows = await wrap(t.objectStore('merchants').getAll());
  rows.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return rows.map((r) => r.name);
}

export async function rememberTag(name) {
  if (!name) return;
  const t = await tx('tags', 'readwrite');
  await wrap(t.objectStore('tags').put({ name, lastUsed: Date.now() }));
}

export async function listTags() {
  const t = await tx('tags');
  const rows = await wrap(t.objectStore('tags').getAll());
  rows.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return rows.map((r) => r.name);
}

/* ------------- Wipe ------------- */

export async function wipeAll() {
  const t = await tx(['receipts', 'photos', 'prefs', 'merchants', 'tags'], 'readwrite');
  await Promise.all([
    wrap(t.objectStore('receipts').clear()),
    wrap(t.objectStore('photos').clear()),
    wrap(t.objectStore('prefs').clear()),
    wrap(t.objectStore('merchants').clear()),
    wrap(t.objectStore('tags').clear()),
  ]);
}

/* ------------- Backup / restore ------------- */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('blob read failed'));
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  // Accepts a data URL of the form "data:<mime>;base64,<bytes>".
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportBackup() {
  const [receipts, photos, prefs, merchants, tags] = await Promise.all([
    getAllReceipts(),
    getAllPhotos(),
    getAllPrefs(),
    listMerchants(),
    listTags(),
  ]);
  const photoOut = [];
  for (const p of photos) {
    photoOut.push({
      id: p.id,
      filename: p.filename,
      mime: p.mime,
      data: await blobToBase64(p.blob),
    });
  }
  return {
    app: 'snaptab',
    version: 1,
    exportedAt: new Date().toISOString(),
    receipts,
    photos: photoOut,
    prefs,
    merchants,
    tags,
  };
}

export async function importBackup(payload, { merge = false } = {}) {
  if (!payload || payload.app !== 'snaptab') {
    throw new Error('Not a SnapTab backup file.');
  }
  if (!merge) await wipeAll();

  for (const rec of (payload.receipts || [])) {
    await putReceipt(rec);
  }
  for (const p of (payload.photos || [])) {
    const blob = base64ToBlob(p.data);
    if (blob) await putPhoto(p.id, blob, p.filename, p.mime || blob.type);
  }
  for (const [k, v] of Object.entries(payload.prefs || {})) {
    await setPref(k, v);
  }
  for (const m of (payload.merchants || [])) await rememberMerchant(m);
  for (const t of (payload.tags || [])) await rememberTag(t);

  return {
    receipts: (payload.receipts || []).length,
    photos: (payload.photos || []).length,
  };
}
