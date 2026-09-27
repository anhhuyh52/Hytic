precision highp float;
precision highp sampler2D;
precision highp sampler3D;

uniform sampler2D uImage;
uniform sampler2D uMaskTexture;
uniform sampler3D uLUT3D;

uniform bool uHasMaskTexture;
uniform bool uHasLUT3D;
uniform bool uAcesLinearInput;

uniform float uMaskOpacity;
uniform float uMaskAlpha;

in vec2 vUv;
out vec4 outColor;

#include <colorPipeline>

void main() {
  vec4 src = texture(uImage, vUv);

  if (!uHasLUT3D) {
    outColor = src;
    return;
  }

  float mask = 0.0;

  if (uHasMaskTexture) {
    mask = texture(uMaskTexture, vUv).r;
  }

  mask = clamp(mask * uMaskOpacity * uMaskAlpha, 0.0, 1.0);

  if (mask <= 0.0001) {
    outColor = src;
    return;
  }

  vec3 lutSource = uAcesLinearInput ? lin2cct(max(src.rgb, 0.0)) : src.rgb;
  vec3 lutInput = clamp(lutSource, 0.0, 1.0);
  vec3 lutColor = texture(uLUT3D, lutInput).rgb;
  vec3 outputColor = uAcesLinearInput ? cct2lin(max(lutColor, 0.0)) : lutColor;

  outColor = vec4(mix(src.rgb, outputColor, mask), src.a);
}