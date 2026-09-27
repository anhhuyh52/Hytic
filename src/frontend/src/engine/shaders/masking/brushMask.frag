// brushMask.frag
// Final brush mask pass: reads the cached brush texture, applies invert/opacity/alpha,
// and outputs an R=mask value texture for LocalAdjustmentPass.

precision highp float;

varying vec2 vUv;

uniform sampler2D uBrushTexture;
uniform float uInvert;
uniform float uOpacity;
uniform float uAlpha;

void main() {
  float mask = texture2D(uBrushTexture, vUv).r;

  if (uInvert > 0.5) {
    mask = 1.0 - mask;
  }

  mask *= clamp(uOpacity, 0.0, 1.0);
  mask *= clamp(uAlpha, 0.0, 1.0);

  gl_FragColor = vec4(mask, mask, mask, mask);
}
