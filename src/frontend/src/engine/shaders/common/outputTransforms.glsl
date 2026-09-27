// ODT-like output transform: working scene-linear -> display-encoded RGB.
//   1. working gamut -> display gamut (linear)         [displayGamuts.glsl]
//   2. tone mapping / view transform (linear)          [toneMapping.glsl]
//   3. gamut compression to display range (linear)     [gamutMapping.glsl]
//   4. display transfer encode                         [displayGamuts.glsl]
//
// Requires those includes BEFORE this one. Display encode happens last; the
// renderer never uses outputColorSpace, so there is no double-encode.
vec3 applyOutputTransform(
  vec3 working,
  mat3 workingToDisplay,
  int displaySpace,
  int viewTransform,
  bool useOutputTransform,
  bool useGamutMapping,
  bool toneMappingEnabled,
  float exposureBias,
  float highlightCompression,
  float shoulderStrength,
  float blackLift
) {
  vec3 outputLinear = convertWorkingToDisplayLinear(working, workingToDisplay);

  if (!useOutputTransform) {
    // Output transform disabled: skip view/tone/gamut mapping, but still perform
    // the display transfer encode as the final step. This avoids accidental
    // linear display output or double-encoding.
    return encodeDisplayColor(outputLinear, displaySpace);
  }

  if (toneMappingEnabled) {
    outputLinear = applyToneMapping(
      outputLinear, viewTransform, exposureBias,
      highlightCompression, shoulderStrength, blackLift
    );
  }

  if (useGamutMapping) {
    outputLinear = compressToDisplayGamut(outputLinear);
  }

  return encodeDisplayColor(outputLinear, displaySpace);
}
