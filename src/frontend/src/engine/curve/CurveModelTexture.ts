import type { CurveModel } from "../state/EditState";
import { prepareCurveEvaluator } from "./CurveEvaluator";


/**
 * Bakes the grading curves (Density/Chroma/Saturation/Radiance)
 * into 256×1 lookup textures the LUT shader samples. These curves carry their
 * y in [0,1] (0.5 = neutral) — unlike CurveEvaluator's `evaluateCurveTexture`,
 * which encodes y as exposure stops. We reuse `prepareCurveEvaluator` for the
 * bezier/cubic/linear interpolation (the same evaluator that powers the
 * Exposure/Contrast spline panels) and write the [0,1] value straight to 8-bit
 * (matching the 8-bit canvas curve texture format).
 */
export const CURVE_MODEL_TEXTURE_SIZE = 512;

/**
 * Packs the three "density block" curves into one RGBA 512×1 texture:
 *   .r = hueVsDensity   (Density panel)   — sampled by hue
 *   .g = chromaVsDensity (Chroma panel)   — sampled by chroma
 *   .b = lumaVsDensity   (Saturation panel) — sampled by luma
 * Each channel is the [0,1] curve value × 255 (0.5 → 128 ≈ neutral identity).
 */
export function evaluateDensityCurves(
  density: CurveModel,
  chroma: CurveModel,
  saturation: CurveModel,
  out?: Uint8Array,
): Uint8Array {
  const n = CURVE_MODEL_TEXTURE_SIZE;
  const data = out || new Uint8Array(n * 4);
  // Build each evaluator once — not once per sample.
  const evalDensity = prepareCurveEvaluator(density.mode, density.points);
  const evalChroma = prepareCurveEvaluator(chroma.mode, chroma.points);
  const evalSaturation = prepareCurveEvaluator(saturation.mode, saturation.points);
  for (let i = 0; i < n; i += 1) {
    const x = i / (n - 1);
    const o = i * 4;
    const dy = evalDensity(x);    data[o]     = Math.round((dy < 0 ? 0 : dy > 1 ? 1 : dy) * 255);
    const cy = evalChroma(x);     data[o + 1] = Math.round((cy < 0 ? 0 : cy > 1 ? 1 : cy) * 255);
    const sy = evalSaturation(x); data[o + 2] = Math.round((sy < 0 ? 0 : sy > 1 ? 1 : sy) * 255);
    data[o + 3] = 255;
  }
  return data;
}

/** Bakes the hueVsLuma (Radiance) curve into all RGB channels of a 512×1 texture. */
export function evaluateRadianceCurve(curve: CurveModel, out?: Uint8Array): Uint8Array {
  return evaluateSingleCurveModel(curve, out);
}

/**
 * Bakes the lumaVsLuma (Tone / Contrast panel) curve into a 512×1 texture.
 * The shader reads the [0,1] value straight as the *target* luma — so this curve
 * is an identity diagonal (y = x) at neutral, unlike the 0.5-neutral curves above.
 */
export function evaluateToneCurve(curve: CurveModel, out?: Uint8Array): Uint8Array {
  return evaluateSingleCurveModel(curve, out);
}

/**
 * Bakes the expVsLuma (Exposure) offset curve into a 512×1 texture. The
 * shader reads `value + 0.5` as a per-luma brightness multiplier (0.5 neutral
 * → ×1.0), sampled by smoothstep(0.05,0.95, luma).
 */
export function evaluateExposureCurve(curve: CurveModel, out?: Uint8Array): Uint8Array {
  return evaluateSingleCurveModel(curve, out);
}

/** Bakes one [0,1] curve into all RGB channels of a 512×1 RGBA texture. */
function evaluateSingleCurveModel(curve: CurveModel, out?: Uint8Array): Uint8Array {
  const n = CURVE_MODEL_TEXTURE_SIZE;
  const data = out || new Uint8Array(n * 4);
  // Build the evaluator once — not once per sample.
  const evaluate = prepareCurveEvaluator(curve.mode, curve.points);
  for (let i = 0; i < n; i += 1) {
    const x = i / (n - 1);
    const o = i * 4;
    const y = evaluate(x);
    const v = Math.round((y < 0 ? 0 : y > 1 ? 1 : y) * 255);
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  return data;
}
