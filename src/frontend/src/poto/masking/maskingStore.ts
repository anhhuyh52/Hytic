import { createSignal } from "solid-js";
import { editState, setEditState } from "../../app/editor-store";
import type { ViewerApi } from "../../ui/Viewer";
import { validateDepthMaskCreation } from "../../features/masking/depthMaskCapability";
import {
  type LocalAdjustmentLayer,
  type BrushMaskComponent,
  type DepthMaskComponent,
  cloneColorState,
  DEFAULT_COLOR_STATE,
} from "../../engine/state/EditState";

export const [selectedMaskId, setSelectedMaskId] = createSignal<string | null>(null);
export const [overlayActive, setOverlayActive] = createSignal(false);
export const [overlayAlwaysOn, setOverlayAlwaysOn] = createSignal(false);
let overlayTimeout: ReturnType<typeof setTimeout> | null = null;

/** Reactive: returns the component type of the currently selected mask, or null. */
export function selectedMaskComponentType(): string | null {
  const id = selectedMaskId();
  if (!id || !editState.localAdjustments) return null;
  const layer = editState.localAdjustments.find((l) => l.id === id);
  return layer?.components[0]?.type ?? null;
}

const DEFAULT_SAMPLE_COLOR: [number, number, number] = [1, 0, 0];
let maskIdCounter = 0;

function uniqueMaskId(prefix: string): string {
  maskIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${maskIdCounter.toString(36)}`;
}

function normalizeRgbTuple(color: number[] | null | undefined): [number, number, number] {
  if (!color || color.length < 3) return DEFAULT_SAMPLE_COLOR;

  const max = Math.max(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
  const scale = max > 1 ? 1 / 255 : 1;

  return [
    Math.max(0, Math.min(1, (color[0] ?? DEFAULT_SAMPLE_COLOR[0]) * scale)),
    Math.max(0, Math.min(1, (color[1] ?? DEFAULT_SAMPLE_COLOR[1]) * scale)),
    Math.max(0, Math.min(1, (color[2] ?? DEFAULT_SAMPLE_COLOR[2]) * scale)),
  ];
}

export function addColorMask(viewerApi?: ViewerApi): string {
  const sampleUV: [number, number] = [0.5, 0.5];
  let sampledColor: [number, number, number] | null = null;
  let radiusSize: [number, number] = [0.25, 0.25];

  if (viewerApi) {
    const samplePos = viewerApi.imageUVToCanvasRelative(sampleUV[0], sampleUV[1]);
    const rect = viewerApi.getCanvasClientRect();
    if (rect && samplePos) {
      const clientX = rect.left + samplePos.x;
      const clientY = rect.top + samplePos.y;
      const color = viewerApi.readDisplayPixelAtClient(clientX, clientY);
      if (color) {
        // Engine.readDisplayPixelAtClient already returns normalized RGB [0..1].
        // Keep this tolerant in case another ViewerApi implementation returns [0..255].
        sampledColor = normalizeRgbTuple(color);
      }
    }

    const origin = viewerApi.imageUVToCanvasRelative(0, 0);
    const xEdge = viewerApi.imageUVToCanvasRelative(1, 0);
    const yEdge = viewerApi.imageUVToCanvasRelative(0, 1);
    if (origin && xEdge && yEdge) {
      const width = Math.hypot(xEdge.x - origin.x, xEdge.y - origin.y);
      const height = Math.hypot(yEdge.x - origin.x, yEdge.y - origin.y);
      if (width > 0 && height > 0) {
        const radius = Math.min(width, height) * 0.25;
        radiusSize = [radius / width, radius / height];
      }
    }
  }

  const initialColor = sampledColor ?? ([0.5, 0.5, 0.5] as [number, number, number]);
  const newMaskId = uniqueMaskId("mask");
  const newMask: LocalAdjustmentLayer = {
    id: newMaskId,
    name: `Color Mask ${(editState.localAdjustments?.length ?? 0) + 1}`,
    enabled: true,
    components: [
      {
        id: uniqueMaskId("comp"),
        type: "color-pick",
        sampleX: sampleUV[0],
        sampleY: sampleUV[1],
        position: [sampleUV[0], sampleUV[1]],
        size: radiusSize,
        angle: 0,
        useRadius: false,
        sampledColor: initialColor,
        selectedColor: initialColor,
        // Resolve a failed initial read after the viewer has rendered instead of
        // displaying the old red fallback as though it came from the image.
        useSelectedColor: sampledColor !== null,
        threshold: 0.25,
        feather: 1,
        invert: false,
        opacity: 1,
        alpha: 1,
      },
    ],
    adjustments: cloneColorState(DEFAULT_COLOR_STATE),
  };

  setEditState("localAdjustments", (layers) => [...(layers || []), newMask]);
  setSelectedMaskId(newMaskId);
  triggerOverlay();
  return newMaskId;
}

/**
 * Creates a new radial (ellipse) local-adjustment mask at image centre and
 * selects it immediately. The overlay auto-hides after ~1 s unless
 * `overlayAlwaysOn` is enabled.
 */
export function addRadialMask(viewerApi?: ViewerApi): string {
  // Equal UV dimensions only look circular on square images. Scale each axis
  // from the shorter displayed image dimension so the default is a visual
  // circle while remaining comfortably inside the image.
  let defaultSize: [number, number] = [0.55, 0.55];
  if (viewerApi) {
    const origin = viewerApi.imageUVToCanvasRelative(0, 0);
    const xEdge = viewerApi.imageUVToCanvasRelative(1, 0);
    const yEdge = viewerApi.imageUVToCanvasRelative(0, 1);
    if (origin && xEdge && yEdge) {
      const width = Math.hypot(xEdge.x - origin.x, xEdge.y - origin.y);
      const height = Math.hypot(yEdge.x - origin.x, yEdge.y - origin.y);
      if (width > 0 && height > 0) {
        const diameter = Math.min(width, height) * 0.55;
        defaultSize = [diameter / width, diameter / height];
      }
    }
  }

  const newMaskId = uniqueMaskId("mask");
  const newMask: LocalAdjustmentLayer = {
    id: newMaskId,
    name: `Radial Mask ${(editState.localAdjustments?.length ?? 0) + 1}`,
    enabled: true,
    components: [
      {
        id: uniqueMaskId("comp"),
        type: "radial",
        // Color-pick fields kept at neutral defaults — unused by radial pass.
        sampleX: 0.5,
        sampleY: 0.5,
        sampledColor: DEFAULT_SAMPLE_COLOR,
        selectedColor: DEFAULT_SAMPLE_COLOR,
        useSelectedColor: false,
        threshold: 0.25,
        useRadius: true,
        // Radial geometry
        position: [0.5, 0.5],
        size: defaultSize,
        angle: 0,
        feather: 1,
        invert: true,
        opacity: 1,
        alpha: 1,
        showOverlay: true,
      },
    ],
    adjustments: cloneColorState(DEFAULT_COLOR_STATE),
  };

  setEditState("localAdjustments", (layers) => [...(layers || []), newMask]);
  setSelectedMaskId(newMaskId);
  triggerOverlay();
  return newMaskId;
}

/**
 * Creates a new gradient local-adjustment mask at the center of the image.
 */
export function addGradientMask(): string {
  const newMaskId = uniqueMaskId("mask");
  const newMask: LocalAdjustmentLayer = {
    id: newMaskId,
    name: `Gradient Mask ${(editState.localAdjustments?.length ?? 0) + 1}`,
    enabled: true,
    components: [
      {
        id: uniqueMaskId("comp"),
        type: "gradient",
        startPoint: [0.5, 0.75],
        endPoint: [0.5, 0.25],
        reflect: false,
        invert: false,
        opacity: 1,
        alpha: 1,
        showOverlay: true,
      } as any,
    ],
    adjustments: cloneColorState(DEFAULT_COLOR_STATE),
  };

  setEditState("localAdjustments", (layers) => [...(layers || []), newMask]);
  setSelectedMaskId(newMaskId);
  triggerOverlay();
  return newMaskId;
}

/**
 * Creates a new luminance mask local-adjustment layer with Polarr defaults and selects it.
 * Default: target = 1 (highlights), range = 0.7, smoothness = 1, invert = false.
 */
export function addLuminanceMask(): string {
  const newMaskId = uniqueMaskId("mask");
  const newMask: LocalAdjustmentLayer = {
    id: newMaskId,
    name: `Luminance Mask ${(editState.localAdjustments?.length ?? 0) + 1}`,
    enabled: true,
    components: [
      {
        id: uniqueMaskId("comp"),
        type: "luminance",
        target:     1,
        range:      0.7,
        smoothness: 1,
        invert:     false,
        opacity:    1,
        alpha:      1,
        showOverlay: true,
      } as any,
    ],
    adjustments: cloneColorState(DEFAULT_COLOR_STATE),
  };

  setEditState("localAdjustments", (layers) => [...(layers || []), newMask]);
  setSelectedMaskId(newMaskId);
  triggerOverlay();
  return newMaskId;
}

export function addDepthMask(_viewerApi?: ViewerApi): string {
  const availability = validateDepthMaskCreation();
  if (!availability.ok) {
    import("solid-toast").then(({ default: toast }) => toast.error(availability.reason));
    return "";
  }

  const newMaskId = uniqueMaskId("mask");
  const depthComponent: DepthMaskComponent = {
    type: "depth",
    id: uniqueMaskId("depth-comp"),
    target: 1,
    range: 0.25,
    invert: false,
    opacity: 1,
    alpha: 1,
    showOverlay: true,
  };

  const newMask: LocalAdjustmentLayer = {
    id: newMaskId,
    name: `Depth Mask ${(editState.localAdjustments?.length ?? 0) + 1}`,
    enabled: true,
    components: [depthComponent as any],
    adjustments: cloneColorState(DEFAULT_COLOR_STATE),
  };

  setEditState("localAdjustments", (layers) => [...(layers || []), newMask]);
  setSelectedMaskId(newMaskId);
  setOverlayAlwaysOn(true);
  setOverlayActive(true);
  triggerOverlay(4000);
  return newMaskId;
}

export function triggerOverlay(duration = 1000) {
  setOverlayActive(true);
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
  }
  if (overlayAlwaysOn()) return;

  overlayTimeout = setTimeout(() => {
    overlayTimeout = null;
    if (!overlayAlwaysOn()) setOverlayActive(false);
  }, duration);
}

/**
 * Creates a new brush mask local-adjustment layer and selects it.
 * Brush starts with neutral adjustments (no exposure jump).
 */
export function addBrushMask(): string {
  const newMaskId = uniqueMaskId("mask");

  const brushComponent: BrushMaskComponent = {
    type: "brush",
    id: uniqueMaskId("brush-comp"),

    brush: null,

    brush_radius: 0.15,
    brush_opacity: 0.8,
    brush_hardness: 0,
    brush_masking: 0,
    brush_erase: false,

    invert: false,
    opacity: 1,
    alpha: 1,

    mode: "mask",
    showOverlay: true,
  };

  const newMask: LocalAdjustmentLayer = {
    id: newMaskId,
    name: `Brush Mask ${(editState.localAdjustments?.length ?? 0) + 1}`,
    enabled: true,
    components: [brushComponent],
    adjustments: cloneColorState(DEFAULT_COLOR_STATE),
  };

  setEditState("localAdjustments", (layers) => [...(layers || []), newMask]);
  setSelectedMaskId(newMaskId);
  setOverlayAlwaysOn(true);
  setOverlayActive(true);
  triggerOverlay(4000);

  return newMaskId;
}
