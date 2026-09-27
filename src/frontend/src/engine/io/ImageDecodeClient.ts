import type {
  ImageDecodeRequest,
  ImageDecodeResponse,
  ImageDecodeResult,
} from "./ImageDecodeProtocol";
import type { SupportedImageFormat } from "./CodecRegistry";

// Main-thread client for the decode worker. Lazily spawns one persistent worker
// (Vite bundles it from the new URL(...) reference) and multiplexes concurrent
// decode requests by id. The decoded ImageBitmap is transferred back, so the only
// main-thread cost is the texture upload — the codec work stays off-thread.

export type WorkerDecodedImage = {
  bitmap: ImageBitmap;
  rgbaBuffer?: ArrayBuffer;
  width: number;
  height: number;
  bitDepth: number;
  hasAlpha: boolean;
  orientation?: number;
  make?: string;
  model?: string;
  dateTime?: string;
};

type Pending = {
  resolve: (value: WorkerDecodedImage) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
// Large RAW/HEIC files can legitimately take over a minute on low-power
// devices; decoding is isolated in a worker, so allow it to finish.
const DECODE_TIMEOUT_MS = 180_000;

function rejectAll(error: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
  worker?.terminate();
  worker = undefined;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ImageDecodeWorker.ts", import.meta.url), {
    type: "module",
    name: "image-decode",
  });
  worker.onmessage = (event: MessageEvent<ImageDecodeResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) {
      const {
        bitmap,
        rgbaBuffer,
        width,
        height,
        bitDepth,
        hasAlpha,
        orientation,
        make,
        model,
        dateTime,
      } = message as ImageDecodeResult;
      entry.resolve({
        bitmap,
        rgbaBuffer,
        width,
        height,
        bitDepth,
        hasAlpha,
        orientation,
        make,
        model,
        dateTime,
      });
    } else {
      entry.reject(new Error(message.error));
    }
  };
  worker.onerror = (event) => {
    // A worker-level error rejects all in-flight requests; the next decode respawns.
    rejectAll(new Error(event.message || "Image decode worker error"));
  };
  return worker;
}

export async function decodeWithWorker(
  file: File,
  format: SupportedImageFormat,
  options: { includePixels?: boolean } = {},
): Promise<WorkerDecodedImage> {
  const buffer = await file.arrayBuffer();
  const id = nextId++;
  const request: ImageDecodeRequest = {
    id,
    format,
    fileName: file.name,
    mimeType: file.type,
    buffer,
    includePixels: options.includePixels,
  };
  return new Promise<WorkerDecodedImage>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      rejectAll(new Error(`Image decode timed out for "${file.name}".`));
    }, DECODE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage(request, [buffer]); // transfer the file bytes
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
