// Balance — faithful port of the legacy `colorVolume` (saturation +
// exposure) and `colorBalance` (temperature + tint) ops, run in the cct log
// working space (lin2cct/cct2lin + legacyLuma + the LEGACY_*2* YIQ matrices from
// the legacyColor include). The engine stores the four axes in [-1,1] (0 neutral);
// the legacy state→shader transforms (Df / Rf) are folded in here so these match
// the legacy uniforms exactly:
//   colorVolume.x (sat mult) = 1 + saturation
//   colorVolume.y (exposure) = exposure < 0 ? pow(2, exposure*0.5) : 0.2*exposure
//   colorBalance.x (temp)    = temperature * 0.1
//   colorBalance.y (tint, Q) = tint * 0.5 * 0.5226 * 0.1
// In the legacy pipeline colorVolume runs FIRST; colorBalance runs AFTER refraction.

const vec3 BAL_D667 = vec3(0.93, 0.54, 0.0);
const vec3 BAL_D667inv = vec3(1.0) - BAL_D667;

vec3 applyColorVolume(vec3 color, float saturation, float exposure) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float cvx = 1.0 + saturation;
  float cvy = exposure < 0.0 ? pow(2.0, exposure * 0.5) : 0.2 * exposure;
  float lum = legacyLuma(cct);
  float mxc = max(cct.x, max(cct.y, cct.z));
  cct = mix(vec3(lum), cct, cvx);
  if (cvx > 1.0) {
    cct *= mix(1.0, mxc / max(max(cct.x, max(cct.y, cct.z)), 0.00001), 1.413 - lum);
  }
  cct = cvy > 0.5 ? mix(cct, cct * cvy, lum) : cct + cvy * pow(1.0 - lum, 5.0);
  return cct2lin(cct);
}

vec3 applyColorBalance(vec3 color, float temperature, float tint) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float temp = temperature * 0.1;
  float tintQ = tint * 0.5 * 0.5226 * 0.1;
  cct = mix(cct, mix(2.0 * cct * BAL_D667, 1.0 - 2.0 * (1.0 - cct) * BAL_D667inv, step(0.5, cct)), temp);
  vec3 yiq = LEGACY_RGB2YIQ * cct; // legacy TNT convention: M * v
  yiq.z = clamp(tintQ + yiq.z, -0.5226, 0.5226);
  cct = LEGACY_YIQ2RGB * yiq;
  return cct2lin(cct);
}
