// =============================================================================
// LEGACY Scattering + Refraction science — extracted verbatim from
// package.min.js (the source of truth) for a faithful port.
//
// These are the REAL legacy shader functions. The legacy creative pipeline runs
// in a LOG working space ("cct"): lin -> lin2cct -> [creative ops] -> cct2lin.
// Scattering (sk8) and Refraction (rfc) both run in that cct space, on Rec.601
// luma. To port: wrap the call in lin2cct/cct2lin around the project's linear
// working colour, and feed the uniforms built per the notes at the bottom.
//
// Status: COMPLETE. refraction (rfc) -> panels/refraction.glsl. scattering (sk8)
// -> panels/scattering.glsl, with the CPU vec4 build (legacy Of+Nf) ported as
// `buildScatterVec4` + the 16-entry `SCATTER_PALETTE` (Nf.ii) in LUTGenerator.ts.
// =============================================================================

// ── working space (log "cct") ───────────────────────────────────────────────
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

// ── shared colour helpers (Rec.601) ─────────────────────────────────────────
float rgb2luma(vec3 c) { return dot(c, vec3(0.29889531, 0.58662247, 0.11448223)); }
float rgb2hue(vec3 c) {
  const vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  return abs((q.w - q.y) / (6.0 * (q.x - min(q.w, q.y)) + 0.0001) + q.z);
}
float rgb2chroma(vec3 c) {
  return length(vec2(
    dot(c, vec3(0.59597799, -0.27417610, -0.32180189)),
    dot(c, vec3(0.21147017, -0.52261711, 0.31114694))
  ));
}
const mat3 rgb2yiq = mat3(0.29889531, 0.58662247, 0.11448223, 0.59597799, -0.27417610, -0.32180189, 0.21147017, -0.52261711, 0.31114694);
const mat3 yiq2rgb = mat3(1.0, 0.95608445, 0.62088850, 1.0, -0.27137664, -0.64860590, 1.0, -1.10561724, 1.70250126);

// ── REFRACTION (filmic per-hue HSL, shadow/highlight separated) ──────────────
// mapVec_i = vec4(shadowAngleDeg, shadowDensity, highlightAngleDeg, highlightDensity)
// for primaries R,Y,G,C,B,M (base angles 0,60,120,180,240,300). spr = separation.
const float rf_crmO = 0.333;
const float rf_crmD = 16.667;
const float rf_crml = rf_crmO + rf_crmD; // 17.0
const float rf_crmM = pow(rf_crml, rf_crml) / (pow(rf_crmO, rf_crmO) * pow(rf_crmD, rf_crmD));

float rf_sig(float x, float k) { return 1.0 / (1.0 + exp(-(x - 0.5) * k)); }
float rf_hlko(float x) { x *= x * x * x * x; return exp(-42.3301 * x) * (1.0 - x); }
float rf_s2m(float l, float spr) {
  const float llmt = 0.2;
  spr = spr * (1.0 - llmt) + llmt;
  return rf_sig(l, spr * spr * 60.0);
}
float rf_mLMT(vec3 rgb, float lum) {
  float crm = rgb2chroma(rgb) * 2.0;
  float mxc = max(rgb.x, max(rgb.y, rgb.z));
  float crm_ko = rf_crmM * pow(crm, mxc) * pow(1.0 - crm, rf_crmD - mxc);
  return crm_ko * rf_hlko(lum) * 1.333;
}
vec3 rf_h2r(float h) {
  const vec3 p324 = vec3(3.0, 2.0, 4.0);
  const vec3 p111 = vec3(1.0, -1.0, -1.0);
  const vec3 p122 = vec3(-1.0, 2.0, 2.0);
  return clamp(abs(h * 6.0 - p324) * p111 + p122, 0.0, 1.0) - 1.0;
}
vec3 rf_p2c(vec4 p, float separation, float lmt) {
  float d = p.z - p.x;
  float delta = d + ((abs(d) > 180.0) ? ((d < 0.0) ? 360.0 : -360.0) : 0.0);
  float s = mix(p.y, p.w, separation);
  s = mix(min(s, 1.0), s, lmt);
  float h = mod((p.x + delta * separation) + 360.0, 360.0) / 360.0;
  return rf_h2r(h) * s + 1.0;
}
vec3 rfc(vec3 rgb, vec4 pR, vec4 pY, vec4 pG, vec4 pC, vec4 pB, vec4 pM, float lum, float spr) {
  float sprMask = rf_s2m(max(rgb.x, max(rgb.y, rgb.z)), spr);
  float lmt = rf_mLMT(rgb, lum);
  if (rgb.r > rgb.g) {
    if (rgb.g > rgb.b) {
      vec3 r = rf_p2c(pR, sprMask, lmt); vec3 y = rf_p2c(pY, sprMask, lmt);
      return rgb.r * r + rgb.g * (y - r) + rgb.b * (1.0 - y);
    } else if (rgb.r > rgb.b) {
      vec3 r = rf_p2c(pR, sprMask, lmt); vec3 m = rf_p2c(pM, sprMask, lmt);
      return rgb.r * r + rgb.g * (1.0 - m) + rgb.b * (m - r);
    } else {
      vec3 m = rf_p2c(pM, sprMask, lmt); vec3 b = rf_p2c(pB, sprMask, lmt);
      return rgb.r * (m - b) + rgb.g * (1.0 - m) + rgb.b * b;
    }
  } else {
    if (rgb.b > rgb.g) {
      vec3 c = rf_p2c(pC, sprMask, lmt); vec3 b = rf_p2c(pB, sprMask, lmt);
      return rgb.r * (1.0 - c) + rgb.g * (c - b) + rgb.b * b;
    } else if (rgb.b > rgb.r) {
      vec3 c = rf_p2c(pC, sprMask, lmt); vec3 g = rf_p2c(pG, sprMask, lmt);
      return rgb.r * (1.0 - c) + rgb.g * g + rgb.b * (c - g);
    } else {
      vec3 y = rf_p2c(pY, sprMask, lmt); vec3 g = rf_p2c(pG, sprMask, lmt);
      return rgb.r * (y - g) + rgb.g * g + rgb.b * (1.0 - y);
    }
  }
}

// ── SCATTERING (sk8) — runs in cct space; shadows/highlights are vec4 ─────────
// shadows.xyz = wheel tint (from --spectrum-shadows), shadows.w = per-hue density.
float sk_slmt(float mxc) { mxc *= mxc * mxc; return exp(-5.0 * mxc) * (1.0 - mxc); }
float sk_hlko(float l, float lp2) { return exp(-6.0 * lp2) * (1.0 - lp2 * l); }
float sk_sdko(float lp2) { return exp(-2.2 * lp2 * lp2) * (1.0 - lp2 * lp2); }
float sk_hlmin(float l, float r, float k) { float h = max(k - abs(l - r), 0.0) / k; return min(l, r) - h * h * k * 0.25; }
float sk_hd2m(float a, float b, float mxc, vec3 c) {
  float dll = max(max(c.x, c.y), c.z) - min(min(c.x, c.y), c.z);
  float lmt = sk_slmt(mxc);
  float d = abs(a - b); d = min(d, 1.0 - d) / 0.5; d = 1.0 - d * d;
  return mix(1.0, (d * d * (1.0 - lmt)) + lmt, smoothstep(0.0125, 0.0667, dll));
}
vec3 sk8(vec3 color, vec4 shadows, vec4 highlights, float hue, float maxRGB, float lum) {
  const vec3 ooo = vec3(0.0);
  vec3 base = color.xyz;
  float lumP2 = lum * lum;
  float shd = sk_hd2m(hue, shadows.w, maxRGB, base);
  float skm = lumP2 * (5.5 - lum);
  skm *= sk_hlko(lum, lumP2);
  skm *= shd; skm *= 2.75;
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
  color *= rgb2yiq;
  color.x = mix(mix(lum, rfl, ssi), color.x, lumP2 * skm * 1.75);
  return color * yiq2rgb;
}

// ── Port wiring notes ────────────────────────────────────────────────────────
// REFRACTION (do first — fully specified):
//   uniforms: vec4 uRefractMapVec[6], float uRefractSeparation.
//   in generateLUT.frag, replace applyRefraction with:
//     if (uUseRefraction) {
//       vec3 cct = lin2cct(max(linear, 0.0));
//       cct = rfc(cct, uRefractMapVec[0..5], rgb2luma(cct), uRefractSeparation);
//       linear = cct2lin(cct);
//     }
//   RefractionState (legacy model): shadowMapVectors:[deg,density]x6,
//     highlightMapVectors:[deg,density]x6, separation. mapVec_i =
//     vec4(shadowMV[i][0], shadowMV[i][1], highlightMV[i][0], highlightMV[i][1]).
//   converter: data.s.shadowMapVectors/highlightMapVectors -> state, data.s.separation.
// SCATTERING (done): JS builds shadows/highlights vec4 via legacy Of+Nf —
//   Of: i=2x-1, o=2y-1; angle=(atan2(i,o)*180/PI+360)%360; dist=min(1,hypot(i,o)).
//   Nf: hue=angle/360; rgb = (1-dist)*index + dist*PALETTE16(hue) (index 0=shadows,
//   1=highlights); .w=hue. PALETTE16 = the baked Nf.ii ambient tints, NOT --spectrum-*.
//   See buildScatterVec4 / SCATTER_PALETTE in LUTGenerator.ts; sk8 runs in cct space.
