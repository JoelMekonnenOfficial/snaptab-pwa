/* camera.js — receipt image processing.
 *
 * Compresses the user-picked image to a JPEG <=1600px on its longest side
 * before we store it in IndexedDB. Also pulls the EXIF DateTimeOriginal if it
 * looks plausible so the form can pre-fill the receipt date.
 */

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.7;

/**
 * Compress a File/Blob image to a sensible size and return:
 *   { blob, mime, width, height, exifDateISO|null }
 */
export async function processImage(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }

  // EXIF (best-effort, JPEGs only)
  let exifDateISO = null;
  try {
    if (file.type === 'image/jpeg') {
      const head = await file.slice(0, 256 * 1024).arrayBuffer();
      exifDateISO = parseExifDateTime(new DataView(head));
    }
  } catch (_) {
    exifDateISO = null;
  }

  const dataURL = await readAsDataURL(file);
  const img = await loadImage(dataURL);

  const ratio = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Painted background prevents transparent PNGs becoming black under JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Image compression failed.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
  return { blob, mime: 'image/jpeg', width: w, height: h, exifDateISO };
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read image.'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}

/**
 * Parse a JPEG header DataView for EXIF DateTimeOriginal.
 * Returns an ISO date string (YYYY-MM-DD) or null. Best-effort only.
 */
function parseExifDateTime(dv) {
  if (dv.byteLength < 4) return null;
  if (dv.getUint16(0) !== 0xFFD8) return null; // not JPEG

  let offset = 2;
  while (offset < dv.byteLength - 4) {
    const marker = dv.getUint16(offset); offset += 2;
    if (marker === 0xFFE1) { // APP1
      const size = dv.getUint16(offset); offset += 2;
      // 'Exif\0\0' signature
      if (dv.getUint32(offset) !== 0x45786966) return null;
      const tiff = offset + 6;
      if (tiff + 8 > dv.byteLength) return null;
      const little = dv.getUint16(tiff) === 0x4949;
      const get16 = (o) => dv.getUint16(o, little);
      const get32 = (o) => dv.getUint32(o, little);
      if (get16(tiff + 2) !== 0x002A) return null;
      const ifd0 = tiff + get32(tiff + 4);
      if (ifd0 + 2 > dv.byteLength) return null;
      const num = get16(ifd0);
      // Find ExifIFD pointer (tag 0x8769)
      let exifIFD = null;
      for (let i = 0; i < num; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > dv.byteLength) break;
        const tag = get16(entry);
        if (tag === 0x8769) {
          exifIFD = tiff + get32(entry + 8);
          break;
        }
      }
      if (!exifIFD || exifIFD + 2 > dv.byteLength) return null;
      const num2 = get16(exifIFD);
      for (let i = 0; i < num2; i++) {
        const entry = exifIFD + 2 + i * 12;
        if (entry + 12 > dv.byteLength) break;
        const tag = get16(entry);
        // DateTimeOriginal = 0x9003, DateTimeDigitized = 0x9004
        if (tag === 0x9003 || tag === 0x9004) {
          const count = get32(entry + 4);
          const valOff = count > 4 ? tiff + get32(entry + 8) : entry + 8;
          if (valOff + count > dv.byteLength) return null;
          let s = '';
          for (let j = 0; j < count - 1; j++) {
            s += String.fromCharCode(dv.getUint8(valOff + j));
          }
          // Format: "YYYY:MM:DD HH:MM:SS"
          const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s);
          if (m) {
            const y = +m[1], mo = +m[2], d = +m[3];
            if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
              return `${m[1]}-${m[2]}-${m[3]}`;
            }
          }
          return null;
        }
      }
      return null;
    }
    if ((marker & 0xFF00) !== 0xFF00) return null;
    const segSize = dv.getUint16(offset);
    offset += segSize;
  }
  return null;
}
