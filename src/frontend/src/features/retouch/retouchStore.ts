import { createSignal } from "solid-js";
import { createRetouchSpotId, MAX_RETOUCH_SPOTS, type RetouchSpot } from "./retouchTypes";

export type RetouchViewportMetrics = {
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  cropWidth: number;
  cropHeight: number;
};

const [selectedSpot, setSelectedSpot] = createSignal<number | null>(null);
const [hoveredSpot, setHoveredSpot] = createSignal<number | null>(null);
const [panMode, setPanMode] = createSignal(false);
const [viewportMetrics, setViewportMetrics] = createSignal<RetouchViewportMetrics>({
  imageWidth: 1,
  imageHeight: 1,
  zoom: 1,
  cropWidth: 1,
  cropHeight: 1,
});

export {
  selectedSpot,
  setSelectedSpot,
  hoveredSpot,
  setHoveredSpot,
  panMode,
  setPanMode,
  viewportMetrics,
  setViewportMetrics,
};

export function createRetouchSpot(metrics = viewportMetrics()): RetouchSpot {
  const width = Math.max(1, metrics.imageWidth);
  const height = Math.max(1, metrics.imageHeight);
  const textureAspect = height / width;
  const zoomCompensation = 1 / Math.max(1, metrics.zoom);
  const cropExtent = Math.min(
    Math.max(0.01, metrics.cropWidth),
    Math.max(0.01, metrics.cropHeight),
  );
  const baseSize = 0.2 * zoomCompensation;
  const position: [number, number] = [0, 0];

  return {
    id: createRetouchSpotId(),
    type: "spot",
    feather: 0.4,
    size: [
      Math.max(0.01, baseSize * textureAspect * cropExtent),
      Math.max(0.01, baseSize * cropExtent),
    ],
    position,
    sourcePosition: [position[0] + baseSize, position[1] + baseSize],
    angle: 0,
    opacity: 1,
    mode: 1,
  };
}

export function canAddRetouchSpot(count: number): boolean {
  return count < MAX_RETOUCH_SPOTS;
}
