/// <reference lib="webworker" />

import { readExif } from "./ExifMetadata";
import type { ExifFields } from "./ExifMetadata";

type Request = { id: number; file: Blob };
type Response =
  | { id: number; ok: true; metadata: ExifFields }
  | { id: number; ok: false; error: string };

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Response): void;
};

// ExifReader is synchronous once bytes have been loaded. Keep that parsing out
// of the UI thread: Promise.race on the main thread cannot interrupt sync work.
worker.onmessage = async (event) => {
  const { id, file } = event.data;
  try {
    worker.postMessage({ id, ok: true, metadata: await readExif(file) });
  } catch (error) {
    worker.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
