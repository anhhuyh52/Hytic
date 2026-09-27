precision highp float;

uniform sampler2D uImage;
uniform vec2 uTexelSize;
uniform float uSampleSpacing;
uniform float uSpatialFalloff;
uniform float uRangeFalloff;
uniform float uCenterWeight;
varying vec2 vUv;

void main() {
  vec3 center = texture2D(uImage, vUv).rgb;
  vec3 sum = center * uCenterWeight;
  float totalWeight = uCenterWeight;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (x == 0 && y == 0) continue;
      vec2 offset = vec2(float(x), float(y)) * uTexelSize * uSampleSpacing;
      vec3 sampleColor = texture2D(uImage, clamp(vUv + offset, 0.0, 1.0)).rgb;
      float spatialWeight = exp(-uSpatialFalloff * float(x * x + y * y));
      vec3 difference = sampleColor - center;
      float rangeWeight = exp(-dot(difference, difference) * uRangeFalloff);
      float weight = spatialWeight * rangeWeight;
      sum += sampleColor * weight;
      totalWeight += weight;
    }
  }

  gl_FragColor = vec4(sum / max(totalWeight, 0.0001), 1.0);
}
