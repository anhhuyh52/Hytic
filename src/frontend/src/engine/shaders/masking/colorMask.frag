precision highp float;

uniform sampler2D uImage;
uniform vec2 uImageSize;

uniform float uFeather;
uniform float uThreshold;
uniform vec2 uSize;
uniform float uAngle;
uniform vec2 uPosition;
uniform bool uUseRadius;
uniform vec3 uSelectedColor;
uniform bool uUseSelectedColor;
uniform bool uInvert;
uniform float uMaskOpacity;
uniform float uMaskAlpha;

varying vec2 vUv;

// LAB color space constants and matrices.
// Kept from your original shader to preserve your current color selection feel.
const float LAB_EPSILON = 216.0 / 24389.0;
const float LAB_KAPPA = 24389.0 / 27.0;

const vec3 D50_WHITE = vec3(0.96422, 1.0, 0.82521);
const vec3 D65_WHITE = vec3(0.95047, 1.0, 1.08883);

const mat3 RGB_TO_XYZ = mat3(
  0.412456, 0.357576, 0.180437,
  0.212673, 0.715152, 0.072175,
  0.019334, 0.119192, 0.950304
);

const mat3 BRADFORD = mat3(
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296
);

const mat3 BRADFORD_INV = mat3(
  0.986993, -0.147054, 0.159963,
  0.432305, 0.51836, 0.049291,
  -0.008529, 0.040043, 0.968487
);

vec3 linearRgbToAdaptedXyz(vec3 rgb, vec3 sourceWhiteBradford, vec3 targetWhiteBradford) {
  vec3 xyz = rgb * RGB_TO_XYZ;
  xyz = xyz * BRADFORD * (sourceWhiteBradford / targetWhiteBradford) * BRADFORD_INV;
  return xyz;
}

vec3 xyzToLab(vec3 xyz, vec3 whitePoint) {
  vec3 normalized = xyz / whitePoint;

  vec3 f = vec3(
    normalized.x > LAB_EPSILON
      ? pow(normalized.x, 1.0 / 3.0)
      : (LAB_KAPPA * normalized.x + 16.0) / 116.0,
    normalized.y > LAB_EPSILON
      ? pow(normalized.y, 1.0 / 3.0)
      : (LAB_KAPPA * normalized.y + 16.0) / 116.0,
    normalized.z > LAB_EPSILON
      ? pow(normalized.z, 1.0 / 3.0)
      : (LAB_KAPPA * normalized.z + 16.0) / 116.0
  );

  return vec3(
    116.0 * f.y - 16.0,
    500.0 * (f.x - f.y),
    200.0 * (f.y - f.z)
  );
}

vec3 sourceRgbToLab(vec3 rgb) {
  vec3 sourceWhiteBradford = D50_WHITE * BRADFORD;
  vec3 targetWhiteBradford = D65_WHITE * BRADFORD;
  return xyzToLab(
    linearRgbToAdaptedXyz(rgb, sourceWhiteBradford, targetWhiteBradford),
    D50_WHITE
  );
}

vec3 sampleSourceRgb(vec2 sourceUv) {
  vec2 uv = clamp(sourceUv, 0.0, 1.0);
  return texture2D(uImage, uv).rgb;
}

float colorMaskAlphaFromRgb(vec3 rgb) {
  if (!uUseSelectedColor) {
    return 0.0;
  }

  vec3 sourceLab = sourceRgbToLab(rgb);
  vec3 selectedLab = sourceRgbToLab(uSelectedColor);

  vec3 normalizedDelta = abs(sourceLab - selectedLab) / vec3(100.0, 127.0, 127.0);

  // Map threshold so 0 is tight and 1 is very broad.
  float threshold = clamp(uThreshold, 0.001, 1.0);
  // Linear scaling feels more predictable to the user.
  float radius = threshold * 0.6 + 0.01;

  float dist = length(normalizedDelta);
  float alpha = 1.0 - smoothstep(radius * 0.2, radius, dist);

  return clamp(alpha, 0.0, 1.0);
}

float colorMaskAlphaAtSourceUv(vec2 sourceUv) {
  vec2 texel = 1.0 / max(uImageSize, vec2(1.0));

  // Keep a small color-smoothing kernel, but do not let feather destroy the
  // Radius ON edge. Radius edge feather is handled in ellipseRadiusAlpha().
  float feather = clamp(uFeather, 0.0, 1.0);
  float sampleRadius = mix(0.5, 1.25, feather);

  vec2 dx = vec2(texel.x * sampleRadius, 0.0);
  vec2 dy = vec2(0.0, texel.y * sampleRadius);

  float alpha = 0.0;

  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv)) * 0.36;

  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv + dx)) * 0.10;
  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv - dx)) * 0.10;
  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv + dy)) * 0.10;
  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv - dy)) * 0.10;

  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv + dx + dy)) * 0.06;
  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv + dx - dy)) * 0.06;
  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv - dx + dy)) * 0.06;
  alpha += colorMaskAlphaFromRgb(sampleSourceRgb(sourceUv - dx - dy)) * 0.06;

  return clamp(alpha, 0.0, 1.0);
}

float ellipseRadiusAlpha(vec2 uv) {
  if (!uUseRadius) {
    return 1.0;
  }

  // Convert normalized image UV to image-pixel space so the ellipse is stable
  // across different aspect ratios.
  vec2 p = (uv - uPosition) * uImageSize;

  // Visual overlay uses rotate(-angle). The mask uses the same visual direction.
  float c = cos(-uAngle);
  float s = sin(-uAngle);

  vec2 rotated = vec2(
    p.x * c - p.y * s,
    p.x * s + p.y * c
  );

  vec2 radius = max(uSize * uImageSize, vec2(1.0));
  float d = length(rotated / radius);

  float feather = clamp(uFeather, 0.0, 1.0);

  // Polarr-like expectation:
  // center remains strong, softness happens near the ellipse edge.
  float edgeWidth = mix(0.001, 0.35, feather);

  return 1.0 - smoothstep(1.0 - edgeWidth, 1.0, d);
}

void main() {
  float colorAlpha = colorMaskAlphaAtSourceUv(vUv);

  // Invert once only.
  if (uInvert) {
    colorAlpha = 1.0 - colorAlpha;
  }

  // Radius ON is a limiter, so outside the radius remains unselected even
  // when the color mask is inverted.
  float radiusAlpha = ellipseRadiusAlpha(vUv);

  float maskAlpha = colorAlpha * radiusAlpha;

  // These are real mask strength controls, not red overlay visibility.
  maskAlpha *= clamp(uMaskOpacity, 0.0, 1.0);
  maskAlpha *= clamp(uMaskAlpha, 0.0, 1.0);

  maskAlpha = clamp(maskAlpha, 0.0, 1.0);

  gl_FragColor = vec4(vec3(maskAlpha), maskAlpha);
}