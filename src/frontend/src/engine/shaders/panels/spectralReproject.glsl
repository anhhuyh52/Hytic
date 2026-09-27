// Spectral re-projection — faithful port of the legacy POST-CMP step
// (the non-CMT branch of main()). After the creative pipeline, colours that
// moved far from the source AND are saturated are pulled toward the legacy 8³
// "lut_csp" gamut/spectral-compression LUT, which tames the over-saturation that
// heavy presets (e.g. VSCO) would otherwise produce. Runs in cct space and is a
// no-op when nothing moved (ffp = 0).
//
// The 8³ cct->cct LUT is supplied as a 64x8 atlas (8 z-slices of 8x8) and sampled
// with manual trilinear via texture2D so no sampler3D / GLSL3 is required.

vec3 cspFetch(sampler2D atlas, float r, float g, float b) {
  float u = (b * 8.0 + r + 0.5) / 64.0;
  float v = (g + 0.5) / 8.0;
  return texture2D(atlas, vec2(u, v)).rgb;
}

vec3 cspSample(sampler2D atlas, vec3 cct) {
  vec3 p = clamp(cct, 0.0, 1.0) * 7.0; // legacy 0.875*x+0.0625 tex coord == texel index 7*x
  vec3 lo = floor(p);
  vec3 f = p - lo;
  float r0 = lo.x, g0 = lo.y, b0 = lo.z;
  float r1 = min(r0 + 1.0, 7.0), g1 = min(g0 + 1.0, 7.0), b1 = min(b0 + 1.0, 7.0);
  vec3 c000 = cspFetch(atlas, r0, g0, b0);
  vec3 c100 = cspFetch(atlas, r1, g0, b0);
  vec3 c010 = cspFetch(atlas, r0, g1, b0);
  vec3 c110 = cspFetch(atlas, r1, g1, b0);
  vec3 c001 = cspFetch(atlas, r0, g0, b1);
  vec3 c101 = cspFetch(atlas, r1, g0, b1);
  vec3 c011 = cspFetch(atlas, r0, g1, b1);
  vec3 c111 = cspFetch(atlas, r1, g1, b1);
  vec3 x00 = mix(c000, c100, f.x);
  vec3 x10 = mix(c010, c110, f.x);
  vec3 x01 = mix(c001, c101, f.x);
  vec3 x11 = mix(c011, c111, f.x);
  return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

vec3 applySpectralReproject(vec3 color, vec3 baseColor, sampler2D cspAtlas, float colorVolumeSat) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  vec3 base = lin2cct(baseColor);
  float ffp = distance(base, cct);
  float csp = (1.0 - pow(1.0 - ffp, 6.0)) * smoothstep(0.0, 0.5, colorVolumeSat);
  float sst = max(cct.x, max(cct.y, cct.z)) - min(cct.x, min(cct.y, cct.z));
  vec3 projected = cspSample(cspAtlas, cct);
  cct = mix(cct, projected, clamp(csp * sst, 0.0, 1.0));
  return cct2lin(cct);
}
