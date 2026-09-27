// Transfer-function encode/decode helpers. Included only by the LUT generator.
// Primary-matrix conversions live in acesApprox.glsl; gamut safety in
// gamutMapping.glsl. Keep this file to transfer curves + display encode only.

vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  vec3 lower = c / 12.92;
  vec3 higher = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(higher, lower, vec3(cutoff));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  vec3 lower = c * 12.92;
  vec3 higher = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(higher, lower, vec3(cutoff));
}

// APPROXIMATION: Rec.709 is a camera OETF (0.45-ish), and displays use the
// BT.1886 ~2.4 gamma. We approximate the Rec.709 display chain with a pure 2.4
// gamma. This is intentionally simple and is NOT a colour-accurate BT.1886/709
// transform. Documented limitation for this phase.
vec3 rec709Decode(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.4));
}

vec3 rec709Encode(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.4));
}

// Display encode for a display color space int (0 = sRGB, 1 = Rec.709 approx).
vec3 displayEncode(vec3 c, int displaySpace) {
  if (displaySpace == 1) {
    return rec709Encode(c);
  }
  return linearToSrgb(c);
}
