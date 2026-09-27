import type { ViewerApi } from "../../ui/Viewer";
import type { EditorOverlayMask } from "../../features/overlays/editorOverlayTypes";
import { validateDepthMaskCreation } from "../../features/masking/depthMaskCapability";

export type OverlayMaskType = "brush" | "eraser" | "radial" | "gradient" | "color" | "luminance" | "depth";

let sequence = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

export function createOverlayMask(type: OverlayMaskType, viewerApi?: ViewerApi): EditorOverlayMask | null {
  if (type === "depth" && !validateDepthMaskCreation().ok) return null;
  if (type === "brush" || type === "eraser") {
    const initialBrush = type === "eraser" ? [{
      id: id("overlay-eraser-base"), mode: "mask" as const,
      points: [{ x: 0.5, y: 0.5, pressure: 1, time: Date.now() }],
      radius: 2, opacity: 1, hardness: 1, masking: 0,
      spacing: 1, interpolate: false, randomize: 0,
    }] : null;
    return {
      id: id("overlay-brush"), type: "brush", brush: initialBrush,
      brush_radius: 0.15, brush_opacity: 0.8, brush_hardness: 0,
      brush_masking: 0, brush_erase: type === "eraser",
      invert: false, opacity: 1, alpha: 1, mode: "mask", showOverlay: true,
    };
  }
  if (type === "gradient") {
    return {
      id: id("overlay-gradient"), type: "gradient",
      startPoint: [0.5, 0.75], endPoint: [0.5, 0.25], reflect: false,
      invert: false, opacity: 1, alpha: 1, showOverlay: true,
    };
  }
  if (type === "luminance") {
    return {
      id: id("overlay-luminance"), type: "luminance", target: 1,
      range: 0.7, smoothness: 1, invert: false, opacity: 1, alpha: 1, showOverlay: true,
    };
  }
  if (type === "depth") {
    return {
      id: id("overlay-depth"), type: "depth", target: 1, range: 0.25,
      invert: false, opacity: 1, alpha: 1, showOverlay: true,
    };
  }
  const radial = type === "radial";
  let sampledColor: [number, number, number] = [0.5, 0.5, 0.5];
  let useSelectedColor = false;
  if (!radial && viewerApi) {
    const point = viewerApi.imageUVToCanvasRelative(0.5, 0.5);
    const rect = viewerApi.getCanvasClientRect();
    if (point && rect) {
      const sampled = viewerApi.readDisplayPixelAtClient(rect.left + point.x, rect.top + point.y);
      if (sampled) {
        sampledColor = [sampled[0], sampled[1], sampled[2]];
        useSelectedColor = true;
      }
    }
  }
  return {
    id: id(`overlay-${type}`), type: radial ? "radial" : "color-pick",
    sampleX: 0.5, sampleY: 0.5, position: [0.5, 0.5], size: radial ? [0.55, 0.55] : [0.25, 0.25],
    angle: 0, useRadius: radial, sampledColor, selectedColor: sampledColor,
    useSelectedColor, threshold: 0.25, feather: 1,
    invert: radial, opacity: 1, alpha: 1, showOverlay: true,
  };
}

export function overlayMaskLabel(mask: EditorOverlayMask | null | undefined): string {
  if (!mask) return "No mask";
  const brushLabel = mask.type === "brush" && mask.brush_erase ? "Eraser Mask" : "Brush Mask";
  const labels: Record<EditorOverlayMask["type"], string> = {
    "color-pick": "Color Mask", luminosity: "Luminosity Mask", radial: "Radial Mask",
    gradient: "Linear Gradient", brush: brushLabel,
    luminance: "Luminance Mask", depth: "Depth Mask",
  };
  return labels[mask.type];
}
