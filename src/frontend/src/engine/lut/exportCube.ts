/**
 * Builds Resolve-compatible `.cube` 3D LUT text from a baked global-color LUT.
 *
 * COLOR CONTRACT:
 *   The engine's LUT uses the active internal color-management chain: input
 *   decode/gamut -> working space -> global color -> display/view/tone/gamut
 *   output encode. Metadata comments document the exact active contract. This
 *   includes ONLY global color: no FX, masks, local layers, crop, or transform.
 */

import type { LUTData3D, LUTInterchangeSize } from "../interchange/InterchangeTypes";
import {
  lutDataFromBakedLUT,
  validateLUTData3D,
  type BakedLUTReadback,
} from "../interchange/LUTData";

export type CubeExportSize = LUTInterchangeSize;

export type CubeExportOptions = {
  title?: string;
  size?: CubeExportSize;
  is8Bit?: boolean;
  /** Extra `# ...` comment lines (e.g. color-management metadata). */
  metadataComments?: string[];
};

/** A baked LUT as a dense RGB grid, indexed (r + g*size + b*size*size)*3. */
export type BakedLUT = BakedLUTReadback & { is8Bit: boolean };

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function fmt(v: number): string {
  return clamp01(v).toFixed(7);
}

/**
 * Renders the `.cube` text. Grid points are written in the standard order:
 * red varies fastest, then green, then blue.
 */
export function lutDataToCubeString(lutData: LUTData3D, options: CubeExportOptions = {}): string {
  const lut =
    options.size && options.size !== lutData.size
      ? lutDataFromBakedLUT({ data: lutData.data, size: lutData.size }, options.size)
      : lutData;
  const errors = validateLUTData3D(lut);
  if (errors.length > 0) {
    throw new Error(`Invalid LUT data for .cube export: ${errors.join(" ")}`);
  }

  const title = (options.title ?? "Hytic Look").replace(/"/g, "'").slice(0, 120);
  const lines: string[] = [];

  lines.push("# Created by Hytic - internal color-managed look LUT.");
  lines.push("# NOTE: Baked global color transform only.");
  lines.push(
    "# NOTE: Does not include masks, local layers, image-space FX, crop, scopes, or project state.",
  );
  for (const comment of options.metadataComments ?? []) {
    lines.push(comment.startsWith("#") ? comment : `# ${comment}`);
  }
  if (options.is8Bit) {
    lines.push("# Precision note: LUT was read back at 8-bit; values quantized to 256 levels.");
  }

  lines.push(`TITLE "${title}"`);
  lines.push(`LUT_3D_SIZE ${lut.size}`);
  lines.push("DOMAIN_MIN 0.0 0.0 0.0");
  lines.push("DOMAIN_MAX 1.0 1.0 1.0");

  for (let b = 0; b < lut.size; b += 1) {
    for (let g = 0; g < lut.size; g += 1) {
      for (let r = 0; r < lut.size; r += 1) {
        const index = (b * lut.size * lut.size + g * lut.size + r) * 3;
        lines.push(
          `${fmt(lut.data[index])} ${fmt(lut.data[index + 1])} ${fmt(lut.data[index + 2])}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function atlasToCubeString(lut: BakedLUT, options: CubeExportOptions = {}): string {
  return lutDataToCubeString(lutDataFromBakedLUT(lut, options.size ?? 64), {
    ...options,
    is8Bit: options.is8Bit ?? lut.is8Bit,
  });
}
