// Display-safety gamut mapping. This is NOT a full perceptual gamut-compression
// algorithm (no ACES gamut compress, no chroma-aware rolloff) — it is a simple,
// less hue-destructive alternative to naive per-channel clipping. Documented
// limitation; refine in a later phase.

// Clamp negatives, then if any channel exceeds 1 scale the whole triplet by the
// max channel (preserving hue) instead of clipping each channel independently.
vec3 compressToDisplayGamut(vec3 color) {
  color = max(color, vec3(0.0));
  float maxChannel = max(color.r, max(color.g, color.b));
  if (maxChannel > 1.0) {
    color /= maxChannel;
  }
  return clamp(color, 0.0, 1.0);
}

// Toggle wrapper used by the output transform.
vec3 applyGamutMapping(vec3 color, bool enabled) {
  if (!enabled) {
    return color;
  }
  return compressToDisplayGamut(color);
}
