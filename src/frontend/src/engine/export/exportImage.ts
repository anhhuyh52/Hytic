import type { WebGLRenderer, WebGLRenderTarget } from "three";
import { recordFullResReadback } from "../../app/performanceCounters";
import { resolveCjs } from "../io/cjsInterop";
import { encodeExport, exportSupportsWorker } from "./ExportEncodeClient";
import { encodePng16, encodePng16FromRgba8 } from "./png16";
import { encodeTiffRGBA8 } from "./encodeTiff";
import { patchJpegDpi, patchPngDpi } from "./dpi";
import { readRenderTargetRgba8 } from "./readRenderTarget";

/** Canonical export image formats (engine layer — mirrors the UI's ExportImageFormat strings). */
export type ExportEncodeFormat = "jpg" | "webp" | "png-8" | "png-16" | "tif";

const FORMAT_MIME: Record<
  Exclude<ExportEncodeFormat, "tif" | "png-16">,
  "image/jpeg" | "image/webp" | "image/png"
> = {
  jpg: "image/jpeg",
  webp: "image/webp",
  "png-8": "image/png",
};

/**
 * Format-aware export encode (§6). Reads the rendered target back off the GPU and encodes to the
 * requested format, embedding/patching DPI where the container supports it. The half-float
 * (png-16) path requires `renderTarget` to be a half-float RT (set by the caller).
 */
export async function encodeExportImageBlob(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
  opts: {
    format: ExportEncodeFormat;
    quality?: number;
    dpi?: number;
    float16?: boolean;
    metadata?: {
      make?: string;
      model?: string;
      lens?: string;
      capturedAt?: string;
      software?: string;
    };
  },
): Promise<Blob> {
  const dpi = opts.dpi ?? 72;

  // 8-bit PNG export goes through UPNG.js (legacy lossless encoder). UPNG is 8-bit only, so true
  // 16-bit PNG uses the native half-float → PNG-16 path (encodePng16).
  if (opts.format === "png-8") {
    const blob = await encodePng8(renderer, renderTarget, width, height);
    return await patchBlobDpi(blob, "image/png", dpi);
  }

  if (opts.format === "png-16") {
    const blob = opts.float16
      ? await renderTargetToBlob(
          renderer,
          renderTarget,
          width,
          height,
          "image/png",
          undefined,
          true,
        )
      : await renderTargetToPng16FromRgba8(renderer, renderTarget, width, height);
    return await patchBlobDpi(blob, "image/png", dpi);
  }

  if (opts.format === "tif") {
    // GL readback is bottom-up; prefer the worker for the row-flip + TIFF encode.
    const pixels = readRenderTargetRgba8(renderer, renderTarget, width, height);
    if (exportSupportsWorker()) {
      try {
        // Transfer a copy: if the worker cannot be loaded or encode in this browser,
        // keep the original readback available for the main-thread fallback below.
        return await encodeExport(
          pixels.buffer.slice(0),
          width,
          height,
          "image/tiff",
          undefined,
          false,
          dpi,
          opts.metadata,
        );
      } catch (error) {
        console.warn("[export] TIFF worker failed; using main-thread encoder", error);
      }
    }
    const rowBytes = width * 4;
    const topDown = new Uint8Array(pixels.length);
    for (let y = 0; y < height; y += 1) {
      const s = (height - 1 - y) * rowBytes;
      topDown.set(pixels.subarray(s, s + rowBytes), y * rowBytes);
    }
    const tiff = encodeTiffRGBA8(topDown, width, height, dpi, opts.metadata);
    return new Blob([tiff], { type: "image/tiff" });
  }

  const mime = FORMAT_MIME[opts.format];
  const blob = await renderTargetToBlob(
    renderer,
    renderTarget,
    width,
    height,
    mime,
    opts.quality,
    false,
  );
  return await patchBlobDpi(blob, mime, dpi);
}

/** Encodes an assembled bottom-up export buffer, used by the overlapped tiled path. */
export async function encodeExportPixels(
  pixels: ArrayBuffer,
  width: number,
  height: number,
  opts: {
    format: ExportEncodeFormat;
    quality?: number;
    dpi?: number;
    float16?: boolean;
    metadata?: {
      make?: string;
      model?: string;
      lens?: string;
      capturedAt?: string;
      software?: string;
    };
  },
): Promise<Blob> {
  const dpi = opts.dpi ?? 72;
  if (opts.format === "png-16") {
    if (typeof Worker !== "undefined") {
      const blob = await encodeExport(
        pixels,
        width,
        height,
        "image/png",
        undefined,
        !!opts.float16,
        72,
        undefined,
        !opts.float16,
      );
      return patchBlobDpi(blob, "image/png", dpi);
    }
    const png = opts.float16
      ? await encodePng16OnMain(new Uint16Array(pixels), width, height)
      : await encodePng16FromRgba8(new Uint8Array(pixels), width, height);
    const blob = new Blob([png], { type: "image/png" });
    return patchBlobDpi(blob, "image/png", dpi);
  }

  if (opts.format === "tif") {
    if (typeof Worker !== "undefined") {
      return encodeExport(
        pixels,
        width,
        height,
        "image/tiff",
        undefined,
        false,
        dpi,
        opts.metadata,
      );
    }
    const top = flipRgba8(new Uint8Array(pixels), width, height);
    return new Blob([encodeTiffRGBA8(top, width, height, dpi, opts.metadata)], {
      type: "image/tiff",
    });
  }

  if (opts.format === "png-8") {
    // Offload to the worker (native OffscreenCanvas PNG) so the encode doesn't
    // block the UI; main-thread UPNG stays only as the no-worker fallback.
    if (exportSupportsWorker()) {
      try {
        const blob = await encodeExport(pixels.slice(0), width, height, "image/png");
        return patchBlobDpi(blob, "image/png", dpi);
      } catch (error) {
        console.warn("[export] PNG worker failed; using main-thread encoder", error);
      }
    }
    const top = flipRgba8(new Uint8Array(pixels), width, height);
    const UPNG = resolveCjs(await import("upng-js"), "UPNG", "encode");
    const png = UPNG.encode([top.buffer], width, height, 0);
    const blob = new Blob([png], { type: "image/png" });
    return patchBlobDpi(blob, "image/png", dpi);
  }

  const mime = FORMAT_MIME[opts.format];
  const bytes = new Uint8Array(pixels);
  let blob: Blob;
  if (exportSupportsWorker()) {
    try {
      blob = await encodeExport(pixels.slice(0), width, height, mime, opts.quality);
    } catch (error) {
      console.warn(`[export] ${mime} worker failed; using main-thread encoder`, error);
      blob = await encodeOnMainThread(bytes, width, height, mime, opts.quality);
    }
  } else {
    blob = await encodeOnMainThread(bytes, width, height, mime, opts.quality);
  }
  return patchBlobDpi(blob, mime, dpi);
}

async function renderTargetToPng16FromRgba8(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
): Promise<Blob> {
  const pixels = readRenderTargetRgba8(renderer, renderTarget, width, height);
  if (typeof Worker !== "undefined") {
    return encodeExport(
      pixels.buffer,
      width,
      height,
      "image/png",
      undefined,
      false,
      72,
      undefined,
      true,
    );
  }
  return new Blob([await encodePng16FromRgba8(pixels, width, height)], { type: "image/png" });
}

function flipRgba8(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = width * 4;
  const top = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = (height - 1 - y) * rowBytes;
    top.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
  }
  return top;
}

async function patchBlobDpi(blob: Blob, mime: string, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const patched =
    mime === "image/png"
      ? patchPngDpi(bytes, dpi)
      : mime === "image/jpeg"
        ? patchJpegDpi(bytes, dpi)
        : bytes;
  return new Blob([patched], { type: blob.type });
}

/** 8-bit lossless PNG via UPNG.encode (cnum 0 = full 32-bit RGBA, no palette quantization). */
async function encodePng8(
  renderer: WebGLRenderer,
  target: WebGLRenderTarget,
  width: number,
  height: number,
): Promise<Blob> {
  // The GPU readback must stay on the GL (main) thread, but the row-flip + PNG
  // encode are offloaded to the export worker. Synchronous UPNG.encode on the main
  // thread froze the app while flattening/exporting full-resolution images; the
  // worker uses OffscreenCanvas's native (lossless) PNG encoder off-thread.
  const pixels = readRenderTargetRgba8(renderer, target, width, height);
  if (exportSupportsWorker()) {
    try {
      return await encodeExport(pixels.buffer.slice(0), width, height, "image/png");
    } catch (error) {
      console.warn("[export] PNG worker failed; using main-thread encoder", error);
    }
  }
  // No-worker/worker-failure fallback: main-thread UPNG (legacy lossless encoder).
  const UPNG = resolveCjs(await import("upng-js"), "UPNG", "encode");
  const rowBytes = width * 4;
  const top = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    const s = (height - 1 - y) * rowBytes; // GL bottom-up → top-down
    top.set(pixels.subarray(s, s + rowBytes), y * rowBytes);
  }
  const png = UPNG.encode([top.buffer], width, height, 0);
  return new Blob([png], { type: "image/png" });
}

export async function renderTargetToBlob(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
  mimeType: "image/png" | "image/jpeg" | "image/webp",
  quality?: number,
  float16 = false,
): Promise<Blob> {
  // True 16-bit: read the half-float RT as raw half bits and encode a 16-bit PNG.
  if (float16) {
    const half = new Uint16Array(width * height * 4);
    recordFullResReadback();
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, half);
    if (typeof Worker !== "undefined") {
      return encodeExport(half.buffer, width, height, "image/png", undefined, true);
    }
    const png = await encodePng16OnMain(half, width, height);
    return new Blob([png], { type: "image/png" });
  }

  // 8-bit: GL readback on the main thread, off-thread row-flip + encode.
  const pixels = readRenderTargetRgba8(renderer, renderTarget, width, height);
  if (exportSupportsWorker()) {
    try {
      return await encodeExport(pixels.buffer.slice(0), width, height, mimeType, quality);
    } catch (error) {
      console.warn(`[export] ${mimeType} worker failed; using main-thread encoder`, error);
    }
  }
  return encodeOnMainThread(pixels, width, height, mimeType, quality);
}

// Main-thread 16-bit fallback (no Worker): decode half -> 16-bit + flip + encode.
async function encodePng16OnMain(
  half: Uint16Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const rowSamples = width * 4;
  const out16 = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const dstRow = y * rowSamples;
    const srcRow = (height - 1 - y) * rowSamples;
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

// Fallback for environments without OffscreenCanvas/Worker support.
function encodeOnMainThread(
  pixels: Uint8Array,
  width: number,
  height: number,
  mimeType: "image/png" | "image/jpeg" | "image/webp",
  quality?: number,
): Promise<Blob> {
  const flippedPixels = new Uint8ClampedArray(width * height * 4);
  const rowBytes = width * 4;
  for (let targetRow = 0; targetRow < height; targetRow += 1) {
    const sourceOffset = (height - 1 - targetRow) * rowBytes;
    flippedPixels.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), targetRow * rowBytes);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Unable to create export canvas"));
  context.putImageData(new ImageData(flippedPixels, width, height), 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to encode export blob"));
        } else if (blob.type !== mimeType) {
          reject(new Error(`${mimeType} encoding is not supported by this browser`));
        } else {
          resolve(blob);
        }
      },
      mimeType,
      quality,
    );
  });
}
