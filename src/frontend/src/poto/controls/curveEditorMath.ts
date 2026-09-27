export type CurvePointModel = {
  x: number;
  y: number;
};

export type CurveInterpolationMode = "cubic" | "bezier" | "linear";

export const CURVE_INTERPOLATION_ORDER: CurveInterpolationMode[] = ["cubic", "bezier", "linear"];

export const LOW_CONTRAST_TEMPLATE_5: CurvePointModel[] = [
  { x: 0, y: 0 },
  { x: 0.133, y: 0.25 },
  { x: 0.371, y: 0.435 },
  { x: 0.868, y: 0.776 },
  { x: 1, y: 1 },
];

export const HIGH_CONTRAST_TEMPLATE_5: CurvePointModel[] = [
  { x: 0, y: 0 },
  { x: 0.279, y: 0.178 },
  { x: 0.433, y: 0.503 },
  { x: 0.734, y: 0.929 },
  { x: 1, y: 1 },
];

export function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clonePoints(points: readonly CurvePointModel[]) {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

export function normalizeCurvePoints(points: readonly CurvePointModel[], wrapAround = false) {
  const next = points
    .slice(0, 7)
    .map((point) => ({
      x: clamp01(point.x),
      y: point.y,
    }))
    .sort((left, right) => left.x - right.x);

  if (next.length === 0) return next;

  if (wrapAround && next.length > 1) {
    next[next.length - 1] = { ...next[next.length - 1], y: next[0].y };
  }

  return next;
}

export function averageCurveY(points: readonly CurvePointModel[]) {
  if (points.length === 0) return 0.5;
  return points.reduce((sum, point) => sum + point.y, 0) / points.length;
}

export function offsetCurveY(
  points: readonly CurvePointModel[],
  delta: number,
  wrapAround = false,
) {
  const next = points.map((point) => ({
    x: clamp01(point.x),
    y: clamp01(point.y + delta),
  }));
  return normalizeCurvePoints(next, wrapAround);
}

export function constrainDraggedCurvePoint(
  points: readonly CurvePointModel[],
  index: number,
  nextPoint: CurvePointModel,
  options: {
    lockX?: boolean;
    lockY?: boolean;
    wrapAround?: boolean;
    pointSizePx?: number;
    widthPx?: number;
  } = {},
) {
  const next = normalizeCurvePoints(points, !!options.wrapAround);
  const current = next[index];
  if (!current) return next;

  const lastIndex = next.length - 1;
  const isWrapEnd = !!options.wrapAround && (index === 0 || index === lastIndex);
  const gap = Math.max(0, options.pointSizePx ?? 0) / Math.max(1, options.widthPx ?? 1);
  const leftBound = index > 0 ? next[index - 1].x + gap : 0;
  const rightBound = index < lastIndex ? next[index + 1].x - gap : 1;

  const x =
    options.lockX || isWrapEnd ? current.x : clamp01(clamp(nextPoint.x, leftBound, rightBound));
  const y = options.lockY ? current.y : nextPoint.y;
  next[index] = { x, y };

  if (options.wrapAround && next.length > 1 && (index === 0 || index === lastIndex)) {
    next[0] = { ...next[0], y };
    next[lastIndex] = { ...next[lastIndex], y };
  }

  // `next` started normalized and X is constrained between its existing
  // neighbours, so a second clone/sort/normalize pass only adds drag latency.
  return next;
}

export function defaultPointResetY(defaultPoints: readonly CurvePointModel[], x: number) {
  return defaultPoints.length > 0 && defaultPoints.every((point) => point.x === point.y)
    ? clamp01(x)
    : 0.5;
}

export function cycleCurveInterpolation(mode: CurveInterpolationMode) {
  const index = CURVE_INTERPOLATION_ORDER.indexOf(mode);
  return CURVE_INTERPOLATION_ORDER[(index + 1) % CURVE_INTERPOLATION_ORDER.length];
}

export function resampleCurvePointCount(
  count: number,
  currentPoints: readonly CurvePointModel[],
  lutImageData: ArrayLike<number>,
  stride: number,
  channel: number,
) {
  const points = normalizeCurvePoints(currentPoints);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  if (count <= 2) return [first, last];

  const innerCount = count - 2;
  const startX = first.x;
  const step = (last.x - startX) / (innerCount + 1);
  const sampleCount = Math.max(1, Math.floor(lutImageData.length / stride));
  const result: CurvePointModel[] = [first];

  for (let i = 1; i <= innerCount; i += 1) {
    const x = clamp01(startX + step * i);
    const offset = Math.round(x * (sampleCount - 1)) * stride + channel;
    result.push({ x, y: clamp01(Number(lutImageData[offset] ?? 0)) });
  }

  result.push(last);
  return result;
}

export function renderCurveLutData(
  points: readonly CurvePointModel[],
  sample: (points: readonly CurvePointModel[], x: number) => number,
  sampleCount = 256,
  stride = 4,
  channel = 0,
) {
  const data = new Float32Array(sampleCount * stride);
  for (let i = 0; i < sampleCount; i += 1) {
    const x = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    data[i * stride + channel] = clamp01(sample(points, x));
  }
  return data;
}

export function contrastTemplatesForCount(
  count: number,
  sample: (points: readonly CurvePointModel[], x: number) => number,
) {
  if (count === 2) {
    return {
      low: [
        { x: 0, y: 0.2 },
        { x: 1, y: 0.8 },
      ],
      high: [
        { x: 0.2, y: 0 },
        { x: 0.8, y: 1 },
      ],
    };
  }

  if (count === 3) {
    return {
      low: [
        { x: 0, y: 0.2 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.8 },
      ],
      high: [
        { x: 0.2, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 0.8, y: 1 },
      ],
    };
  }

  const lowLut = renderCurveLutData(LOW_CONTRAST_TEMPLATE_5, sample);
  const highLut = renderCurveLutData(HIGH_CONTRAST_TEMPLATE_5, sample);
  return {
    low: resampleCurvePointCount(count, LOW_CONTRAST_TEMPLATE_5, lowLut, 4, 0),
    high: resampleCurvePointCount(count, HIGH_CONTRAST_TEMPLATE_5, highLut, 4, 0),
  };
}

export function morphContrastPoints(
  basePoints: readonly CurvePointModel[],
  sliderValue: number,
  lowTemplate: readonly CurvePointModel[],
  highTemplate: readonly CurvePointModel[],
) {
  const value = clamp01(sliderValue);
  const towardHigh = value > 0.5;
  const strength = towardHigh ? 2 * (value - 0.5) : 1 - 2 * value;
  const target = towardHigh ? highTemplate : lowTemplate;

  return basePoints.map((base, index) => {
    const to = target[index] ?? base;
    return {
      x: clamp01(lerp(base.x, to.x, strength)),
      y: clamp01(lerp(base.y, to.y, strength)),
    };
  });
}

function clamp(value: number, lo: number, hi: number) {
  return value < lo ? lo : value > hi ? hi : value;
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}
