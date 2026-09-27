precision highp float;

uniform sampler2D uMaskTexture;
uniform vec3 uOverlayColor;
uniform float uOpacity;
uniform bool uTextureMode;

varying vec2 vUv;

void main() {
  vec4 sampled = texture2D(uMaskTexture, vUv);
  if (uTextureMode) {
    gl_FragColor = sampled;
    return;
  }
  float maskAlpha = sampled.a;
  
  float finalAlpha = clamp(maskAlpha * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(uOverlayColor, finalAlpha);
}
