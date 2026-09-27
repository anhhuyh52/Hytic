// Main-thread client for the export encode worker. Each encode gets its own
// worker so large export jobs release memory immediately after completion/error.

type ExportEncodeResponse =
  | { id: number; ok: true; buffer: ArrayBuffer; type: string }
  | { id: number; ok: false; error: string };

type ExportEncodeMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/tiff";

let nextId = 1;

export function exportSupportsWorker(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

function createWorker(): Worker {
  return new Worker(new URL("./ExportEncodeWorker.ts", import.meta.url), {
    type: "module",
    name: "export-encode",
  });
}

export function encodeExport(
  pixels: ArrayBuffer,
  width: number,
  height: number,
  mimeType: ExportEncodeMimeType,
  quality?: number,
  float16 = false,
  dpi = 72,
  metadata?: {
    make?: string;
    model?: string;
    lens?: string;
    capturedAt?: string;
    software?: string;
  },
  rgba8ToPng16 = false,
): Promise<Blob> {
  const id = nextId++;
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error("Export encoder timed out"));
    }, 60_000);
    const cleanup = () => {
      if (settled) return false;
      settled = true;
      window.clearTimeout(timeout);
      worker.terminate();
      return true;
    };
    worker.onmessage = (event: MessageEvent<ExportEncodeResponse>) => {
      const message = event.data;
      if (message.id !== id || !cleanup()) return;
      if (message.ok) resolve(new Blob([message.buffer], { type: message.type }));
      else reject(new Error(message.error));
    };
    worker.onerror = (event) => {
      if (!cleanup()) return;
      reject(new Error(event.message || "Export encode worker error"));
    };
    worker.onmessageerror = () => {
      if (!cleanup()) return;
      reject(new Error("Export encoder returned an unreadable response"));
    };
    try {
      worker.postMessage(
        { id, pixels, width, height, mimeType, quality, float16, dpi, metadata, rgba8ToPng16 },
        [pixels],
      );
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
