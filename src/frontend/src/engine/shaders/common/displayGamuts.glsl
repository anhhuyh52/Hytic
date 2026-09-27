// Display-side gamut conversion + transfer encode.
//
// The working->display 3x3 is computed on the CPU from documented primaries with
// Bradford white adaptation (see OutputTransforms.ts) and supplied as the
// uWorkingToDisplayMatrix uniform. Requires colorSpaces.glsl (linearToSrgb).
//
// displaySpace int: 0 srgb, 1 rec709-gamma24, 2 display-p3, 3 rec2020.

vec3 convertWorkingToDisplayLinear(vec3 working, mat3 workingToDisplay) {
  return workingToDisplay * working;
}

// Encode display-linear -> display-encoded.
//   srgb           : exact sRGB OETF
//   rec709-gamma24 : pure 1/2.4 gamma (APPROX — not the BT.709 OETF / BT.1886)
//   display-p3     : sRGB transfer (Display P3 uses the sRGB EOTF by spec; gamut
//                    conversion is approximate)
//   rec2020        : 1/2.4 gamma (APPROX — not the BT.2020 OETF)
vec3 encodeDisplayColor(vec3 color, int displaySpace) {
  color = max(color, vec3(0.0));
  if (displaySpace == 1) {
    return pow(color, vec3(1.0 / 2.4));   // Rec.709 gamma 2.4 (approx)
  }
  if (displaySpace == 2) {
    return linearToSrgb(color);           // Display P3 transfer (sRGB)
  }
  if (displaySpace == 3) {
    return pow(color, vec3(1.0 / 2.4));   // Rec.2020 (approx)
  }
  return linearToSrgb(color);             // sRGB (exact)
}
