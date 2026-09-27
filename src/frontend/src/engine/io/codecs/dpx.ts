// Conservative DPX decoder. Only layouts verified by the code below enter the
// pixel path; all other descriptors, packing methods, encodings, and transfer
// characteristics are rejected before a project media record can be created.

import { isDecodedImageWithinBudget } from "../DecodedImageBudget";

export type DecodedDpx = { width: number; height: number; rgba: Uint8Array; bitDepth: number };

export const UNSUPPORTED_DPX_LAYOUT_MESSAGE = "This DPX layout is not supported yet.";

export type DpxVariantInfo = {
  littleEndian: boolean;
  width: number;
  height: number;
  imageDataOffset: number;
  imageElements: number;
  descriptor: number;
  transfer: number;
  bitDepth: number;
  packing: number;
  encoding: number;
  supported: boolean;
  reason?: string;
};

const MAX_DIMENSION = 100000;
const IMAGE_ELEMENT_OFFSET = 800;
const SUPPORTED_TRANSFERS = new Set([2, 6]); // linear and Rec. 709 code values

export function inspectDpxVariant(buffer: ArrayBuffer): DpxVariantInfo {
  if (buffer.byteLength < IMAGE_ELEMENT_OFFSET + 20)
    throw new Error("DPX: file header is truncated");
  const bytes = new Uint8Array(buffer, 0, 4);
  const magic = String.fromCharCode(...bytes);
  if (magic !== "SDPX" && magic !== "XPDS") throw new Error("DPX: bad magic");
  const littleEndian = magic === "XPDS";
  const view = new DataView(buffer);
  const imageDataOffset = view.getUint32(4, littleEndian);
  const orientation = view.getUint16(768, littleEndian);
  const imageElements = view.getUint16(770, littleEndian);
  const width = view.getUint32(772, littleEndian);
  const height = view.getUint32(776, littleEndian);
  const descriptor = view.getUint8(800);
  const transfer = view.getUint8(801);
  const bitDepth = view.getUint8(803);
  const packing = view.getUint16(804, littleEndian);
  const encoding = view.getUint16(806, littleEndian);
  const elementDataOffset = view.getUint32(808, littleEndian);
  const endOfLinePadding = view.getUint32(812, littleEndian);
  const endOfImagePadding = view.getUint32(816, littleEndian);
  const effectiveOffset = elementDataOffset || imageDataOffset;
  const base: DpxVariantInfo = {
    littleEndian,
    width,
    height,
    imageDataOffset: effectiveOffset,
    imageElements,
    descriptor,
    transfer,
    bitDepth,
    packing,
    encoding,
    supported: true,
  };
  if (
    !width ||
    !height ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    !isDecodedImageWithinBudget(width, height)
  ) {
    return { ...base, supported: false, reason: "dimensions" };
  }
  if (orientation !== 0) return { ...base, supported: false, reason: "orientation" };
  if (imageElements !== 1) return { ...base, supported: false, reason: "image element count" };
  if (descriptor !== 50) return { ...base, supported: false, reason: "descriptor" };
  if (!SUPPORTED_TRANSFERS.has(transfer))
    return { ...base, supported: false, reason: transfer === 1 ? "log transfer" : "transfer" };
  if (encoding !== 0) return { ...base, supported: false, reason: "encoding" };
  if (endOfLinePadding !== 0 || endOfImagePadding !== 0)
    return { ...base, supported: false, reason: "padding" };
  if (bitDepth === 10 && packing !== 1)
    return { ...base, supported: false, reason: "10-bit packing" };
  if (bitDepth === 16 && packing !== 0)
    return { ...base, supported: false, reason: "16-bit packing" };
  if (bitDepth !== 10 && bitDepth !== 16) return { ...base, supported: false, reason: "bit depth" };
  const bytesPerPixel = bitDepth === 10 ? 4 : 6;
  const requiredBytes = width * height * bytesPerPixel;
  if (
    effectiveOffset < IMAGE_ELEMENT_OFFSET + 20 ||
    effectiveOffset + requiredBytes > buffer.byteLength
  ) {
    return { ...base, supported: false, reason: "pixel data bounds" };
  }
  return base;
}

export function decodeDpx(buffer: ArrayBuffer): DecodedDpx {
  const variant = inspectDpxVariant(buffer);
  if (!variant.supported) throw new Error(UNSUPPORTED_DPX_LAYOUT_MESSAGE);
  const { width, height, imageDataOffset, littleEndian, bitDepth } = variant;
  const view = new DataView(buffer, imageDataOffset);
  const pixels = width * height;
  const rgba = new Uint8Array(pixels * 4);

  if (bitDepth === 16) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const source = pixel * 6;
      const target = pixel * 4;
      rgba[target] = view.getUint16(source, littleEndian) >> 8;
      rgba[target + 1] = view.getUint16(source + 2, littleEndian) >> 8;
      rgba[target + 2] = view.getUint16(source + 4, littleEndian) >> 8;
      rgba[target + 3] = 255;
    }
  } else {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const word = view.getUint32(pixel * 4, littleEndian);
      const target = pixel * 4;
      rgba[target] = ((word >>> 22) & 0x3ff) >>> 2;
      rgba[target + 1] = ((word >>> 12) & 0x3ff) >>> 2;
      rgba[target + 2] = ((word >>> 2) & 0x3ff) >>> 2;
      rgba[target + 3] = 255;
    }
  }

  return { width, height, rgba, bitDepth };
}
