// IDT-like input transform: encoded source RGB -> working scene-linear RGB.
//   1. decode the source transfer curve to linear (in source primaries)
//   2. convert source gamut -> working gamut (matrix supplied as a uniform)
//
// Requires (included earlier): colorSpaces.glsl (srgbToLinear/rec709Decode),
// cameraLogCurves.glsl (camera log decodes), gamutMatrices.glsl
// (convertSourceGamutToWorking).
//
// The transfer int MUST match InputTransforms.ts transferInt / inputColorSpaceToInt:
//   0 srgb, 1 rec709, 2 linear-srgb,
//   3 sony-slog3, 4 arri-logc3, 5 canon-clog3, 6 panasonic-vlog, 7 red-log3g10,
//   8 acescg (linear), 9 aces2065-1 (linear)

vec3 decodeInputTransfer(vec3 c, int inSpace) {
  c = max(c, vec3(0.0)); // guard: never feed negative code values into pow()
  if (inSpace == 0) return srgbToLinear(c);
  if (inSpace == 1) return rec709Decode(c);
  if (inSpace == 2) return c;               // linear sRGB
  if (inSpace == 3) return slog3Decode(c);
  if (inSpace == 4) return logc3Decode(c);
  if (inSpace == 5) return clog3Decode(c);
  if (inSpace == 6) return vlogDecode(c);
  if (inSpace == 7) return log3g10Decode(c);
  if (inSpace == 8) return c;               // ACEScg (already linear AP1)
  if (inSpace == 9) return c;               // ACES2065-1 (already linear AP0)
  return srgbToLinear(c);
}

vec3 applyInputTransform(vec3 c, int inSpace, mat3 sourceToWorking) {
  vec3 linearSource = decodeInputTransfer(c, inSpace);
  return convertSourceGamutToWorking(linearSource, sourceToWorking);
}
