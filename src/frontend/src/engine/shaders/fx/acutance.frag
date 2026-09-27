precision highp float;

// Film Acutance — faithful port of the legacy Texture "acutance" pass (`Ou`). An
// image-adaptive local-contrast / clarity operator: a 16-sample spiral, log-space,
// edge-preserving smoothing (`dns`, weighted by color direction + magnitude), then an
// unsharp mask `src + (src - smoothed) * amount` plus a tiny shadow lift. amount = 0 → identity.
uniform sampler2D uInput;
uniform float uAmount;       // acutanceAmount (0..1)
uniform vec2 uTexelSize;

varying vec2 vUv;

const float SAMPLES = 16.0;
const float SIZE = 16.0;
const float RADIUS = 0.5 / SAMPLES;
const mat2 ROTATION = mat2(-0.7373688579969029, 0.675490316182507, -0.675490316182507, -0.7373688579969029);
const float INV_LOG_SCALE = 1.0 / 17.52;
const float LOG_OFFSET = 9.72;
const float V_SMALL = 1e-6;

float linRgb2luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 lin2log(vec3 lin) { return (log2(max(lin, vec3(V_SMALL))) + LOG_OFFSET) * INV_LOG_SCALE; }
vec3 log2lin(vec3 cct) { return pow(vec3(2.0), cct / INV_LOG_SCALE - LOG_OFFSET); }
float pow16(float v) { v *= v; v *= v; v *= v; return v * v; }
vec3 safeNormalize(vec3 v) {
  float len = length(v);
  return len > 1e-5 ? v / len : vec3(0.57735026919);
}

vec3 dns(vec3 c, vec2 texel, vec2 uv) {
  vec3 sum = vec3(0.0);
  float weight = 0.0;
  c = lin2log(c);
  vec3 cn = safeNormalize(c);
  float cs = length(c);
  vec2 rotation = vec2(0.0, 1.0);
  vec2 base_offset_scale = SIZE * 0.5 * texel;
  for (float i = 1.0; i <= SAMPLES; i += 1.0) {
    rotation = rotation * ROTATION;
    vec2 offset = rotation * sqrt(i) * base_offset_scale;
    vec3 ci = lin2log(texture2D(uInput, uv + offset).rgb);
    float ti = 1.0 - RADIUS * pow(dot(offset, offset), 0.1);
    float weight_dist = ti * ti;
    float weight_color_dir = pow16(0.5 + 0.5 * dot(cn, safeNormalize(ci)));
    float weight_color_mag = pow16(1.0 - abs(length(ci) - cs));
    float f = weight_dist * weight_color_dir * weight_color_mag;
    weight += f;
    sum += ci * f;
  }
  vec3 b = sum / max(weight, V_SMALL);
  return log2lin(clamp(0.1125 + 0.75 * b, 0.0, 10.0));
}

void main() {
  vec4 srcColor = texture2D(uInput, vUv);
  if (uAmount > 0.0) {
    vec3 blip = dns(srcColor.xyz, uTexelSize, vUv);
    float lum = min(1.0, linRgb2luma(srcColor.xyz));
    float blum = min(1.0, linRgb2luma(blip));
    blip = mix(blip, srcColor.xyz, lum * blum);
    blip = max(srcColor.rgb + (srcColor.rgb - blip) * uAmount, 0.0);
    blip += vec3(0.02 * smoothstep(0.25, 0.0, max(0.0, linRgb2luma(blip))) * uAmount);
    gl_FragColor = vec4(blip, srcColor.a);
  } else {
    gl_FragColor = srcColor;
  }
}
