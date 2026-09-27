vec3 safeLutRgb(vec3 c) {
  c = min(max(c, vec3(-65504.0)), vec3(65504.0));
  c.r = (c.r == c.r) ? c.r : 0.0;
  c.g = (c.g == c.g) ? c.g : 0.0;
  c.b = (c.b == c.b) ? c.b : 0.0;
  return clamp(c, 0.0, 1.0);
}

vec3 sampleLUT3D(sampler3D lut, vec3 color) {
  vec3 c = clamp(color, 0.0, 1.0);
  return safeLutRgb(texture(lut, c).rgb);
}

vec3 sampleGradedLUT(sampler3D lut, vec3 color, int interpolationMode, float lutSize) {
  return sampleLUT3D(lut, color);
}
  