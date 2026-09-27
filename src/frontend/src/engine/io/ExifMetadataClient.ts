import { readExif, type ExifFields } from "./ExifMetadata";

type Response =
  | { id: number; ok: true; metadata: ExifFields }
  | { id: number; ok: false; error: string };

type Pending = {
  resolve: (metadata: ExifFields) => void;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
const EXIF_TIMEOUT_MS = 2_000;
// Metadata is best-effort. Do not duplicate a 100+ MB RAW in the metadata
// worker while the decode worker is already holding its own input and RGBA.
const MAX_EXIF_SCAN_BYTES = 32 * 1024 * 1024;

function stopWorker(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve({});
  }
  pending.clear();
  worker?.terminate();
  worker = undefined;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ExifMetadataWorker.ts", import.meta.url), {
    type: "module",
    name: "image-metadata",
  });
  worker.onmessage = (event: MessageEvent<Response>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message.ok ? message.metadata : {});
  };
  worker.onerror = () => stopWorker();
  return worker;
}

/**
 * Read metadata without running ExifReader's synchronous parser on the UI
 * thread. Blob structured cloning and slicing do not copy image bytes; the
 * bounded slice also caps the worker's parsing allocation for huge files.
 */
export function readExifOffThread(file: Blob): Promise<ExifFields> {
  if (typeof Worker === "undefined") return readExif(file);
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve({});
      // Termination actually interrupts a stuck synchronous parser; a
      // Promise.race timeout cannot do that.
      stopWorker();
    }, EXIF_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    try {
      getWorker().postMessage({ id, file: file.slice(0, MAX_EXIF_SCAN_BYTES, file.type) });
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      resolve({});
    }
  });
}
