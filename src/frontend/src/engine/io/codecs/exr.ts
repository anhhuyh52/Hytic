// Native OpenEXR decoder (rebuilt in TS — no legacy bundle). Scanline images
// with NONE / RLE / ZIPS / ZIP compression, HALF or FLOAT channels, R/G/B(/A).
// EXR is scene-linear, so for the 8-bit preview we apply the sRGB OETF (clamped
// to [0,1]) — HDR/float passthrough would need a float texture path (future).
// Unsupported (throws): PIZ/PXR24/B44/B44A/DWAA/DWAB compression, tiled, deep,
// multipart. async because ZIP uses DecompressionStream. See [[image-decode-worker]].

import { isDecodedImageWithinBudget } from "../DecodedImageBudget";

export type DecodedExr = {
  width: number;
  height: number;
  rgba: Uint8Array;
  bitDepth: number;
  hasAlpha: boolean;
};

const MAGIC = 20000630; // 0x01312f76 little-endian
const HALF = 1;
const FLOAT = 2;
export const UNSUPPORTED_EXR_VARIANT_MESSAGE = "This EXR variant is not supported yet.";

type Channel = { name: string; type: number; size: number; xSampling: number; ySampling: number };

type ParsedExrHeader = {
  channels: Channel[];
  compression: number;
  dataWindow: [number, number, number, number];
  dataOffset: number;
  version: number;
  tiled: boolean;
  deep: boolean;
  multipart: boolean;
};

export type ExrVariantInfo = {
  compression: number;
  channelNames: string[];
  pixelTypes: number[];
  sampling: Array<[number, number]>;
  tiled: boolean;
  deep: boolean;
  multipart: boolean;
  supported: boolean;
  reason?: string;
};

export function inspectExrVariant(buffer: ArrayBuffer): ExrVariantInfo {
  const header = parseExrHeader(buffer);
  const names = header.channels.map((channel) => channel.name);
  const uniqueNames = new Set(names);
  const hasRgb = uniqueNames.has("R") && uniqueNames.has("G") && uniqueNames.has("B");
  const hasY = uniqueNames.has("Y");
  const allowedNames = hasRgb ? new Set(["R", "G", "B", "A"]) : new Set(["Y", "A"]);
  const base: ExrVariantInfo = {
    compression: header.compression,
    channelNames: names,
    pixelTypes: header.channels.map((channel) => channel.type),
    sampling: header.channels.map(
      (channel) => [channel.xSampling, channel.ySampling] as [number, number],
    ),
    tiled: header.tiled,
    deep: header.deep,
    multipart: header.multipart,
    supported: true,
  };
  if (header.version > 2) return { ...base, supported: false, reason: "version" };
  if (header.tiled || header.deep || header.multipart)
    return { ...base, supported: false, reason: "image organization" };
  if (![0, 1, 2, 3].includes(header.compression))
    return { ...base, supported: false, reason: "compression" };
  if (header.channels.some((channel) => channel.type !== HALF && channel.type !== FLOAT)) {
    return { ...base, supported: false, reason: "pixel type" };
  }
  if (header.channels.some((channel) => channel.xSampling !== 1 || channel.ySampling !== 1)) {
    return { ...base, supported: false, reason: "channel sampling" };
  }
  const [xmin, ymin, xmax, ymax] = header.dataWindow;
  if (xmax < xmin || ymax < ymin) return { ...base, supported: false, reason: "data window" };
  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  if (!isDecodedImageWithinBudget(width, height)) {
    return { ...base, supported: false, reason: "dimensions" };
  }
  if ((!hasRgb && !hasY) || (hasRgb && hasY) || uniqueNames.size !== names.length) {
    return { ...base, supported: false, reason: "channel layout" };
  }
  if (names.some((name) => !allowedNames.has(name)))
    return { ...base, supported: false, reason: "channel layout" };
  return base;
}

export async function decodeExr(buffer: ArrayBuffer): Promise<DecodedExr> {
  const variant = inspectExrVariant(buffer);
  if (!variant.supported) throw new Error(UNSUPPORTED_EXR_VARIANT_MESSAGE);
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("EXR: bad magic");
  const versionField = dv.getUint32(4, true);
  const version = versionField & 0xff;
  const tiled = (versionField & 0x200) !== 0;
  const nonImage = (versionField & 0x800) !== 0; // deep
  const multipart = (versionField & 0x1000) !== 0;
  if (version > 2) throw new Error(`EXR: unsupported version ${version}`);
  if (tiled) throw new Error("EXR: tiled images are not supported");
  if (nonImage || multipart) throw new Error("EXR: deep/multipart images are not supported");

  // ── header attributes ────────────────────────────────────────────────────
  let p = 8;
  const readStr = (): string => {
    let s = "";
    while (dv.getUint8(p) !== 0) s += String.fromCharCode(dv.getUint8(p++));
    p += 1; // skip null
    return s;
  };

  let channels: Channel[] | null = null;
  let compression = 0;
  let dw: [number, number, number, number] | null = null;

  for (;;) {
    const name = readStr();
    if (name === "") break; // end of header
    readStr(); // attribute type string (dispatch on name instead)
    const size = dv.getUint32(p, true);
    p += 4;
    const valueStart = p;
    if (name === "channels") {
      channels = [];
      let q = valueStart;
      while (dv.getUint8(q) !== 0) {
        let cname = "";
        while (dv.getUint8(q) !== 0) cname += String.fromCharCode(dv.getUint8(q++));
        q += 1; // null
        const ptype = dv.getInt32(q, true);
        q += 4; // pixelType
        q += 4; // pLinear (1) + reserved (3)
        const xSampling = dv.getInt32(q, true);
        q += 4;
        const ySampling = dv.getInt32(q, true);
        q += 4;
        const bytes = ptype === HALF ? 2 : 4;
        channels.push({ name: cname, type: ptype, size: bytes, xSampling, ySampling });
      }
    } else if (name === "compression") {
      compression = dv.getUint8(valueStart);
    } else if (name === "dataWindow") {
      dw = [
        dv.getInt32(valueStart, true),
        dv.getInt32(valueStart + 4, true),
        dv.getInt32(valueStart + 8, true),
        dv.getInt32(valueStart + 12, true),
      ];
    }
    p = valueStart + size;
  }

  if (!channels || !dw) throw new Error("EXR: missing channels/dataWindow");
  if (![0, 1, 2, 3].includes(compression)) {
    throw new Error(`EXR: compression ${compression} (PIZ/PXR24/B44/DWA) is not supported`);
  }
  for (const c of channels) {
    if (c.type !== HALF && c.type !== FLOAT) {
      throw new Error(`EXR: channel ${c.name} has unsupported pixel type ${c.type}`);
    }
  }

  const [xmin, ymin, xmax, ymax] = dw;
  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  if (width <= 0 || height <= 0) throw new Error(`EXR: invalid data window ${width}x${height}`);

  // Channels are stored sorted by name; precompute per-scanline byte offsets.
  const sorted = [...channels].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let scanlineBytes = 0;
  const channelOffset = new Map<string, number>();
  for (const c of sorted) {
    channelOffset.set(c.name, scanlineBytes);
    scanlineBytes += width * c.size;
  }
  const byName = new Map(sorted.map((c) => [c.name, c]));

  const linesPerBlock = compression === 3 ? 16 : 1; // ZIP=16; NONE/RLE/ZIPS=1
  const numBlocks = Math.ceil(height / linesPerBlock);

  // ── offset table ───────────────────────────────────────────────────────────
  const offsets: number[] = [];
  for (let i = 0; i < numBlocks; i += 1) {
    if (p + 8 > buffer.byteLength) throw new Error("EXR: truncated scanline offset table");
    // uint64 little-endian (offsets fit safely in a double for sane files)
    const lo = dv.getUint32(p, true);
    const hi = dv.getUint32(p + 4, true);
    offsets.push(hi * 0x100000000 + lo);
    p += 8;
  }

  // ── decode blocks into per-channel float planes ──────────────────────────────
  const planes = new Map<string, Float32Array>();
  for (const c of sorted) planes.set(c.name, new Float32Array(width * height));

  for (let b = 0; b < numBlocks; b += 1) {
    let bp = offsets[b];
    if (!Number.isSafeInteger(bp) || bp < 0 || bp + 8 > buffer.byteLength)
      throw new Error("EXR: invalid scanline block offset");
    const blockY = dv.getInt32(bp, true);
    bp += 4;
    const dataSize = dv.getUint32(bp, true);
    bp += 4;
    const rows = Math.min(linesPerBlock, ymax - blockY + 1);
    if (rows <= 0 || bp + dataSize > buffer.byteLength)
      throw new Error("EXR: invalid scanline block");
    const uncompressedSize = scanlineBytes * rows;
    const compData = new Uint8Array(buffer, bp, dataSize);

    let raw: Uint8Array;
    if (compression === 0 || dataSize >= uncompressedSize) {
      raw = compData; // NONE, or stored uncompressed (compressor didn't help)
    } else if (compression === 1) {
      raw = exrReconstruct(rleUncompress(compData, uncompressedSize));
    } else {
      raw = exrReconstruct(await inflate(compData)); // ZIP / ZIPS
    }
    if (raw.byteLength < uncompressedSize) throw new Error("EXR: truncated scanline data");

    for (let r = 0; r < rows; r += 1) {
      const y = blockY - ymin + r;
      if (y < 0 || y >= height) continue;
      const rowBase = r * scanlineBytes;
      for (const c of sorted) {
        const plane = planes.get(c.name)!;
        const src = rowBase + channelOffset.get(c.name)! + 0;
        const dstRow = y * width;
        for (let x = 0; x < width; x += 1) {
          const o = src + x * c.size;
          let v: number;
          if (c.type === HALF) v = halfToFloat((raw[o] | (raw[o + 1] << 8)) & 0xffff);
          else if (c.type === FLOAT) v = readFloat32LE(raw, o);
          else v = readFloat32LE(raw, o);
          plane[dstRow + x] = v;
        }
      }
    }
  }

  // ── assemble RGBA (linear -> sRGB 8-bit preview) ─────────────────────────────
  const R = planes.get("R");
  const G = planes.get("G");
  const B = planes.get("B");
  const A = planes.get("A");
  const Y = planes.get("Y"); // luminance-only EXRs
  const hasAlpha = !!A && byName.has("A");
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    let r: number, g: number, bl: number;
    if (R && G && B) {
      r = R[i];
      g = G[i];
      bl = B[i];
    } else if (Y) {
      r = g = bl = Y[i];
    } else throw new Error(UNSUPPORTED_EXR_VARIANT_MESSAGE);
    rgba[o] = to8(r);
    rgba[o + 1] = to8(g);
    rgba[o + 2] = to8(bl);
    rgba[o + 3] = hasAlpha ? Math.round(Math.min(1, Math.max(0, A![i])) * 255) : 255;
  }

  return { width, height, rgba, bitDepth: 8, hasAlpha };
}

function parseExrHeader(buffer: ArrayBuffer): ParsedExrHeader {
  const dv = new DataView(buffer);
  const ensure = (offset: number, length = 1) => {
    if (offset < 0 || offset + length > buffer.byteLength) throw new Error("EXR: truncated header");
  };
  ensure(0, 8);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("EXR: bad magic");
  const versionField = dv.getUint32(4, true);
  let p = 8;
  const readStr = (): string => {
    let value = "";
    for (;;) {
      ensure(p);
      const byte = dv.getUint8(p++);
      if (byte === 0) return value;
      value += String.fromCharCode(byte);
    }
  };
  let channels: Channel[] | null = null;
  let compression = -1;
  let dataWindow: [number, number, number, number] | null = null;
  for (;;) {
    const name = readStr();
    if (name === "") break;
    readStr();
    ensure(p, 4);
    const size = dv.getUint32(p, true);
    p += 4;
    const valueStart = p;
    ensure(valueStart, size);
    if (name === "channels") {
      channels = [];
      let q = valueStart;
      const end = valueStart + size;
      while (q < end && dv.getUint8(q) !== 0) {
        let channelName = "";
        while (q < end && dv.getUint8(q) !== 0)
          channelName += String.fromCharCode(dv.getUint8(q++));
        q += 1;
        if (q + 16 > end) throw new Error("EXR: truncated channel list");
        const pixelType = dv.getInt32(q, true);
        q += 8;
        const xSampling = dv.getInt32(q, true);
        q += 4;
        const ySampling = dv.getInt32(q, true);
        q += 4;
        channels.push({
          name: channelName,
          type: pixelType,
          size: pixelType === HALF ? 2 : 4,
          xSampling,
          ySampling,
        });
      }
    } else if (name === "compression") {
      compression = dv.getUint8(valueStart);
    } else if (name === "dataWindow") {
      if (size < 16) throw new Error("EXR: invalid data window");
      dataWindow = [
        dv.getInt32(valueStart, true),
        dv.getInt32(valueStart + 4, true),
        dv.getInt32(valueStart + 8, true),
        dv.getInt32(valueStart + 12, true),
      ];
    }
    p = valueStart + size;
  }
  if (!channels || !dataWindow) throw new Error("EXR: missing channels/dataWindow");
  return {
    channels,
    compression,
    dataWindow,
    dataOffset: p,
    version: versionField & 0xff,
    tiled: (versionField & 0x200) !== 0,
    deep: (versionField & 0x800) !== 0,
    multipart: (versionField & 0x1000) !== 0,
  };
}

// linear scene value -> 8-bit sRGB display code.
function to8(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  let val: number;
  if (e === 0) val = f * Math.pow(2, -24);
  else if (e === 0x1f) val = f ? NaN : Infinity;
  else val = (1 + f / 1024) * Math.pow(2, e - 15);
  return s ? -val : val;
}

function readFloat32LE(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
}

// OpenEXR post-decompression reconstruction: undo the delta predictor, then
// interleave the two halves back together (ImfZip.cpp / ImfRle.cpp).
function exrReconstruct(buf: Uint8Array): Uint8Array {
  const len = buf.length;
  for (let t = 1; t < len; t += 1) {
    const d = buf[t - 1] + buf[t] - 128;
    buf[t] = d & 0xff;
  }
  const out = new Uint8Array(len);
  let t1 = 0;
  let t2 = Math.floor((len + 1) / 2);
  let s = 0;
  while (s < len) {
    out[s++] = buf[t1++];
    if (s < len) out[s++] = buf[t2++];
  }
  return out;
}

// OpenEXR RLE (ImfRle.cpp): signed count; <0 => -count literal bytes; >=0 =>
// count+1 copies of the next byte.
function rleUncompress(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let s = 0;
  let d = 0;
  while (s < src.length && d < expected) {
    const count = (src[s++] << 24) >> 24; // signed
    if (count < 0) {
      for (let i = 0; i < -count && d < expected; i += 1) out[d++] = src[s++];
    } else {
      const c = src[s++];
      for (let i = 0; i <= count && d < expected; i += 1) out[d++] = c;
    }
  }
  return out;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
