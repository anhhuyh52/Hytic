// Camera RAW decode via the vendored legacy LibRaw WASM build (wlbr). This is the
// same decoder the legacy Poto app shipped; it fully develops large sensors
// (e.g. 48MP iPhone ProRAW) that the libraw-wasm npm package only partially
// decodes. Runs inside the decode worker so the multi-second develop never blocks
// the UI. Dynamically imported so the ~1 MB module loads only when a RAW is opened.
//
// wlbr's `process()` returns interleaved RGBA in the module heap plus a metadata
// object; we copy the pixels out before freeing the heap buffer.

import { assertDecodedImageWithinBudget } from "../DecodedImageBudget";

export type RawWlbrDecoded = {
  width: number;
  height: number;
  rgba: Uint8Array; // interleaved RGBA, 8-bit
  hasAlpha: boolean;
  make?: string;
  model?: string;
  dateTime?: string;
};

// LibRaw develop parameters, matched verbatim to the legacy call
// `process(ptr, size, 0, 6, 0.2, 66.667, 0.5, 0, 0)`. They select camera WB +
// sRGB 8-bit output with the RAW orientation baked in (the same pipeline the
// legacy app rendered every RAW through).
const LEGACY_DEVELOP_PARAMS = [0, 6, 0.2, 66.667, 0.5, 0, 0] as const;

export async function decodeRawWlbr(buffer: ArrayBuffer): Promise<RawWlbrDecoded> {
  const { default: wlbr } = await import("./wlbr.js");
  const module = await wlbr();

  const bytes = new Uint8Array(buffer);
  const size = bytes.length;
  const inputPtr = module._malloc(size);
  module.HEAPU8.set(bytes, inputPtr);

  let result;
  try {
    result = module.process(inputPtr, size, ...LEGACY_DEVELOP_PARAMS);
  } finally {
    module._free(inputPtr);
  }

  const { ptr, size: outSize, metadata } = result;
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height || !outSize) {
    module.freeBuffer(ptr);
    throw new Error("RAW develop produced no image data.");
  }
  try {
    assertDecodedImageWithinBudget(width, height, "RAW");
  } catch (error) {
    module.freeBuffer(ptr);
    throw error;
  }

  // Copy the developed pixels out of the WASM heap before it's freed/reused.
  const rgba = new Uint8Array(outSize);
  rgba.set(new Uint8Array(module.HEAP8.buffer, ptr, outSize));
  module.freeBuffer(ptr);

  const channels = Math.round(outSize / (width * height));
  // wlbr develops to interleaved RGBA; normalize to RGBA if it ever returns RGB.
  const out = channels === 4 ? rgba : toRgba(rgba, width, height, channels);

  return {
    width,
    height,
    rgba: out,
    hasAlpha: false, // RAW has no real alpha; the 4th channel is opaque padding
    make: typeof metadata.make === "string" ? metadata.make : undefined,
    model: typeof metadata.model === "string" ? metadata.model : undefined,
    dateTime:
      typeof metadata.datetime === "number"
        ? new Date(metadata.datetime * 1000).toISOString()
        : typeof metadata.datetime === "string"
          ? metadata.datetime
          : undefined,
  };
}

function toRgba(src: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, s = 0; i < width * height; i += 1, s += channels) {
    const o = i * 4;
    out[o] = src[s];
    out[o + 1] = src[s + 1];
    out[o + 2] = src[s + 2];
    out[o + 3] = channels === 4 ? src[s + 3] : 255;
  }
  return out;
}
