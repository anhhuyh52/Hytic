// Best-effort DPI metadata patching for already-encoded PNG/JPEG blobs (§6). Pixels are
// already oriented; this only writes resolution metadata, never touches pixel data. WebP has
// no widely-honoured DPI field, so it is left as-is. TIFF embeds DPI at encode time instead.

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserts/replaces a PNG `pHYs` chunk so viewers report the given DPI. */
export function patchPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  for (let i = 0; i < PNG_SIG.length; i += 1) if (png[i] !== PNG_SIG[i]) return png; // not a PNG

  const perMeter = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, perMeter);
  dv.setUint32(4, perMeter);
  data[8] = 1; // unit = metre

  const chunk = new Uint8Array(12 + 9);
  const cdv = new DataView(chunk.buffer);
  cdv.setUint32(0, 9); // length
  chunk[4] = 0x70;
  chunk[5] = 0x48;
  chunk[6] = 0x59;
  chunk[7] = 0x73; // "pHYs"
  chunk.set(data, 8);
  cdv.setUint32(17, crc32(chunk.subarray(4, 17)));

  let pos = 8;
  let insertAt = -1;
  let existingAt = -1;
  while (pos + 12 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + pos, 4).getUint32(0);
    const end = pos + 12 + length;
    if (end > png.length) return png;
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    if (type === "IHDR") insertAt = end;
    if (type === "pHYs") {
      existingAt = pos;
      break;
    }
    pos = end;
  }
  if (insertAt < 0) return png;

  if (existingAt >= 0) {
    const existingLength = new DataView(png.buffer, png.byteOffset + existingAt, 4).getUint32(0);
    const existingEnd = existingAt + 12 + existingLength;
    const out = new Uint8Array(png.length - (existingEnd - existingAt) + chunk.length);
    out.set(png.subarray(0, existingAt), 0);
    out.set(chunk, existingAt);
    out.set(png.subarray(existingEnd), existingAt + chunk.length);
    return out;
  }

  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(png.subarray(insertAt), insertAt + chunk.length);
  return out;
}

/** Patches (or inserts) the JFIF APP0 density so viewers report the given DPI. */
export function patchJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg; // not a JPEG (no SOI)
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));

  // Existing JFIF APP0? (FF E0 .. "JFIF\0")
  if (
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    jpeg[6] === 0x4a &&
    jpeg[7] === 0x46 &&
    jpeg[8] === 0x49 &&
    jpeg[9] === 0x46 &&
    jpeg[10] === 0x00
  ) {
    const out = jpeg.slice();
    out[13] = 1; // units = dots per inch
    out[14] = (d >> 8) & 0xff;
    out[15] = d & 0xff; // Xdensity
    out[16] = (d >> 8) & 0xff;
    out[17] = d & 0xff; // Ydensity
    return out;
  }

  // No JFIF APP0 → insert a minimal one right after SOI.
  const app0 = new Uint8Array([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    (d >> 8) & 0xff,
    d & 0xff,
    (d >> 8) & 0xff,
    d & 0xff,
    0x00,
    0x00,
  ]);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}
