// Exposure — faithful port of the legacy `expVsLuma` op (package.min.js
// main shader). Run in the cct log working space: the curve (an offset curve,
// 0.5 neutral, sampled by a smoothstepped luma) becomes a per-pixel multiplier
// `sample + 0.5` (so 0.5 -> ×1.0 identity, 0 -> ×0.5, 1 -> ×1.5).
//   uExposureCurve.r = expVsLuma, sampled by smoothstep(0.05,0.95, luma).
vec3 applyExposureCurve(vec3 color, sampler2D curve) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float lum = legacyLuma(cct);
  float epp2 = smoothstep(0.05, 0.95, lum);
  cct *= texture2D(curve, vec2(epp2, 0.5)).r + 0.5;
  return cct2lin(cct);
}
