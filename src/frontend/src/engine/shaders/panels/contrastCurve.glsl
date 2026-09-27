// Decodes a baked contrast-curve texel (0..1) back to a local contrast amount
// in [minValue, maxValue] (typically [-1, 1]). Neutral encoded 0.5 -> 0.0.
float decodeContrastCurveValue(float encoded, float minValue, float maxValue) {
  return mix(minValue, maxValue, encoded);
}
