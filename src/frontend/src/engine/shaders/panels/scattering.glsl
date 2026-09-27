// Scattering — faithful port of the legacy `sk8` science, extracted
// verbatim from package.min.js. Physically-motivated ambient shadow/highlight
// tinting that runs in the cct log working space (lin2cct/cct2lin from the
// legacyColor include) on Rec.601 luma.
//
// shadows / highlights are vec4 built CPU-side (see LUTGenerator buildScatterVec4):
//   .xyz = ambient wheel tint (partly-desaturated spectrum colour)
//   .w   = wheel hue in [0,1] (per-hue density target for sk_hd2m)
// Legacy neutral defaults: shadows = (0,0,0,0.375), highlights = (1,1,1,0.375),
// which are a no-op (min(shadows.xyz) == 0 and highlights distance == 0).

float sk_hlmin(float l, float r, float k) {
  float h = max(k - abs(l - r), 0.0) / k;
  return min(l, r) - h * h * k * 0.25;
}
float sk_slmt(float mxc) {
  mxc *= mxc * mxc;
  return exp(-5.0 * mxc) * (1.0 - mxc);
}
float sk_hlko(float l, float lp2) {
  return exp(-6.0 * lp2) * (1.0 - lp2 * l);
}
float sk_sdko(float lp2) {
  return exp(-2.2 * lp2 * lp2) * (1.0 - lp2 * lp2);
}
float sk_hd2m(float a, float b, float mxc, vec3 c) {
  float dll = max(max(c.x, c.y), c.z) - min(min(c.x, c.y), c.z);
  float lmt = sk_slmt(mxc);
  float d = abs(a - b);
  d = min(d, 1.0 - d) / 0.5;
  d = 1.0 - d * d;
  return mix(1.0, (d * d * (1.0 - lmt)) + lmt, smoothstep(0.0125, 0.0667, dll));
}

vec3 sk8(vec3 color, vec4 shadows, vec4 highlights, float hue, float maxRGB, float lum) {
  const vec3 ooo = vec3(0.0);
  vec3 base = color.xyz;
  float lumP2 = lum * lum;
  float shd = sk_hd2m(hue, shadows.w, maxRGB, base);
  float skm = lumP2 * (5.5 - lum);
  skm *= sk_hlko(lum, lumP2);
  skm *= shd;
  skm *= 2.75;
  vec3 ssc = shadows.xyz * skm;
  float ssi = min(ssc.x, min(ssc.y, ssc.z));
  color = mix(base, ssc, ssi);
  float ssm = min(2.0, 1.0 + ssi * skm * (1.0 - shd) * 3.333);
  color = clamp(mix(vec3(lum), color, ssm), 0.0, 1.0);
  float hkm = sk_sdko(lumP2);
  float hsi = min(1.0, distance(highlights.xyz, ooo));
  vec3 hlc = (1.0 - hkm) * (highlights.xyz * (2.0 - hsi)) + hkm;
  color = min(color, mix(color, color * hlc * hlc * hlc * hlc, sk_hlmin(lum, 0.58631, 0.333)));
  float rfl = lum - (ssi * mix(lumP2 * lumP2, maxRGB, ssc.r));
  color *= LEGACY_RGB2YIQ;
  color.x = mix(mix(lum, rfl, ssi), color.x, lumP2 * skm * 1.75);
  return color * LEGACY_YIQ2RGB;
}

vec3 applyScattering(vec3 color, vec4 shadows, vec4 highlights) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float lum = min(1.0, legacyLuma(cct));
  float hue = legacyHue(cct);
  float mxc = max(cct.r, max(cct.g, cct.b));
  cct = sk8(cct, shadows, highlights, hue, mxc, lum);
  return cct2lin(cct);
}
