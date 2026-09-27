// ACES-style primary matrices and tone-curve approximations.
//
// IMPORTANT: these are widely-used APPROXIMATIONS, not an official ACES Output
// Transform / OCIO chain:
//   * ACESInputMat / ACESOutputMat are Stephen Hill's sRGB<->AP1 fit matrices
//     (D60 adaptation baked in). Good enough for a creative ACEScg-ish working
//     space, but not a colour-managed OCIO transform.
//   * narkowiczACES is Krzysztof Narkowicz's filmic ACES approximation.
//   * AP0_TO_AP1 is the standard ACES AP0->AP1 matrix.
// Do not claim ACES/OCIO/CLF compliance from these.
//
// GLSL mat3 is column-major: each mat3(...) below lists COLUMNS, i.e. the
// transpose of the row-major source, so that `M * v` is the standard product.

// sRGB(Rec.709) linear -> ACEScg (AP1).  (Hill)
const mat3 ACESInputMat = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);

// ACEScg (AP1) -> sRGB(Rec.709) linear.  (Hill)
const mat3 ACESOutputMat = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602
);

// ACES2065-1 (AP0) -> ACEScg (AP1).  (Standard ACES matrix.)
const mat3 AP0_TO_AP1 = mat3(
   1.4514393161, -0.0765537734,  0.0083161484,
  -0.2365107469,  1.1762296998, -0.0060324498,
  -0.2149285693, -0.0996759264,  0.9977163014
);

// AP0 linear -> sRGB(Rec.709) linear, composed AP0->AP1->709.
vec3 ap0ToRec709Linear(vec3 c) {
  return ACESOutputMat * (AP0_TO_AP1 * c);
}

// Narkowicz 2015 filmic ACES approximation. Operates on sRGB-linear scene
// values and returns sRGB-linear display values (apply sRGB encode afterwards).
// APPROXIMATE — not the official ACES RRT+ODT.
vec3 narkowiczACES(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
