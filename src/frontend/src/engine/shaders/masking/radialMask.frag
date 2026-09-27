precision highp float;

// Normalized image-UV center of the ellipse (0..1).
uniform vec2 uPosition;
// Normalized image-UV *radius* per axis (half of the diameter, 0..1).
// The caller passes size * 0.5 so the shader treats it as radius directly.
uniform vec2 uSize;
// Rotation angle in radians.
uniform float uAngle;
// Feather amount 0 (hard) .. 1 (fully soft).
uniform float uFeather;
// When true the mask is 1 outside the ellipse and 0 inside.
uniform bool uInvert;
// Overall mask strength (UI "opacity" slider).
uniform float uOpacity;
// Per-layer blend alpha (UI "alpha" slider).
uniform float uAlpha;
// Source image pixel dimensions (used to make the ellipse aspect-ratio stable).
uniform vec2 uTextureSize;

varying vec2 vUv;

void main() {
  // Convert UV to image-pixel space so the ellipse axes are independent of the
  // canvas or render-target aspect ratio and only depend on the image dimensions.
  vec2 p = (vUv - uPosition) * uTextureSize;

  // Rotate by -uAngle (same direction as the SVG overlay which uses rotate(-angle)).
  float c = cos(-uAngle);
  float s = sin(-uAngle);
  vec2 rotated = vec2(
    p.x * c - p.y * s,
    p.x * s + p.y * c
  );

  // Normalise into ellipse-local space so unit circle = ellipse boundary.
  // uSize already holds the *radius* (half-size in UV units) scaled by textureSize.
  vec2 radius = max(uSize * uTextureSize, vec2(1.0));
  float dist = length(rotated / radius);

  // Feather: map uFeather 0..1 → hard-edge (featherLimit ≈ 1) to fully-soft
  // (featherLimit ≈ 0). smoothstep(featherLimit, 1.0, dist) gives 0 inside,
  // 1 outside; invert for a soft-interior mask.
  float featherLimit = clamp(1.0 - uFeather, 0.01, 0.99);
  // mask = 1 inside the ellipse (with feathered edge), 0 outside.
  float mask = 1.0 - smoothstep(featherLimit, 1.0, dist);

  if (uInvert) {
    mask = 1.0 - mask;
  }

  float alpha = clamp(mask * uOpacity * uAlpha, 0.0, 1.0);

  gl_FragColor = vec4(vec3(alpha), alpha);
}
