import type { OverlayLayer, OverlayState } from "./overlayTypes";

export function selectedOverlay(state: OverlayState): OverlayLayer | undefined {
  return state.layers.find((layer) => layer.id === state.selectedLayerId);
}

export function renderableOverlays(state: Pick<OverlayState, "layers">): OverlayLayer[] {
  return state.layers.filter((layer) => layer.visible && !layer.disabled && layer.fill > 0 && layer.opacity > 0);
}
