import { createStore, produce } from "solid-js/store";
import { createOverlayId, DEFAULT_GRADIENT_STOPS, DEFAULT_IMAGE_OVERLAY } from "./overlayDefaults";
import { sanitizeTransform } from "./overlayMath";
import type { GradientStop, OverlayBlendMode, OverlayGradientType, OverlayLayer, OverlayState, OverlayTransformPatch } from "./overlayTypes";

export const [overlayState, setOverlayState] = createStore<OverlayState>({
  layers: [], selectedLayerId: null, isEditing: false, isPanMode: false,
  isConfirmMode: false, openMenu: null,
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const layerIndex = (id: string) => overlayState.layers.findIndex((layer) => layer.id === id);

export function addOverlay(layer: OverlayLayer): void {
  setOverlayState("layers", (layers) => [...layers, layer]);
  setOverlayState({ selectedLayerId: layer.id, isEditing: true });
}

export function createImageOverlay(patch: Partial<Omit<OverlayLayer, "id">> = {}): OverlayLayer {
  const layer: OverlayLayer = { ...DEFAULT_IMAGE_OVERLAY, ...patch, id: createOverlayId(), position: patch.position ?? [0.5, 0.5], scale: patch.scale ?? [1, 1], gradientStops: patch.gradientStops?.map((stop) => ({ ...stop, color: [...stop.color] })) ?? [] };
  addOverlay(layer);
  return layer;
}

export function createGradientOverlay(type: Exclude<OverlayGradientType, "none"> = "linear"): OverlayLayer {
  return createImageOverlay({ name: "Gradient", category: "gradient", sourceType: "gradient", blendMode: "NORMAL", gradientType: type, gradientStops: DEFAULT_GRADIENT_STOPS() });
}

export function updateOverlay(id: string, patch: Partial<Omit<OverlayLayer, "id">>): void {
  const index = layerIndex(id);
  if (index >= 0) setOverlayState("layers", index, patch);
}

export function updateOverlayTransform(id: string, patch: OverlayTransformPatch): void {
  const index = layerIndex(id);
  if (index < 0) return;
  setOverlayState("layers", index, sanitizeTransform(patch));
}

export function deleteOverlay(id: string): OverlayLayer | undefined {
  const removed = overlayState.layers.find((layer) => layer.id === id);
  setOverlayState("layers", (layers) => layers.filter((layer) => layer.id !== id));
  if (overlayState.selectedLayerId === id) setOverlayState({ selectedLayerId: null, isEditing: false });
  return removed;
}

export function duplicateOverlay(id: string): OverlayLayer | undefined {
  const source = overlayState.layers.find((layer) => layer.id === id);
  if (!source) return;
  const copy: OverlayLayer = { ...source, id: createOverlayId(), name: `${source.name} copy`, position: [source.position[0] + 0.02, source.position[1] + 0.02], scale: [...source.scale], gradientStops: source.gradientStops.map((stop) => ({ ...stop, color: [...stop.color] })) };
  addOverlay(copy);
  return copy;
}

export const selectOverlay = (id: string) => setOverlayState({ selectedLayerId: id, isEditing: true });
export const clearOverlaySelection = () => setOverlayState({ selectedLayerId: null, isEditing: false, openMenu: null });
export const moveOverlay = (id: string, position: [number, number]) => updateOverlayTransform(id, { position });
export const resizeOverlay = (id: string, scale: [number, number]) => updateOverlayTransform(id, { scale });
export const rotateOverlay = (id: string, angle: number) => updateOverlayTransform(id, { angle });
export const flipOverlayX = (id: string) => { const layer = overlayState.layers[layerIndex(id)]; if (layer) resizeOverlay(id, [-layer.scale[0], layer.scale[1]]); };
export const flipOverlayY = (id: string) => { const layer = overlayState.layers[layerIndex(id)]; if (layer) resizeOverlay(id, [layer.scale[0], -layer.scale[1]]); };
export const resetOverlayTransform = (id: string, initialScale: [number, number] = [1, 1]) => updateOverlayTransform(id, { position: [0.5, 0.5], scale: initialScale, angle: 0 });
export const setOverlayBlendMode = (id: string, blendMode: OverlayBlendMode) => updateOverlay(id, { blendMode });
export const setOverlayFill = (id: string, fill: number) => updateOverlay(id, { fill: clamp01(fill) });
export const setOverlayOpacity = (id: string, opacity: number) => updateOverlay(id, { opacity: clamp01(opacity) });
export const setOverlayGradientType = (id: string, gradientType: OverlayGradientType) => updateOverlay(id, { gradientType });
export const setOverlayMask = (id: string, maskId: string) => updateOverlay(id, { maskId });
export const removeOverlayMask = (id: string) => updateOverlay(id, { maskId: null });
export const disableOverlay = (id: string) => updateOverlay(id, { disabled: true });
export const enableOverlay = (id: string) => updateOverlay(id, { disabled: false });

export function setGradientStops(id: string, stops: GradientStop[]): void {
  updateOverlay(id, { gradientStops: stops.map((stop) => ({ ...stop, position: clamp01(stop.position), color: [...stop.color] as GradientStop["color"] })).sort((a, b) => a.position - b.position) });
}
export function addGradientStop(id: string, position: number, color: GradientStop["color"] = [1, 1, 1, 1]): string {
  const stopId = createOverlayId();
  const layer = overlayState.layers[layerIndex(id)];
  if (layer) setGradientStops(id, [...layer.gradientStops, { id: stopId, position, color }]);
  return stopId;
}
export function removeGradientStop(id: string, stopId: string): void {
  const layer = overlayState.layers[layerIndex(id)];
  if (layer && layer.gradientStops.length > 1) setGradientStops(id, layer.gradientStops.filter((stop) => stop.id !== stopId));
}
export function moveGradientStop(id: string, stopId: string, position: number): void {
  const layer = overlayState.layers[layerIndex(id)];
  if (layer) setGradientStops(id, layer.gradientStops.map((stop) => stop.id === stopId ? { ...stop, position } : stop));
}
export function setGradientStopColor(id: string, stopId: string, color: GradientStop["color"]): void {
  const index = layerIndex(id);
  if (index < 0) return;
  setOverlayState("layers", index, "gradientStops", produce((stops) => { const stop = stops.find((item) => item.id === stopId); if (stop) stop.color = [...color]; }));
}
