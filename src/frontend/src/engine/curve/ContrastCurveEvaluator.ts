import type { ContrastCurveMode, ContrastCurvePoint, ContrastCurveState } from "../state/EditState";

export const CONTRAST_CURVE_TEXTURE_SIZE = 512;
export const CONTRAST_CURVE_MIN = -1;
export const CONTRAST_CURVE_MAX = 1;

/**
 * Bakes the contrast curve into a 512x1 RGBA buffer. Each texel encodes the
 * local contrast amount for that luminance input, mapped from [-1, 1] -> [0, 1]:
 *   encoded = (contrastValue - MIN) / (MAX - MIN)
 * Neutral (contrastValue = 0) encodes to 0.5.
 */
export function evaluateContrastCurveTexture(
  curve: ContrastCurveState,
  out?: Uint8Array,
): Uint8Array {
  const data = out || new Uint8Array(CONTRAST_CURVE_TEXTURE_SIZE * 4);

  for (let index = 0; index < CONTRAST_CURVE_TEXTURE_SIZE; index += 1) {
    const x = index / (CONTRAST_CURVE_TEXTURE_SIZE - 1);
    const value = curve.bypass ? 0 : evaluateContrastCurve(curve, x);
    const encoded =
      (clampContrast(value) - CONTRAST_CURVE_MIN) / (CONTRAST_CURVE_MAX - CONTRAST_CURVE_MIN);
    const byte = Math.round(clamp01(encoded) * 255);
    const offset = index * 4;

    data[offset] = byte;
    data[offset + 1] = byte;
    data[offset + 2] = byte;
    data[offset + 3] = 255;
  }

  return data;
}

export function evaluateContrastCurve(curve: ContrastCurveState, x: number): number {
  const { mode } = curve;

  if (mode === "gain") {
    return (iiqGain(x, curve.gain) - x) * curve.amount;
  }
  if (mode === "parabola") {
    return parabola(x, curve.parabolaPower) * curve.amount;
  }
  if (mode === "pcurve") {
    return (pcurve(x, curve.pcurveA, curve.pcurveB) - x) * curve.amount;
  }
  if (mode === "almostUnitIdentity") {
    return (almostUnitIdentity(x) - x) * curve.amount;
  }
  if (mode === "expImpulse") {
    return expImpulse(x, curve.expImpulseK) * curve.amount;
  }
  if (mode === "cubicPulse") {
    return cubicPulse(curve.cubicPulseCenter, curve.cubicPulseWidth, x) * curve.amount;
  }

  return evaluateManualContrastCurve(mode, curve.points, x);
}

export function evaluateManualContrastCurve(
  mode: ContrastCurveMode,
  points: ContrastCurvePoint[],
  x: number,
): number {
  const normalizedPoints = normalizePoints(points);

  if (mode === "bezier") {
    return evaluateBezierCurve(normalizedPoints, x);
  }

  const index = findSegmentIndex(normalizedPoints, x);
  const start = normalizedPoints[index];
  const end = normalizedPoints[index + 1];
  const t = start.x === end.x ? 0 : clamp01((x - start.x) / (end.x - start.x));

  if (mode === "cubic") {
    const easedT = t * t * (3 - 2 * t);
    return lerp(start.y, end.y, easedT);
  }

  return lerp(start.y, end.y, t);
}

// ── Designed contrast math (Inigo Quilez-style) ───────────────────────────

function iiqGain(x: number, k: number): number {
  const safeX = clamp01(x);
  const a = 0.5 * Math.pow(2 * (safeX < 0.5 ? safeX : 1 - safeX), k);
  return safeX < 0.5 ? a : 1 - a;
}

function parabola(x: number, k: number): number {
  return Math.pow(Math.max(0, 4 * x * (1 - x)), k);
}

function pcurve(x: number, a: number, b: number): number {
  const safeX = clamp01(x);
  if (safeX <= 0 || safeX >= 1) return 0;
  const safeA = Math.max(0.001, a);
  const safeB = Math.max(0.001, b);
  const k =
    Math.pow(safeA + safeB, safeA + safeB) / (Math.pow(safeA, safeA) * Math.pow(safeB, safeB));
  return k * Math.pow(safeX, safeA) * Math.pow(1 - safeX, safeB);
}

function almostUnitIdentity(x: number): number {
  return x * x * (2 - x);
}

function expImpulse(x: number, k: number): number {
  const h = k * x;
  return h * Math.exp(1 - h);
}

function cubicPulse(c: number, w: number, x: number): number {
  let dx = Math.abs(x - c);
  if (dx > w) return 0;
  dx /= w;
  return 1 - dx * dx * (3 - 2 * dx);
}

// ── Manual curve helpers ──────────────────────────────────────────────────

function evaluateBezierCurve(points: ContrastCurvePoint[], x: number): number {
  const samples = 96;
  let previous = deCasteljau(points, 0);

  if (x <= previous.x) {
    return previous.y;
  }

  for (let index = 1; index <= samples; index += 1) {
    const t = index / samples;
    const current = deCasteljau(points, t);

    if (x <= current.x) {
      const span = current.x - previous.x;
      const localT = span === 0 ? 0 : clamp01((x - previous.x) / span);
      return lerp(previous.y, current.y, localT);
    }

    previous = current;
  }

  return previous.y;
}

function deCasteljau(points: ContrastCurvePoint[], t: number): ContrastCurvePoint {
  const working = points.map((point) => ({ ...point }));

  for (let level = working.length - 1; level > 0; level -= 1) {
    for (let index = 0; index < level; index += 1) {
      working[index] = {
        x: lerp(working[index].x, working[index + 1].x, t),
        y: lerp(working[index].y, working[index + 1].y, t),
      };
    }
  }

  return working[0];
}

function normalizePoints(points: ContrastCurvePoint[]) {
  const deduped = points
    .slice(0, 7)
    .map((point) => ({
      x: clamp01(point.x),
      y: clampContrast(point.y),
    }))
    .sort((left, right) => left.x - right.x)
    .filter((point, index, list) => index === 0 || point.x !== list[index - 1].x);

  if (deduped.length < 2) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
  }

  deduped[0] = { ...deduped[0], x: 0 };
  deduped[deduped.length - 1] = { ...deduped[deduped.length - 1], x: 1 };

  return deduped;
}

function findSegmentIndex(points: ContrastCurvePoint[], x: number) {
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

function clampContrast(value: number) {
  return Math.min(CONTRAST_CURVE_MAX, Math.max(CONTRAST_CURVE_MIN, value));
}
