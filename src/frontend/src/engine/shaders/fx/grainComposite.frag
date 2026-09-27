precision highp float;

uniform sampler2D uInput;
uniform bool uUseGrain;
uniform float uGrainAmount;
uniform float uGrainSize;
uniform float uGrainColorAmount;
uniform float uGrainSeed;
uniform vec4 uImage;
uniform vec2 uViewport;
uniform vec2 uOffset;
uniform vec2 uScale;

varying vec2 vUv;

const float PI = 3.1416015625;
const float TWO_PI = 2.0 * PI;
const float GRAIN_GAMMA = 1.8;
const mat3 rgb2yiq = mat3(
  0.29889531, 0.58662247, 0.11448223,
  0.59597799, -0.27417610, -0.32180189,
  0.21147017, -0.52261711, 0.31114694
);
const mat3 yiq2rgb = mat3(
  1.0, 0.95608445, 0.62088850,
  1.0, -0.27137664, -0.64860590,
  1.0, -1.10561724, 1.70250126
);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float normalSample(vec2 p) {
  float x = max(hash12(p), 1e-4);
  float y = hash12(p + 19.19);
  float theta = TWO_PI * y;
  float radius = sqrt(max(-2.0 * log(x), 1e-4));
  return radius * cos(theta);
}

float psr(float m, vec2 p) {
  float s = sqrt(max(m, 1e-4)) + 0.1;
  return m + s * normalSample(p);
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

vec2 imageGrainCoord(vec2 uv) {
  vec2 imageSize = max(uImage.xy, vec2(1.0));
  vec2 coord = floor((uv * imageSize) / max(uGrainSize, 0.001));
  coord.y += 999999.0;
  return coord;
}

vec3 applyGrain(vec3 color) {
  float amount = max(uGrainAmount, 0.0);
  float chroma = clamp(uGrainColorAmount, 0.0, 1.0);
  vec2 grainCoord = imageGrainCoord(vUv);
  vec2 seed = grainCoord + vec2(uGrainSeed, uGrainSeed * 1.618);
  vec3 working = pow(max(color, vec3(0.0)), vec3(1.0 / GRAIN_GAMMA));
  vec3 yiq = rgb2yiq * working;
  float l = min(1.0, yiq.x);
  float fff = mix(3.333, 33.333, l);
  vec3 grained = rgb2yiq * vec3(
    max(psr(working.r * fff, seed + 11.0) / fff, max(0.01, working.r - mix(0.1, 0.333, working.r))),
    max(psr(working.g * fff, seed + 37.0) / fff, max(0.01, working.g - mix(0.1, 0.333, working.g))),
    max(psr(working.b * fff, seed + 73.0) / fff, max(0.01, working.b - mix(0.1, 0.333, working.b)))
  );
  grained.x *= mix(1.0, 0.94231, l * l * l);
  grained.yz = mix(yiq.yz, grained.yz, chroma);
  grained = clamp(yiq2rgb * grained, 0.0, 65504.0);
  return pow(max(mix(working, grained, amount * grainLumaComp(l)), vec3(0.0)), vec3(GRAIN_GAMMA));
}

void main() {
  vec4 src = texture2D(uInput, vUv);
  vec3 color = src.rgb;
  if (uUseGrain) {
    color = applyGrain(color);
  }
  gl_FragColor = vec4(color, src.a);
}
