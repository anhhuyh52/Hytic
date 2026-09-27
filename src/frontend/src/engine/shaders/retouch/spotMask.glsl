vec2 rotateRetouchVector(vec2 value, float degrees, vec2 pixelSize) {
  float radiansValue = radians(degrees);
  float cosine = cos(radiansValue);
  float sine = sin(radiansValue);
  vec2 pixelVector = value * pixelSize;
  pixelVector = mat2(cosine, -sine, sine, cosine) * pixelVector;
  return pixelVector / pixelSize;
}

float retouchNoise(vec2 coordinate) {
  return fract(sin(dot(coordinate, vec2(12.9898, 78.233))) * 43758.5453);
}

float retouchDestinationMask(
  vec2 displayUv,
  vec2 centeredPosition,
  vec2 size,
  float angle,
  float feather,
  float opacity
) {
  vec2 center = centeredPosition + 0.5;
  vec2 local = rotateRetouchVector(displayUv - center, -angle, uOutputSize);
  vec2 safeRadius = max(size * 0.5, vec2(0.0005));
  float radialDistance = length(local / safeRadius);
  float featherLimit = min(1.0 - feather, 0.99);
  radialDistance += retouchNoise(gl_FragCoord.xy) / 50.0 * (1.0 - featherLimit);
  return smoothstep(1.0, featherLimit, radialDistance) * opacity;
}
