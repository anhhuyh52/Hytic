// View-transform tone mapping. Operates on DISPLAY-primaries scene-linear RGB,
// before the display transfer encode. All curves here are documented
// APPROXIMATIONS — the "aces-like" curve is the Narkowicz ACES fit, NOT an
// official ACES Output Transform.

vec3 applyExposureBias(vec3 color, float exposureBias) {
  return color * pow(2.0, exposureBias);
}

// Reinhard-style highlight soft clip, blended by shoulder strength.
vec3 softClipHighlights(vec3 color, float compression, float shoulder) {
  float c = max(compression, 0.0001);
  vec3 compressed = color / (color + vec3(c));
  return mix(color, compressed, clamp(shoulder, 0.0, 1.0));
}

// Lift the black point; clamps to >= 0 so it never produces negatives.
vec3 applyBlackLift(vec3 color, float lift) {
  return max(color + vec3(lift), vec3(0.0));
}

// Narkowicz 2015 filmic ACES approximation (shared by "filmic" + "aces-like").
vec3 filmicAcesApprox(vec3 color) {
  color = max(color, vec3(0.0));
  return clamp(
    (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14),
    0.0,
    1.0
  );
}

// viewTransform: 0 none, 1 standard, 2 filmic, 3 aces-like, 4 soft-clip
vec3 applyToneMapping(
  vec3 color,
  int viewTransform,
  float exposureBias,
  float highlightCompression,
  float shoulderStrength,
  float blackLift
) {
  color = applyExposureBias(color, exposureBias);

  if (viewTransform == 0) {
    return color; // none — no tone mapping (debug-friendly)
  }

  vec3 mapped;
  if (viewTransform == 1) {
    mapped = max(color, vec3(0.0));           // standard — neutral, matches v1
  } else if (viewTransform == 2) {
    mapped = filmicAcesApprox(color);         // filmic (approx)
  } else if (viewTransform == 3) {
    mapped = filmicAcesApprox(color);         // aces-like (approx, not official ACES)
  } else if (viewTransform == 4) {
    mapped = softClipHighlights(color, highlightCompression, shoulderStrength);
  } else {
    mapped = color;
  }

  // Black lift applies after the curve; default 0 is a no-op (preserves neutral).
  mapped = applyBlackLift(mapped, blackLift);
  return mapped;
}
