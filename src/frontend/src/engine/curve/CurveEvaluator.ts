import type { CurvePoint, CurveState, ManualCurveMode } from "../state/EditState";

export const CURVE_TEXTURE_SIZE = 512;
export const CURVE_MIN_STOPS = -2;
export const CURVE_MAX_STOPS = 2;

export type PreparedCurveEvaluator = (x: number) => number;

export function evaluateCurveTexture(curve: CurveState, out?: Uint8Array): Uint8Array {
  const data = out || new Uint8Array(CURVE_TEXTURE_SIZE * 4);
  const evaluate = curve.bypass ? null : prepareCurveEvaluator(curve.mode, curve.points);

  for (let index = 0; index < CURVE_TEXTURE_SIZE; index += 1) {
    const x = index / (CURVE_TEXTURE_SIZE - 1);
    const stops = evaluate ? evaluate(x) : 0;
    const encodedStops = (stops - CURVE_MIN_STOPS) / (CURVE_MAX_STOPS - CURVE_MIN_STOPS);
    const encoded = Math.round(clamp01(encodedStops) * 255);
    const offset = index * 4;

    data[offset] = encoded;
    data[offset + 1] = encoded;
    data[offset + 2] = encoded;
    data[offset + 3] = 255;
  }

  return data;
}

export function evaluateCurve(curve: CurveState, x: number): number {
  return evaluateManualCurve(curve.mode, curve.points, x);
}

/**
 * Convenience single-sample API.
 * Keep this for compatibility, but avoid using it inside LUT/sample loops.
 */
export function evaluateManualCurve(
  mode: ManualCurveMode,
  points: readonly CurvePoint[],
  x: number,
): number {
  return prepareCurveEvaluator(mode, points)(x);
}

/**
 * Hot-path API.
 * Normalize/solve/build once per curve, then cheaply evaluate many x samples.
 */
export function prepareCurveEvaluator(
  mode: ManualCurveMode,
  points: readonly CurvePoint[],
): PreparedCurveEvaluator {
  const normalizedPoints = normalizePoints(points);

  if (mode === "bezier") {
    return prepareBezierCurveEvaluator(normalizedPoints);
  }

  if (mode === "cubic") {
    return prepareNaturalCubicSplineEvaluator(normalizedPoints);
  }

  return (x: number) => evaluateLinearCurve(normalizedPoints, x);
}

function evaluateLinearCurve(points: readonly CurvePoint[], x: number): number {
  const index = findSegmentIndex(points, x);
  const start = points[index];
  const end = points[index + 1];
  const t = start.x === end.x ? 0 : clamp01((x - start.x) / (end.x - start.x));

  return lerp(start.y, end.y, t);
}

/** Legacy-style natural cubic spline. Keep stop values in the curve domain; do not clamp to 0..1. */
export function evaluateNaturalCubicSpline(points: readonly CurvePoint[], x: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n === 1) return clampStops(points[0].y);

  return evaluateNaturalCubicAtCoefficients(computeNaturalCubicCoefficients(points), x);
}

function prepareNaturalCubicSplineEvaluator(points: readonly CurvePoint[]): PreparedCurveEvaluator {
  const n = points.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => clampStops(points[0].y);

  const coeffs = computeNaturalCubicCoefficients(points);

  return (x: number) => evaluateNaturalCubicAtCoefficients(coeffs, x);
}

type NaturalCubicCoefficients = {
  xs: number[];
  ys: number[];
  first: number[];
  second: number[];
  third: number[];
  last: number;
};

function computeNaturalCubicCoefficients(points: readonly CurvePoint[]): NaturalCubicCoefficients {
  const n = points.length;
  const last = n - 1;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const h = new Array<number>(last);
  const lower = new Array<number>(n).fill(0);
  const diag = new Array<number>(n).fill(1);
  const upper = new Array<number>(n).fill(0);
  const rhs = new Array<number>(n).fill(0);
  const cPrime = new Array<number>(n).fill(0);
  const dPrime = new Array<number>(n).fill(0);
  const second = new Array<number>(n).fill(0);
  const first = new Array<number>(last).fill(0);
  const third = new Array<number>(last).fill(0);

  for (let i = 1; i < n; i += 1) {
    h[i - 1] = Math.max(1e-9, xs[i] - xs[i - 1]);
  }

  for (let i = 1; i < last; i += 1) {
    lower[i] = h[i - 1];
    diag[i] = 2 * (h[i - 1] + h[i]);
    upper[i] = h[i];
    rhs[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);

    const denom = diag[i] - lower[i] * cPrime[i - 1];
    cPrime[i] = upper[i] / denom;
    dPrime[i] = (rhs[i] - lower[i] * dPrime[i - 1]) / denom;
  }

  for (let i = last - 1; i >= 0; i -= 1) {
    second[i] = dPrime[i] - cPrime[i] * second[i + 1];
  }

  for (let i = 0; i < last; i += 1) {
    first[i] = (ys[i + 1] - ys[i]) / h[i] - (h[i] * (second[i + 1] + 2 * second[i])) / 3;
    third[i] = (second[i + 1] - second[i]) / (3 * h[i]);
  }

  return {
    xs,
    ys,
    first,
    second,
    third,
    last,
  };
}

function evaluateNaturalCubicAtCoefficients(coeffs: NaturalCubicCoefficients, x: number): number {
  const { xs, ys, first, second, third, last } = coeffs;
  const cx = clamp01(x);

  if (cx <= xs[0]) return clampStops(ys[0]);
  if (cx >= xs[last]) return clampStops(ys[last]);

  let seg = last - 1;

  for (let i = 0; i < last; i += 1) {
    if (cx <= xs[i + 1]) {
      seg = i;
      break;
    }
  }

  const dx = cx - xs[seg];

  return clampStops(ys[seg] + first[seg] * dx + second[seg] * dx * dx + third[seg] * dx * dx * dx);
}

/**
 * Monotone cubic Hermite spline (Fritsch–Carlson). Kept for existing callers.
 * This is not used by `mode === "cubic"` because the legacy cubic path is natural cubic.
 */
export function evaluateMonotoneCubicSpline(points: readonly CurvePoint[], x: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n === 1) return points[0].y;

  const last = n - 1;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const h: number[] = new Array(last);
  const delta: number[] = new Array(last);

  for (let i = 0; i < last; i += 1) {
    h[i] = xs[i + 1] - xs[i] || 1e-9;
    delta[i] = (ys[i + 1] - ys[i]) / h[i];
  }

  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[last] = delta[last - 1];

  for (let i = 1; i < last; i += 1) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }

  for (let i = 0; i < last; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }

    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;

    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }

  const cx = x < xs[0] ? xs[0] : x > xs[last] ? xs[last] : x;
  let seg = last - 1;

  for (let i = 0; i < last; i += 1) {
    if (cx <= xs[i + 1]) {
      seg = i;
      break;
    }
  }

  const t = (cx - xs[seg]) / h[seg];
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * ys[seg] + h10 * h[seg] * m[seg] + h01 * ys[seg + 1] + h11 * h[seg] * m[seg + 1];
}

function prepareBezierCurveEvaluator(points: readonly CurvePoint[]): PreparedCurveEvaluator {
  const n = points.length;

  if (n === 0) return () => 0;
  if (n === 1) return () => points[0].y;

  const cp = buildBezierControlSequence(points);
  const lastY = points[n - 1].y;

  return (x: number) => evaluateBezierAtControlSequence(cp, lastY, x);
}

/**
 * Bezier — faithful port of the legacy Poto "Bezier" interpolator.
 * Build this once per curve, not once per sample.
 */
function buildBezierControlSequence(points: readonly CurvePoint[]): CurvePoint[] {
  const n = points.length;
  const first = points[0];
  const last = points[n - 1];

  const cp: CurvePoint[] = [{ x: 0, y: first.y }, { x: 0, y: first.y }, { ...first }, { ...first }];

  for (let i = 1; i < n; i += 1) {
    const prev = points[i - 1];
    const prevPrev = points[i - 2] ?? prev;
    const cur = points[i];
    const next = points[i + 1] ?? cur;

    cp.push(bezierHandle(prev, prevPrev, cur, false));
    cp.push(bezierHandle(cur, prev, next, true));
    cp.push({ ...cur });
  }

  cp.push({ ...last }, { x: 1, y: last.y }, { x: 1, y: last.y });

  return cp;
}

function evaluateBezierAtControlSequence(
  cp: readonly CurvePoint[],
  lastY: number,
  x: number,
): number {
  const cx = clamp01(x);

  for (let s = 0; s + 3 < cp.length; s += 3) {
    if (cx <= cp[s + 3].x || s + 6 >= cp.length) {
      return solveBezierSegment(cp[s], cp[s + 1], cp[s + 2], cp[s + 3], cx);
    }
  }

  return lastY;
}

// Legacy `pf`: Catmull-Rom-style tangent handle.
function bezierHandle(
  p: CurvePoint,
  prev: CurvePoint,
  next: CurvePoint,
  isIn: boolean,
): CurvePoint {
  const sx = next.x - prev.x;
  const sy = next.y - prev.y;
  const rx = p.x - prev.x;
  const ry = p.y - prev.y;
  const c = Math.sqrt(rx * rx + ry * ry);
  const hx = next.x - p.x;
  const hy = next.y - p.y;
  const nextDistance = Math.sqrt(hx * hx + hy * hy);
  const f = 1.667 * Math.min(Math.max(0, rx), Math.max(0, hx)) * 0.647 + 0.02;
  const denom = c + nextDistance;
  const d = denom <= 1e-9 ? 0 : f * (c / denom);

  if (isIn) {
    return { x: p.x - d * sx, y: p.y - d * sy };
  }

  const k = f - d;
  return { x: p.x + k * sx, y: p.y + k * sy };
}

function solveBezierSegment(
  p0: CurvePoint,
  p1: CurvePoint,
  p2: CurvePoint,
  p3: CurvePoint,
  targetX: number,
): number {
  if (targetX <= p0.x) return p0.y;
  if (targetX >= p3.x) return p3.y;

  let lo = 0;
  let hi = 1;
  let t = 0.5;

  for (let i = 0; i < 24; i += 1) {
    t = (lo + hi) * 0.5;
    const bx = cubicBezier(p0.x, p1.x, p2.x, p3.x, t);

    if (bx < targetX) lo = t;
    else hi = t;
  }

  return cubicBezier(p0.y, p1.y, p2.y, p3.y, t);
}

function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number) {
  const mt = 1 - t;

  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function normalizePoints(points: readonly CurvePoint[]) {
  const deduped = points
    .slice(0, 7)
    .map((point) => ({
      x: clamp01(point.x),
      y: clampStops(point.y),
    }))
    .sort((left, right) => left.x - right.x)
    .filter((point, index, list) => index === 0 || point.x !== list[index - 1].x);

  if (deduped.length < 2) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
  }

  return deduped;
}

function findSegmentIndex(points: readonly CurvePoint[], x: number) {
  const clampedX = clamp01(x);

  for (let index = 0; index < points.length - 1; index += 1) {
    if (clampedX <= points[index + 1].x) {
      return index;
    }
  }

  return points.length - 2;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clampStops(value: number) {
  return Math.min(CURVE_MAX_STOPS, Math.max(CURVE_MIN_STOPS, value));
}
