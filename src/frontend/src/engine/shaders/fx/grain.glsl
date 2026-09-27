float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

const float GRAIN_GAMMA = 1.8;
const float GRAIN_PI = 3.1416015625;
const mat3 grainRgb2Yiq = mat3(
  0.29889531, 0.58662247, 0.11448223,
  0.59597799, -0.27417610, -0.32180189,
  0.21147017, -0.52261711, 0.31114694
);
const mat3 grainYiq2Rgb = mat3(
  1.0, 0.95608445, 0.62088850,
  1.0, -0.27137664, -0.64860590,
  1.0, -1.10561724, 1.70250126
);

float grainNormalSample(vec2 p) {
  float x = max(hash12(p), 1e-4);
  float y = hash12(p + 19.19);
  return sqrt(max(-2.0 * log(x), 1e-4)) * cos(2.0 * GRAIN_PI * y);
}

float grainPsr(float m, vec2 p) {
  float s = sqrt(max(m, 1e-4)) + 0.1;
  return m + s * grainNormalSample(p);
}

float grainLumaComp(float x) {
  float x2 = x * x;
  float t1 = 1.0 + x;
  float t2 = 1.0 - x2;
  float t3 = t1 * t1;
  float t4 = t3 * t3;
  float t5 = t4 * t1;
  float t6 = t2 * t2 * t2;
  return 1.0 - (t5 * t6 * 0.153);
}

vec3 applyGrain(
  vec3 color,
  vec2 uv,
  vec2 imageSize,
  float amount,
  float size,
  float roughness,
  float colorAmount,
  float seed
) {
  float safeAmount = clamp(amount, 0.0, 1.0);
  float safeColorAmount = clamp(colorAmount, 0.0, 1.0);
  vec2 pixel = uv * max(imageSize, vec2(1.0));
  vec2 grainCoord = floor(pixel / max(size, 0.001));
  vec2 grainSeed = grainCoord + vec2(seed, seed * 1.618);
  vec3 working = pow(max(color, vec3(0.0)), vec3(1.0 / GRAIN_GAMMA));
  vec3 yiq = grainRgb2Yiq * working;
  float l = min(1.0, yiq.x);
  float fff = mix(3.333, 33.333, l);
  vec3 grained = grainRgb2Yiq * vec3(
    max(grainPsr(working.r * fff, grainSeed + 11.0) / fff, max(0.01, working.r - mix(0.1, 0.333, working.r))),
    max(grainPsr(working.g * fff, grainSeed + 37.0) / fff, max(0.01, working.g - mix(0.1, 0.333, working.g))),
    max(grainPsr(working.b * fff, grainSeed + 73.0) / fff, max(0.01, working.b - mix(0.1, 0.333, working.b)))
  );
  grained.x *= mix(1.0, 0.94231, l * l * l);
  grained.yz = mix(yiq.yz, grained.yz, safeColorAmount);
  grained = clamp(grainYiq2Rgb * grained, 0.0, 65504.0);
  return pow(clamp(mix(working, grained, safeAmount * grainLumaComp(l)), 0.0, 1.0), vec3(GRAIN_GAMMA));
}
