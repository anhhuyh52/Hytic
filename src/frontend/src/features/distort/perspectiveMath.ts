import {
  DEFAULT_DISTORTION_POINTS,
  defaultDistortionPoints,
} from "./distortDefaults";
import type { DistortionPoints, Mat3, NormalizedCrop, PerspectiveHandleId } from "./distortTypes";

const EPSILON = 1e-7;

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export { defaultDistortionPoints };

export function pointsEqualDefault(points: DistortionPoints): boolean {
  return points.every((value, index) => Math.abs(value - DEFAULT_DISTORTION_POINTS[index]) < 1e-5);
}

export function buildPerspectiveMatrix(points: DistortionPoints): Mat3 {
  const src = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const rows: number[][] = [];
  const values: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const X = points[i * 2];
    const Y = points[i * 2 + 1];
    rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    values.push(X);
    rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    values.push(Y);
  }

  const solved = solveLinearSystem(rows, values);
  if (!solved) return [...IDENTITY] as Mat3;
  return [
    solved[0],
    solved[1],
    solved[2],
    solved[3],
    solved[4],
    solved[5],
    solved[6],
    solved[7],
    1,
  ];
}

export function invertMat3(matrix: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return [...IDENTITY] as Mat3;
  const inv = 1 / det;
  return [A * inv, B * inv, C * inv, D * inv, E * inv, F * inv, G * inv, H * inv, I * inv];
}

export function transformPoint(matrix: Mat3, x: number, y: number): [number, number] {
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  if (!Number.isFinite(w) || Math.abs(w) < EPSILON) return [x, y];
  const nx = (matrix[0] * x + matrix[1] * y + matrix[2]) / w;
  const ny = (matrix[3] * x + matrix[4] * y + matrix[5]) / w;
  return [Number.isFinite(nx) ? nx : x, Number.isFinite(ny) ? ny : y];
}

export function limitDistortionPoints(
  next: DistortionPoints,
  previous: DistortionPoints,
  movingHandle: PerspectiveHandleId,
): DistortionPoints {
  const limited = finitePoints(next, previous);
  const cornerIndex = cornerIndexForHandle(movingHandle);
  const candidate = cornerIndex == null
    ? limited
    : clipCornerToLegacyBoundary(limited, cornerIndex, pointAt(previous, cornerIndex));

  // Edge and center handles can collapse or invert the quad just like corner
  // handles. Never publish an invalid intermediate state to the shader.
  return isValidQuad(candidate) && perspectiveMatrixIsValid(candidate) ? candidate : previous;
}

export function isValidQuad(points: DistortionPoints): boolean {
  if (!points.every(Number.isFinite)) return false;
  const polygon = quadPolygon(points);
  const area = signedArea(polygon);
  if (area < 0.01) return false;
  if (polygon.some((point, index) => distance(point, polygon[(index + 1) % polygon.length]) < 0.01)) {
    return false;
  }
  if (segmentsIntersect(polygon[0], polygon[1], polygon[2], polygon[3])) return false;
  if (segmentsIntersect(polygon[1], polygon[2], polygon[3], polygon[0])) return false;

  // A square homography must remain convex. Concave quads can have a finite
  // matrix while placing its projective pole inside the visible image.
  const turns = polygon.map((point, index) =>
    orientation(point, polygon[(index + 1) % 4], polygon[(index + 2) % 4]),
  );
  if (turns.some((turn) => turn <= EPSILON)) return false;
  return true;
}

export function calculateAutoCropForDistortion(
  points: DistortionPoints,
  _imageWidth: number,
  _imageHeight: number,
): NormalizedCrop {
  if (!isValidQuad(points)) return { x: 0, y: 0, width: 1, height: 1 };
  // Reference autoCrop: the inscribed axis-aligned box of the warped quad —
  // max of the left-edge xs, min of the right-edge xs, max of the top-edge ys,
  // min of the bottom-edge ys — so the transparent wedges get cropped away
  // (not the outer bounding box, which would keep them).
  const [tlx, tly, trx, trY, blx, bly, brx, brY] = points.map((v) => (v + 1) * 0.5);
  const left = clamp(Math.max(tlx, blx), 0, 0.98);
  const right = clamp(Math.min(trx, brx), left + 0.02, 1);
  const top = clamp(Math.max(1 - bly, 1 - brY), 0, 0.98);
  const bottom = clamp(Math.min(1 - tly, 1 - trY), top + 0.02, 1);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function perspectiveMatrixIsValid(points: DistortionPoints): boolean {
  const matrix = buildPerspectiveMatrix(points);
  const inverse = invertMat3(matrix);
  return matrix.every(Number.isFinite) && inverse.every(Number.isFinite);
}

function finitePoints(next: DistortionPoints, previous: DistortionPoints): DistortionPoints {
  return next.map((value, index) => (Number.isFinite(value) ? value : previous[index])) as DistortionPoints;
}

// Reference point order (y-up): 0 = bottom-left, 1 = bottom-right,
// 2 = top-left, 3 = top-right.
function cornerIndexForHandle(handle: PerspectiveHandleId): 0 | 1 | 2 | 3 | null {
  if (handle === "bottom-left") return 0;
  if (handle === "bottom-right") return 1;
  if (handle === "top-left") return 2;
  if (handle === "top-right") return 3;
  return null;
}

function pointAt(points: DistortionPoints, cornerIndex: 0 | 1 | 2 | 3): [number, number] {
  const index = cornerIndex * 2;
  return [points[index], points[index + 1]];
}

function setPointAt(
  points: DistortionPoints,
  cornerIndex: 0 | 1 | 2 | 3,
  point: [number, number],
): DistortionPoints {
  const next = [...points] as DistortionPoints;
  const index = cornerIndex * 2;
  next[index] = point[0];
  next[index + 1] = point[1];
  return next;
}

function clipCornerToLegacyBoundary(
  points: DistortionPoints,
  cornerIndex: 0 | 1 | 2 | 3,
  original: [number, number],
): DistortionPoints {
  const tl = pointAt(points, 0);
  const tr = pointAt(points, 1);
  const bl = pointAt(points, 2);
  const br = pointAt(points, 3);

  let target: [number, number];
  let opposite: [number, number];
  let edgeA: [number, number];
  let edgeB: [number, number];
  if (cornerIndex === 0) {
    target = tl;
    opposite = br;
    edgeA = bl;
    edgeB = tr;
  } else if (cornerIndex === 1) {
    target = tr;
    opposite = bl;
    edgeA = br;
    edgeB = tl;
  } else if (cornerIndex === 2) {
    target = bl;
    opposite = tr;
    edgeA = tl;
    edgeB = br;
  } else {
    target = br;
    opposite = tl;
    edgeA = tr;
    edgeB = bl;
  }

  const farA = lerpPoint(opposite, edgeA, 1000);
  const farB = lerpPoint(opposite, edgeB, 1000);
  const boundary: Array<[number, number]> = [edgeA, farA, [farA[0], farB[1]], farB, edgeB];
  const hit = intersectPolylineWithSegment(boundary, original, target);
  if (!hit) return points;

  return setPointAt(points, cornerIndex, lerpPoint(hit, original, 0.0001));
}

function lerpPoint(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function intersectPolylineWithSegment(
  path: Array<[number, number]>,
  start: [number, number],
  end: [number, number],
): [number, number] | null {
  for (let i = 0; i < path.length - 1; i += 1) {
    const hit = segmentIntersection(start, end, path[i], path[i + 1]);
    if (hit) return hit;
  }
  return null;
}

function segmentIntersection(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): [number, number] | null {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const cdx = d[0] - c[0];
  const cdy = d[1] - c[1];
  const denom = cross(abx, aby, cdx, cdy);
  if (Math.abs(denom) < EPSILON) return null;

  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const t = cross(acx, acy, cdx, cdy) / denom;
  const u = cross(acx, acy, abx, aby) / denom;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return [a[0] + abx * t, a[1] + aby * t];
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function solveLinearSystem(rows: number[][], values: number[]): number[] | null {
  const n = values.length;
  const a = rows.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < EPSILON) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function quadPolygon(points: DistortionPoints): Array<[number, number]> {
  return [
    [points[0], points[1]],
    [points[2], points[3]],
    [points[6], points[7]],
    [points[4], points[5]],
  ];
}

function signedArea(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum * 0.5;
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
