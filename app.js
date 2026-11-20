/* app.js — SnapTab main module.
 *
 * Wires DOM events to db / camera / csv modules.
 * No external libraries. ES module import only.
 */

import {
  putReceipt, getReceipt, deleteReceipt, getAllReceipts,
  putPhoto, getPhoto, getAllPhotos,
  getPref, setPref, getAllPrefs,
  rememberMerchant, listMerchants,
  rememberTag, listTags,
  wipeAll, exportBackup, importBackup,
} from './db.js';
import { processImage } from './camera.js';
import { buildCSV, parseCSV, downloadBlob, buildZip, CSV_COLUMNS } from './csv.js';
import {
  $, $$, esc, haptic, announce, toast, confirmDialog,
  formatCurrency, formatDate, todayISO, uuid, parseAmount,
} from './ui.js';

/* -------------------- Constants -------------------- */
const DEFAULT_CATEGORIES = [
  'Meals', 'Travel', 'Supplies', 'Vehicle', 'Equipment',
  'Software/Subs', 'Marketing', 'Office', 'Phone/Internet', 'Other',
];
const CAT_COLORS = {
  'Meals':           getComputedStyleVar('--cat-meals',     '#f472b6'),
  'Travel':          getComputedStyleVar('--cat-travel',    '#10b981'),
  'Supplies':        getComputedStyleVar('--cat-supplies',  '#fbbf24'),
  'Vehicle':         getComputedStyleVar('--cat-vehicle',   '#0ea5e9'),
  'Equipment':       getComputedStyleVar('--cat-equipment', '#8b5cf6'),
  'Software/Subs':   getComputedStyleVar('--cat-software',  '#6366f1'),
  'Marketing':       getComputedStyleVar('--cat-marketing', '#ef4444'),
  'Office':          getComputedStyleVar('--cat-office',    '#f97316'),
  'Phone/Internet':  getComputedStyleVar('--cat-phone',     '#14b8a6'),
  'Other':           getComputedStyleVar('--cat-other',     '#94a3b8'),
  'Mileage':         getComputedStyleVar('--cat-mileage',   '#22c55e'),
};

function getComputedStyleVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) {
    return fallback;
  }
}

/* -------------------- App state -------------------- */
const state = {
  receipts: [],
  categories: DEFAULT_CATEGORIES.slice(),
  prefs: {
    currency: 'USD',
    theme: 'system',
    largeText: false,
    taxStartMonth: 1,
    mileageRate: 0.67,
    onboardingDone: false,
    notifReminder: false,
    notifLastShown: 0,
  },
  pendingPhotoBlob: null,
  pendingPhotoMime: null,
  pendingPhotoFilename: null,
  deferredInstall: null,
  thumbCache: new Map(),  // id -> object URL
  filter: { search: '', category: '', from: '', to: '' },
  editingReceiptId: null,
};

/* -------------------- Boot -------------------- */
window.addEventListener('DOMContentLoaded', () => boot().catch((err) => {
  console.warn('Boot failed', err);
  toast('Something went wrong starting the app. Reloading may help.');
}));

async function boot() {
  await loadPrefs();
  applyTheme();
  applyLargeText();

  populateCategorySelects();
  populateCategoryEditor();
  populateSettingsInputs();

  await loadReceipts();
  renderList();

  setupNavigation();
  setupListView();
  setupCaptureView();
  setupDetailView();
  setupMileageView();
  setupSummaryView();
  setupExportView();
  setupSettingsView();
  setupOnboarding();
  setupInstallBanner();
  setupNotifications();
  setupURLActions();

  registerServiceWorker();
}

async function loadPrefs() {
  const fromDB = await getAllPrefs();
  for (const [k, v] of Object.entries(fromDB)) state.prefs[k] = v;
  // Categories may be persisted
  const stored = await getPref('categories', null);
  if (Array.isArray(stored) && stored.length) state.categories = stored;
}

async function persistCategories() {
  await setPref('categories', state.categories);
}

async function loadReceipts() {
  const all = await getAllReceipts();
  // Newest first by date then createdAt
  all.sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  state.receipts = all;
}

/* -------------------- Theme -------------------- */
function applyTheme() {
  const root = document.documentElement;
  if (state.prefs.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.prefs.theme);
}
function applyLargeText() {
  document.documentElement.setAttribute('data-large-text', state.prefs.largeText ? '1' : '0');
}

/* -------------------- Navigation -------------------- */
function setupNavigation() {
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      showView(v);
    });
  });
}

function showView(viewName) {
  document.body.dataset.view = viewName;
  const map = {
    list: 'view-list',
    capture: 'view-capture',
    detail: 'view-detail',
    summary: 'view-summary',
    export: 'view-export',
    settings: 'view-settings',
    mileage: 'view-mileage',
  };
  for (const [name, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = (name !== viewName);
  }
  // Highlight top nav
  $$('.nav-btn').forEach((b) => {
    const active = b.dataset.view === viewName ||
                   (viewName === 'detail' && b.dataset.view === 'list') ||
                   (viewName === 'capture' && b.dataset.view === 'list') ||
                   (viewName === 'mileage' && b.dataset.view === 'list');
    b.classList.toggle('is-active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // Per-view init
  if (viewName === 'summary') renderSummary();
  if (viewName === 'export') initExportView();
  // Move focus to main for SR users
  const main = document.getElementById('main');
  if (main) main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* -------------------- Categories UI -------------------- */
function populateCategorySelects() {
  const selects = [
    document.getElementById('capture-category'),
    document.getElementById('detail-category'),
    document.getElementById('filter-category'),
  ].filter(Boolean);
  for (const sel of selects) {
    const isFilter = sel.id === 'filter-category';
    const current = sel.value;
    sel.innerHTML = '';
    if (isFilter) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'All categories';
      sel.appendChild(opt);
    }
    for (const cat of state.categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }
}

function populateCategoryEditor() {
  const ul = document.getElementById('category-editor');
  if (!ul) return;
  ul.innerHTML = '';
  for (const cat of state.categories) {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `<span>${esc(cat)}</span>` +
      `<button type="button" aria-label="Remove ${esc(cat)}">&times;</button>`;
    li.querySelector('button').addEventListener('click', async () => {
      if (state.categories.length <= 1) {
        toast('Keep at least one category.');
        return;
      }
      state.categories = state.categories.filter((c) => c !== cat);
      await persistCategories();
      populateCategoryEditor();
      populateCategorySelects();
    });
    ul.appendChild(li);
  }
}

/* -------------------- Settings inputs -------------------- */
function populateSettingsInputs() {
  const t = document.getElementById('setting-theme');
  const lt = document.getElementById('setting-large-text');
  const cur = document.getElementById('setting-currency');
  const tm = document.getElementById('setting-tax-month');
  const mr = document.getElementById('setting-mileage-rate');
  if (t)  t.value  = state.prefs.theme || 'system';
  if (lt) lt.checked = !!state.prefs.largeText;
  if (cur) cur.value = state.prefs.currency || 'USD';
  if (tm) tm.value = String(state.prefs.taxStartMonth || 1);
  if (mr) mr.value = String(state.prefs.mileageRate || 0.67);
}

/* -------------------- List view -------------------- */
function setupListView() {
  document.getElementById('fab').addEventListener('click', startCapture);
  document.getElementById('empty-cta').addEventListener('click', startCapture);
  document.getElementById('list-retry').addEventListener('click', async () => {
    document.getElementById('list-error').hidden = true;
    await loadReceipts();
    renderList();
  });

  const search = document.getElementById('search-input');
  search.addEventListener('input', () => {
    state.filter.search = search.value.trim().toLowerCase();
    renderList();
  });
  document.getElementById('filter-category').addEventListener('change', (e) => {
    state.filter.category = e.target.value;
    renderList();
  });
  document.getElementById('filter-from').addEventListener('change', (e) => {
    state.filter.from = e.target.value;
    renderList();
  });
  document.getElementById('filter-to').addEventListener('change', (e) => {
    state.filter.to = e.target.value;
    renderList();
  });
  document.getElementById('filter-clear').addEventListener('click', () => {
    state.filter = { search: '', category: '', from: '', to: '' };
    document.getElementById('search-input').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value = '';
    renderList();
  });
}

function filteredReceipts() {
  const { search, category, from, to } = state.filter;
  return state.receipts.filter((r) => {
    if (category && r.category !== category) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (search) {
      const hay = (r.merchant + ' ' + (r.notes || '') + ' ' + (r.tag || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function renderList() {
  const ul = document.getElementById('receipt-list');
  const empty = document.getElementById('list-empty');
  const errBox = document.getElementById('list-error');
  const loading = document.getElementById('list-loading');
  const counter = document.getElementById('list-result-count');

  loading.hidden = true;
  errBox.hidden = true;
  ul.innerHTML = '';

  const list = filteredReceipts();

  if (state.receipts.length === 0) {
    empty.hidden = false;
    counter.textContent = '';
    return;
  }
  empty.hidden = true;

  if (list.length === 0) {
    counter.textContent = 'No matches for your filters.';
    return;
  }

  counter.textContent = `${list.length} of ${state.receipts.length} receipts`;
  const currency = state.prefs.currency;

  const frag = document.createDocumentFragment();
  for (const r of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'receipt-item';
    btn.dataset.id = r.id;
    btn.setAttribute('aria-label',
      `${r.merchant || 'Receipt'}, ${formatCurrency(r.amount, currency)}, ${formatDate(r.date)}, ${r.category || ''}`);
    btn.innerHTML = `
      <div class="receipt-thumb" aria-hidden="true">
        ${r.hasPhoto ? `<img alt="" data-photo="${esc(r.id)}" />` : 'IMG'}
      </div>
      <div class="receipt-info">
        <div class="merchant">${esc(r.merchant || '(no merchant)')}</div>
        <div class="meta">
          <span>${esc(formatDate(r.date))}</span>
          <span class="cat-badge" data-cat="${esc(r.category || 'Other')}">${esc(r.category || 'Other')}</span>
          ${r.tag ? `<span>· ${esc(r.tag)}</span>` : ''}
        </div>
      </div>
      <div class="receipt-amount">${esc(formatCurrency(r.amount, currency))}</div>
    `;
    btn.addEventListener('click', () => openDetail(r.id));
    li.appendChild(btn);
    frag.appendChild(li);
  }
  ul.appendChild(frag);
  // Lazy-attach thumb sources
  for (const img of ul.querySelectorAll('img[data-photo]')) {
    const id = img.getAttribute('data-photo');
    getThumb(id).then((url) => { if (url) img.src = url; });
  }
}

async function getThumb(id) {
  if (state.thumbCache.has(id)) return state.thumbCache.get(id);
  const photo = await getPhoto(id);
  if (!photo) return null;
  const url = URL.createObjectURL(photo.blob);
  state.thumbCache.set(id, url);
  return url;
}

/* -------------------- Capture / new entry -------------------- */
function startCapture() {
  resetCaptureForm();
  showView('capture');
  document.getElementById('capture-amount').focus();
  // Open the camera right away on tap — best UX for mobile.
  // (User must tap explicitly because the browser requires a user gesture.)
}

function resetCaptureForm() {
  state.pendingPhotoBlob = null;
  state.pendingPhotoMime = null;
  state.pendingPhotoFilename = null;
  document.getElementById('capture-form').reset();
  document.getElementById('capture-amount').value = '';
  document.getElementById('capture-merchant').value = '';
  document.getElementById('capture-date').value = todayISO();
  document.getElementById('capture-category').value = state.categories[0] || 'Other';
  document.getElementById('capture-payment').value = '';
  document.getElementById('capture-tag').value = '';
  document.getElementById('capture-notes').value = '';
  setCaptureThumb(null);
  hideErrors(['err-capture-amount', 'err-capture-merchant']);
}

function setCaptureThumb(url) {
  const img = document.getElementById('capture-thumb');
  const ph = document.getElementById('capture-thumb-placeholder');
  const removeBtn = document.getElementById('capture-remove');
  if (url) {
    img.src = url;
    img.hidden = false;
    ph.hidden = true;
    removeBtn.hidden = false;
  } else {
    if (img.src) URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
    img.hidden = true;
    ph.hidden = false;
    removeBtn.hidden = true;
  }
}

function setupCaptureView() {
  document.getElementById('capture-back').addEventListener('click', () => {
    resetCaptureForm();
    showView('list');
  });
  document.getElementById('capture-remove').addEventListener('click', () => {
    state.pendingPhotoBlob = null;
    state.pendingPhotoMime = null;
    state.pendingPhotoFilename = null;
    setCaptureThumb(null);
  });

  document.getElementById('capture-input').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await processPickedFile(f);
    e.target.value = '';
  });
  document.getElementById('upload-input').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await processPickedFile(f);
    e.target.value = '';
  });

  document.getElementById('capture-repeat').addEventListener('click', repeatLast);

  // Populate merchant/tag autocomplete
  refreshAutocomplete();

  // Submit
  document.getElementById('capture-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await saveNewReceipt();
  });
}

async function processPickedFile(file) {
  try {
    toast('Processing photo…', { duration: 1200 });
    const result = await processImage(file);
    state.pendingPhotoBlob = result.blob;
    state.pendingPhotoMime = result.mime;
    state.pendingPhotoFilename = makePhotoFilename();
    const url = URL.createObjectURL(result.blob);
    setCaptureThumb(url);
    if (result.exifDateISO) {
      document.getElementById('capture-date').value = result.exifDateISO;
    }
    haptic(10);
    announce('Photo attached.');
  } catch (err) {
    console.warn('Image processing failed', err);
    toast('Could not process that image. Try another file.');
  }
}

function makePhotoFilename() {
  const id = uuid().slice(0, 8);
  return `receipt-${todayISO()}-${id}.jpg`;
}

function hideErrors(ids) { for (const id of ids) { const e = document.getElementById(id); if (e) e.textContent = ''; } }

async function saveNewReceipt() {
  const amount = parseAmount(document.getElementById('capture-amount').value);
  const merchant = document.getElementById('capture-merchant').value.trim();
  const date = document.getElementById('capture-date').value || todayISO();
  const category = document.getElementById('capture-category').value || 'Other';
  const payment = document.getElementById('capture-payment').value.trim();
  const tag = document.getElementById('capture-tag').value.trim();
  const notes = document.getElementById('capture-notes').value.trim();

  let valid = true;
  if (!Number.isFinite(amount) || amount < 0) {
    document.getElementById('err-capture-amount').textContent = 'Enter a valid amount.';
    document.getElementById('capture-amount').setAttribute('aria-invalid', 'true');
    valid = false;
  } else {
    document.getElementById('capture-amount').removeAttribute('aria-invalid');
    document.getElementById('err-capture-amount').textContent = '';
  }
  if (!merchant) {
    document.getElementById('err-capture-merchant').textContent = 'Add a merchant or note.';
    document.getElementById('capture-merchant').setAttribute('aria-invalid', 'true');
    valid = false;
  } else {
    document.getElementById('capture-merchant').removeAttribute('aria-invalid');
    document.getElementById('err-capture-merchant').textContent = '';
  }
  if (!valid) return;

  const id = uuid();
  const rec = {
    id,
    date,
    merchant,
    amount: Math.round(amount * 100) / 100,
    currency: state.prefs.currency || 'USD',
    category,
    payment,
    tag,
    notes,
    hasPhoto: !!state.pendingPhotoBlob,
    photoFile: state.pendingPhotoBlob ? state.pendingPhotoFilename : '',
    type: 'receipt',
    createdAt: Date.now(),
  };

  try {
    await putReceipt(rec);
    if (state.pendingPhotoBlob) {
      await putPhoto(id, state.pendingPhotoBlob, state.pendingPhotoFilename, state.pendingPhotoMime);
    }
    if (merchant) await rememberMerchant(merchant);
    if (tag) await rememberTag(tag);

    haptic([30, 20, 30]);
    announce('Receipt saved.');
    toast('Receipt saved.');
    await loadReceipts();
    refreshAutocomplete();
    renderList();
    resetCaptureForm();
    showView('list');
  } catch (err) {
    console.warn('Save failed', err);
    toast('Could not save receipt.');
  }
}

async function repeatLast() {
  const last = state.receipts.find((r) => r.type === 'receipt');
  if (!last) {
    toast('No previous entry to repeat.');
    return;
  }
  document.getElementById('capture-amount').value = String(last.amount.toFixed(2));
  document.getElementById('capture-merchant').value = last.merchant || '';
  document.getElementById('capture-category').value = last.category || 'Other';
  document.getElementById('capture-payment').value = last.payment || '';
  document.getElementById('capture-tag').value = last.tag || '';
  document.getElementById('capture-notes').value = last.notes || '';
  document.getElementById('capture-date').value = todayISO();
  haptic(15);
  toast('Pre-filled from last receipt.');
}

async function refreshAutocomplete() {
  const merchants = await listMerchants();
  const tags = await listTags();
  for (const id of ['merchant-list-capture', 'merchant-list-detail']) {
    const dl = document.getElementById(id);
    if (!dl) continue;
    dl.innerHTML = '';
    for (const m of merchants) {
      const o = document.createElement('option');
      o.value = m;
      dl.appendChild(o);
    }
  }
  const tagList = document.getElementById('tag-list');
  if (tagList) {
    tagList.innerHTML = '';
    for (const t of tags) {
      const o = document.createElement('option');
      o.value = t;
      tagList.appendChild(o);
    }
  }
}

/* -------------------- Detail view -------------------- */
function setupDetailView() {
  document.getElementById('detail-back').addEventListener('click', () => showView('list'));
  document.getElementById('detail-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await saveDetailChanges();
  });
  document.getElementById('detail-delete').addEventListener('click', async () => {
    if (!state.editingReceiptId) return;
    const ok = await confirmDialog({
      title: 'Delete receipt?',
      message: 'This receipt and its photo will be removed from this device.',
      okText: 'Delete', cancelText: 'Cancel', danger: true,
    });
    if (!ok) return;
    await deleteReceipt(state.editingReceiptId);
    state.thumbCache.delete(state.editingReceiptId);
    state.editingReceiptId = null;
    haptic(40);
    toast('Receipt deleted.');
    await loadReceipts();
    renderList();
    showView('list');
  });
  document.getElementById('detail-share').addEventListener('click', shareCurrentReceipt);
}

async function openDetail(id) {
  const r = await getReceipt(id);
  if (!r) {
    toast('Receipt not found.');
    return;
  }
  state.editingReceiptId = id;
  document.getElementById('detail-id').value = id;
  document.getElementById('detail-amount').value = String((r.amount || 0).toFixed(2));
  document.getElementById('detail-merchant').value = r.merchant || '';
  document.getElementById('detail-date').value = r.date || todayISO();
  document.getElementById('detail-category').value = r.category || 'Other';
  document.getElementById('detail-payment').value = r.payment || '';
  document.getElementById('detail-tag').value = r.tag || '';
  document.getElementById('detail-notes').value = r.notes || '';

  // Photo
  const photoEl = document.getElementById('detail-photo');
  const emptyEl = document.getElementById('detail-photo-empty');
  if (r.hasPhoto) {
    const url = await getThumb(id);
    if (url) {
      photoEl.src = url;
      photoEl.alt = r.merchant ? `Photo of receipt from ${r.merchant}` : 'Receipt photo';
      photoEl.hidden = false;
      emptyEl.hidden = true;
    } else {
      photoEl.hidden = true;
      emptyEl.hidden = false;
    }
  } else {
    photoEl.hidden = true;
    photoEl.removeAttribute('src');
    emptyEl.hidden = false;
  }

  showView('detail');
}

async function saveDetailChanges() {
  const id = state.editingReceiptId;
  if (!id) return;
  const existing = await getReceipt(id);
  if (!existing) return;

  const amount = parseAmount(document.getElementById('detail-amount').value);
  const merchant = document.getElementById('detail-merchant').value.trim();
  const date = document.getElementById('detail-date').value || todayISO();

  let valid = true;
  if (!Number.isFinite(amount) || amount < 0) {
    document.getElementById('err-detail-amount').textContent = 'Enter a valid amount.';
    document.getElementById('detail-amount').setAttribute('aria-invalid', 'true');
    valid = false;
  } else {
    document.getElementById('err-detail-amount').textContent = '';
    document.getElementById('detail-amount').removeAttribute('aria-invalid');
  }
  if (!merchant) {
    document.getElementById('err-detail-merchant').textContent = 'Merchant required.';
    document.getElementById('detail-merchant').setAttribute('aria-invalid', 'true');
    valid = false;
  } else {
    document.getElementById('err-detail-merchant').textContent = '';
    document.getElementById('detail-merchant').removeAttribute('aria-invalid');
  }
  if (!valid) return;

  const updated = {
    ...existing,
    amount: Math.round(amount * 100) / 100,
    merchant,
    date,
    category: document.getElementById('detail-category').value,
    payment: document.getElementById('detail-payment').value.trim(),
    tag: document.getElementById('detail-tag').value.trim(),
    notes: document.getElementById('detail-notes').value.trim(),
    updatedAt: Date.now(),
  };
  await putReceipt(updated);
  if (merchant) await rememberMerchant(merchant);
  if (updated.tag) await rememberTag(updated.tag);
  toast('Saved.');
  announce('Receipt updated.');
  haptic(20);
  await loadReceipts();
  refreshAutocomplete();
  renderList();
  showView('list');
}

async function shareCurrentReceipt() {
  const id = state.editingReceiptId;
  if (!id) return;
  const rec = await getReceipt(id);
  if (!rec) return;
  const cur = state.prefs.currency;
  const summary = `${rec.merchant} — ${formatCurrency(rec.amount, cur)} on ${formatDate(rec.date)} (${rec.category})`;

  // Try sharing the photo as a file if Web Share Level 2 is available
  let photo = null;
  if (rec.hasPhoto) photo = await getPhoto(id);

  const shareData = { title: 'Receipt', text: summary };
  if (photo && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([photo.blob], photo.filename || 'receipt.jpg', { type: photo.mime || 'image/jpeg' });
    if (navigator.canShare({ files: [file] })) {
      shareData.files = [file];
    }
  }

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled
      // fall through to clipboard fallback
    }
  }
  // Fallback: copy summary to clipboard
  try {
    await navigator.clipboard.writeText(summary);
    toast('Receipt summary copied.');
  } catch (_) {
    toast('Sharing not supported on this device.');
  }
}

/* -------------------- Mileage -------------------- */
function setupMileageView() {
  document.getElementById('mileage-back').addEventListener('click', () => showView('list'));
  document.getElementById('go-mileage').addEventListener('click', () => {
    document.getElementById('mileage-date').value = todayISO();
    document.getElementById('mileage-rate').value = String(state.prefs.mileageRate);
    document.getElementById('mileage-start').value = '';
    document.getElementById('mileage-end').value = '';
    document.getElementById('mileage-miles').value = '';
    document.getElementById('mileage-tag').value = '';
    document.getElementById('mileage-notes').value = '';
    document.getElementById('mileage-hint').textContent = '';
    showView('mileage');
    document.getElementById('mileage-miles').focus();
  });

  const recalc = () => {
    const start = parseAmount(document.getElementById('mileage-start').value);
    const end = parseAmount(document.getElementById('mileage-end').value);
    const rate = parseAmount(document.getElementById('mileage-rate').value);
    const milesField = document.getElementById('mileage-miles');
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      milesField.value = (end - start).toFixed(1);
    }
    const miles = parseAmount(milesField.value);
    if (Number.isFinite(miles) && Number.isFinite(rate)) {
      const total = miles * rate;
      document.getElementById('mileage-hint').textContent =
        `Estimated deduction: ${formatCurrency(total, state.prefs.currency)} at ${rate.toFixed(3)} per mile.`;
    } else {
      document.getElementById('mileage-hint').textContent = '';
    }
  };
  for (const id of ['mileage-start','mileage-end','mileage-miles','mileage-rate']) {
    document.getElementById(id).addEventListener('input', recalc);
  }

  document.getElementById('mileage-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await saveMileage();
  });
}

async function saveMileage() {
  const miles = parseAmount(document.getElementById('mileage-miles').value);
  const rate = parseAmount(document.getElementById('mileage-rate').value) || state.prefs.mileageRate || 0;
  if (!Number.isFinite(miles) || miles <= 0) {
    document.getElementById('err-mileage-miles').textContent = 'Enter total miles driven.';
    document.getElementById('mileage-miles').setAttribute('aria-invalid', 'true');
    return;
  }
  document.getElementById('err-mileage-miles').textContent = '';
  document.getElementById('mileage-miles').removeAttribute('aria-invalid');

  const date = document.getElementById('mileage-date').value || todayISO();
  const start = document.getElementById('mileage-start').value;
  const end = document.getElementById('mileage-end').value;
  const tag = document.getElementById('mileage-tag').value.trim();
  const notes = document.getElementById('mileage-notes').value.trim();
  const amount = Math.round(miles * rate * 100) / 100;

  const id = uuid();
  const merchant = `Mileage — ${miles.toFixed(1)} mi`;
  const noteParts = [];
  if (start) noteParts.push(`Start odometer: ${start}`);
  if (end) noteParts.push(`End odometer: ${end}`);
  noteParts.push(`Rate: $${rate.toFixed(3)}/mi`);
  if (notes) noteParts.push(notes);

  const rec = {
    id, date, merchant,
    amount,
    currency: state.prefs.currency || 'USD',
    category: 'Vehicle',
    payment: 'Mileage',
    tag,
    notes: noteParts.join(' • '),
    hasPhoto: false,
    photoFile: '',
    type: 'mileage',
    miles,
    rate,
    createdAt: Date.now(),
  };
  await putReceipt(rec);
  if (tag) await rememberTag(tag);
  toast('Mileage saved.');
  announce('Mileage entry saved.');
  haptic(20);
  await loadReceipts();
  renderList();
  showView('list');
}

/* -------------------- Summary -------------------- */
function setupSummaryView() {
  const m = document.getElementById('summary-month');
  m.value = monthValue(new Date());
  m.addEventListener('change', renderSummary);
}

function monthValue(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
}

function renderSummary() {
  const month = document.getElementById('summary-month').value || monthValue(new Date());
  const inMonth = state.receipts.filter((r) => (r.date || '').startsWith(month));
  const cur = state.prefs.currency;

  const totalEl = document.getElementById('summary-total');
  const metaEl = document.getElementById('summary-meta');
  const topEl = document.getElementById('summary-top');
  const topSubEl = document.getElementById('summary-top-sub');
  const emptyEl = document.getElementById('summary-empty');
  const chart = document.getElementById('summary-chart');
  const legend = document.getElementById('summary-legend');

  if (inMonth.length === 0) {
    totalEl.textContent = formatCurrency(0, cur);
    metaEl.textContent = '0 receipts';
    topEl.textContent = '—';
    topSubEl.textContent = '';
    legend.innerHTML = '';
    drawBarChart(chart, []);
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  let total = 0;
  const byCat = new Map();
  const byMerchant = new Map();
  for (const r of inMonth) {
    total += Number(r.amount) || 0;
    byCat.set(r.category || 'Other', (byCat.get(r.category || 'Other') || 0) + (Number(r.amount) || 0));
    if (r.merchant) {
      byMerchant.set(r.merchant, (byMerchant.get(r.merchant) || 0) + (Number(r.amount) || 0));
    }
  }
  totalEl.textContent = formatCurrency(total, cur);
  metaEl.textContent = `${inMonth.length} receipt${inMonth.length === 1 ? '' : 's'}`;

  const topMerch = [...byMerchant.entries()].sort((a,b) => b[1] - a[1])[0];
  if (topMerch) {
    topEl.textContent = topMerch[0];
    topSubEl.textContent = formatCurrency(topMerch[1], cur);
  } else {
    topEl.textContent = '—';
    topSubEl.textContent = '';
  }

  const catData = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  drawBarChart(chart, catData);
  legend.innerHTML = '';
  for (const [name, val] of catData) {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${CAT_COLORS[name] || CAT_COLORS.Other}"></i><span>${esc(name)} — ${esc(formatCurrency(val, cur))}</span>`;
    legend.appendChild(li);
  }
}

function drawBarChart(canvas, data) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600;
  const cssHeight = 320;
  canvas.style.height = cssHeight + 'px';
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (data.length === 0) {
    ctx.fillStyle = getComputedStyleVar('--muted', '#94a3b8');
    ctx.font = '14px ' + (getComputedStyleVar('--font-sans', 'system-ui'));
    ctx.fillText('No data', 8, 24);
    return;
  }

  const padLeft = 110, padRight = 24, padTop = 14, padBot = 14;
  const innerW = cssWidth - padLeft - padRight;
  const innerH = cssHeight - padTop - padBot;
  const max = Math.max(...data.map((d) => d[1]));
  const rowH = Math.max(20, Math.min(40, innerH / data.length));
  const barH = rowH * 0.65;
  const gap = rowH - barH;
  ctx.font = '13px ' + (getComputedStyleVar('--font-sans', 'system-ui'));
  ctx.textBaseline = 'middle';

  for (let i = 0; i < data.length; i++) {
    const [name, val] = data[i];
    const y = padTop + i * rowH + gap / 2;
    const w = innerW * (val / max);

    // Label
    ctx.fillStyle = getComputedStyleVar('--ink', '#0f172a');
    ctx.textAlign = 'right';
    ctx.fillText(truncateLabel(name, 14), padLeft - 10, y + barH / 2);

    // Track
    ctx.fillStyle = getComputedStyleVar('--surface-2', '#f1f5f9');
    roundRect(ctx, padLeft, y, innerW, barH, barH / 2);
    ctx.fill();

    // Bar
    ctx.fillStyle = CAT_COLORS[name] || CAT_COLORS.Other;
    roundRect(ctx, padLeft, y, Math.max(2, w), barH, barH / 2);
    ctx.fill();

    // Value text
    ctx.fillStyle = getComputedStyleVar('--ink', '#0f172a');
    ctx.textAlign = 'left';
    const formatted = formatCurrency(val, state.prefs.currency);
    ctx.fillText(formatted, padLeft + Math.max(2, w) + 6, y + barH / 2);
  }
}
function truncateLabel(s, max) {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* -------------------- Export view -------------------- */
function setupExportView() {
  document.getElementById('export-csv-month').addEventListener('click', () => exportCSV('month'));
  document.getElementById('export-csv-all').addEventListener('click', () => exportCSV('all'));
  document.getElementById('export-csv-share').addEventListener('click', shareCSV);
  document.getElementById('export-zip').addEventListener('click', exportPhotoZip);
  document.getElementById('backup-export').addEventListener('click', doBackupExport);
  document.getElementById('backup-import').addEventListener('change', doBackupImport);
}

function initExportView() {
  const m = document.getElementById('export-month');
  if (!m.value) m.value = monthValue(new Date());
}

function pickReceiptsForExport(scope) {
  if (scope === 'all') return state.receipts;
  const month = document.getElementById('export-month').value || monthValue(new Date());
  return state.receipts.filter((r) => (r.date || '').startsWith(month));
}

function receiptsToCSVRows(receipts) {
  return receipts.map((r) => ({
    date: r.date,
    merchant: r.merchant,
    amount: r.amount,
    currency: r.currency || state.prefs.currency,
    category: r.category || 'Other',
    payment: r.payment || '',
    tag: r.tag || '',
    notes: r.notes || '',
    photoFile: r.photoFile || '',
  }));
}

async function exportCSV(scope) {
  const status = document.getElementById('export-status');
  const list = pickReceiptsForExport(scope);
  if (list.length === 0) {
    status.textContent = 'Nothing to export for that selection.';
    return;
  }
  const csv = buildCSV(receiptsToCSVRows(list));

  // Round-trip self-test: parse what we just built and ensure row count matches.
  let roundTripOK = true;
  try {
    const parsed = parseCSV(csv);
    if (parsed.length !== list.length) roundTripOK = false;
  } catch (_) { roundTripOK = false; }
  if (!roundTripOK) {
    status.textContent = 'CSV failed round-trip check. Please report a bug.';
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const fname = scope === 'month'
    ? `snaptab-${document.getElementById('export-month').value}.csv`
    : `snaptab-all.csv`;

  // Prefer File System Access API when available; fall back to <a download>
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fname,
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      status.textContent = `Saved ${fname} (${list.length} receipts).`;
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        status.textContent = 'Save cancelled.';
        return;
      }
      // Other errors -> fall back below
    }
  }
  downloadBlob(blob, fname);
  status.textContent = `Downloaded ${fname} (${list.length} receipts).`;
}

async function shareCSV() {
  const status = document.getElementById('export-status');
  const list = pickReceiptsForExport('month');
  if (list.length === 0) { status.textContent = 'Nothing to share for that month.'; return; }
  const csv = buildCSV(receiptsToCSVRows(list));
  const month = document.getElementById('export-month').value || monthValue(new Date());
  const file = new File([csv], `snaptab-${month}.csv`, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: `SnapTab ${month}`, files: [file] });
      status.textContent = 'Shared CSV.';
      return;
    } catch (err) {
      if (err && err.name !== 'AbortError') status.textContent = 'Share failed.';
      return;
    }
  }
  status.textContent = 'Sharing not supported here — use the download button.';
}

async function exportPhotoZip() {
  const status = document.getElementById('export-zip-status');
  const photos = await getAllPhotos();
  if (photos.length === 0) {
    status.textContent = 'No photos to export yet.';
    return;
  }
  status.textContent = 'Building archive…';
  // Build a CSV manifest INSIDE the zip so the user has a one-shot bundle.
  const csv = buildCSV(receiptsToCSVRows(state.receipts));
  const entries = [];
  entries.push({ name: 'receipts.csv', data: new TextEncoder().encode(csv) });
  for (const p of photos) {
    // Try to associate filename from the receipt record; fall back to id-based
    const rec = state.receipts.find((r) => r.id === p.id);
    const fname = (rec && rec.photoFile) || p.filename || `receipt-${p.id}.jpg`;
    entries.push({ name: `photos/${sanitizeFilename(fname)}`, data: p.blob });
  }
  try {
    const zipBlob = await buildZip(entries);
    downloadBlob(zipBlob, `snaptab-archive-${todayISO()}.zip`);
    status.textContent = `Downloaded ${photos.length} photo${photos.length === 1 ? '' : 's'} + CSV.`;
  } catch (err) {
    console.warn('ZIP failed', err);
    status.textContent = 'Could not build archive.';
  }
}

function sanitizeFilename(name) {
  return String(name || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

async function doBackupExport() {
  const status = document.getElementById('backup-status');
  try {
    status.textContent = 'Building backup…';
    const data = await exportBackup();
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `snaptab-backup-${todayISO()}.json`);
    status.textContent = `Backup saved (${data.receipts.length} receipts, ${data.photos.length} photos).`;
  } catch (err) {
    console.warn('Backup export failed', err);
    status.textContent = 'Backup failed.';
  }
}

async function doBackupImport(ev) {
  const status = document.getElementById('backup-status');
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const ok = await confirmDialog({
    title: 'Restore backup?',
    message: 'Restoring will replace all current data on this device. This cannot be undone.',
    okText: 'Restore', cancelText: 'Cancel', danger: true,
  });
  if (!ok) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const summary = await importBackup(payload);
    await loadPrefs();
    applyTheme();
    applyLargeText();
    populateCategorySelects();
    populateCategoryEditor();
    populateSettingsInputs();
    await loadReceipts();
    state.thumbCache.forEach((url) => URL.revokeObjectURL(url));
    state.thumbCache.clear();
    refreshAutocomplete();
    renderList();
    status.textContent = `Restored ${summary.receipts} receipts and ${summary.photos} photos.`;
    toast('Backup restored.');
  } catch (err) {
    console.warn('Backup import failed', err);
    status.textContent = 'Could not restore that file.';
  }
}

/* -------------------- Settings -------------------- */
function setupSettingsView() {
  document.getElementById('setting-theme').addEventListener('change', async (e) => {
    state.prefs.theme = e.target.value;
    await setPref('theme', state.prefs.theme);
    applyTheme();
  });
  document.getElementById('setting-large-text').addEventListener('change', async (e) => {
    state.prefs.largeText = !!e.target.checked;
    await setPref('largeText', state.prefs.largeText);
    applyLargeText();
  });
  document.getElementById('setting-currency').addEventListener('change', async (e) => {
    state.prefs.currency = e.target.value;
    await setPref('currency', state.prefs.currency);
    renderList();
    renderSummary();
  });
  document.getElementById('setting-tax-month').addEventListener('change', async (e) => {
    state.prefs.taxStartMonth = Number(e.target.value) || 1;
    await setPref('taxStartMonth', state.prefs.taxStartMonth);
  });
  document.getElementById('setting-mileage-rate').addEventListener('change', async (e) => {
    const v = parseAmount(e.target.value);
    if (Number.isFinite(v) && v >= 0) {
      state.prefs.mileageRate = v;
      await setPref('mileageRate', v);
    }
  });
  document.getElementById('category-add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = document.getElementById('category-add');
    const name = input.value.trim();
    if (!name) return;
    if (state.categories.includes(name)) {
      toast('That category already exists.');
      return;
    }
    state.categories.push(name);
    await persistCategories();
    input.value = '';
    populateCategoryEditor();
    populateCategorySelects();
  });
  document.getElementById('wipe-data').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Erase all data?',
      message: 'This deletes every receipt, photo, tag, and preference on this device. There is no cloud backup.',
      okText: 'Erase everything', cancelText: 'Cancel', danger: true,
      requireType: 'ERASE',
    });
    if (!ok) return;
    await wipeAll();
    state.receipts = [];
    state.categories = DEFAULT_CATEGORIES.slice();
    state.prefs = {
      currency: 'USD', theme: 'system', largeText: false,
      taxStartMonth: 1, mileageRate: 0.67, onboardingDone: true,
      notifReminder: false, notifLastShown: 0,
    };
    state.thumbCache.forEach((u) => URL.revokeObjectURL(u));
    state.thumbCache.clear();
    applyTheme();
    applyLargeText();
    populateCategoryEditor();
    populateCategorySelects();
    populateSettingsInputs();
    renderList();
    toast('All data erased.');
    showView('list');
  });
  document.getElementById('reopen-onb').addEventListener('click', () => {
    state.prefs.onboardingDone = false;
    showOnboarding();
  });
}

/* -------------------- Onboarding -------------------- */
function setupOnboarding() {
  if (!state.prefs.onboardingDone) showOnboarding();
  document.getElementById('onb-skip').addEventListener('click', finishOnboarding);
  document.getElementById('onb-next').addEventListener('click', advanceOnboarding);
}

function showOnboarding() {
  document.getElementById('onboarding').hidden = false;
  $$('.onb-slide').forEach((s, i) => { s.hidden = i !== 0; });
  $$('.onb-dot').forEach((d, i) => d.classList.toggle('is-active', i === 0));
  document.getElementById('onb-next').textContent = 'Next';
}

function advanceOnboarding() {
  const slides = $$('.onb-slide');
  const dots = $$('.onb-dot');
  let idx = slides.findIndex((s) => !s.hidden);
  if (idx < 0) idx = 0;
  if (idx >= slides.length - 1) {
    finishOnboarding();
    return;
  }
  slides[idx].hidden = true;
  slides[idx + 1].hidden = false;
  dots.forEach((d, i) => d.classList.toggle('is-active', i === idx + 1));
  if (idx + 1 === slides.length - 1) {
    document.getElementById('onb-next').textContent = 'Done';
  }
}

async function finishOnboarding() {
  document.getElementById('onboarding').hidden = true;
  state.prefs.onboardingDone = true;
  await setPref('onboardingDone', true);
}

/* -------------------- Install banner -------------------- */
function setupInstallBanner() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstall = e;
    // Don't show during onboarding
    if (!state.prefs.onboardingDone) return;
    if (sessionStorage.getItem('snaptab-install-dismissed') === '1') return;
    document.getElementById('install-banner').hidden = false;
  });
  document.getElementById('install-accept').addEventListener('click', async () => {
    const e = state.deferredInstall;
    document.getElementById('install-banner').hidden = true;
    if (!e) return;
    try {
      e.prompt();
      const choice = await e.userChoice;
      if (choice && choice.outcome === 'accepted') toast('Thanks for installing!');
    } catch (_) { /* ignore */ }
    state.deferredInstall = null;
  });
  document.getElementById('install-dismiss').addEventListener('click', () => {
    document.getElementById('install-banner').hidden = true;
    sessionStorage.setItem('snaptab-install-dismissed', '1');
  });
  window.addEventListener('appinstalled', () => {
    document.getElementById('install-banner').hidden = true;
    toast('SnapTab installed.');
  });
}

/* -------------------- Notifications -------------------- */
// Inside the iPhone app the monthly reminder is handed to iOS as local notifications, so it
// arrives even when the app is closed. Nothing leaves the device.
function nativeReminders() {
  try {
    const h = window.webkit && window.webkit.messageHandlers;
    return (h && h['local-reminders']) ? h : null;
  } catch (_) { return null; }
}

function scheduleNativeMonthly() {
  const h = nativeReminders();
  if (!h) return;
  const items = [];
  if (state.prefs.notifReminder) {
    const now = new Date();
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1, 9, 0, 0, 0);
      items.push({
        id: `monthly-${d.getFullYear()}-${d.getMonth() + 1}`,
        title: 'SnapTab monthly review',
        body: 'Time to review last month’s expenses and export your CSV.',
        at: d.getTime(),
      });
    }
  }
  try {
    h['local-reminders'].postMessage(JSON.stringify({ action: 'set', items }));
  } catch (_) { /* best-effort */ }
}

function nativeRequestPermission() {
  return new Promise((resolve) => {
    const h = nativeReminders();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      window.removeEventListener('push-permission-request', onResult);
      resolve(v);
    };
    const onResult = (e) => finish(e && e.detail === 'granted' ? 'granted' : 'denied');
    window.addEventListener('push-permission-request', onResult);
    try { h['push-permission-request'].postMessage('request'); } catch (_) { finish('denied'); }
    setTimeout(() => finish('denied'), 2 * 60 * 1000);
  });
}

function setupNotifications() {
  const btn = document.getElementById('notif-enable');
  const status = document.getElementById('notif-status');
  updateNotifStatus();

  if (nativeReminders()) {
    btn.addEventListener('click', async () => {
      if (state.prefs.notifReminder) {
        state.prefs.notifReminder = false;
        await setPref('notifReminder', false);
        scheduleNativeMonthly();
        toast('Monthly reminder turned off.');
      } else {
        const result = await nativeRequestPermission();
        if (result === 'granted') {
          state.prefs.notifReminder = true;
          await setPref('notifReminder', true);
          scheduleNativeMonthly();
          toast('Reminders enabled.');
        } else {
          status.textContent = 'Notifications are off for SnapTab. Turn them on in iPhone Settings.';
          return;
        }
      }
      updateNotifStatus();
    });
    // Keep the next 12 months topped up every time the app is opened.
    scheduleNativeMonthly();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleNativeMonthly();
    });
    return;
  }

  btn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      status.textContent = 'Notifications not supported on this device.';
      return;
    }
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        state.prefs.notifReminder = true;
        await setPref('notifReminder', true);
        toast('Reminders enabled.');
        // Show an immediate confirmation notification
        try { new Notification('SnapTab reminders on', { body: 'You will see a monthly reminder to review your expenses.', icon: 'icons/icon-192.png' }); } catch (_) { /* ignore */ }
      } else {
        status.textContent = 'Permission not granted.';
      }
    } catch (_) {
      status.textContent = 'Could not request permission.';
    }
    updateNotifStatus();
  });

  // Show reminder on app boot if it's the 1st of the month and we haven't shown one this month.
  maybeMonthlyReminder();
}

function updateNotifStatus() {
  const status = document.getElementById('notif-status');
  if (nativeReminders()) {
    const btn = document.getElementById('notif-enable');
    const on = !!state.prefs.notifReminder;
    if (btn) btn.textContent = on ? 'Turn off monthly reminder' : 'Enable monthly reminder';
    status.textContent = on ? 'Reminders on (1st of each month, 9:00).' : '';
    return;
  }
  if (!('Notification' in window)) {
    status.textContent = 'Notifications not supported.';
    return;
  }
  if (Notification.permission === 'granted' && state.prefs.notifReminder) {
    status.textContent = 'Reminders on.';
  } else if (Notification.permission === 'denied') {
    status.textContent = 'Blocked by browser.';
  } else {
    status.textContent = '';
  }
}

async function maybeMonthlyReminder() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!state.prefs.notifReminder) return;
  const now = new Date();
  if (now.getDate() !== 1) return;
  const tag = `${now.getFullYear()}-${now.getMonth() + 1}`;
  if (state.prefs.notifLastShown === tag) return;
  try {
    new Notification('SnapTab monthly review', {
      body: 'Time to review last month’s expenses and export your CSV.',
      icon: 'icons/icon-192.png',
      tag: 'snaptab-monthly',
    });
    state.prefs.notifLastShown = tag;
    await setPref('notifLastShown', tag);
  } catch (_) { /* ignore */ }
}

/* -------------------- Service Worker -------------------- */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Skip when running from file:// — SW requires http(s) origin.
  if (location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode degrades gracefully */ });
  });
}

/* -------------------- URL shortcut actions -------------------- */
function setupURLActions() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const view = params.get('view');
  if (action === 'capture') {
    setTimeout(() => startCapture(), 80);
  } else if (view && ['summary', 'export', 'settings'].includes(view)) {
    setTimeout(() => showView(view), 80);
  }
}
