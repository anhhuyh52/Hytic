/*
 * Legacy LUT-export destination matrix (package.min.js export-window `lut-format` select)
 * plus the `po` change-handler derivation. Shared by the export window UI and exportStore so
 * the option list, allowed sizes, and extension/mime/layout derivation stay in one place.
 */
import type { LutLayout } from "../engine/lut/lutFormatWriters";

export type LutFormatOption = {
  label: string;
  /** Legacy option value (writer selector): cube / cube-c4d / xmp / dctl / cms / spi3d / clut / vlt / txt-eeColor / png-grid / png-strip / png-cube. */
  value: string;
  /** Allowed cube sizes (legacy data-sizes). */
  sizes: number[];
  /** Marks a destination unavailable in the current runtime. */
  unsupported?: boolean;
};

export type LutFormatGroup = { label: string; options: LutFormatOption[] };

export const LUT_FORMAT_GROUPS: LutFormatGroup[] = [
  {
    label: "3D LUT for Applications",
    options: [
      { label: "Adobe Lightroom (XMP)", value: "xmp", sizes: [32, 64] },
      { label: "Adobe Camera RAW (XMP)", value: "xmp", sizes: [32, 64] },
      { label: "Adobe Photoshop", value: "cube", sizes: [16, 32, 64] },
      { label: "Adobe Premiere", value: "cube", sizes: [16, 32, 64] },
      { label: "Adobe After Effects", value: "cube", sizes: [16, 32, 64] },
      { label: "DaVinci Resolve (LUT)", value: "cube", sizes: [32, 33, 64, 65] },
      { label: "DaVinci Resolve (DCTL)", value: "dctl", sizes: [65] },
      { label: "CapCut", value: "cube", sizes: [32, 33, 64, 65] },
      { label: "Avid", value: "cube", sizes: [32, 33, 64, 65] },
      { label: "Final Cut Pro", value: "cube", sizes: [16, 32, 64] },
      { label: "Affinity Photo", value: "cube", sizes: [16, 32, 64] },
      { label: "Darktable", value: "cube", sizes: [16, 32, 64] },
      { label: "LumaFusion", value: "cube", sizes: [16, 32, 64] },
      { label: "Nucoda", value: "cms", sizes: [17, 33, 65] },
      { label: "OCIO spi3d", value: "spi3d", sizes: [17, 33, 65] },
      { label: "eeColor (TXT)", value: "txt-eeColor", sizes: [16, 17, 32, 33, 64, 65] },
      { label: "Cube Generic", value: "cube", sizes: [16, 17, 32, 33, 64, 65] },
    ],
  },
  {
    label: "Cameras & Monitors",
    options: [
      { label: "Arri Reference Tool", value: "cube", sizes: [33] },
      { label: "Arri Color Tool", value: "cube", sizes: [33] },
      { label: "Blackmagic Camera", value: "cube", sizes: [17, 33] },
      { label: "BMD Video Assist", value: "cube", sizes: [17, 33] },
      { label: "smallHD Monitor", value: "cube", sizes: [33] },
      { label: "Canon CLUT", value: "clut", sizes: [33] },
      { label: "Sony Camera", value: "cube", sizes: [17, 33] },
      { label: "LUMIX Lab App", value: "cube", sizes: [17, 33] },
      { label: "Panasonic Varicam", value: "vlt", sizes: [17] },
    ],
  },
  {
    label: "Social Media Apps",
    options: [
      { label: "TikTok Effect House", value: "png-grid", sizes: [64] },
      { label: "Meta Spark Studio", value: "png-grid", sizes: [64] },
      { label: "Snapchat Lens Studio", value: "png-strip", sizes: [16] },
    ],
  },
  {
    label: "3D Engines",
    options: [
      { label: "Unreal Engine 5", value: "png-strip", sizes: [16] },
      { label: "Unreal Engine 4", value: "cube", sizes: [16, 32, 64] },
      { label: "Unity", value: "png-strip", sizes: [32] },
      { label: "Cinema4D Redshift", value: "cube-c4d", sizes: [16, 32, 64] },
    ],
  },
  {
    label: "LUT PNG Textures",
    options: [
      { label: "Cube Strip 2D", value: "png-strip", sizes: [16, 32, 64] },
      { label: "Cube Grid 2D", value: "png-grid", sizes: [16, 32, 64] },
      { label: "Hald CLUT 3D", value: "png-cube", sizes: [16, 32, 64] },
    ],
  },
];

export const LUT_FORMAT_OPTIONS: LutFormatOption[] = LUT_FORMAT_GROUPS.flatMap((g) => g.options);

export type LutFormatPatch = {
  lutFormat: string;
  lutValue: string;
  lutExtension: string;
  lutMimeType: string;
  lutLayout: LutLayout;
  lutSize: number;
};

/** Extension/mime/layout derivation for a format value — ported from legacy `po`. */
export function deriveLutFormatFields(value: string): {
  lutExtension: string;
  lutMimeType: string;
  lutLayout: LutLayout;
} {
  const isCube = value.startsWith("cube");
  const isTxt = !isCube && value.startsWith("txt");
  const isPng = !isCube && !isTxt && value.startsWith("png");
  return {
    lutExtension: `.${isCube ? "cube" : isTxt ? "txt" : isPng ? "png" : value}`,
    lutMimeType: isPng ? "image/png" : "application/octet-stream",
    lutLayout: isPng
      ? (value.replace("png-", "") as LutLayout)
      : value === "cube-c4d"
        ? "c4d"
        : "cube",
  };
}

/**
 * Full patch for selecting a LUT format option (legacy `po`): keeps the current size when the
 * format still supports it, otherwise falls back to the option's last listed size.
 */
export function deriveLutSettings(option: LutFormatOption, currentSize: number): LutFormatPatch {
  const lutSize = option.sizes.includes(currentSize)
    ? currentSize
    : option.sizes[option.sizes.length - 1];
  return {
    lutFormat: option.label,
    lutValue: option.value,
    ...deriveLutFormatFields(option.value),
    lutSize,
  };
}

/** Match the legacy Lightroom XMP default. */
export const DEFAULT_LUT_OPTION =
  LUT_FORMAT_OPTIONS.find((o) => o.label === "Adobe Lightroom (XMP)") ?? LUT_FORMAT_OPTIONS[0];
