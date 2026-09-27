// Web Worker for the legacy Color Match. Runs the vendored srp-static statistical
// color-transfer off the main thread and returns a 16³ half-float RGB LUT (atlas
// ordering (r + g*16 + b*256)*3) that the LUTGenerator bakes into the look. The
// "AI" framing in the legacy UI is marketing — this is deterministic statistics.
import vt from "./srpStatic.js";

export type MatchWorkerRequest = {
  id: number;
  source: { data: ArrayBuffer; width: number; height: number };
  reference: { data: ArrayBuffer; width: number; height: number };
  colorMix: number; // 0..1
  lumaMix: number; // 0..1
};

export type MatchWorkerResponse =
  | { id: number; ok: true; buffer: ArrayBuffer }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<MatchWorkerRequest>) => void) | null;
  postMessage(message: MatchWorkerResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = (event: MessageEvent<MatchWorkerRequest>) => {
  const { id, source, reference, colorMix, lumaMix } = event.data;
  try {
    const lut = vt(
      { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height },
      {
        data: new Uint8ClampedArray(reference.data),
        width: reference.width,
        height: reference.height,
      },
      colorMix,
      lumaMix,
      true,
    );
    // srp returns a partial view onto a larger buffer; copy to a tight buffer so
    // the transfer carries exactly the LUT bytes.
    const out = new Uint16Array(lut);
    ctx.postMessage({ id, ok: true, buffer: out.buffer }, [out.buffer]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
