export type HexagonalSliderPoint = [number, number];

export const DISTANCE_RANGE = 3.333;
export const DISTANCE_EASING = 1.8;
export const CONTROL_SIZE = 190;
export const POINT_SIZE = 18;
export const INLAY_PADDING = 4;
export const VIEWBOX_SIZE = 100;
export const CENTER = VIEWBOX_SIZE / 2;

export type HexagonalSliderDragBounds = {
  angle: number;
  previous: number;
  next: number;
  initialRadius: number;
};

export function clamp(min: number, max: number, value: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function unwrapNear(angle: number, reference: number) {
  return reference + ((((angle - reference) % 360) + 540) % 360) - 180;
}

export function cloneHexagonalSliderPoints(points: HexagonalSliderPoint[]): HexagonalSliderPoint[] {
  return points.map((point) => [point[0], point[1]]);
}

export function getHexagonalSliderGeometry(renderSize: number) {
  const pxToUnits = VIEWBOX_SIZE / Math.max(renderSize, 1);
  const pointRadius = (POINT_SIZE / 2) * pxToUnits;
  return {
    pointRadius,
    // Legacy clamps the handle center to the host radius; the handle can overhang.
    usableRadius: CENTER,
    inlayRadius: CENTER - (INLAY_PADDING / 2) * pxToUnits,
  };
}

/** Legacy polar convention: 0 degrees is up and angles increase clockwise. */
export function hexagonalSliderPointToXY(point: HexagonalSliderPoint, usableRadius: number) {
  const theta = (point[0] * Math.PI) / 180;
  const radius =
    Math.pow(clamp(0, DISTANCE_RANGE, point[1]) / DISTANCE_RANGE, 1 / DISTANCE_EASING) *
    usableRadius;
  return {
    x: CENTER + Math.sin(theta) * radius,
    y: CENTER - Math.cos(theta) * radius,
  };
}

/**
 * Port of legacy Xg.Le: circular radial clamp plus ordered-neighbour angle clamp.
 * The visual six-sided web is not a geometric input boundary in package.min.js.
 */
export function hexagonalSliderPointerToPoint(
  rawX: number,
  rawY: number,
  usableRadius: number,
  bounds: HexagonalSliderDragBounds,
  shiftKey = false,
  altKey = false,
): HexagonalSliderPoint | null {
  if (shiftKey && altKey) return null;

  let x = rawX;
  let y = rawY;
  let radius = Math.hypot(x, y);

  if (shiftKey) {
    if (radius > 0) {
      const scale = bounds.initialRadius / radius;
      x *= scale;
      y *= scale;
      radius = bounds.initialRadius;
    }
  } else if (radius > usableRadius) {
    const scale = usableRadius / radius;
    x *= scale;
    y *= scale;
    radius = usableRadius;
  }

  // Avoid turning the center's +0 Y into -0: legacy atan2(0, 0) resolves to 0°.
  const upwardY = y === 0 ? 0 : -y;
  let angle = normalizeAngle((Math.atan2(x, upwardY) * 180) / Math.PI);
  const current = normalizeAngle(bounds.angle);
  let previous = unwrapNear(normalizeAngle(bounds.previous), current);
  let next = unwrapNear(normalizeAngle(bounds.next), current);
  while (previous > current) previous -= 360;
  while (next < current) next += 360;

  let projected = false;
  if (altKey) {
    angle = current;
    projected = true;
  } else {
    const unwrapped = unwrapNear(angle, current);
    const constrained = clamp(previous, next, unwrapped);
    projected = constrained !== unwrapped;
    angle = constrained;
  }

  if (projected) {
    const theta = (angle * Math.PI) / 180;
    const ux = Math.sin(theta);
    const uy = -Math.cos(theta);
    radius = clamp(0, usableRadius, x * ux + y * uy);
  }

  return [
    normalizeAngle(angle),
    Math.pow(clamp(0, 1, radius / usableRadius), DISTANCE_EASING) * DISTANCE_RANGE,
  ];
}
