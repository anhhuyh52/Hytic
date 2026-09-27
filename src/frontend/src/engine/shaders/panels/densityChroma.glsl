// Density / Chroma / Saturation — faithful port of the legacy DNS
// block (package.min.js), run in the cct log working space (lin2cct/cct2lin +
// legacyHue/legacyChroma from the legacyColor include).
//
// The three ops share ONE (hue, crm, lum) snapshot — legacy computes them once
// at the top of the block and reuses them across all three calls — so they live
// in a single function / single lin2cct→cct2lin round-trip, each gated by its
// own enable flag. Curves are packed into one RGBA texture (uDensityCurves):
//   .r = hueVsDensity   (Density)    sampled by hue   -> dns()
//   .g = chromaVsDensity (Chroma)    sampled by chroma -> dns()
//   .b = lumaVsDensity  (Saturation) sampled by luma  -> saturation mix
// Curve value 0.5 is identity for every op (so a neutral curve is a no-op).

float dnsChroma2log(float crm) { return crm < 0.5 ? pow(4.0 * crm * (1.0 - crm), 0.4) : 1.0; }
float dnsPuma(vec3 c) { return sqrt(dot(c * c, vec3(0.29889531, 0.58662247, 0.11448223))); }
float dnsHlko(float l) { l *= l * l * l * l; return exp(-25.0 * l) * (1.0 - l); }
float dnsCrmko(float crm) { return 39.06889564611748 * pow(crm, 1.503301) * pow(1.0 - crm, 5.596701); }

vec3 dns(vec3 rgb, float amount, float crm, float lum, vec3 lum3) {
  if (amount <= 0.5) {
    return mix(lum3, rgb, amount * 2.0);
  }
  float d = pow((amount - 0.5) / 0.5, 2.0);
  d *= dnsHlko(lum) * dnsCrmko(crm);
  d = d * (12.125 - 1.0) + 1.0;
  float mxc = max(rgb.x, max(rgb.y, rgb.z));
  vec3 dRGB = mix(lum3, rgb, mix(amount * 2.0, d, amount));
  dRGB *= mix(1.0, mxc / max(max(dRGB.x, max(dRGB.y, dRGB.z)), 0.00001), 1.413 - lum);
  return mix(rgb, dRGB, rgb.x);
}

vec3 applyDensityCurves(
  vec3 color,
  sampler2D curves,
  bool useDensity,
  bool useChroma,
  bool useSaturation
) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float hue = legacyHue(cct);
  float crm = dnsChroma2log(legacyChroma(cct));
  float lum = dnsPuma(cct);
  vec3 lum3 = vec3(lum);

  if (useDensity) {
    cct = dns(cct, texture2D(curves, vec2(hue, 0.5)).r, crm, lum, lum3);
  }
  if (useChroma) {
    cct = dns(cct, texture2D(curves, vec2(crm, 0.5)).g, crm, lum, lum3);
  }
  if (useSaturation) {
    cct = mix(lum3, cct, texture2D(curves, vec2(lum, 0.5)).b * 2.0);
  }

  return cct2lin(cct);
}
