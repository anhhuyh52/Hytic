import type { GradientStop, OverlayLayer } from "./overlayTypes";
import { createOverlayId } from "./overlayIds";

export { createOverlayId } from "./overlayIds";

export const DEFAULT_GRADIENT_STOPS = (): GradientStop[] => [
  { id: createOverlayId(), position: 0, color: [0, 0, 0, 1] },
  { id: createOverlayId(), position: 1, color: [1, 1, 1, 1] },
];

export const DEFAULT_IMAGE_OVERLAY: Omit<OverlayLayer, "id"> = {
  name: "Overlay",
  category: "custom",
  sourceType: "file",
  sourceId: null,
  textureId: null,
  position: [0.5, 0.5],
  scale: [1, 1],
  angle: 0,
  blendMode: "SCREEN",
  fill: 1,
  opacity: 1,
  gradientType: "none",
  gradientStops: [],
  reverse: false,
  reflect: false,
  repeat: false,
  maskId: null,
  disabled: false,
  visible: true,
};
