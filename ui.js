/* ui.js — small UI helpers shared across views. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape user-provided text for safe insertion into innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Briefly vibrate, if supported and the user hasn't asked for reduced motion. */
export function haptic(pattern = 20) {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (_) { /* ignore */ }
}

/** Announce to screen readers via the live region. */
export function announce(message) {
  const lr = document.getElementById('live-region');
  if (!lr) return;
  // Clear then set to retrigger SR announcement
  lr.textContent = '';
  setTimeout(() => { lr.textContent = message; }, 30);
}

/** Toast for transient messages. */
export function toast(message, { duration = 2400 } = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 180ms ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/** Promise-based confirmation dialog using <dialog>. */
export function confirmDialog({
  title = 'Confirm',
  message = 'Are you sure?',
  okText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  requireType = null,           // require the user to type a phrase (e.g. 'ERASE')
} = {}) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('confirm-dialog');
    if (!dlg) return resolve(false);

    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const extra = document.getElementById('confirm-extra');
    const extraInput = document.getElementById('confirm-extra-input');

    ok.textContent = okText;
    cancel.textContent = cancelText;
    ok.classList.toggle('btn-danger', !!danger);
    ok.classList.toggle('btn-primary', !danger);

    if (requireType) {
      extra.hidden = false;
      extraInput.value = '';
      const phraseEl = extra.querySelector('code');
      if (phraseEl) phraseEl.textContent = requireType;
      ok.disabled = true;
      const onInput = () => { ok.disabled = extraInput.value.trim() !== requireType; };
      extraInput.oninput = onInput;
    } else {
      extra.hidden = true;
      ok.disabled = false;
    }

    const cleanup = (result) => {
      ok.onclick = null;
      cancel.onclick = null;
      extraInput.oninput = null;
      try { dlg.close(); } catch (_) { /* ignore */ }
      resolve(result);
    };
    ok.onclick = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
    dlg.addEventListener('cancel', () => cleanup(false), { once: true });

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    setTimeout(() => cancel.focus(), 30);
  });
}

/** Format a number as currency using Intl. Falls back gracefully. */
export function formatCurrency(amount, currency = 'USD') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).format(n);
  } catch (_) {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Format an ISO date (YYYY-MM-DD) for the user, in their locale. */
export function formatDate(iso) {
  if (!iso) return '';
  // Treat as local date by adding noon to avoid TZ edge cases.
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Today's date in YYYY-MM-DD (local). */
export function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** RFC 4122-ish UUID v4 using crypto when available. */
export function uuid() {
  try {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) { /* ignore */ }
  const r = crypto.getRandomValues(new Uint8Array(16));
  r[6] = (r[6] & 0x0f) | 0x40;
  r[8] = (r[8] & 0x3f) | 0x80;
  const hex = Array.from(r, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parse an amount the user typed. Returns a number or NaN. */
export function parseAmount(input) {
  if (input == null) return NaN;
  // Remove currency symbols, commas, spaces.
  const cleaned = String(input).replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
