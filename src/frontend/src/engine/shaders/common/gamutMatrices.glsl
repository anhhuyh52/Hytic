// Source-gamut -> working-gamut conversion.
//
// The actual 3x3 is computed on the CPU from documented primary chromaticities
// with Bradford white adaptation (see ColorSpaceMatrices.ts / CameraColorSpaces.ts
// / InputTransforms.ts) and supplied as the `uSourceToWorkingMatrix` uniform.
// We derive from primaries rather than hard-coding constants so the matrices are
// verifiable and never silently identity for camera gamuts.
//
// This function is intentionally tiny; it exists so the gamut step has a named
// home matching the pipeline architecture.
vec3 convertSourceGamutToWorking(vec3 linearSource, mat3 sourceToWorking) {
  return sourceToWorking * linearSource;
}
