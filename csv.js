/* csv.js — CSV builder/parser + minimal STORE ZIP writer.
 *
 * CSV columns (exact order):
 *   Date, Merchant, Amount, Currency, Category, Payment, Tag, Notes, PhotoFile
 *
 * - String fields are RFC-4180 quoted; embedded quotes are doubled.
 * - Newline between rows is "\r\n" for max Excel compatibility.
 * - The parser handles quoted fields, embedded commas/newlines, and doubled
 *   quotes. It returns objects with the same column keys.
 *
 * ZIP: we emit a standards-compliant ZIP using STORE (no compression) — small
 * and reliable. Each photo gets its own filename so the CSV `PhotoFile` value
 * lines up with the archive entry.
 */

export const CSV_COLUMNS = [
  'Date', 'Merchant', 'Amount', 'Currency',
  'Category', 'Payment', 'Tag', 'Notes', 'PhotoFile',
];

/* ----------------- writing ----------------- */

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build a CSV string from receipt records.
 * Each receipt object: { date, merchant, amount, currency, category, payment, tag, notes, photoFile }
 */
export function buildCSV(receipts) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of receipts) {
    lines.push([
      csvEscape(r.date),
      csvEscape(r.merchant),
      csvEscape(formatAmount(r.amount)),
      csvEscape(r.currency || ''),
      csvEscape(r.category || ''),
      csvEscape(r.payment || ''),
      csvEscape(r.tag || ''),
      csvEscape(r.notes || ''),
      csvEscape(r.photoFile || ''),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function formatAmount(a) {
  const n = Number(a);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

/* ----------------- parsing (used for backup round-trip + tests) ----------------- */

export function parseCSV(text) {
  const out = [];
  if (!text) return out;
  // Normalize line endings (allow LF too)
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // peek
      if (src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  // tail
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return out;
  const header = rows.shift().map((h) => h.trim());
  for (const r of rows) {
    if (r.length === 1 && r[0] === '') continue; // skip blank line
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = r[i] != null ? r[i] : '';
    }
    out.push(obj);
  }
  return out;
}

/* ----------------- triggers ----------------- */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke shortly after; some browsers need the click to complete.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ----------------- minimal STORE ZIP writer ----------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(uint8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < uint8.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ uint8[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

function dosTime(d) {
  // returns [time, date] DOS-encoded
  const time = ((d.getHours() & 0x1F) << 11) |
               ((d.getMinutes() & 0x3F) << 5) |
               ((Math.floor(d.getSeconds() / 2)) & 0x1F);
  const year = Math.max(1980, d.getFullYear()) - 1980;
  const date = ((year & 0x7F) << 9) |
               (((d.getMonth() + 1) & 0x0F) << 5) |
               (d.getDate() & 0x1F);
  return [time & 0xFFFF, date & 0xFFFF];
}

function writeU16(view, off, v) { view.setUint16(off, v, true); }
function writeU32(view, off, v) { view.setUint32(off, v >>> 0, true); }

/**
 * Build an uncompressed (STORE) ZIP from an array of entries.
 *   entries: [{ name: 'a.jpg', data: Uint8Array | Blob }]
 * Returns a Blob with type 'application/zip'.
 */
export async function buildZip(entries, { now = new Date() } = {}) {
  const records = [];
  const central = [];
  let offset = 0;
  const [dt, dd] = dosTime(now);

  for (const entry of entries) {
    const data = entry.data instanceof Uint8Array
      ? entry.data
      : new Uint8Array(await entry.data.arrayBuffer());
    const nameBytes = utf8(entry.name);
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes + name)
    const lhBuf = new ArrayBuffer(30);
    const lh = new DataView(lhBuf);
    writeU32(lh, 0, 0x04034b50);
    writeU16(lh, 4, 20);              // version needed
    writeU16(lh, 6, 0x0800);          // general purpose: UTF-8 name flag
    writeU16(lh, 8, 0);               // compression: store
    writeU16(lh, 10, dt);
    writeU16(lh, 12, dd);
    writeU32(lh, 14, crc);
    writeU32(lh, 18, size);
    writeU32(lh, 22, size);
    writeU16(lh, 26, nameBytes.length);
    writeU16(lh, 28, 0);              // extra length
    records.push(new Uint8Array(lhBuf), nameBytes, data);

    // Central directory entry (46 bytes + name)
    const cdBuf = new ArrayBuffer(46);
    const cd = new DataView(cdBuf);
    writeU32(cd, 0, 0x02014b50);
    writeU16(cd, 4, 20);              // version made by
    writeU16(cd, 6, 20);              // version needed
    writeU16(cd, 8, 0x0800);
    writeU16(cd, 10, 0);
    writeU16(cd, 12, dt);
    writeU16(cd, 14, dd);
    writeU32(cd, 16, crc);
    writeU32(cd, 20, size);
    writeU32(cd, 24, size);
    writeU16(cd, 28, nameBytes.length);
    writeU16(cd, 30, 0);              // extra
    writeU16(cd, 32, 0);              // comment
    writeU16(cd, 34, 0);              // disk no
    writeU16(cd, 36, 0);              // internal attrs
    writeU32(cd, 38, 0);              // external attrs
    writeU32(cd, 42, offset);
    central.push(new Uint8Array(cdBuf), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  // EOCD (22 bytes)
  const centralSize = central.reduce((acc, u) => acc + u.length, 0);
  const eocdBuf = new ArrayBuffer(22);
  const eocd = new DataView(eocdBuf);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, entries.length);
  writeU16(eocd, 10, entries.length);
  writeU32(eocd, 12, centralSize);
  writeU32(eocd, 16, offset);
  writeU16(eocd, 20, 0);

  return new Blob([...records, ...central, new Uint8Array(eocdBuf)], { type: 'application/zip' });
}
