precision highp float;

/**
 * Gradient mask shader.
 *
 * The gradient is defined by two points in image-UV space:
 *   uStartPoint  = the transparent side  (mask = 0)
 *   uEndPoint    = the fully-opaque side  (mask = 1)
 *
 * For each fragment we project its UV onto the start→end axis and compute a
 * normalised signed distance t (0 at start, 1 at end).  smoothstep gives
 * a soft edge; for a hard-linear gradient we just clamp t.
 *
 * reflect = true  →  the centre-line is brightest; both sides fade out.
 *                    Implemented as  mask = 1 - |2t - 1|   (tent function).
 */

uniform vec2  uStartPoint;   // image UV – transparent side
uniform vec2  uEndPoint;     // image UV – opaque side
uniform bool  uReflect;
uniform bool  uInvert;
uniform float uOpacity;      // overall strength 0..1
uniform float uAlpha;        // per-layer blend 0..1

varying vec2 vUv;

void main() {
  vec2  axis = uEndPoint - uStartPoint;
  float len2 = dot(axis, axis);

  // Projected, normalised position along the gradient axis (0 = start, 1 = end).
  float t = (len2 < 1e-8)
      ? 0.5
      : dot(vUv - uStartPoint, axis) / len2;

  float mask;
  if (uReflect) {
    // 0 at the centre (t == 0.5), 1 at both edges and beyond.
    mask = clamp(abs(2.0 * t - 1.0), 0.0, 1.0);
  } else {
    // 1 at start line (t=0), 0 at end line (t=1).
    mask = clamp(1.0 - t, 0.0, 1.0);
  }

  if (uInvert) {
    mask = 1.0 - mask;
  }

  float alpha = clamp(mask * uOpacity * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(vec3(alpha), alpha);
}
