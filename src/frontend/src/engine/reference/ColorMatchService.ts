// Main-thread client for the Color Match worker. One persistent worker,
// multiplexed by id. Mirrors the legacy behavior: a minimum processing time so
// the "analyzing" UI reads as deliberate work (legacy enforced ~1750ms).
import type { MatchWorkerResponse } from "./matchWorker";

export type ColorMatchImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

const MIN_DURATION_MS = 1750;

type Pending = {
  resolve: (lut: Uint16Array) => void;
  reject: (err: Error) => void;
  start: number;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
const MATCH_TIMEOUT_MS = 60_000;

function rejectAll(error: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
  worker?.terminate();
  worker = undefined;
}

export function colorMatchSupported(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./matchWorker.ts", import.meta.url), {
    type: "module",
    name: "color-match",
  });
  worker.onmessage = (event: MessageEvent<MatchWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) {
      const lut = new Uint16Array(message.buffer);
      const wait = Math.max(0, MIN_DURATION_MS - (Date.now() - entry.start));
      setTimeout(() => entry.resolve(lut), wait);
    } else {
      entry.reject(new Error(message.error));
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Color match worker error");
    rejectAll(error);
  };
  return worker;
}

/**
 * Generates a 16³ half-float LUT that maps the graded source toward the reference.
 * `source` is a snapshot of the current grade (display sRGB, match disabled) and
 * `reference` is the reference image — both RGBA8. colorMix / lumaMix are 0..1.
 * The source/reference buffers are transferred and must not be reused after this.
 */
export function generateColorMatchLUT(
  source: ColorMatchImage,
  reference: ColorMatchImage,
  colorMix: number,
  lumaMix: number,
): Promise<Uint16Array> {
  const id = nextId++;
  return new Promise<Uint16Array>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      rejectAll(new Error("Color match worker timed out."));
    }, MATCH_TIMEOUT_MS);
    pending.set(id, { resolve, reject, start: Date.now(), timer });
    try {
      getWorker().postMessage(
        {
          id,
          source: { data: source.data.buffer, width: source.width, height: source.height },
          reference: {
            data: reference.data.buffer,
            width: reference.width,
            height: reference.height,
          },
          colorMix,
          lumaMix,
        },
        [source.data.buffer, reference.data.buffer],
      );
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
