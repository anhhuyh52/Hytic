precision highp float;
precision highp int;
precision mediump sampler2D;

in vec2 vUv;

out vec4 FragColor;

uniform sampler2D uInput;
uniform bool uUseGrain;
uniform float uGrainAmount;
uniform float uGrainSize;
uniform float uGrainColorAmount;
uniform float uGrainSeed;
uniform vec4 uImage;
uniform vec4 uExportViewport;

const float PI = 3.1416015625;
const float TWO_PI = 2.0 * PI;
const float U = 5.960464477539063e-08;
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

uint hash(uint x) {
  x ^= x >> 16;
  x *= 0x21F0AAADu;
  x ^= x >> 15;
  x *= 0xD35A2D97u;
  x ^= x >> 15;
  return x;
}

uint rng_state;

uint rand() {
  rng_state = hash(rng_state);
  return rng_state;
}

float psr(float m) {
  float s = sqrt(max(m, 1e-4)) + 0.1;
  uint r1 = rand();
  uint r2 = hash(r1);
  float x = float(r1 & 0x7FFFFFu) * U;
  float y = float(r2 & 0x7FFFFFu) * U;
  float theta = TWO_PI * y;
  float r = sqrt(max(-2.0 * log(max(x, 1e-4)), 1e-4));
  return m + s * r * cos(theta);
}

float comp(float x) {
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
  vec2 imageUv = uExportViewport.xy + uv * uExportViewport.zw;
  vec2 coord = floor((imageUv * imageSize) / max(uGrainSize, 0.001));
  coord.y += 999999.0;
  return coord;
}

void main() {
  vec4 srcColor = texture(uInput, vUv);
  if (uUseGrain && uGrainAmount > 0.0) {
    vec3 fragColor = pow(max(srcColor.rgb, vec3(0.0)), vec3(1.0 / GRAIN_GAMMA));
    vec3 yiq = rgb2yiq * fragColor;
    vec2 grainCoord = imageGrainCoord(vUv);
    uint stableSeed = uint(mod(abs(uGrainSeed) * 4096.0, 4294967295.0));
    rng_state = hash(uint(grainCoord.x) + hash(uint(grainCoord.y) + stableSeed));
    float l = min(1.0, yiq.x);
    float fff = mix(3.333, 33.333, l);
    vec3 nnn = rgb2yiq * vec3(
      max(psr(fragColor.r * fff) / fff, max(0.01, fragColor.r - mix(0.1, 0.333, fragColor.r))),
      max(psr(fragColor.g * fff) / fff, max(0.01, fragColor.g - mix(0.1, 0.333, fragColor.g))),
      max(psr(fragColor.b * fff) / fff, max(0.01, fragColor.b - mix(0.1, 0.333, fragColor.b)))
    );
    nnn.x *= mix(1.0, 0.94231, l * l * l);
    nnn.yz = mix(yiq.yz, nnn.yz, clamp(uGrainColorAmount, 0.0, 1.0));
    nnn = clamp(yiq2rgb * nnn, 0.0, 65504.0);
    FragColor = vec4(
      pow(max(mix(fragColor, nnn, max(uGrainAmount, 0.0) * comp(l)), vec3(0.0)), vec3(GRAIN_GAMMA)),
      srcColor.a
    );
  } else {
    FragColor = srcColor;
  }
}
