import type { OverlayTransformPatch } from "./overlayTypes";

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 20;

export function clampScale(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.abs(value)));
}

export function normalizeAngle(angle: number): number {
  const normalized = angle % 360;
  return normalized <= -180 ? normalized + 360 : normalized > 180 ? normalized - 360 : normalized;
}

export function sanitizeTransform(patch: OverlayTransformPatch): OverlayTransformPatch {
  return {
    ...(patch.position && { position: [patch.position[0], patch.position[1]] }),
    ...(patch.scale && { scale: [clampScale(patch.scale[0]), clampScale(patch.scale[1])] }),
    ...(patch.angle !== undefined && { angle: normalizeAngle(patch.angle) }),
  };
}

/** Converts an image-space delta into the layer's local (unrotated) axes. */
export function rotateDeltaToLocal(dx: number, dy: number, angleDegrees: number): [number, number] {
  const radians = -angleDegrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [dx * c - dy * s, dx * s + dy * c];
}
