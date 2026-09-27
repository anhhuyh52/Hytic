// Off-thread export encode: the main thread reads the graded pixels off the GPU
// (readRenderTargetPixels must stay on the GL thread), then transfers them here
// for the row-flip + encode, so large exports don't block the UI.
//   8-bit  → OffscreenCanvas.convertToBlob (PNG/JPEG)
//   16-bit → half-float bits decoded to 16-bit + native PNG (encodePng16)
// See [[image-decode-worker]].
import { encodePng16, encodePng16FromRgba8 } from "./png16";
import { encodeTiffRGBA8 } from "./encodeTiff";

type ExportEncodeRequest = {
  id: number;
  pixels: ArrayBuffer; // RGBA, bottom-up (GL order), transferred. Uint8 (8-bit) or Uint16 half-float (float16)
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/tiff";
  quality?: number;
  float16?: boolean;
  rgba8ToPng16?: boolean;
  dpi?: number;
  metadata?: {
    make?: string;
    model?: string;
    lens?: string;
    capturedAt?: string;
    software?: string;
  };
};

type ExportEncodeResponse =
  | { id: number; ok: true; buffer: ArrayBuffer; type: string }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ExportEncodeRequest>) => void) | null;
  postMessage(message: ExportEncodeResponse, transfer: Transferable[]): void;
};

ctx.onmessage = async (event: MessageEvent<ExportEncodeRequest>) => {
  const { id, pixels, width, height, mimeType, quality, float16, rgba8ToPng16, dpi, metadata } =
    event.data;
  try {
    const buffer = float16
      ? await encode16(pixels, width, height)
      : rgba8ToPng16
        ? await encodePng16FromRgba8(new Uint8Array(pixels), width, height)
        : await encode8(pixels, width, height, mimeType, quality, dpi, metadata);
    ctx.postMessage(
      {
        id,
        ok: true,
        buffer: buffer.buffer,
        type: float16 || rgba8ToPng16 ? "image/png" : mimeType,
      },
      [buffer.buffer],
    );
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }, []);
  }
};

async function encode8(
  pixels: ArrayBuffer,
  width: number,
  height: number,
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/tiff",
  quality?: number,
  dpi = 72,
  metadata?: {
    make?: string;
    model?: string;
    lens?: string;
    capturedAt?: string;
    software?: string;
  },
): Promise<Uint8Array> {
  const src = new Uint8ClampedArray(pixels);
  const rowBytes = width * 4;
  const flipped = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y += 1) {
    const s = (height - 1 - y) * rowBytes;
    flipped.set(src.subarray(s, s + rowBytes), y * rowBytes);
  }
  if (mimeType === "image/tiff") {
    return encodeTiffRGBA8(new Uint8Array(flipped.buffer), width, height, dpi, metadata);
  }
  const canvas = new OffscreenCanvas(width, height);
  const c2d = canvas.getContext("2d");
  if (!c2d) throw new Error("OffscreenCanvas 2D context unavailable");
  c2d.putImageData(new ImageData(flipped, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: mimeType, quality });
  if (blob.type !== mimeType) {
    throw new Error(`${mimeType} encoding is not supported by this browser`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}

// half-float RGBA bits (bottom-up) -> top-down 16-bit RGBA -> native PNG16.
async function encode16(pixels: ArrayBuffer, width: number, height: number): Promise<Uint8Array> {
  const half = new Uint16Array(pixels);
  const rowSamples = width * 4;
  const out16 = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const dstRow = y * rowSamples;
    const srcRow = (height - 1 - y) * rowSamples; // flip (GL bottom-up -> top-down)
    for (let i = 0; i < rowSamples; i += 1) {
      const v = halfToFloat(half[srcRow + i]);
      const c = v < 0 ? 0 : v > 1 ? 1 : v;
      out16[dstRow + i] = Math.round(c * 65535);
    }
  }
  return encodePng16(out16, width, height);
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
