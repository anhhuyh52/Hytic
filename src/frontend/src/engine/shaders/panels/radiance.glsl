// Radiance — port of the legacy hueVsLuma op (package.min.js LMM
// block), run in the cct log working space (lin2cct/cct2lin + legacy* helpers
// from the legacyColor include). Per-hue luma modulation is weighted by chroma
// and darkness: the curve (sampled by hue) lifts/cuts luma most in dark,
// chromatic regions. Curve value 0.5 is identity (so a neutral curve is a no-op).
//   uRadianceCurve.r = hueVsLuma, sampled by hue.
//
// Legacy samples hue/chroma before lch_mod, then applies this op after lch_mod.
// The LUT shader's combined LMM block preserves that dependency. This standalone
// wrapper is only faithful when called with the intended pre-Tone input.
vec3 applyRadiance(vec3 color, sampler2D curve) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float hue = legacyHue(cct);
  float crm = legacyChroma(cct);
  float lum = legacyLuma(cct);
  float hueVsLum = texture2D(curve, vec2(hue, 0.5)).r * 4.0 - 1.0;
  float hvlInf = (1.0 - pow(1.0 - crm, 2.0)) * (1.0 - lum);
  cct = mix(cct, cct * hueVsLum, hvlInf);
  return cct2lin(cct);
}
