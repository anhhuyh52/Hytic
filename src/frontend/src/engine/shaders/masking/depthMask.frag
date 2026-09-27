precision highp float;

/**
 * Depth mask shader.
 *
 * Selects pixels by their depth value sampled from uDepthTexture.r.
 *
 * Polarr formula (confirmed from bundle):
 *   width     = range * 0.98 + 0.01
 *   maskValue = clamp(1.0 - abs(depth - target) / width, 0.0, 1.0)
 *   if (invert) maskValue = 1.0 - maskValue
 *   output    = maskValue * opacity * alpha
 */

uniform sampler2D uDepthTexture;
uniform float uHasDepth;

uniform float uTarget;   // 0..1 selected depth value
uniform float uRange;    // 0..1 selected depth width
uniform float uInvert;   // float: 0 = normal, 1 = inverted
uniform float uOpacity;
uniform float uAlpha;

varying vec2 vUv;

void main() {
  // Guard before inversion: unavailable depth must always remain an empty mask.
  if (uHasDepth < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float depthValue = texture2D(uDepthTexture, vUv).r;

  // Polarr-confirmed range formula: keeps a minimum width of 0.01.
  float width = clamp(uRange, 0.0, 1.0) * 0.98 + 0.01;

  float maskValue = clamp(
    1.0 - abs(depthValue - clamp(uTarget, 0.0, 1.0)) / width,
    0.0,
    1.0
  );

  if (uInvert > 0.5) {
    maskValue = 1.0 - maskValue;
  }

  maskValue *= clamp(uOpacity, 0.0, 1.0);
  maskValue *= clamp(uAlpha,   0.0, 1.0);

  gl_FragColor = vec4(vec3(maskValue), maskValue);
}
