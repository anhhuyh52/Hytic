type XmpWorkerResponse =
  | { id: number; ok: true; buffer: ArrayBuffer }
  | { id: number; ok: false; error: string };

let nextXmpRequestId = 1;
const XMP_TIMEOUT_MS = 60_000;

export function encodeXmpProfile(cube: Blob, title: string): Promise<Blob> {
  const id = nextXmpRequestId++;
  const file = new File([cube], `${title}.cube`, { type: "application/octet-stream" });
  return new Promise((resolve, reject) => {
    const worker = new Worker("/workers/xmpProfileWorker.js", { name: "xmp-profile" });
    let settled = false;
    const timer = setTimeout(
      () => finish(() => reject(new Error("XMP profile worker timed out."))),
      XMP_TIMEOUT_MS,
    );
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    worker.onmessage = (event: MessageEvent<XmpWorkerResponse>) => {
      if (event.data.id !== id) return;
      if (event.data.ok) {
        const buffer = event.data.buffer;
        finish(() => resolve(new Blob([buffer], { type: "application/octet-stream" })));
      } else {
        const error = event.data.error;
        finish(() => reject(new Error(error)));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "XMP profile worker failed")));
    };
    try {
      worker.postMessage({ id, file, title });
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}
