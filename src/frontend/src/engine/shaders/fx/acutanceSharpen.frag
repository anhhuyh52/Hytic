precision highp float;

// Film Resolution sharpen — faithful port of the legacy Texture `Ku` pass. A FidelityFX-CAS
// (Contrast-Adaptive Sharpening) 5-tap operator driven by Film Resolution > 0.5. amount = 0 →
// identity. Sharpening is suppressed in highlights (`1 - lc³`).
uniform sampler2D uInput;
uniform float uAmount;
uniform vec2 uTexelSize;

varying vec2 vUv;

float linRgb2luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 c = texture2D(uInput, vUv);
  if (uAmount > 0.0) {
    vec2 texel = uTexelSize;
    vec3 a = texture2D(uInput, vUv + vec2(0.0, -texel.y)).rgb;
    vec3 b = texture2D(uInput, vUv + vec2(-texel.x, 0.0)).rgb;
    vec3 d = texture2D(uInput, vUv + vec2(texel.x, 0.0)).rgb;
    vec3 e = texture2D(uInput, vUv + vec2(0.0, texel.y)).rgb;
    float la = linRgb2luma(a);
    float lb = linRgb2luma(b);
    float lc = linRgb2luma(c.rgb);
    float ld = linRgb2luma(d);
    float le = linRgb2luma(e);
    float min_g = min(1.0, min(la, min(lb, min(lc, min(ld, le)))));
    float max_g = min(1.0, max(la, max(lb, max(lc, max(ld, le)))));
    float w_mix_factor = -0.125 - 0.075 * uAmount;
    float w = sqrt(min(1.0 - max_g, min_g) / max(max_g, 1e-5)) * w_mix_factor;
    vec3 o = (w * (a + b + d + e) + c.rgb) / (4.0 * w + 1.0);
    float clc = min(1.0, lc);
    float m = uAmount * (1.0 - clc * clc * clc);
    gl_FragColor = vec4(mix(c.rgb, clamp(o, 0.0, 100.0), m), c.a);
  } else {
    gl_FragColor = c;
  }
}
