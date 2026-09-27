vec3 safeLutRgb(vec3 c) {
  c = min(max(c, vec3(-65504.0)), vec3(65504.0));
  c.r = (c.r == c.r) ? c.r : 0.0;
  c.g = (c.g == c.g) ? c.g : 0.0;
  c.b = (c.b == c.b) ? c.b : 0.0;
  return clamp(c, 0.0, 1.0);
}

vec3 fetchLUT2D(sampler2D lut, vec3 index) {
  vec3 clampedIndex = clamp(index, 0.0, 63.0);
  float blueSlice = clampedIndex.b;
  float tileX = mod(blueSlice, 8.0);
  float tileY = floor(blueSlice / 8.0);
  vec2 tileOffset = vec2(tileX, tileY) * 64.0;
  vec2 localPixel = clampedIndex.rg;
  vec2 uv = (tileOffset + localPixel + 0.5) / 512.0;
  return safeLutRgb(texture2D(lut, clamp(uv, 0.0, 1.0)).rgb);
}

vec3 sampleLUT2DTrilinear(sampler2D lut, vec3 color) {
  vec3 c = clamp(color, 0.0, 1.0) * 63.0;
  float blue = c.b;
  float blueLow = floor(blue);
  float blueHigh = min(blueLow + 1.0, 63.0);
  float blueMix = blue - blueLow;

  vec3 lowColor = fetchLUT2D(lut, vec3(c.r, c.g, blueLow));
  vec3 highColor = fetchLUT2D(lut, vec3(c.r, c.g, blueHigh));

  return mix(lowColor, highColor, blueMix);
}

vec3 sampleLUT2DTetrahedral(sampler2D lut, vec3 color) {
  vec3 c = clamp(color, 0.0, 1.0) * 63.0;
  vec3 p0 = floor(c);
  vec3 f = c - p0;
  vec3 p1 = min(p0 + 1.0, vec3(63.0));

  vec3 c000 = fetchLUT2D(lut, p0);
  vec3 c111 = fetchLUT2D(lut, p1);

  if (f.r >= f.g && f.g >= f.b) {
    vec3 c100 = fetchLUT2D(lut, vec3(p1.r, p0.g, p0.b));
    vec3 c110 = fetchLUT2D(lut, vec3(p1.r, p1.g, p0.b));
    return c000 * (1.0 - f.r) + c100 * (f.r - f.g) + c110 * (f.g - f.b) + c111 * f.b;
  }

  if (f.r >= f.b && f.b >= f.g) {
    vec3 c100 = fetchLUT2D(lut, vec3(p1.r, p0.g, p0.b));
    vec3 c101 = fetchLUT2D(lut, vec3(p1.r, p0.g, p1.b));
    return c000 * (1.0 - f.r) + c100 * (f.r - f.b) + c101 * (f.b - f.g) + c111 * f.g;
  }

  if (f.b >= f.r && f.r >= f.g) {
    vec3 c001 = fetchLUT2D(lut, vec3(p0.r, p0.g, p1.b));
    vec3 c101 = fetchLUT2D(lut, vec3(p1.r, p0.g, p1.b));
    return c000 * (1.0 - f.b) + c001 * (f.b - f.r) + c101 * (f.r - f.g) + c111 * f.g;
  }

  if (f.g >= f.r && f.r >= f.b) {
    vec3 c010 = fetchLUT2D(lut, vec3(p0.r, p1.g, p0.b));
    vec3 c110 = fetchLUT2D(lut, vec3(p1.r, p1.g, p0.b));
    return c000 * (1.0 - f.g) + c010 * (f.g - f.r) + c110 * (f.r - f.b) + c111 * f.b;
  }

  if (f.g >= f.b && f.b >= f.r) {
    vec3 c010 = fetchLUT2D(lut, vec3(p0.r, p1.g, p0.b));
    vec3 c011 = fetchLUT2D(lut, vec3(p0.r, p1.g, p1.b));
    return c000 * (1.0 - f.g) + c010 * (f.g - f.b) + c011 * (f.b - f.r) + c111 * f.r;
  }

  if (f.b >= f.g && f.g >= f.r) {
    vec3 c001 = fetchLUT2D(lut, vec3(p0.r, p0.g, p1.b));
    vec3 c011 = fetchLUT2D(lut, vec3(p0.r, p1.g, p1.b));
    return c000 * (1.0 - f.b) + c001 * (f.b - f.g) + c011 * (f.g - f.r) + c111 * f.r;
  }

  return c111;
}

vec3 sampleGradedLUT(sampler2D lut, vec3 color, int interpolationMode) {
  if (interpolationMode == 0) {
    return sampleLUT2DTrilinear(lut, color);
  }
  return sampleLUT2DTetrahedral(lut, color);
}
