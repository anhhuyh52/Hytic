import { cloneRetouchSpot, type RetouchSpot } from "./retouchTypes";

export type RetouchPoint = { x: number; y: number };

export function moveRetouchSpot(
  startSpot: RetouchSpot,
  startPointer: RetouchPoint,
  pointer: RetouchPoint,
  target: "destination" | "source",
): RetouchSpot {
  const next = cloneRetouchSpot(startSpot);
  const start = target === "destination" ? startSpot.position : startSpot.sourcePosition;
  const position = target === "destination" ? next.position : next.sourcePosition;
  position[0] = clampCentered(start[0] + pointer.x - startPointer.x);
  position[1] = clampCentered(start[1] + pointer.y - startPointer.y);
  return next;
}

export function resizeRotateRetouchSpot(
  startSpot: RetouchSpot,
  startDistance: number,
  startAngle: number,
  distance: number,
  angle: number,
): RetouchSpot {
  const next = cloneRetouchSpot(startSpot);
  const scale = distance / Math.max(0.0001, startDistance);
  next.angle = startSpot.angle + shortestAngleDelta(startAngle, angle);
  next.size = scaleRetouchSize(startSpot.size, scale);
  return next;
}

export function pinchRetouchSpot(startSpot: RetouchSpot, scale: number): RetouchSpot {
  const next = cloneRetouchSpot(startSpot);
  next.size = scaleRetouchSize(startSpot.size, scale);
  return next;
}

export function ellipseBoundaryPoint(
  center: RetouchPoint,
  radiusX: number,
  radiusY: number,
  rotationDegrees: number,
  toward: RetouchPoint,
): RetouchPoint {
  const radians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const localX = cosine * dx + sine * dy;
  const localY = -sine * dx + cosine * dy;
  const safeRadiusX = Math.max(0.0001, radiusX);
  const safeRadiusY = Math.max(0.0001, radiusY);
  const denominator = Math.sqrt(
    (localX * localX) / (safeRadiusX * safeRadiusX) +
      (localY * localY) / (safeRadiusY * safeRadiusY),
  );
  if (denominator <= 0.0001) return { ...center };
  const boundaryX = localX / denominator;
  const boundaryY = localY / denominator;
  return {
    x: center.x + cosine * boundaryX - sine * boundaryY,
    y: center.y + sine * boundaryX + cosine * boundaryY,
  };
}

export function clientDistance(a: RetouchPoint, b: RetouchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function scaleRetouchSize(size: readonly [number, number], scale: number): [number, number] {
  const safeScale = Number.isFinite(scale) ? Math.max(0.01, scale) : 1;
  return [Math.max(0.01, size[0] * safeScale), Math.max(0.01, size[1] * safeScale)];
}

function shortestAngleDelta(start: number, end: number): number {
  let delta = end - start;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function clampCentered(value: number): number {
  return Math.max(-0.5, Math.min(0.5, value));
}
