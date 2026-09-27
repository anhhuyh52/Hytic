import type { ColorManagementState } from "../color/ColorManagementTypes";
import {
  displayColorSpaceLabels,
  inputColorSpaceLabels,
  viewTransformLabels,
  workingColorSpaceLabels,
} from "../color/ColorTransforms";
import type {
  LUTData3D,
  LUTInterchangeMetadata,
  LUTInterchangeSize,
  RGBTriplet,
} from "./InterchangeTypes";

export type BakedLUTReadback = {
  data: Float32Array;
  size: number;
  is8Bit?: boolean;
};

const DEFAULT_DOMAIN: RGBTriplet = [0, 0, 0];
const DEFAULT_RANGE: RGBTriplet = [1, 1, 1];

export function createLUTData3D(
  size: number,
  data: Float32Array,
  inputMin: RGBTriplet = [...DEFAULT_DOMAIN],
  inputMax: RGBTriplet = [...DEFAULT_RANGE],
  outputMin: RGBTriplet = [...DEFAULT_DOMAIN],
  outputMax: RGBTriplet = [...DEFAULT_RANGE],
): LUTData3D {
  return {
    size,
    data,
    ordering: "blue-major-red-fastest",
    inputMin,
    inputMax,
    outputMin,
    outputMax,
  };
}

export function lutDataFromBakedLUT(
  lut: BakedLUTReadback,
  outputSize: LUTInterchangeSize | number = lut.size,
): LUTData3D {
  const size = normalizeLUTSize(outputSize);
  const data = new Float32Array(size * size * size * 3);
  const denom = Math.max(1, size - 1);
  const rgb: RGBTriplet = [0, 0, 0];

  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        sampleTrilinear(lut, r / denom, g / denom, b / denom, rgb);
        const index = (b * size * size + g * size + r) * 3;
        data[index] = rgb[0];
        data[index + 1] = rgb[1];
        data[index + 2] = rgb[2];
      }
    }
  }

  return createLUTData3D(size, data);
}

export function validateLUTData3D(lut: LUTData3D): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(lut.size) || lut.size <= 1) {
    errors.push("LUT size must be an integer greater than 1.");
  }

  if (lut.ordering !== "blue-major-red-fastest") {
    errors.push("LUT ordering must be blue-major-red-fastest.");
  }

  const expectedLength =
    Number.isInteger(lut.size) && lut.size > 1 ? lut.size * lut.size * lut.size * 3 : -1;
  if (!(lut.data instanceof Float32Array)) {
    errors.push("LUT data must be a Float32Array.");
  } else if (lut.data.length !== expectedLength) {
    errors.push(`LUT data length must be size^3 * 3 (${expectedLength}), got ${lut.data.length}.`);
  } else {
    for (let i = 0; i < lut.data.length; i += 1) {
      if (!Number.isFinite(lut.data[i])) {
        errors.push(`LUT data contains a non-finite value at index ${i}.`);
        break;
      }
    }
  }

  validateDomain(lut.inputMin, lut.inputMax, "input", errors);
  validateDomain(lut.outputMin, lut.outputMax, "output", errors);

  return errors;
}

export function buildLUTInterchangeMetadata(
  state: ColorManagementState,
  title: string,
  description = "Global color transform exported from the app internal transform chain.",
): LUTInterchangeMetadata {
  const tm = state.toneMapping;
  return {
    title: title.trim() || "Hytic Look",
    description,
    inputColorSpace: inputColorSpaceLabels[state.inputColorSpace],
    workingColorSpace: workingColorSpaceLabels[state.workingColorSpace],
    displayColorSpace: displayColorSpaceLabels[state.displayColorSpace],
    viewTransform: viewTransformLabels[state.viewTransform],
    generatedAt: Date.now(),
    notes: [
      "Baked global color transform only.",
      "Does not include masks, local layers, image-space FX, crop, scopes, or project state.",
      `Tone mapping enabled: ${tm.enabled ? "true" : "false"}.`,
      `Tone mapping: exposureBias=${tm.exposureBias} highlightCompression=${tm.highlightCompression} shoulderStrength=${tm.shoulderStrength} blackLift=${tm.blackLift}.`,
      `Output transform: ${state.useOutputTransform ? "on" : "off"}.`,
      `Gamut mapping: ${state.useGamutMapping ? "on" : "off"}.`,
      `Color management enabled: ${state.enabled ? "true" : "false"}.`,
      "Internal color transform chain; validate non-sRGB and camera-log contracts before delivery.",
      ...(state.ocioRuntime.useBakedLUT
        ? [
            "OCIO baked prototype: internal mapping, not full OCIO processor.",
            "Includes baked OCIO prototype transform.",
            "Limited transform-chain evaluation.",
            "Not full OCIO runtime.",
            `OCIO runtime mode: ${state.ocioRuntime.mode}.`,
            `OCIO runtime plan id: ${state.ocioRuntime.selectedPlanId ?? "none"}.`,
          ]
        : []),
    ],
  };
}

function normalizeLUTSize(size: number): number {
  if (!Number.isInteger(size) || size <= 1) {
    throw new Error("LUT size must be an integer greater than 1.");
  }
  return size;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sampleTrilinear(
  lut: BakedLUTReadback,
  u: number,
  v: number,
  w: number,
  out: RGBTriplet,
): void {
  const size = normalizeLUTSize(lut.size);
  const maxIndex = size - 1;

  const fr = clamp01(u) * maxIndex;
  const fg = clamp01(v) * maxIndex;
  const fb = clamp01(w) * maxIndex;

  const r0 = Math.floor(fr);
  const g0 = Math.floor(fg);
  const b0 = Math.floor(fb);
  const r1 = Math.min(r0 + 1, maxIndex);
  const g1 = Math.min(g0 + 1, maxIndex);
  const b1 = Math.min(b0 + 1, maxIndex);

  const dr = fr - r0;
  const dg = fg - g0;
  const db = fb - b0;

  const at = (r: number, g: number, b: number, c: number) =>
    lut.data[(r + g * size + b * size * size) * 3 + c];

  for (let c = 0; c < 3; c += 1) {
    const c000 = at(r0, g0, b0, c);
    const c100 = at(r1, g0, b0, c);
    const c010 = at(r0, g1, b0, c);
    const c110 = at(r1, g1, b0, c);
    const c001 = at(r0, g0, b1, c);
    const c101 = at(r1, g0, b1, c);
    const c011 = at(r0, g1, b1, c);
    const c111 = at(r1, g1, b1, c);

    const c00 = c000 * (1 - dr) + c100 * dr;
    const c10 = c010 * (1 - dr) + c110 * dr;
    const c01 = c001 * (1 - dr) + c101 * dr;
    const c11 = c011 * (1 - dr) + c111 * dr;

    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;

    out[c] = c0 * (1 - db) + c1 * db;
  }
}

function validateDomain(min: RGBTriplet, max: RGBTriplet, label: string, errors: string[]): void {
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(min[i]) || !Number.isFinite(max[i])) {
      errors.push(`${label} domain contains a non-finite value.`);
      return;
    }
    if (max[i] <= min[i]) {
      errors.push(`${label} domain max must be greater than min on channel ${i}.`);
      return;
    }
  }
}
