// Minimal self-contained baseline TIFF encoder (uncompressed, lossless) for export (§6).
// Writes little-endian 8-bit RGBA with embedded resolution (DPI). No external dependency, so
// "TIFF" is a real format here rather than a fallback. Input pixels must already be top-down.

/** Thrown when a format's encoder isn't available, so the UI can show a graceful warning. */
export class ExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportUnsupportedError";
  }
}

/**
 * Encodes a top-down RGBA8 buffer to a baseline (uncompressed) TIFF with the given DPI.
 * Tag order must be ascending (TIFF requirement).
 */
export function encodeTiffRGBA8(
  rgbaTopDown: Uint8Array,
  width: number,
  height: number,
  dpi: number,
  metadata: {
    make?: string;
    model?: string;
    lens?: string;
    capturedAt?: string;
    software?: string;
  } = {},
): Uint8Array {
  const tags: Array<{ tag: number; type: number; count: number; value: number }> = [];
  const TYPE_SHORT = 3;
  const TYPE_LONG = 4;
  const TYPE_RATIONAL = 5;
  const TYPE_ASCII = 2;

  const encoder = new TextEncoder();
  const ascii = [
    metadata.lens ? { tag: 270, value: metadata.lens } : null,
    metadata.make ? { tag: 271, value: metadata.make } : null,
    metadata.model ? { tag: 272, value: metadata.model } : null,
    metadata.software ? { tag: 305, value: metadata.software } : null,
    metadata.capturedAt ? { tag: 306, value: metadata.capturedAt } : null,
  ]
    .filter((entry): entry is { tag: number; value: string } => !!entry)
    .map((entry) => ({ ...entry, bytes: encoder.encode(`${entry.value}\0`) }));

  // External (>4 byte) tag payloads are laid out immediately after the IFD.
  const numTags = 14 + ascii.length;
  const headerSize = 8;
  const ifdSize = 2 + numTags * 12 + 4;
  let auxOffset = headerSize + ifdSize;

  const bitsPerSampleOffset = auxOffset; // 4 SHORTs = 8 bytes
  auxOffset += 8;
  const asciiOffsets = ascii.map((entry) => {
    const offset = auxOffset;
    auxOffset += entry.bytes.length;
    return offset;
  });
  const xResOffset = auxOffset; // RATIONAL = 8 bytes
  auxOffset += 8;
  const yResOffset = auxOffset; // RATIONAL = 8 bytes
  auxOffset += 8;

  const stripOffset = auxOffset;
  const stripBytes = width * height * 4;
  const totalSize = stripOffset + stripBytes;

  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  const out = new Uint8Array(buf);

  // Header (little-endian "II", magic 42, IFD offset).
  out[0] = 0x49;
  out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, headerSize, true);

  tags.push({ tag: 256, type: TYPE_LONG, count: 1, value: width }); // ImageWidth
  tags.push({ tag: 257, type: TYPE_LONG, count: 1, value: height }); // ImageLength
  tags.push({ tag: 258, type: TYPE_SHORT, count: 4, value: bitsPerSampleOffset }); // BitsPerSample
  tags.push({ tag: 259, type: TYPE_SHORT, count: 1, value: 1 }); // Compression = none
  tags.push({ tag: 262, type: TYPE_SHORT, count: 1, value: 2 }); // Photometric = RGB
  tags.push({ tag: 273, type: TYPE_LONG, count: 1, value: stripOffset }); // StripOffsets
  tags.push({ tag: 277, type: TYPE_SHORT, count: 1, value: 4 }); // SamplesPerPixel
  tags.push({ tag: 278, type: TYPE_LONG, count: 1, value: height }); // RowsPerStrip
  tags.push({ tag: 279, type: TYPE_LONG, count: 1, value: stripBytes }); // StripByteCounts
  tags.push({ tag: 282, type: TYPE_RATIONAL, count: 1, value: xResOffset }); // XResolution
  tags.push({ tag: 283, type: TYPE_RATIONAL, count: 1, value: yResOffset }); // YResolution
  tags.push({ tag: 284, type: TYPE_SHORT, count: 1, value: 1 }); // PlanarConfiguration
  tags.push({ tag: 296, type: TYPE_SHORT, count: 1, value: 2 }); // ResolutionUnit = inch (DPI)
  tags.push({ tag: 338, type: TYPE_SHORT, count: 1, value: 1 }); // Legacy Np: associated alpha
  ascii.forEach((entry, index) => {
    tags.push({
      tag: entry.tag,
      type: TYPE_ASCII,
      count: entry.bytes.length,
      value: asciiOffsets[index],
    });
  });

  tags.sort((a, b) => a.tag - b.tag);

  let p = headerSize;
  dv.setUint16(p, tags.length, true);
  p += 2;
  for (const t of tags) {
    dv.setUint16(p, t.tag, true);
    dv.setUint16(p + 2, t.type, true);
    dv.setUint32(p + 4, t.count, true);
    if (t.type === TYPE_SHORT && t.count === 1) {
      dv.setUint16(p + 8, t.value, true); // inline SHORT (low bytes)
      dv.setUint16(p + 10, 0, true);
    } else {
      dv.setUint32(p + 8, t.value, true); // LONG inline, or offset for SHORT[4]/RATIONAL
    }
    p += 12;
  }
  dv.setUint32(p, 0, true); // next IFD = none

  // BitsPerSample = 8,8,8,8
  dv.setUint16(bitsPerSampleOffset, 8, true);
  dv.setUint16(bitsPerSampleOffset + 2, 8, true);
  dv.setUint16(bitsPerSampleOffset + 4, 8, true);
  dv.setUint16(bitsPerSampleOffset + 6, 8, true);
  // X/Y resolution rationals = dpi / 1
  const d = Math.max(1, Math.round(dpi));
  dv.setUint32(xResOffset, d, true);
  dv.setUint32(xResOffset + 4, 1, true);
  dv.setUint32(yResOffset, d, true);
  dv.setUint32(yResOffset + 4, 1, true);
  ascii.forEach((entry, index) => out.set(entry.bytes, asciiOffsets[index]));

  out.set(rgbaTopDown.subarray(0, stripBytes), stripOffset);
  return out;
}
