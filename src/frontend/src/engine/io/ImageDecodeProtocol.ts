import type { SupportedImageFormat } from "./CodecRegistry";

// Message protocol shared between the main thread (ImageDecodeClient) and the
// decode worker (ImageDecodeWorker). Heavy pure-JS/WASM codecs run off the main
// thread so large/pro images don't freeze the UI; the worker returns a ready
// ImageBitmap (Transferable) plus dimensions/depth.

// Formats that are decoded in the worker (vs. the browser-native createImageBitmap
// path for jpeg/png). Keep in sync with CodecRegistry import statuses.
export const WORKER_DECODE_FORMATS: readonly SupportedImageFormat[] = [
  "dpx",
  "tiff",
  "exr",
  "heic",
  "raw",
];

export function shouldUseImageDecodeWorker(format: SupportedImageFormat): boolean {
  return WORKER_DECODE_FORMATS.includes(format);
}

export type ImageDecodeRequest = {
  id: number;
  format: SupportedImageFormat;
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer; // transferred
  /** Import persistence needs the decoded RGBA; normal viewer loads do not. */
  includePixels?: boolean;
};

export type ImageDecodeResult = {
  id: number;
  ok: true;
  bitmap: ImageBitmap; // transferred
  /** Present only when requested; avoids a main-thread canvas readback on import. */
  rgbaBuffer?: ArrayBuffer; // transferred
  width: number;
  height: number;
  bitDepth: number;
  hasAlpha: boolean;
  // EXIF/TIFF-derived metadata (when the codec exposes it).
  orientation?: number;
  make?: string;
  model?: string;
  dateTime?: string;
};

export type ImageDecodeError = {
  id: number;
  ok: false;
  error: string;
};

export type ImageDecodeResponse = ImageDecodeResult | ImageDecodeError;
