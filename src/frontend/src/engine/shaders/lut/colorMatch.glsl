// Color Match — a 16³ RGB LUT baked from the legacy srp-static algorithm, sampled
// at the end of the creative grade. This is the legacy `lut_cmt` / `useCmt` block
// (package.min.js `If` pass), which samples the LUT in DISPLAY sRGB, not in the
// scene-linear working space:
//
//   if (useCmt) {
//     fragColor = cct2rgb(fragColor);                              // working CCT -> display sRGB
//     fragColor = texture(lut_cmt, 0.9375*fragColor + 0.03125).xyz; // LUT in DISPLAY sRGB
//     fragColor = rgb2cct(fragColor);                              // display sRGB -> working CCT
//   }
//
// Here the creative pipeline hands us scene-linear AP1 `work` (== legacy
// cct2lin(fragColor)), so the legacy `cct2rgb(fragColor)` reduces to `acg2rgb(work)`
// and `rgb2cct(...)` to its inverse — the whole sandwich stays in AP1-linear and
// needs no cct<->lin, so this include is self-contained (independent of
// colorPipeline.glsl / include order). The caller's `lin2cct(work)` afterwards is the
// `lin2cct` half of the legacy `rgb2cct`.
//
// LUT supplied as a 256x16 atlas (16 blue-slices of 16x16 laid out across) and
// sampled with manual trilinear via texture2D, so no sampler3D / GLSL3 is required
// (matches the cspLut approach). Atlas address: px = b*16 + r, py = g. The manual
// fractional index 15*c equals legacy's `0.9375*c + 0.03125` sampler coordinate.

// ── legacy `Cu` colour helpers (verbatim from package.min.js, GLSL ES 1.00 syntax,
//    cmt-prefixed to avoid colliding with the project's own ACES/sRGB helpers) ────
const float CMT_P1 =  0.0245786;
const float CMT_P2 = -0.000090537;
const float CMT_Q1 =  0.983729;
const float CMT_Q2 =  0.4329510;
const float CMT_Q3 =  0.238081;

// sRGB(Rec.709) linear <-> ACEScg (AP1), Hill fit (legacy rgb2ap1 / ap12rgb).
vec3 cmtRgb2ap1(vec3 rgb) {
  return vec3(
    max(0.0, 0.59719 * rgb.x + 0.35458 * rgb.y + 0.04823 * rgb.z),
    max(0.0, 0.07600 * rgb.x + 0.90834 * rgb.y + 0.01566 * rgb.z),
    max(0.0, 0.02840 * rgb.x + 0.13383 * rgb.y + 0.83777 * rgb.z)
  );
}
vec3 cmtAp12rgb(vec3 ap1) {
  return vec3(
    max(0.0,  1.60475 * ap1.x - 0.53108 * ap1.y - 0.07367 * ap1.z),
    max(0.0, -0.10208 * ap1.x + 1.10813 * ap1.y - 0.00605 * ap1.z),
    max(0.0, -0.00327 * ap1.x - 0.07276 * ap1.y + 1.07602 * ap1.z)
  );
}

// ACES tone curve, Hill rational fit (legacy tm_f / tm_r). Forward maps [0,inf)->[0,~1];
// reverse inverts in-gamut display values and returns 0 outside the curve's range.
vec3 cmtTmF(vec3 x) {
  x = max(x, 0.0);
  return (x * x + CMT_P1 * x + CMT_P2) / (CMT_Q1 * x * x + CMT_Q2 * x + CMT_Q3);
}
float cmtTmR(float y) {
  float a = y * CMT_Q1 - 1.0;
  float b = y * CMT_Q2 - CMT_P1;
  float c = y * CMT_Q3 - CMT_P2;
  if (abs(a) < 1e-6) return abs(b) < 1e-6 ? 0.0 : -c / b;
  float d = b * b - 4.0 * a * c;
  return d < 0.0 ? 0.0 : (-b - sqrt(d)) / (2.0 * a);
}
vec3 cmtTmR(vec3 y) { return vec3(cmtTmR(y.r), cmtTmR(y.g), cmtTmR(y.b)); }

vec3 cmtLinToSrgb(vec3 lin) {
  lin = clamp(lin, 0.0, 1.0);
  return vec3(
    lin.x <= 0.0031308 ? 12.92 * lin.x : 1.055 * pow(lin.x, 1.0 / 2.4) - 0.055,
    lin.y <= 0.0031308 ? 12.92 * lin.y : 1.055 * pow(lin.y, 1.0 / 2.4) - 0.055,
    lin.z <= 0.0031308 ? 12.92 * lin.z : 1.055 * pow(lin.z, 1.0 / 2.4) - 0.055
  );
}
vec3 cmtSrgbToLin(vec3 rgb) {
  return vec3(
    rgb.x <= 0.04045 ? rgb.x / 12.92 : pow((rgb.x + 0.055) / 1.055, 2.4),
    rgb.y <= 0.04045 ? rgb.y / 12.92 : pow((rgb.y + 0.055) / 1.055, 2.4),
    rgb.z <= 0.04045 ? rgb.z / 12.92 : pow((rgb.z + 0.055) / 1.055, 2.4)
  );
}

// AP1 scene-linear (legacy cct2lin output) <-> display sRGB. cmtAcgToDisplay is the
// legacy `acg2rgb`; cmtDisplayToAcg is its inverse minus the final lin2cct (the
// caller does lin2cct), completing the legacy `cct2rgb` / `rgb2cct` round-trip.
vec3 cmtAcgToDisplay(vec3 cg)  { return cmtLinToSrgb(cmtAp12rgb(cmtTmF(cg))); }
vec3 cmtDisplayToAcg(vec3 rgb) { return cmtTmR(cmtRgb2ap1(cmtSrgbToLin(rgb))); }

vec3 matchFetch(sampler2D atlas, float r, float g, float b) {
  float u = (b * 16.0 + r + 0.5) / 256.0;
  float v = (g + 0.5) / 16.0;
  return texture2D(atlas, vec2(u, v)).rgb;
}

// Manual trilinear over the 16³ grid in DISPLAY sRGB. Fractional index 15*c ==
// legacy `0.9375*c + 0.03125` (clamp-to-edge, texel centers at (i+0.5)/16).
vec3 sampleMatchAtlas(sampler2D atlas, vec3 disp) {
  vec3 p = clamp(disp, 0.0, 1.0) * 15.0;
  vec3 lo = floor(p);
  vec3 f = p - lo;
  float r0 = lo.x, g0 = lo.y, b0 = lo.z;
  float r1 = min(r0 + 1.0, 15.0), g1 = min(g0 + 1.0, 15.0), b1 = min(b0 + 1.0, 15.0);
  vec3 c000 = matchFetch(atlas, r0, g0, b0);
  vec3 c100 = matchFetch(atlas, r1, g0, b0);
  vec3 c010 = matchFetch(atlas, r0, g1, b0);
  vec3 c110 = matchFetch(atlas, r1, g1, b0);
  vec3 c001 = matchFetch(atlas, r0, g0, b1);
  vec3 c101 = matchFetch(atlas, r1, g0, b1);
  vec3 c011 = matchFetch(atlas, r0, g1, b1);
  vec3 c111 = matchFetch(atlas, r1, g1, b1);
  vec3 x00 = mix(c000, c100, f.x);
  vec3 x10 = mix(c010, c110, f.x);
  vec3 x01 = mix(c001, c101, f.x);
  vec3 x11 = mix(c011, c111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

// Legacy CMT block. `work` is scene-linear AP1 (the creative pipeline's working
// value, == legacy cct2lin(fragColor)). Returns AP1-linear; the caller's
// `lin2cct(work)` completes the legacy `rgb2cct`.
vec3 applyColorMatchLUT(vec3 work, sampler2D atlas, bool useMatch) {
  if (!useMatch) return work;
  vec3 disp = cmtAcgToDisplay(work);    // AP1-linear -> display sRGB  (legacy cct2rgb)
  disp = clamp(sampleMatchAtlas(atlas, disp), 0.0, 1.0); // sample the LUT in display sRGB
  return cmtDisplayToAcg(disp);         // display sRGB -> AP1-linear  (legacy rgb2cct)
}
