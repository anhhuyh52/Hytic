// Linear-light channel row mixing. luminance709 is provided by the shared luma
// include so balance, saturation, and this panel use one luminance definition.
vec3 applyRGBMixerRows(
  vec3 color,
  vec3 redRow,
  vec3 greenRow,
  vec3 blueRow,
  bool preserveLuminance
) {
  float beforeLuma = luminance709(color);

  vec3 result = vec3(
    dot(redRow, color),
    dot(greenRow, color),
    dot(blueRow, color)
  );

  if (preserveLuminance) {
    float afterLuma = luminance709(result);
    // Rescale only when both lumas are meaningfully positive. The legacy cct grade
    // chain legitimately produces deep-shadow colors with slightly negative
    // channels (negative luma); flooring afterLuma to 1e-6 there scales the color
    // by beforeLuma/1e-6 ≈ ±10^3 and corrupts the dark corner of the baked LUT
    // (RAW Standard green speckles), even with identity rows.
    if (beforeLuma > 1e-6 && afterLuma > 1e-6) {
      result *= beforeLuma / afterLuma;
    }
  }

  return result;
}
