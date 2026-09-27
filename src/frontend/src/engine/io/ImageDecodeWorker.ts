// Dedicated decode worker: runs heavy image codecs (rebuilt natively in TS) off
// the main thread and returns a ready ImageBitmap (Transferable) so large/pro
// images never freeze the UI. Spawned by ImageDecodeClient via
// new Worker(new URL(...)). See [[engine-lut-panel-effect-pattern]] for the
// project's Vite worker pattern.
import { decodeDpx } from "./codecs/dpx";
import { decodeTiff } from "./codecs/tiff";
import { decodeExr } from "./codecs/exr";
import { decodeRawWlbr } from "./codecs/rawWlbr";
import { assertDecodedImageWithinBudget } from "./DecodedImageBudget";
import type { ImageDecodeRequest, ImageDecodeResponse } from "./ImageDecodeProtocol";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ImageDecodeRequest>) => void) | null;
  postMessage(message: ImageDecodeResponse, transfer: Transferable[]): void;
};

type Decoded = {
  width: number;
  height: number;
  rgba: Uint8Array;
  bitDepth: number;
  hasAlpha: boolean;
  orientation?: number;
  make?: string;
  model?: string;
  dateTime?: string;
};

ctx.onmessage = async (event: MessageEvent<ImageDecodeRequest>) => {
  const { id, format, buffer, includePixels } = event.data;
  try {
    const decoded = await decode(format, buffer);
    assertDecodedImageWithinBudget(decoded.width, decoded.height, format.toUpperCase());
    const pixels = new Uint8ClampedArray(
      decoded.rgba.buffer,
      decoded.rgba.byteOffset,
      decoded.rgba.byteLength,
    );
    const bitmap = await createImageBitmap(new ImageData(pixels, decoded.width, decoded.height), {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    // The importer persists heavy formats as image.data. Transfer the codec's
    // existing RGBA buffer when requested instead of drawing the full bitmap to a
    // main-thread canvas and reading every pixel back again.
    const rgbaBuffer = includePixels
      ? pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength
        ? pixels.buffer
        : pixels.slice().buffer
      : undefined;
    ctx.postMessage(
      {
        id,
        ok: true,
        bitmap,
        rgbaBuffer,
        width: decoded.width,
        height: decoded.height,
        bitDepth: decoded.bitDepth,
        hasAlpha: decoded.hasAlpha,
        orientation: decoded.orientation,
        make: decoded.make,
        model: decoded.model,
        dateTime: decoded.dateTime,
      },
      rgbaBuffer ? [bitmap, rgbaBuffer] : [bitmap],
    );
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }, []);
  }
};

async function decode(format: string, buffer: ArrayBuffer): Promise<Decoded> {
  if (format === "dpx") {
    const { width, height, rgba, bitDepth } = decodeDpx(buffer);
    return { width, height, rgba, bitDepth, hasAlpha: false };
  }
  if (format === "tiff") {
    return decodeTiff(buffer);
  }
  if (format === "exr") {
    return decodeExr(buffer);
  }
  if (format === "heic") {
    return decodeHeic(buffer);
  }
  if (format === "raw") {
    const { width, height, rgba, hasAlpha, make, model, dateTime } = await decodeRawWlbr(buffer);
    return { width, height, rgba, bitDepth: 8, hasAlpha, make, model, dateTime };
  }
  throw new Error(`Unsupported worker decode format: ${format}`);
}

// HEIC = HEVC intra decode — not hand-rebuildable, so we use the libheif WASM
// library. Dynamically imported so its ~2 MB only loads when a HEIC is decoded
// (DPX/TIFF/EXR stay lightweight). Sync WASM init is allowed in a worker.
async function decodeHeic(buffer: ArrayBuffer): Promise<Decoded> {
  const { default: libheif } = await import("libheif-js/wasm-bundle");
  const images = new libheif.HeifDecoder().decode(new Uint8Array(buffer));
  if (!images.length) throw new Error("HEIC: no images in file");
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  assertDecodedImageWithinBudget(width, height, "HEIC");
  const out = { data: new Uint8ClampedArray(width * height * 4), width, height };
  await new Promise<void>((resolve, reject) => {
    image.display(out, (d) =>
      d ? resolve() : reject(new Error("HEIC: display/processing failed")),
    );
  });
  return { width, height, rgba: new Uint8Array(out.data.buffer), bitDepth: 8, hasAlpha: true };
}
