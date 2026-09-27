import type {
  ExportDPI,
  ExportImageFormat,
  ExportMode,
  ExportPreset,
  ExportState,
} from "./exportStore";

/**
 * Legacy export-preset definitions + sizing math. Pure functions only — no engine/DOM access.
 * The export window reads the active image's base (crop/rotate-resolved) dimensions once on
 * open and uses these to derive width/height; it never recomputes from live slider/curve edits.
 */

/**
 * Sentinel "lossless" quality marker for PNG/TIFF. Legacy uses 1000; the encoder ignores
 * quality for these formats — the value only flags "this is a lossless selection" so the
 * format-switch logic can restore a usable compressed quality when leaving lossless.
 */
export const LOSSLESS = 1000;

/** Selectable JPEG/WebP encoder quality steps. Keep the floor high enough for graded images. */
export const QUALITY_STEPS = [0.8, 0.9, 0.95, 0.98, 1] as const;

export const DPI_STEPS: ExportDPI[] = [72, 96, 150, 240, 300];

export const FORMAT_META: Record<
  ExportImageFormat,
  { extension: string; mimeType: string; label: string }
> = {
  jpg: { extension: ".jpg", mimeType: "image/jpeg", label: "JPG" },
  webp: { extension: ".webp", mimeType: "image/webp", label: "WebP" },
  "png-8": { extension: ".png", mimeType: "image/png", label: "PNG 8-bit" },
  "png-16": { extension: ".png", mimeType: "image/png", label: "PNG 16-bit" },
  tif: { extension: ".tiff", mimeType: "image/tiff", label: "TIFF" },
};

type PresetSpec = {
  format: ExportImageFormat;
  quality: number;
  dpi: ExportDPI;
  /** Cap the long edge to this many px (small variants); undefined = full/current size. */
  longEdgeCap?: number;
};

/** Legacy preset table (§4). `custom` is excluded — it leaves the user's manual values intact. */
export const PRESET_SPECS: Record<Exclude<ExportPreset, "custom">, PresetSpec> = {
  // "Small" controls dimensions, not aggressive compression. Original uses
  // visually-lossless quality to preserve gradients, grain and fine colour detail.
  "jpg-s": { format: "jpg", quality: 0.9, dpi: 72, longEdgeCap: 2048 },
  "jpg-o": { format: "jpg", quality: 0.98, dpi: 72 },
  "png-s": { format: "png-8", quality: LOSSLESS, dpi: 72, longEdgeCap: 1024 },
  "png-o": { format: "png-8", quality: LOSSLESS, dpi: 72 },
  "png-x": { format: "png-16", quality: LOSSLESS, dpi: 300 },
  "tif-o": { format: "tif", quality: LOSSLESS, dpi: 72 },
  "tif-x": { format: "tif", quality: LOSSLESS, dpi: 300 },
};

export const PRESET_LABELS: Record<ExportPreset, string> = {
  "jpg-s": "JPG Small",
  "jpg-o": "JPG Original",
  "png-s": "PNG Small",
  "png-o": "PNG Original",
  "png-x": "PNG Archival",
  "tif-o": "TIFF Original",
  "tif-x": "TIFF Print",
  custom: "Custom",
};

const round = (v: number) => Math.max(1, Math.round(v));

/** Legacy Hc() export safety cap. Keeps very large exports inside mobile/browser memory limits. */
export function legacyMaxSafeExportSize(): number {
  if (typeof navigator === "undefined") return 16384;
  const ua = navigator.userAgent.toLowerCase();
  const isIos =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);
  const areaLimit = isIos ? 16_777_216 : isAndroid ? 117_418_896 : 268_435_456;
  const edge = Math.floor(16_384 * Math.sqrt(areaLimit / (16_384 * 16_384)));
  return Math.max(1, Math.min(16_384, edge));
}

/** Scale (w,h) down so the longest edge ≤ cap, preserving aspect. Never upscales. */
export function fitLongEdge(w: number, h: number, cap: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= cap) return { width: round(w), height: round(h) };
  const s = cap / longest;
  return { width: round(w * s), height: round(h * s) };
}

/** Clamp (w,h) to a maximum edge (e.g. GPU max texture size), preserving aspect. */
export function clampToMax(w: number, h: number, max: number): { width: number; height: number } {
  return fitLongEdge(w, h, max);
}

/** Legacy xp/wp/bp sizing: set the longest edge to `longEdge`, preserving aspect. */
export function sizeByLongEdge(
  w: number,
  h: number,
  longEdge: number,
): { width: number; height: number } {
  const edge = Math.max(1, longEdge);
  if (w >= h) return { width: round(edge), height: round(edge / Math.max(w / h, 1e-6)) };
  return { width: round(edge * (w / Math.max(h, 1))), height: round(edge) };
}

/**
 * Resize keeping the base aspect ratio when the user edits one of the W/H inputs.
 * `edited` says which field changed; the other is derived from the base aspect.
 */
export function resizeKeepingAspect(
  edited: "width" | "height",
  value: number,
  baseAspect: number,
): { imageWidth: number; imageHeight: number } {
  const v = round(value);
  if (edited === "width") {
    return { imageWidth: v, imageHeight: round(v / baseAspect) };
  }
  return { imageWidth: round(v * baseAspect), imageHeight: v };
}

/**
 * Produce the ExportState patch for applying a preset against the active image's base
 * (crop/rotate-resolved) dimensions. `custom` only flips the preset flag (manual values kept).
 */
export function applyExportPreset(
  preset: ExportPreset,
  baseWidth: number,
  baseHeight: number,
  maxSafeSize = legacyMaxSafeExportSize(),
  mode: ExportMode = "single",
  currentBatchMaxSize = 0,
): Partial<ExportState> {
  if (preset === "custom") return { preset };

  const spec = PRESET_SPECS[preset];
  const meta = FORMAT_META[spec.format];
  const requestedLongEdge =
    spec.longEdgeCap ??
    (mode === "single" ? Math.max(baseWidth, baseHeight) : currentBatchMaxSize || maxSafeSize);
  const batchMaxSize = Math.max(1, Math.min(maxSafeSize, requestedLongEdge));
  const sized = sizeByLongEdge(baseWidth, baseHeight, batchMaxSize);

  return {
    preset,
    batchMaxSize,
    imageFormat: spec.format,
    imageExtension: meta.extension,
    imageMimeType: meta.mimeType,
    imageQuality: spec.quality,
    imageQualityEnabled: true,
    imageDPI: spec.dpi,
    imageWidth: sized.width,
    imageHeight: sized.height,
  };
}

/** Per-format traits mirroring legacy Cp(): compression, lossless, and high-DPI support. */
function formatTraits(format: ExportImageFormat) {
  const isCompressed = format === "jpg" || format === "webp";
  // Only WebP lacks DPI-metadata support (legacy isHighDpiEnabled = jpg || png || tif).
  const isHighDpiEnabled = format !== "webp";
  return { isCompressed, isLossless: !isCompressed, isHighDpiEnabled };
}

/**
 * Patch for switching format manually in custom mode (legacy `lo` handler). Mirrors legacy:
 *  - leaving a lossless format → restore a high compressed quality (0.95),
 *  - entering a lossless format → set the lossless sentinel,
 *  - dropping to a non-high-DPI format (WebP) while DPI > 72 → force DPI back to 72.
 */
export function applyFormatChange(
  format: ExportImageFormat,
  currentQuality: number,
  currentDpi: ExportDPI,
): Partial<ExportState> {
  const meta = FORMAT_META[format];
  const { isCompressed, isLossless, isHighDpiEnabled } = formatTraits(format);
  const patch: Partial<ExportState> = {
    imageFormat: format,
    imageExtension: meta.extension,
    imageMimeType: meta.mimeType,
  };
  if (currentDpi !== 72 && !isHighDpiEnabled) patch.imageDPI = 72;
  if (currentQuality === LOSSLESS) {
    if (isCompressed) patch.imageQuality = 1;
  } else if (isLossless) {
    patch.imageQuality = LOSSLESS;
  }
  return patch;
}

/** Whether a format ignores the quality control (lossless). */
export function isLosslessFormat(format: ExportImageFormat): boolean {
  return format === "png-8" || format === "png-16" || format === "tif";
}

/**
 * Approximate encoded size for display before export. Lossy formats vary with
 * image detail; PNG estimates use photographic-image averages. TIFF is emitted
 * uncompressed and is therefore close to four bytes per pixel.
 */
export function estimateExportBytes(
  width: number,
  height: number,
  format: ExportImageFormat,
  quality?: number,
): number {
  const pixels = Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height));
  const q = Math.max(0.01, Math.min(1, quality ?? 0.92));
  const bytesPerPixel =
    format === "tif"
      ? 4
      : format === "png-16"
        ? 4.2
        : format === "png-8"
          ? 1.8
          : format === "webp"
            ? 0.08 + 0.72 * q ** 3
            : 0.12 + 1.05 * q ** 4;
  return Math.max(1024, Math.round(pixels * bytesPerPixel + 2048));
}

export function formatEstimatedBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb < 100 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
