// Tone — faithful port of the legacy `lch_mod` op (package.min.js LMM
// block), the science behind the legacy "Contrast" panel's lumaVsLuma curve.
// Runs in the cct log working space (lin2cct/cct2lin + the LEGACY_*2* YIQ
// matrices from the legacyColor include). NOT the color-management tone mapping.
//
// The curve (uToneCurve, sampled by the cct-space YIQ luma) gives a *target*
// luma `tl` for the source luma `sl`. lch_mod then:
//   • derives a saturation factor from how far tl departs from sl,
//   • scales the I/Q (chroma) channels by it (more contrast => more chroma),
//   • pulls luma a third of the way toward the target.
// When the curve is the identity diagonal (tl == sl) the op is a no-op:
//   sa = 1 -> sf = 0.5, st = 1 -> chroma unchanged, luma unchanged.
//   uToneCurve.r = lumaVsLuma, sampled by luma.

float toneInvSst(float x) {
  float nx = 1.0 - x;
  return nx * pow(x, 0.707) + x * (1.0 - pow(nx, 0.707));
}

vec3 toneLchMod(vec3 yiq, float sl, float tl, float r) {
  float f = r - 2.0;
  float sa = (sl - tl) + 1.0;            // [-1 : 0 : 1] -> [0 : 1 : 2]
  float sf = toneInvSst(0.5 * sa);       // [0 : 1 : 2] ~> [0 : 0.5 : 1]
  float st = max(0.0, ((sa * (r + f)) / 2.0) - f); // [0 : 1 : 2] -> [0 : 1 : r]
  yiq.y = mix(yiq.y, st * yiq.y, sf);
  yiq.z = mix(yiq.z, st * yiq.z, sf);
  yiq.x = mix(sl, tl, 0.333);
  return clamp(yiq * LEGACY_YIQ2RGB, 0.0, 1.0);
}

vec3 applyTone(vec3 color, sampler2D curve) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  vec3 yiq = cct * LEGACY_RGB2YIQ;       // legacy row-vector convention: .x = luma
  float lum = yiq.x;
  float tgtLum = texture2D(curve, vec2(lum, 0.5)).r;
  vec3 outRgb = toneLchMod(yiq, lum, tgtLum, 2.4381791201);
  return cct2lin(outRgb);
}
