// Pure linear-algebra helpers for deriving RGB↔RGB gamut-conversion matrices
// from documented primary chromaticities. We derive matrices from primaries
// (well-documented per gamut) instead of transcribing 3×3 constants by hand,
// which is both more verifiable and less error-prone.
//
// Matrices here are ROW-MAJOR: m = [m11,m12,m13, m21,m22,m23, m31,m32,m33], so
// `mulVec(m, v)` is the standard product M·v. (Three.Matrix3.set also takes
// row-major arguments, so the result feeds straight into a uniform.)

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Vec3 = [number, number, number];
export type XY = { x: number; y: number };
export type Primaries = { r: XY; g: XY; b: XY; white: XY };

export function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as Mat3;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3 + 0] * b[0 * 3 + col] +
        a[row * 3 + 1] * b[1 * 3 + col] +
        a[row * 3 + 2] * b[2 * 3 + col];
    }
  }
  return out;
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function inverse(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    // Singular — return identity rather than producing NaN downstream.
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  const inv = 1 / det;
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

function diag(v: Vec3): Mat3 {
  return [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];
}

/** White chromaticity → XYZ with Y normalized to 1. */
function whiteXYZ(w: XY): Vec3 {
  return [w.x / w.y, 1, (1 - w.x - w.y) / w.y];
}

/**
 * RGB→XYZ matrix for a set of primaries + white point (Y scaled so the white
 * point maps to luminance 1). Standard derivation (e.g. Bruce Lindbloom).
 */
export function rgbToXYZ(p: Primaries): Mat3 {
  const xr = p.r.x / p.r.y,
    yr = 1,
    zr = (1 - p.r.x - p.r.y) / p.r.y;
  const xg = p.g.x / p.g.y,
    yg = 1,
    zg = (1 - p.g.x - p.g.y) / p.g.y;
  const xb = p.b.x / p.b.y,
    yb = 1,
    zb = (1 - p.b.x - p.b.y) / p.b.y;

  const M: Mat3 = [xr, xg, xb, yr, yg, yb, zr, zg, zb];
  const S = mulVec(inverse(M), whiteXYZ(p.white));

  return [
    xr * S[0],
    xg * S[1],
    xb * S[2],
    yr * S[0],
    yg * S[1],
    yb * S[2],
    zr * S[0],
    zg * S[1],
    zb * S[2],
  ];
}

// Bradford chromatic-adaptation transform (cone response matrix).
const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

/** Bradford adaptation matrix taking XYZ under srcWhite to XYZ under dstWhite. */
export function bradford(srcWhite: XY, dstWhite: XY): Mat3 {
  const rs = mulVec(BRADFORD, whiteXYZ(srcWhite));
  const rd = mulVec(BRADFORD, whiteXYZ(dstWhite));
  const d = diag([rd[0] / rs[0], rd[1] / rs[1], rd[2] / rs[2]]);
  return mul(inverse(BRADFORD), mul(d, BRADFORD));
}

/**
 * Linear source-RGB → linear destination-RGB, including Bradford white
 * adaptation when the two white points differ (e.g. camera D65 → ACES D60).
 */
export function rgbToRgb(src: Primaries, dst: Primaries): Mat3 {
  const srcToXYZ = rgbToXYZ(src);
  const adapt = bradford(src.white, dst.white);
  const xyzToDst = inverse(rgbToXYZ(dst));
  return mul(xyzToDst, mul(adapt, srcToXYZ));
}
