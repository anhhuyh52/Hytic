import { Matrix3, Vector2, type IUniform } from "three";
import {
  buildDistortionMatrix,
  distortStateIsActive,
  normalizeDistortionSlider,
  normalizePerspectiveSlider,
} from "./distortMath";
import type { DistortState } from "./distortTypes";

export const DISTORT_SHADER_UNIFORMS = [
  "uDistortionAmount",
  "uDistortionHorizontal",
  "uDistortionVertical",
  "uDistortionMatrix",
  "uDistortionEnabled",
  "uTextureSize",
] as const;

/** Uniform declarations shared by every material that warps through the distortion. */
export const distortionUniformDeclarationsGLSL = `
uniform bool uDistortionEnabled;
uniform float uDistortionAmount;
uniform float uDistortionHorizontal;
uniform float uDistortionVertical;
uniform mat3 uDistortionMatrix;
uniform vec2 uTextureSize;
`;

/**
 * Inverse distortion warp: output UV → source UV. The single copy of the math
 * used by the main viewer, export, and the Distort window draft preview.
 *
 * Ported from the Polarr composite/fringing vertex shader. Polarr applies the
 * corner homography forward to the positions of a detail-64 plane mesh and
 * evaluates the lens/keystone warp per-vertex into a `distortionCoord`
 * texcoord varying; for a homography the per-pixel inverse below produces the
 * identical image (and evaluates the lens warp exactly instead of
 * mesh-interpolated). Slider uniforms are the raw -1..1 state values, matching
 * the reference (`distortion_amount`, `distortion_horizontal`,
 * `distortion_vertical` are fed to the shader unscaled there too).
 */
export const distortionInverseGLSL = `
float distortionUvInBounds(vec2 uv) {
  const float eps = 0.0001;
  return step(-eps, uv.x) * step(uv.x, 1.0 + eps) *
    step(-eps, uv.y) * step(uv.y, 1.0 + eps);
}

vec3 applyDistortionInverse(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;

  vec3 projected = uDistortionMatrix * vec3(p, 1.0);
  float valid = step(0.00001, max(projected.z, -projected.z));
  float w = mix(1.0, projected.z, valid);
  vec2 coord = (projected.xy / w) * 0.5 + 0.5;

  // In the reference the mesh IS the warped quad, so no fragment exists out
  // here. Bail out before the lens math below: its abs() folds are only valid
  // for in-quad fragments and would otherwise mirror spill pixels back into
  // the source image.
  valid *= distortionUvInBounds(coord);
  if (valid < 0.5) {
    return vec3(coord, 0.0);
  }

  vec2 center = vec2(0.5);
  vec2 axis = vec2(0.0, 0.5);
  float len = length(uTextureSize);
  vec2 m = 0.4 / len * uTextureSize;
  vec2 o = vec2(uDistortionHorizontal, uDistortionVertical);
  vec2 n = 1.0 - step(0.0, o);
  vec2 g;
  vec2 a;
  float c;
  float d;
  float h = 1.0;
  float i = 1.0;
  vec2 b = abs(n - coord);

  if (uDistortionHorizontal != 0.0) {
    a = b - axis.xy;
    g = 1.0 - abs(uDistortionHorizontal) * m;
    a = mix(a, a * g, vec2(1.0, a.x));
    b = a + axis.xy;
  }
  if (uDistortionVertical != 0.0) {
    a = b - axis.yx;
    g = 1.0 - abs(uDistortionVertical) * m;
    a = mix(a, a * g, vec2(a.y, 1.0));
    b = a + axis.yx;
  }

  b = abs(n - b) - center;

  if (uDistortionAmount < 0.0) {
    d = len / (uDistortionAmount * -4.0);
    c = max(length(b * uTextureSize) / d, 0.0001);
    h = atan(c) / c;
    c = max(-0.5 * uTextureSize.x, -0.5 * uTextureSize.y) / d;
    i = atan(c) / c;
  }
  if (uDistortionAmount > 0.0) {
    c = dot(b, b) * 0.5625;
    d = uDistortionAmount * 2.0;
    h = 1.0 + c * d;
    i = 1.0 + 0.5 * 0.5625 * d;
  }

  vec2 sourceUv = h * b / i + center;
  valid *= distortionUvInBounds(sourceUv);

  return vec3(sourceUv, valid);
}
`;

export function createDistortUniforms(): Record<string, IUniform> {
  return {
    uDistortionEnabled: { value: false },
    uDistortionAmount: { value: 0 },
    uDistortionHorizontal: { value: 0 },
    uDistortionVertical: { value: 0 },
    uDistortionMatrix: { value: new Matrix3() },
    uTextureSize: { value: new Vector2(1, 1) },
  };
}

/**
 * Writes a DistortState into shader uniforms. The distortion matrix is derived
 * here from `distortionPoints` — the state is the source of truth, never the
 * matrix. Pass committed state for the main viewer/export, draft state for the
 * Distort window preview.
 */
export function applyDistortUniforms(
  uniforms: Record<string, IUniform>,
  state: DistortState,
  imageSize?: { width: number; height: number },
) {
  uniforms.uDistortionEnabled.value = distortStateIsActive(state);
  uniforms.uDistortionAmount.value = normalizeDistortionSlider(state.distortionAmount);
  uniforms.uDistortionHorizontal.value = normalizePerspectiveSlider(state.distortionHorizontal);
  uniforms.uDistortionVertical.value = normalizePerspectiveSlider(state.distortionVertical);
  const matrix = buildDistortionMatrix(state.distortionPoints);
  (uniforms.uDistortionMatrix.value as Matrix3).set(...matrix);
  if (imageSize) {
    (uniforms.uTextureSize.value as Vector2).set(
      Math.max(1, imageSize.width),
      Math.max(1, imageSize.height),
    );
  }
}
