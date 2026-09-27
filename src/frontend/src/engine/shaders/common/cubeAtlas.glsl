// Manual trilinear sampler for a 64^3 RGB cube LUT packed into a 512x512 atlas
// (8x8 tiles of 64x64; blue index b -> tile (b%8, floor(b/8)), x=r, y=g — the
// same layout as the main LUT). GLSL ES 1.00 has no sampler3D, so the legacy
// `texture(lut_idt/odt, ...)` cube samples (rewritten by build-legacy-idt-odt.mjs
// to sampleCubeAtlas) read the atlas with explicit trilinear interpolation.
// The atlas textures (uLutIdtAtlas / uLutOdtAtlas) are NEAREST-filtered so each
// texel is fetched exactly. See [[legacy-look-needs-aces-rrt-odt]].

uniform sampler2D uLutIdtAtlas;
uniform sampler2D uLutOdtAtlas;

vec3 cubeTexel(sampler2D atlas, vec2 px) {
  return texture2D(atlas, (px + 0.5) / 512.0).rgb;
}

// Bilinear fetch within one blue slice (tile b), rg in [0,63].
vec3 cubeSlice(sampler2D atlas, vec2 rg, float b) {
  vec2 base = vec2(mod(b, 8.0), floor(b / 8.0)) * 64.0; // tile top-left pixel
  float r0 = floor(rg.x), g0 = floor(rg.y);
  float r1 = min(r0 + 1.0, 63.0), g1 = min(g0 + 1.0, 63.0);
  float fr = rg.x - r0, fg = rg.y - g0;
  vec3 c00 = cubeTexel(atlas, base + vec2(r0, g0));
  vec3 c10 = cubeTexel(atlas, base + vec2(r1, g0));
  vec3 c01 = cubeTexel(atlas, base + vec2(r0, g1));
  vec3 c11 = cubeTexel(atlas, base + vec2(r1, g1));
  return mix(mix(c00, c10, fr), mix(c01, c11, fr), fg);
}

vec3 sampleCubeAtlas(sampler2D atlas, vec3 c) {
  vec3 p = clamp(c, 0.0, 1.0) * 63.0; // [0,1] -> [0,63] grid coordinate
  float b0 = floor(p.z);
  float b1 = min(b0 + 1.0, 63.0);
  float tb = p.z - b0;
  return mix(cubeSlice(atlas, p.xy, b0), cubeSlice(atlas, p.xy, b1), tb);
}
