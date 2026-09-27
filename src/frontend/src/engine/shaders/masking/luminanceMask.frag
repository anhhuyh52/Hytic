precision highp float;

/**
 * Luminance mask shader.
 *
 * Selects pixels by brightness/luminance.
 *
 * uSourceTexture – the input image to sample
 * uTarget        – which brightness value to center on (0=shadows, 1=highlights)
 * uRange         – width of selected luminance band (0=narrow, 1=broad)
 * uSmoothness    – feather softness outside the range (0=hard, 1=soft)
 * uInvert        – 1.0 to flip selected/unselected
 * uOpacity       – overall mask strength 0..1
 * uAlpha         – per-layer blend alpha 0..1
 */

uniform sampler2D uSourceTexture;
uniform float uTarget;
uniform float uRange;
uniform float uSmoothness;
uniform float uInvert;   // float so no bool uniform issues across GL implementations
uniform float uOpacity;
uniform float uAlpha;

varying vec2 vUv;

// BT.601 luma coefficients — matches Polarr's perceived brightness weighting.
float luminanceOf(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 color = texture2D(uSourceTexture, vUv).rgb;

  float luma   = luminanceOf(color);
  float target = clamp(uTarget,     0.0, 1.0);
  float range  = clamp(uRange,      0.0, 1.0);
  float smooth_ = clamp(uSmoothness, 0.0, 1.0);

  float dist = abs(luma - target);

  // hardWidth = selected zone radius around target.
  float hardWidth   = max(0.0001, range);
  // featherWidth = soft transition outside the hard zone.
  float featherWidth = max(0.0001, (1.0 - range) * smooth_);

  float maskValue = 1.0 - smoothstep(
    hardWidth,
    min(1.0, hardWidth + featherWidth),
    dist
  );

  if (uInvert > 0.5) {
    maskValue = 1.0 - maskValue;
  }

  maskValue *= clamp(uOpacity, 0.0, 1.0);
  maskValue *= clamp(uAlpha,   0.0, 1.0);

  gl_FragColor = vec4(vec3(maskValue), maskValue);
}
