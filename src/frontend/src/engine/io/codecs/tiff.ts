// Native baseline TIFF decoder (rebuilt in TS — no legacy bundle). Covers the
// common pro-import cases: little/big-endian, strip-based, uncompressed +
// PackBits + LZW + Deflate("ZIP"), 8/16-bit integer, RGB / RGBA / grayscale,
// chunky planar config, and the horizontal predictor. Downconverts to 8-bit RGBA
// for preview. Unsupported variants (JPEG-in-TIFF, tiled, planar=2, palette,
// CMYK, float) throw a clear error rather than emitting garbage.
//
// async because Deflate uses the browser DecompressionStream. See
// [[image-decode-worker]].

import { applyOrientation } from "./orientation";
import { isDecodedImageWithinBudget } from "../DecodedImageBudget";

export type DecodedTiff = {
  width: number;
  height: number;
  rgba: Uint8Array;
  bitDepth: number;
  hasAlpha: boolean;
  orientation?: number;
  make?: string;
  model?: string;
  dateTime?: string;
};

export const UNSUPPORTED_TIFF_VARIANT_MESSAGE = "This TIFF variant is not supported yet.";

export type TiffVariantInfo = {
  width: number;
  height: number;
  compression: number;
  layout: "stripped" | "tiled" | "unknown";
  photometric: number;
  bitsPerSample: number;
  sampleFormat: number;
  planarConfiguration: number;
  samplesPerPixel: number;
  predictor: number;
  supported: boolean;
  reason?: string;
};

/** Reads only structural tags. No pixel decoder runs until this returns supported. */
export function inspectTiffVariant(buffer: ArrayBuffer): TiffVariantInfo {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 8) throw new Error("TIFF: file too small");
  const le = u8[0] === 0x49 && u8[1] === 0x49;
  if (!le && !(u8[0] === 0x4d && u8[1] === 0x4d)) throw new Error("TIFF: bad byte-order mark");
  const dv = new DataView(buffer);
  const u16 = (offset: number) => dv.getUint16(offset, le);
  const u32 = (offset: number) => dv.getUint32(offset, le);
  if (u16(2) !== 42) throw new Error("TIFF: bad magic");
  const ifdOffset = u32(4);
  if (ifdOffset + 2 > buffer.byteLength) throw new Error("TIFF: invalid IFD offset");
  const entryCount = u16(ifdOffset);
  const values = new Map<number, number[]>();
  for (let i = 0; i < entryCount; i += 1) {
    const base = ifdOffset + 2 + i * 12;
    if (base + 12 > buffer.byteLength) throw new Error("TIFF: truncated IFD");
    const tag = u16(base);
    const type = u16(base + 2);
    const count = u32(base + 4);
    const byteLength = (TYPE_SIZE[type] ?? 1) * count;
    const valueOffset = byteLength <= 4 ? base + 8 : u32(base + 8);
    if (valueOffset + byteLength > buffer.byteLength)
      throw new Error("TIFF: invalid tag data offset");
    values.set(tag, readValues(dv, le, type, count, valueOffset));
  }
  const first = (tag: number, fallback: number) => values.get(tag)?.[0] ?? fallback;
  const hasTiles =
    values.has(TAG.TileOffsets) || values.has(TAG.TileWidth) || values.has(TAG.TileLength);
  const hasStrips = values.has(TAG.StripOffsets);
  const bitDepths = values.get(TAG.BitsPerSample) ?? [8];
  const sampleFormats = values.get(TAG.SampleFormat) ?? [1];
  const stripOffsets = values.get(TAG.StripOffsets) ?? [];
  const stripByteCounts = values.get(TAG.StripByteCounts) ?? [];
  const info: TiffVariantInfo = {
    width: first(TAG.ImageWidth, 0),
    height: first(TAG.ImageLength, 0),
    compression: first(TAG.Compression, 1),
    layout: hasTiles ? "tiled" : hasStrips ? "stripped" : "unknown",
    photometric: first(TAG.Photometric, 1),
    bitsPerSample: bitDepths[0],
    sampleFormat: sampleFormats[0],
    planarConfiguration: first(TAG.PlanarConfig, 1),
    samplesPerPixel: first(TAG.SamplesPerPixel, 1),
    predictor: first(TAG.Predictor, 1),
    supported: true,
  };
  if (
    !info.width ||
    !info.height ||
    !isDecodedImageWithinBudget(info.width, info.height)
  ) {
    return { ...info, supported: false, reason: "dimensions" };
  }
  if (info.layout !== "stripped") return { ...info, supported: false, reason: "non-strip layout" };
  if (![1, 5, 8, 32773, 32946].includes(info.compression)) {
    return {
      ...info,
      supported: false,
      reason: info.compression === 6 || info.compression === 7 ? "JPEG compression" : "compression",
    };
  }
  if (![0, 1, 2].includes(info.photometric))
    return { ...info, supported: false, reason: "photometric interpretation" };
  if (info.photometric === 2 && info.samplesPerPixel !== 3 && info.samplesPerPixel !== 4) {
    return { ...info, supported: false, reason: "RGB sample layout" };
  }
  if (
    info.samplesPerPixel === 4 &&
    !values.get(TAG.ExtraSamples)?.some((value) => value === 1 || value === 2)
  ) {
    return { ...info, supported: false, reason: "alpha sample declaration" };
  }
  if (info.photometric !== 2 && info.samplesPerPixel !== 1)
    return { ...info, supported: false, reason: "gray sample layout" };
  if (info.planarConfiguration !== 1) return { ...info, supported: false, reason: "planar layout" };
  if (sampleFormats.some((value) => value !== 1))
    return { ...info, supported: false, reason: "sample format" };
  if (
    bitDepths.some((value) => value !== info.bitsPerSample) ||
    (info.bitsPerSample !== 8 && info.bitsPerSample !== 16)
  ) {
    return { ...info, supported: false, reason: "bit depth" };
  }
  if (info.predictor !== 1 && info.predictor !== 2)
    return { ...info, supported: false, reason: "predictor" };
  if (!stripByteCounts.length || stripOffsets.length !== stripByteCounts.length) {
    return { ...info, supported: false, reason: "strip byte counts" };
  }
  if (stripOffsets.some((offset, index) => offset + stripByteCounts[index] > buffer.byteLength)) {
    return { ...info, supported: false, reason: "strip data bounds" };
  }
  return info;
}

export async function decodeTiff(buffer: ArrayBuffer): Promise<DecodedTiff> {
  const variant = inspectTiffVariant(buffer);
  if (!variant.supported) throw new Error(UNSUPPORTED_TIFF_VARIANT_MESSAGE);
  return decodeTiffNative(buffer);
}

// TIFF tag ids we read.
const TAG = {
  ImageWidth: 256,
  ImageLength: 257,
  BitsPerSample: 258,
  Compression: 259,
  Photometric: 262,
  Make: 271,
  Model: 272,
  StripOffsets: 273,
  Orientation: 274,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  PlanarConfig: 284,
  Predictor: 317,
  TileWidth: 322,
  TileLength: 323,
  TileOffsets: 324,
  TileByteCounts: 325,
  ExtraSamples: 338,
  SampleFormat: 339,
  DateTime: 306,
} as const;

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

type Entry = { type: number; count: number; values: number[] };

async function decodeTiffNative(buffer: ArrayBuffer): Promise<DecodedTiff> {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 8) throw new Error("TIFF: file too small");
  const le = u8[0] === 0x49 && u8[1] === 0x49; // "II" little-endian, "MM" big-endian
  if (!le && !(u8[0] === 0x4d && u8[1] === 0x4d)) throw new Error("TIFF: bad byte-order mark");
  const dv = new DataView(buffer);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error("TIFF: bad magic");

  // ── IFD 0 ──────────────────────────────────────────────────────────────────
  const ifdOffset = u32(4);
  const entryCount = u16(ifdOffset);
  const tags = new Map<number, Entry>();
  for (let i = 0; i < entryCount; i += 1) {
    const base = ifdOffset + 2 + i * 12;
    const tag = u16(base);
    const type = u16(base + 2);
    const count = u32(base + 4);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const valueOffset = size <= 4 ? base + 8 : u32(base + 8);
    tags.set(tag, { type, count, values: readValues(dv, le, type, count, valueOffset) });
  }

  const first = (tag: number, fallback?: number): number => {
    const e = tags.get(tag);
    if (e && e.values.length) return e.values[0];
    if (fallback !== undefined) return fallback;
    throw new Error(`TIFF: missing required tag ${tag}`);
  };

  const width = first(TAG.ImageWidth);
  const height = first(TAG.ImageLength);
  const compression = first(TAG.Compression, 1);
  const photometric = first(TAG.Photometric, 1);
  const samplesPerPixel = first(TAG.SamplesPerPixel, 1);
  const bitsPerSample = tags.get(TAG.BitsPerSample)?.values ?? [first(TAG.BitsPerSample, 8)];
  const bps = bitsPerSample[0] ?? 8;
  const planar = first(TAG.PlanarConfig, 1);
  const predictor = first(TAG.Predictor, 1);
  const sampleFormat = tags.get(TAG.SampleFormat)?.values[0] ?? 1;
  const rowsPerStrip = first(TAG.RowsPerStrip, height);
  const stripOffsets = tags.get(TAG.StripOffsets)?.values ?? [];
  const stripByteCounts = tags.get(TAG.StripByteCounts)?.values ?? [];

  // ── guardrails ──────────────────────────────────────────────────────────────
  if (planar !== 1) throw new Error("TIFF: planar configuration 2 is not supported");
  if (sampleFormat === 3) throw new Error("TIFF: floating-point samples are not supported yet");
  if (bps !== 8 && bps !== 16)
    throw new Error(`TIFF: ${bps}-bit samples are not supported (need 8 or 16)`);
  if (photometric !== 0 && photometric !== 1 && photometric !== 2) {
    throw new Error(`TIFF: photometric ${photometric} (palette/CMYK/YCbCr) is not supported`);
  }
  if (![1, 5, 8, 32773, 32946].includes(compression)) {
    throw new Error(`TIFF: compression ${compression} (e.g. JPEG) is not supported`);
  }
  if (!stripOffsets.length) throw new Error("TIFF: no strips (tiled TIFF not supported)");

  // ── read + decompress strips into the full raw sample buffer ─────────────────
  const bytesPerSample = bps / 8;
  const rowBytes = width * samplesPerPixel * bytesPerSample;
  const raw = new Uint8Array(rowBytes * height);
  let written = 0;
  for (let s = 0; s < stripOffsets.length; s += 1) {
    const stripRows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    if (stripRows <= 0) break;
    const expected = rowBytes * stripRows;
    const comp = u8.subarray(stripOffsets[s], stripOffsets[s] + (stripByteCounts[s] ?? expected));
    let strip: Uint8Array;
    if (compression === 1) strip = comp;
    else if (compression === 32773) strip = unpackBits(comp, expected);
    else if (compression === 5) strip = lzwDecode(comp, expected);
    else strip = await inflate(comp); // 8 / 32946 Deflate
    if (strip.byteLength < expected) throw new Error("TIFF: truncated strip data");
    raw.set(strip.subarray(0, expected), written);
    written += expected;
  }
  if (written !== raw.byteLength) throw new Error("TIFF: incomplete strip data");

  // ── horizontal predictor (per row) ──────────────────────────────────────────
  if (predictor === 2) applyHorizontalPredictor(raw, width, height, samplesPerPixel, bps, le);

  // ── pack to 8-bit RGBA ──────────────────────────────────────────────────────
  const rgba = new Uint8Array(width * height * 4);
  const read16 = bps === 16;
  const sample = (rowStart: number, pixel: number, channel: number): number => {
    const idx = rowStart + (pixel * samplesPerPixel + channel) * bytesPerSample;
    if (read16) return (le ? raw[idx] | (raw[idx + 1] << 8) : (raw[idx] << 8) | raw[idx + 1]) >> 8;
    return raw[idx];
  };
  const hasAlpha = samplesPerPixel >= 4 && photometric === 2;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (photometric === 2) {
        rgba[o] = sample(rowStart, x, 0);
        rgba[o + 1] = sample(rowStart, x, 1);
        rgba[o + 2] = sample(rowStart, x, 2);
        rgba[o + 3] = hasAlpha ? sample(rowStart, x, 3) : 255;
      } else {
        let v = sample(rowStart, x, 0);
        if (photometric === 0) v = 255 - v; // WhiteIsZero
        rgba[o] = v;
        rgba[o + 1] = v;
        rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
    }
  }

  // Camera/EXIF tags + orientation (ASCII tags come back as char codes).
  const asciiTag = (tag: number): string | undefined => {
    const e = tags.get(tag);
    if (!e || !e.values.length) return undefined;
    const s = String.fromCharCode(...e.values)
      .replace(/\0+$/, "")
      .trim();
    return s || undefined;
  };
  const orientation = first(TAG.Orientation, 1);
  const oriented = applyOrientation(rgba, width, height, orientation);

  return {
    width: oriented.width,
    height: oriented.height,
    rgba: oriented.rgba,
    bitDepth: 8,
    hasAlpha,
    orientation,
    make: asciiTag(TAG.Make),
    model: asciiTag(TAG.Model),
    dateTime: asciiTag(TAG.DateTime),
  };
}

function readValues(
  dv: DataView,
  le: boolean,
  type: number,
  count: number,
  offset: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (type === 3 || type === 8) out.push(dv.getUint16(offset + i * 2, le));
    else if (type === 4 || type === 9) out.push(dv.getUint32(offset + i * 4, le));
    else if (type === 1 || type === 2 || type === 6 || type === 7)
      out.push(dv.getUint8(offset + i));
    else if (type === 5 || type === 10)
      out.push(dv.getUint32(offset + i * 8, le) / dv.getUint32(offset + i * 8 + 4, le));
    else out.push(dv.getUint32(offset + i * 4, le));
  }
  return out;
}

// PackBits (Macintosh RLE).
function unpackBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let s = 0;
  let d = 0;
  while (s < src.length && d < expected) {
    const n = (src[s++] << 24) >> 24; // signed
    if (n >= 0) {
      for (let i = 0; i <= n && d < expected; i += 1) out[d++] = src[s++];
    } else if (n !== -128) {
      const b = src[s++];
      for (let i = 0; i < 1 - n && d < expected; i += 1) out[d++] = b;
    }
  }
  return out;
}

// TIFF LZW (MSB-first, variable 9–12 bit codes, early change).
function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const CLEAR = 256;
  const EOI = 257;
  const out = new Uint8Array(expected);
  let d = 0;
  let bitBuf = 0;
  let bitCount = 0;
  let pos = 0;
  let codeWidth = 9;
  let dict: number[][] = [];
  let prev: number[] | null = null;

  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i += 1) dict[i] = [i];
    dict[CLEAR] = [];
    dict[EOI] = [];
    codeWidth = 9;
  };
  reset();

  const next = (): number => {
    while (bitCount < codeWidth) {
      if (pos >= src.length) return EOI;
      bitBuf = (bitBuf << 8) | src[pos++];
      bitCount += 8;
    }
    bitCount -= codeWidth;
    return (bitBuf >> bitCount) & ((1 << codeWidth) - 1);
  };

  for (;;) {
    const code = next();
    if (code === EOI) break;
    if (code === CLEAR) {
      reset();
      const first = next();
      if (first === EOI) break;
      const entry = dict[first];
      for (let i = 0; i < entry.length && d < expected; i += 1) out[d++] = entry[i];
      prev = entry.slice();
      continue;
    }
    let entry: number[];
    if (dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error("TIFF LZW: bad code stream");
    for (let i = 0; i < entry.length && d < expected; i += 1) out[d++] = entry[i];
    if (prev) {
      dict.push([...prev, entry[0]]);
      // early change: bump width one code before the boundary
      if (dict.length + 1 === 1 << codeWidth && codeWidth < 12) codeWidth += 1;
    }
    prev = entry;
  }
  return out;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Horizontal differencing predictor (per row, per channel).
function applyHorizontalPredictor(
  raw: Uint8Array,
  width: number,
  height: number,
  spp: number,
  bps: number,
  le: boolean,
) {
  const rowBytes = width * spp * (bps / 8);
  if (bps === 8) {
    for (let y = 0; y < height; y += 1) {
      const base = y * rowBytes;
      for (let x = 1; x < width; x += 1) {
        for (let c = 0; c < spp; c += 1) {
          const i = base + (x * spp + c);
          raw[i] = (raw[i] + raw[i - spp]) & 0xff;
        }
      }
    }
  } else {
    // 16-bit: add the previous sample in the file's native endianness.
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let y = 0; y < height; y += 1) {
      const base = y * rowBytes;
      for (let x = 1; x < width; x += 1) {
        for (let c = 0; c < spp; c += 1) {
          const i = base + (x * spp + c) * 2;
          const prev = view.getUint16(i - spp * 2, le);
          view.setUint16(i, (view.getUint16(i, le) + prev) & 0xffff, le);
        }
      }
    }
  }
}
