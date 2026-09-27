// Requires these uniforms declared in the including shader:
//   uniform bool  uCropEnabled;
//   uniform vec4  uCropRect;         // x, y, width, height (normalized display UV)
//   uniform vec2  uSourceSize;       // source bitmap pixel size
//   uniform vec2  uDisplaySize;      // transformed display pixel size
//   uniform float uOrientationAngle; // 0 | 90 | 180 | 270 degrees
//   uniform float uStraighten;       // -45..45 degrees fine rotation
//   uniform bool  uFlipX;
//   uniform bool  uFlipY;
//
// Maps an output UV (0..1) to the corresponding source image UV.
// Crop coordinates live in the transformed display space, matching the legacy
// canvas implementation.
vec2 applyImageTransform(vec2 uv) {
  vec2 displayUv = uv;

  if (uCropEnabled) {
    displayUv = uCropRect.xy + displayUv * uCropRect.zw;
  }

  vec2 sourceSize = max(uSourceSize, vec2(1.0));
  vec2 displaySize = max(uDisplaySize, vec2(1.0));
  vec2 p = (displayUv - 0.5) * displaySize;

  float angle = radians(-(uOrientationAngle + uStraighten));
  float s = sin(angle);
  float c = cos(angle);
  p = mat2(c, s, -s, c) * p;

  float fine = radians(abs(uStraighten));
  float fs = sin(fine);
  float fc = cos(fine);
  float fillScale = max(
    (displaySize.x * fc + displaySize.y * fs) / displaySize.x,
    (displaySize.x * fs + displaySize.y * fc) / displaySize.y
  );

  p /= max(fillScale, 0.0001);
  if (uFlipX) p.x = -p.x;
  if (uFlipY) p.y = -p.y;

  return p / sourceSize + 0.5;
}
