precision highp float;
varying vec2 vUv;
uniform sampler2D uBaseTexture;
uniform sampler2D uLayerTexture;
uniform sampler2D uMaskTexture;
uniform sampler2D uGradientTexture;
uniform vec2 uPosition;
uniform vec2 uScale;
uniform float uAngle;
uniform float uFill;
uniform float uOpacity;
uniform int uBlendMode;
uniform int uGradientType;
uniform bool uHasMask;
uniform bool uReverse;
uniform bool uReflect;
uniform bool uRepeat;

vec3 blend(vec3 base, vec3 layer) {
  if (uBlendMode == 1) return 1.0 - (1.0 - base) * (1.0 - layer); // screen
  if (uBlendMode == 2) return base * layer; // multiply
  if (uBlendMode == 3) return mix(2.0 * base * layer, 1.0 - 2.0 * (1.0 - base) * (1.0 - layer), step(0.5, base));
  if (uBlendMode == 4) return mix(2.0 * base * layer + base * base * (1.0 - 2.0 * layer), sqrt(base) * (2.0 * layer - 1.0) + 2.0 * base * (1.0 - layer), step(0.5, layer));
  if (uBlendMode == 5) return max(base, layer);
  if (uBlendMode == 6) return min(base, layer);
  if (uBlendMode == 7) return min(vec3(1.0), base + layer);
  return layer;
}

void main() {
  vec4 base = texture2D(uBaseTexture, vUv);
  float radians = -uAngle * 0.017453292519943295;
  mat2 rotation = mat2(cos(radians), -sin(radians), sin(radians), cos(radians));
  vec2 layerUv = rotation * (vUv - uPosition) / uScale + 0.5;
  float bounds = step(0.0, layerUv.x) * step(layerUv.x, 1.0) * step(0.0, layerUv.y) * step(layerUv.y, 1.0);
  vec4 layer = texture2D(uLayerTexture, layerUv);
  if (uGradientType > 0) {
    float coordinate = layerUv.x;
    if (uGradientType == 2) coordinate = length(layerUv * 2.0 - 1.0);
    if (uGradientType == 3) coordinate = dot(base.rgb, vec3(0.298839, 0.586811, 0.11435));
    if (uRepeat) coordinate = fract(coordinate);
    if (uReflect) coordinate = abs(1.0 - coordinate * 2.0);
    if (uReverse) coordinate = 1.0 - coordinate;
    layer = texture2D(uGradientTexture, vec2(coordinate, 0.5));
    if (uGradientType == 3) bounds = 1.0;
  }
  float maskAlpha = uHasMask ? texture2D(uMaskTexture, vUv).r : 1.0;
  vec3 blended = mix(base.rgb, blend(base.rgb, layer.rgb), uFill);
  float amount = uOpacity * layer.a * bounds * maskAlpha;
  gl_FragColor = vec4(mix(base.rgb, blended, amount), base.a);
}
