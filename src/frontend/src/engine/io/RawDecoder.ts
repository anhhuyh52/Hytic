// Camera RAW decode via libraw-wasm (LibRaw). The library self-offloads to its
// own internal Web Worker, so it's driven from the main thread (no nesting inside
// our decode worker). Dynamically imported so its ~1.3 MB WASM only loads when a
// RAW file is opened. Outputs camera-WB, sRGB 8-bit RGB which we wrap as an
// ImageBitmap for the preview path. See [[image-decode-worker]].

import { recordCreateImageBitmap, recordRawDecode } from "../../app/performanceCounters";

export type RawDecoded = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  hasAlpha: boolean;
};

export async function decodeRaw(file: File): Promise<RawDecoded> {
  // One-time RAW ingest. Must only run on import — never during panel interaction
  // (the reopen path loads the cached developed raster instead). The warning fires
  // if this is ever reached mid-drag.
  recordRawDecode();
  const { default: LibRaw } = await import("libraw-wasm");
  const bytes = new Uint8Array(await file.arrayBuffer());

  const raw = new LibRaw();
  try {
    await raw.open(bytes, {
      useCameraWb: true, // honor the camera's recorded white balance
      outputColor: 1, // sRGB
      outputBps: 8,
      userQual: 3, // AHD demosaic
      noAutoBright: false, // keep auto-brightness so dark exposures aren't crushed to black
    });
  } catch (err) {
    throw new Error(
      `Could not read RAW file "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const meta = await raw.metadata();
  const decoded = await raw.imageData();

  // libraw-wasm's imageData() returns a descriptor object — { width, height,
  // colors, bits, dataSize, data } — NOT a bare pixel array. The processed buffer
  // and its true (cropped/rotated active-area) dimensions live on that object, so
  // use them directly instead of guessing dims from the sensor-size metadata
  // (which overruns the buffer and renders black). Stay tolerant of a build that
  // returns the typed array itself by falling back to the metadata dims.
  const descriptor = decoded as unknown as {
    data?: ArrayLike<number>;
    width?: number;
    height?: number;
    colors?: number;
  };
  const hasDescriptor = !!descriptor && ArrayBuffer.isView(descriptor.data as unknown);
  const pixels = (hasDescriptor ? descriptor.data : decoded) as ArrayLike<number> | undefined;

  if (!pixels || pixels.length < 3) {
    throw new Error(`RAW decode produced no image data for "${file.name}".`);
  }

  const metaW = typeof meta.width === "number" ? meta.width : 0;
  const metaH = typeof meta.height === "number" ? meta.height : 0;

  // Prefer the descriptor's own dimensions/channel count; they always match the
  // buffer. Fall back to deriving from the metadata + buffer length otherwise.
  let width = hasDescriptor && descriptor.width ? descriptor.width : metaW;
  let height = hasDescriptor && descriptor.height ? descriptor.height : metaH;
  let channels =
    hasDescriptor && (descriptor.colors === 3 || descriptor.colors === 4)
      ? (descriptor.colors as number)
      : 3;

  if (!hasDescriptor) {
    // Legacy bare-array path: trust metadata dims only when they divide the buffer.
    const metaPx = metaW * metaH;
    if (metaPx > 0 && pixels.length % metaPx === 0) {
      const c = pixels.length / metaPx;
      if (c === 3 || c === 4) channels = c;
    }
    const totalPx = Math.floor(pixels.length / channels);
    // Some RAWs report the full SENSOR size in metadata while imageData() returns
    // the smaller cropped/rotated active area; reshape from one axis to fit.
    if (width * height !== totalPx) {
      if (metaW > 0 && totalPx % metaW === 0) height = totalPx / metaW;
      else if (metaH > 0 && totalPx % metaH === 0) width = totalPx / metaH;
      else {
        throw new Error(
          `RAW decode size mismatch for "${file.name}" (${pixels.length} bytes, metadata ${metaW}x${metaH}).`,
        );
      }
    }
  }
  if (!width || !height) throw new Error(`RAW: missing dimensions for "${file.name}".`);

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, s = 0; i < width * height; i += 1) {
    const o = i * 4;
    rgba[o] = pixels[s];
    rgba[o + 1] = pixels[s + 1];
    rgba[o + 2] = pixels[s + 2];
    rgba[o + 3] = channels === 4 ? pixels[s + 3] : 255;
    s += channels;
  }

  recordCreateImageBitmap();
  const bitmap = await createImageBitmap(new ImageData(rgba, width, height), {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  return { bitmap, width, height, hasAlpha: channels === 4 };
}
