import type { GradientOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import type { ViewerApi } from "../../ui/Viewer";

export const MIN_GRADIENT_SCALE = 0.0001;

export type GradientHandle = "n" | "e" | "s" | "w";
export type TransformPatch = Pick<GradientOverlayLayer, "position" | "scale" | "angle">;

export function imageAspectFromViewer(api: ViewerApi): number | null {
  const origin = api.imageUVToCanvasRelative(0, 0);
  const xEdge = api.imageUVToCanvasRelative(1, 0);
  const yEdge = api.imageUVToCanvasRelative(0, 1);
  if (!origin || !xEdge || !yEdge) return null;
  const width = Math.hypot(xEdge.x - origin.x, xEdge.y - origin.y);
  const height = Math.hypot(yEdge.x - origin.x, yEdge.y - origin.y);
  return width > 0 && height > 0 ? width / height : null;
}

export function linearEndpointUv(
  layer: GradientOverlayLayer,
  handle: "e" | "w",
  imageAspect: number,
): [number, number] {
  const radians = layer.angle * Math.PI / 180;
  const direction = handle === "e" ? 1 : -1;
  const halfLength = Math.abs(layer.scale[0]) * 0.5 * direction;
  return [
    layer.position[0] + Math.cos(radians) * halfLength,
    layer.position[1] + Math.sin(radians) * halfLength * imageAspect,
  ];
}

export function radialHandleUv(
  layer: GradientOverlayLayer,
  handle: GradientHandle,
  imageAspect: number,
): [number, number] {
  const radians = layer.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  if (handle === "e" || handle === "w") {
    const direction = handle === "e" ? 1 : -1;
    const halfWidth = Math.abs(layer.scale[0]) * 0.5 * direction;
    return [
      layer.position[0] + cos * halfWidth,
      layer.position[1] + sin * halfWidth * imageAspect,
    ];
  }
  const direction = handle === "s" ? 1 : -1;
  const halfHeight = Math.abs(layer.scale[1]) * 0.5 * direction;
  return [
    layer.position[0] - sin * halfHeight / imageAspect,
    layer.position[1] + cos * halfHeight,
  ];
}

function pixelVector(
  from: [number, number],
  to: [number, number],
  imageAspect: number,
): [number, number] {
  return [to[0] - from[0], (to[1] - from[1]) / imageAspect];
}

function vectorAngle(vector: [number, number]): number {
  return Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
}

function vectorLength(vector: [number, number]): number {
  return Math.max(MIN_GRADIENT_SCALE, Math.hypot(vector[0], vector[1]));
}

export function resizeLinearFromEndpoint(
  layer: GradientOverlayLayer,
  handle: "e" | "w",
  pointer: [number, number],
  imageAspect: number,
): TransformPatch {
  const fixedHandle = handle === "e" ? "w" : "e";
  const fixed = linearEndpointUv(layer, fixedHandle, imageAspect);
  const from = handle === "e" ? fixed : pointer;
  const to = handle === "e" ? pointer : fixed;
  const vector = pixelVector(from, to, imageAspect);
  return {
    position: [(fixed[0] + pointer[0]) * 0.5, (fixed[1] + pointer[1]) * 0.5],
    scale: [vectorLength(vector), layer.scale[1]],
    angle: vectorAngle(vector),
  };
}

export function resizeRadialFromHandle(
  layer: GradientOverlayLayer,
  handle: GradientHandle,
  pointer: [number, number],
  imageAspect: number,
  modifiers: { alt: boolean; shift: boolean; constrainRotation: boolean },
): TransformPatch {
  const opposite: Record<GradientHandle, GradientHandle> = { n: "s", e: "w", s: "n", w: "e" };
  const fixed = modifiers.alt ? layer.position : radialHandleUv(layer, opposite[handle], imageAspect);
  const from = handle === "e" || handle === "s" ? fixed : pointer;
  const to = handle === "e" || handle === "s" ? pointer : fixed;
  const vector = pixelVector(from, to, imageAspect);
  const centeredMultiplier = modifiers.alt ? 2 : 1;
  let angle = vectorAngle(vector) - (handle === "n" || handle === "s" ? 90 : 0);
  if (modifiers.constrainRotation) angle = layer.angle;
  const nextPosition: [number, number] = modifiers.alt
    ? [...layer.position]
    : [(fixed[0] + pointer[0]) * 0.5, (fixed[1] + pointer[1]) * 0.5];
  const scale: [number, number] = [...layer.scale];
  if (handle === "e" || handle === "w") {
    scale[0] = vectorLength(vector) * centeredMultiplier;
    if (modifiers.shift) {
      const ratio = Math.abs(layer.scale[0] / layer.scale[1]) || 1;
      scale[1] = scale[0] / ratio;
    }
  } else {
    scale[1] = vectorLength(vector) * imageAspect * centeredMultiplier;
    if (modifiers.shift) {
      const ratio = Math.abs(layer.scale[0] / layer.scale[1]) || 1;
      scale[0] = scale[1] * ratio;
    }
  }
  return { position: nextPosition, scale, angle };
}
