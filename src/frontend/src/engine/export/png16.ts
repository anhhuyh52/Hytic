// Native 16-bit RGBA PNG encoder (PNG spec). Big-endian samples, no row filter,
// IDAT compressed via the browser DecompressionStream's counterpart
// CompressionStream('deflate') (a proper zlib stream). Used by the export worker
// for true 16-bit export. See [[image-decode-worker]].

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

// rgba16: top-down RGBA 16-bit samples (length = width*height*4).
export async function encodePng16(
  rgba16: Uint16Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const rowSamples = width * 4;
  const raw = new Uint8Array(height * (1 + rowSamples * 2)); // filter byte + BE uint16s
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p++] = 0; // filter: none
    const base = y * rowSamples;
    for (let i = 0; i < rowSamples; i += 1) {
      const v = rgba16[base + i];
      raw[p++] = (v >>> 8) & 0xff;
      raw[p++] = v & 0xff;
    }
  }
  const idat = await deflate(raw);

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, width, false);
  idv.setUint32(4, height, false);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // [10] compression=0, [11] filter=0, [12] interlace=0 (already zero)

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** Legacy Dp fallback: promote bottom-up RGBA8 render pixels to a real top-down RGBA16 PNG. */
export async function encodePng16FromRgba8(
  rgba8BottomUp: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const rowSamples = width * 4;
  const rgba16 = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = (height - 1 - y) * rowSamples;
    const targetRow = y * rowSamples;
    for (let i = 0; i < rowSamples; i += 1) {
      rgba16[targetRow + i] = rgba8BottomUp[sourceRow + i] * 257;
    }
  }
  return encodePng16(rgba16, width, height);
}
