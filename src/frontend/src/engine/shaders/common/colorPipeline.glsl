// Shared legacy colour helpers (extracted from package.min.js) used by
// the ported Scattering / Refraction science. The legacy creative ops run in a
// LOG working space ("cct") on Rec.601 luma. Names are legacy*-prefixed to avoid
// colliding with the project's Rec.709 helpers in the concatenated LUT shader.

vec3 lin2cct(vec3 lin) {
  return vec3(
    lin.x >= 0.0078125 ? (log2(lin.x) + 9.72) / 17.52 : lin.x * 10.5402377416545 + 0.0729055341958355,
    lin.y >= 0.0078125 ? (log2(lin.y) + 9.72) / 17.52 : lin.y * 10.5402377416545 + 0.0729055341958355,
    lin.z >= 0.0078125 ? (log2(lin.z) + 9.72) / 17.52 : lin.z * 10.5402377416545 + 0.0729055341958355
  );
}

vec3 cct2lin(vec3 cct) {
  return vec3(
    cct.x > 0.155251141552511 ? pow(2.0, cct.x * 17.52 - 9.72) : (cct.x - 0.0729055341958355) / 10.5402377416545,
    cct.y > 0.155251141552511 ? pow(2.0, cct.y * 17.52 - 9.72) : (cct.y - 0.0729055341958355) / 10.5402377416545,
    cct.z > 0.155251141552511 ? pow(2.0, cct.z * 17.52 - 9.72) : (cct.z - 0.0729055341958355) / 10.5402377416545
  );
}

float legacyLuma(vec3 c) { return dot(c, vec3(0.29889531, 0.58662247, 0.11448223)); }

float legacyHue(vec3 c) {
  const vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  return abs((q.w - q.y) / (6.0 * (q.x - min(q.w, q.y)) + 0.0001) + q.z);
}

float legacyChroma(vec3 c) {
  return length(vec2(
    dot(c, vec3(0.59597799, -0.27417610, -0.32180189)),
    dot(c, vec3(0.21147017, -0.52261711, 0.31114694))
  ));
}

// YIQ matrices (used as `color * MAT`, the legacy row-vector convention).
const mat3 LEGACY_RGB2YIQ = mat3(
  0.29889531, 0.58662247, 0.11448223,
  0.59597799, -0.27417610, -0.32180189,
  0.21147017, -0.52261711, 0.31114694
);
const mat3 LEGACY_YIQ2RGB = mat3(
  1.0, 0.95608445, 0.62088850,
  1.0, -0.27137664, -0.64860590,
  1.0, -1.10561724, 1.70250126
);
