import { createStore } from "solid-js/store";
import type { LutLayout } from "../engine/lut/lutFormatWriters";

/**
 * Persistent export settings (legacy "Export" window state). Kept in its own store —
 * NOT part of the graded EditState / JSON autosave — and mirrored to localStorage so the
 * chosen format/preset/color space survive across sessions. The export window reads/writes
 * this; nothing here mutates the preview render or color pipeline.
 */

export type ExportMode = "single" | "batch";

export type ExportImageFormat = "jpg" | "webp" | "png-8" | "png-16" | "tif";

export type ExportPreset =
  | "jpg-s"
  | "jpg-o"
  | "png-s"
  | "png-o"
  | "png-x"
  | "tif-o"
  | "tif-x"
  | "custom";

export type ExportColorSpace =
  | "preview"
  | "display-p3"
  | "p3-d65"
  | "aces-cct"
  | "dwg"
  | "log-c-3"
  | "log-c-4"
  | "ipp2";

export type ExportGammaCurve = "kalar" | "native";

export type ExportMetadataMode = "preserve" | "clean";

export type ExportDPI = 72 | 96 | 150 | 240 | 300;

export type ExportState = {
  mode: ExportMode;

  fileName: string;
  batchSuffix: string;

  preset: ExportPreset;

  batchMaxSize: number;

  imageWidth: number;
  imageHeight: number;
  imageFormat: ExportImageFormat;
  imageExtension: string;
  imageMimeType: string;
  imageDPI: ExportDPI;
  imageQuality: number;
  /** False delegates lossy compression quality to the browser encoder default. */
  imageQualityEnabled: boolean;

  colorSpace: ExportColorSpace;
  gammaCurve: ExportGammaCurve;

  /** preserve = copy source EXIF into JPEG exports; clean = strip all metadata (default). */
  metadata: ExportMetadataMode;

  // LUT export (legacy fp lut* fields). lutFormat is the human label; lutValue is the writer
  // selector; extension/mime/layout are derived from it (lutFormatCatalog.deriveLutSettings).
  lutFormat: string;
  lutValue: string;
  lutExtension: string;
  lutMimeType: string;
  lutLayout: LutLayout;
  lutSize: number;
};

export const DEFAULT_EXPORT_STATE: ExportState = {
  mode: "single",
  fileName: "",
  batchSuffix: "__GRADED",
  preset: "jpg-s",
  // Legacy default 0 = export each batch image at its original (rendered) size.
  batchMaxSize: 0,
  imageWidth: 0,
  imageHeight: 0,
  imageFormat: "jpg",
  imageExtension: ".jpg",
  imageMimeType: "image/jpeg",
  imageDPI: 72,
  imageQuality: 1,
  imageQualityEnabled: true,
  colorSpace: "preview",
  gammaCurve: "kalar",
  metadata: "preserve",
  // Match the legacy default destination.
  lutFormat: "Adobe Lightroom (XMP)",
  lutValue: "xmp",
  lutExtension: ".xmp",
  lutMimeType: "application/octet-stream",
  lutLayout: "cube",
  lutSize: 64,
};

const STORAGE_KEY = "poto.exportState.v1";

// Only persist the user's durable preferences — never the per-image dimensions/name, which
// are reseeded from the active image each time the window opens.
type PersistedExport = Pick<
  ExportState,
  | "mode"
  | "batchSuffix"
  | "preset"
  | "batchMaxSize"
  | "imageFormat"
  | "imageExtension"
  | "imageMimeType"
  | "imageDPI"
  | "imageQuality"
  | "imageQualityEnabled"
  | "colorSpace"
  | "gammaCurve"
  | "metadata"
  | "lutFormat"
  | "lutValue"
  | "lutExtension"
  | "lutMimeType"
  | "lutLayout"
  | "lutSize"
>;

function loadPersisted(): Partial<ExportState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedExport>;
    if (!parsed || typeof parsed !== "object") return {};
    // v1 originally persisted this option as "kalar". Keep existing users on the
    // same transform after the user-facing rename to "Hytic"; passing the legacy
    // value into the export resolver leaves gamma-controlled transforms undefined.
    if ((parsed.gammaCurve as string | undefined) === "kalar") {
      parsed.gammaCurve = "kalar";
    } else if (parsed.gammaCurve !== "kalar" && parsed.gammaCurve !== "native") {
      delete parsed.gammaCurve;
    }
    // Migrate legacy low-quality JPEG/WebP settings so existing users receive
    // the improved export defaults instead of retaining 0.667 indefinitely.
    if (
      (parsed.imageFormat === "jpg" || parsed.imageFormat === "webp") &&
      typeof parsed.imageQuality === "number" &&
      parsed.imageQuality < 0.8
    ) {
      parsed.imageQuality = 1;
    }
    return parsed;
  } catch {
    return {};
  }
}

export const [exportState, setExportStateStore] = createStore<ExportState>({
  ...DEFAULT_EXPORT_STATE,
  ...loadPersisted(),
});

/** Typed setter wrapper around the Solid store setter (mirrors editor-store's setEditState). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const setExportState = setExportStateStore as (...args: any[]) => void;

function persist() {
  try {
    const p: PersistedExport = {
      mode: exportState.mode,
      batchSuffix: exportState.batchSuffix,
      preset: exportState.preset,
      batchMaxSize: exportState.batchMaxSize,
      imageFormat: exportState.imageFormat,
      imageExtension: exportState.imageExtension,
      imageMimeType: exportState.imageMimeType,
      imageDPI: exportState.imageDPI,
      imageQuality: exportState.imageQuality,
      imageQualityEnabled: exportState.imageQualityEnabled,
      colorSpace: exportState.colorSpace,
      gammaCurve: exportState.gammaCurve,
      metadata: exportState.metadata,
      lutFormat: exportState.lutFormat,
      lutValue: exportState.lutValue,
      lutExtension: exportState.lutExtension,
      lutMimeType: exportState.lutMimeType,
      lutLayout: exportState.lutLayout,
      lutSize: exportState.lutSize,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // localStorage may be unavailable (private mode / quota) — non-fatal.
  }
}

/** Apply a partial update and persist the durable subset. */
export function updateExportState(patch: Partial<ExportState>): void {
  setExportStateStore(patch);
  persist();
}
