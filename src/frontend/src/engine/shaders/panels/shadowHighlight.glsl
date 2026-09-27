// Shadow / Highlight — faithful port of the legacy `rng_mod` op
// (package.min.js LMM block), the science behind the legacy "Shadow Highlight"
// ("rgb") panel. Runs in the cct log working space (lin2cct/cct2lin + legacyLuma
// from the legacyColor include). Per-channel RGB black point (shadows) and white
// point (highlights) lift brightness and add hue shifts at the dark / bright ends
// of the tone range, weighted by a luma curve. Each point is [r,g,b] in [0,1]
// with 0.5 = neutral; the op is a no-op when both points are [0.5,0.5,0.5].
//
// The legacy precomputes the slope/pow conditioning of the points in its vertex
// shader (constant across pixels); here it is inlined from the point uniforms.

vec3 shadowHighlightRngModCct(vec3 cct, vec3 blackPoint, vec3 whitePoint, float l) {
  // Legacy vertex-shader conditioning of the black / white points.
  vec3 bCond = vec3(greaterThan(blackPoint, vec3(0.5)));
  vec3 wCond = vec3(lessThan(whitePoint, vec3(0.5)));
  vec3 blackMapped = 2.0 * blackPoint - 1.0;
  vec3 blackSlope = mix(vec3(2.0), vec3(0.267), bCond);
  vec3 blackPow = mix(vec3(6.0), vec3(4.0), bCond);
  vec3 whiteMapped = 2.0 * whitePoint - 1.0;
  vec3 whiteSlope = mix(vec3(2.0), vec3(0.5), wCond);
  vec3 whitePow = mix(vec3(6.0), vec3(3.0), wCond);

  // rng_mod: luma weight then per-channel shadow lift + highlight roll-off.
  l = 1.0 - clamp(l, 0.0, 1.0);
  l = l * l * (2.2 - l);
  l = 4.0 * l * (1.0 - l);
  l = 1.0 - l * l * l * l;

  vec3 c = clamp(cct, 0.0, 1.0);
  vec3 m = c + (blackMapped * blackSlope) * pow(max(1.0 - c, vec3(0.0)), blackPow);
  m = max(m, (1.0 - pow(1.0 - ((blackPoint - 0.5) * 2.0), vec3(3.0))) * 0.3);
  m = clamp(m + (whiteMapped * whiteSlope) * pow(m, whitePow), 0.0, 1.0);
  return mix(c, m, l);
}

vec3 applyShadowHighlight(vec3 color, vec3 blackPoint, vec3 whitePoint) {
  // No max(color, 0): legacy runs the whole grade as one continuous cct chain, so
  // each op's linear↔cct round-trip must be an exact inverse (cct2lin/lin2cct are,
  // even for negatives). Clamping dark out-of-gamut channels to linear-0 here
  // floors them to cct 0.0729 and locks rng_mod's per-channel black/white point
  // into pure-green sparkles legacy never produces. See [[raw-standard-...]].
  vec3 cct = lin2cct(color);
  return cct2lin(shadowHighlightRngModCct(cct, blackPoint, whitePoint, legacyLuma(cct)));
}
