import { createOverlayId } from "./overlayIds";
import type {
  BrushMaskComponent,
  ColorPickMaskComponent,
  DepthMaskComponent,
  GradientMaskComponent,
  LuminanceMaskComponent,
  RadialMaskComponent,
} from "../../engine/state/EditState";

export type EditorOverlayMask =
  | ColorPickMaskComponent
  | RadialMaskComponent
  | GradientMaskComponent
  | BrushMaskComponent
  | LuminanceMaskComponent
  | DepthMaskComponent;

export type EditorOverlayBlendMode =
  | "NORMAL"
  | "SCREEN"
  | "MULTIPLY"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "COLOR_DODGE"
  | "COLOR_BURN"
  | "VIVID_LIGHT"
  | "LINEAR_LIGHT"
  | "LIGHTEN"
  | "DARKEN"
  | "ADD"
  | "SUBTRACT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "DIVIDE"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

export type EditorOverlayBase = {
  id: string;
  name: string;
  categoryId?: string;
  position: [number, number];
  scale: [number, number];
  angle: number;
  blendMode: EditorOverlayBlendMode;
  opacity: number;
  fill: number;
  visible: boolean;
  locked: boolean;
  /** Photo-space alpha mask owned exclusively by this overlay layer. */
  mask: EditorOverlayMask | null;
};

export type ImageOverlayLayer = EditorOverlayBase & {
  type: "image";
  sourceId: string;
  /** Runtime property. A blob:// URL. Omitted during JSON serialization. */
  sourceDataUrl?: string;
  sourceWidth: number;
  sourceHeight: number;
};

export type GradientKind = "linear" | "radial" | "luminance";

export type GradientStop = {
  id: string;
  position: number;
  color: [number, number, number, number];
};

export type GradientOverlayLayer = EditorOverlayBase & {
  type: "gradient";
  gradientConfig: {
    kind: GradientKind;
    stops: GradientStop[];
    reverse: boolean;
    reflect: boolean;
    repeat: boolean;
  };
};

export type EditorOverlayLayer = ImageOverlayLayer | GradientOverlayLayer;
export type EditorOverlayLayerPatch =
  | Partial<Omit<ImageOverlayLayer, "id" | "type">>
  | Partial<Omit<GradientOverlayLayer, "id" | "type">>;

export const EDITOR_OVERLAY_BLEND_MODES: readonly EditorOverlayBlendMode[] = [
  "NORMAL",
  "SCREEN",
  "MULTIPLY",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "COLOR_DODGE",
  "COLOR_BURN",
  "VIVID_LIGHT",
  "LINEAR_LIGHT",
  "LIGHTEN",
  "DARKEN",
  "ADD",
  "SUBTRACT",
  "DIFFERENCE",
  "EXCLUSION",
  "DIVIDE",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
];

const DEFAULT_GRADIENT_COLORS: readonly GradientStop["color"][] = [
  [0, 0, 0, 1],
  [1, 1, 1, 1],
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAngle(value: unknown): number {
  const angle = numberOr(value, 0) % 360;
  return angle <= -180 ? angle + 360 : angle > 180 ? angle - 360 : angle;
}

function normalizeScale(value: unknown, fallback: number): number {
  const scale = clamp(numberOr(value, fallback), -20, 20);
  if (Math.abs(scale) >= 0.0001) return scale;
  return scale < 0 ? -0.0001 : 0.0001;
}

function defaultGradientStops(): GradientStop[] {
  return DEFAULT_GRADIENT_COLORS.map((color, index) => ({
    id: createOverlayId(),
    position: index,
    color: [...color],
  }));
}

export function normalizeGradientStops(rawStops: readonly GradientStop[]): GradientStop[] {
  const usedIds = new Set<string>();
  const stops = rawStops.map((stop) => {
    let id = typeof stop.id === "string" && stop.id ? stop.id : createOverlayId();
    while (usedIds.has(id)) id = createOverlayId();
    usedIds.add(id);
    const color = Array.isArray(stop.color) ? stop.color : DEFAULT_GRADIENT_COLORS[0]!;
    return {
      id,
      position: clamp01(numberOr(stop.position, 0)),
      color: [
        clamp01(numberOr(color[0], 0)),
        clamp01(numberOr(color[1], 0)),
        clamp01(numberOr(color[2], 0)),
        clamp01(numberOr(color[3], 1)),
      ] as GradientStop["color"],
    };
  });
  return (stops.length ? stops : defaultGradientStops()).sort((left, right) => left.position - right.position);
}

export function cloneEditorOverlayLayer(layer: EditorOverlayLayer): EditorOverlayLayer {
  const base = {
    ...layer,
    position: [...layer.position] as [number, number],
    scale: [...layer.scale] as [number, number],
    mask: cloneEditorOverlayMask(layer.mask),
  };

  if (layer.type === "gradient") {
    return {
      ...base,
      type: "gradient",
      gradientConfig: {
        ...layer.gradientConfig,
        stops: layer.gradientConfig.stops.map((stop) => ({
          ...stop,
          color: [...stop.color] as [number, number, number, number],
        })),
      },
    } as GradientOverlayLayer;
  }

  return {
    ...base,
    type: "image",
  } as ImageOverlayLayer;
}

export function normalizeEditorOverlayLayer(layer: EditorOverlayLayer): EditorOverlayLayer {
  const normalizedBase = {
    ...layer,
    name: layer.name.slice(0, 120),
    position: [numberOr(layer.position[0], 0.5), numberOr(layer.position[1], 0.5)] as [number, number],
    scale: [normalizeScale(layer.scale[0], 1), normalizeScale(layer.scale[1], 1)] as [number, number],
    angle: normalizeAngle(layer.angle),
    opacity: clamp01(numberOr(layer.opacity, 1)),
    fill: clamp01(numberOr(layer.fill, 1)),
    blendMode: EDITOR_OVERLAY_BLEND_MODES.includes(layer.blendMode) ? layer.blendMode : "NORMAL" as const,
    mask: cloneEditorOverlayMask(layer.mask),
  };
  if (layer.type === "gradient") {
    return {
      ...normalizedBase,
      type: "gradient",
      gradientConfig: {
        kind: layer.gradientConfig.kind,
        stops: normalizeGradientStops(layer.gradientConfig.stops),
        reverse: layer.gradientConfig.reverse === true,
        reflect: layer.gradientConfig.reflect === true,
        repeat: layer.gradientConfig.repeat === true,
      },
    };
  }
  return {
    ...normalizedBase,
    type: "image",
    sourceId: layer.sourceId,
    categoryId: layer.categoryId,
    sourceDataUrl: layer.sourceDataUrl,
    sourceWidth: Math.max(1, numberOr(layer.sourceWidth, 1)),
    sourceHeight: Math.max(1, numberOr(layer.sourceHeight, 1)),
  };
}

export function applyEditorOverlayLayerPatch(
  layer: EditorOverlayLayer,
  patch: EditorOverlayLayerPatch,
): EditorOverlayLayer {
  if (layer.type === "gradient") {
    const gradientPatch = patch as Partial<GradientOverlayLayer>;
    return normalizeEditorOverlayLayer({
      ...layer,
      ...gradientPatch,
      id: layer.id,
      type: "gradient",
      gradientConfig: gradientPatch.gradientConfig ?? layer.gradientConfig,
    });
  }
  const imagePatch = patch as Partial<ImageOverlayLayer>;
  return normalizeEditorOverlayLayer({
    ...layer,
    ...imagePatch,
    id: layer.id,
    type: "image",
  });
}

export function cloneEditorOverlayMask(mask: EditorOverlayMask | null | undefined): EditorOverlayMask | null {
  if (!mask) return null;
  if (mask.type === "brush") {
    return {
      ...mask,
      brush: mask.brush?.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      })) ?? null,
    };
  }
  if (mask.type === "gradient") {
    return { ...mask, startPoint: [...mask.startPoint], endPoint: [...mask.endPoint] };
  }
  if (mask.type === "color-pick" || mask.type === "luminosity" || mask.type === "radial") {
    return { ...mask, position: [...mask.position], size: [...mask.size], sampledColor: [...mask.sampledColor], selectedColor: [...mask.selectedColor] };
  }
  return { ...mask };
}

export function serializeEditorOverlayLayer(layer: EditorOverlayLayer): EditorOverlayLayer {
  const cloned = cloneEditorOverlayLayer(layer);
  if (cloned.type === "image") {
    delete cloned.sourceDataUrl;
  }
  return cloned;
}

export function deserializeEditorOverlays(raw: unknown): EditorOverlayLayer[] {
  if (!Array.isArray(raw)) return [];
  const result: EditorOverlayLayer[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (!value || typeof value !== "object") continue;
    const layer = value as Record<string, unknown>;
    const position = Array.isArray(layer.position) ? layer.position : [];
    const scale = Array.isArray(layer.scale) ? layer.scale : [];
    const blendMode = EDITOR_OVERLAY_BLEND_MODES.includes(layer.blendMode as EditorOverlayBlendMode)
      ? (layer.blendMode as EditorOverlayBlendMode)
      : layer.type === "gradient" ? "NORMAL" : "SCREEN";

    const base: EditorOverlayBase = {
      id: typeof layer.id === "string" ? layer.id : `overlay-${index}`,
      name: typeof layer.name === "string" ? layer.name.slice(0, 120) : `Overlay ${index + 1}`,
      categoryId: typeof layer.categoryId === "string" ? layer.categoryId : undefined,
      position: [numberOr(position[0], 0.5), numberOr(position[1], 0.5)],
      scale: [normalizeScale(scale[0], layer.type === "gradient" ? 1 : 0.5), normalizeScale(scale[1], layer.type === "gradient" ? 1 : 0.5)],
      angle: normalizeAngle(layer.angle),
      blendMode,
      opacity: clamp01(numberOr(layer.opacity ?? layer.strength, 1)),
      fill: clamp01(numberOr(layer.fill, 1)),
      visible: layer.visible !== false,
      locked: layer.locked === true,
      mask: deserializeEditorOverlayMask(layer.mask),
    };

    if (layer.type === "gradient") {
      const config = (layer.gradientConfig || {}) as Record<string, unknown>;
      const rawStops = Array.isArray(config.stops) ? config.stops : [];
      const stops: GradientStop[] = [];
      for (let stopIndex = 0; stopIndex < rawStops.length; stopIndex += 1) {
        const rawStop = rawStops[stopIndex];
        if (!rawStop || typeof rawStop !== "object") continue;
        const stop = rawStop as Record<string, unknown>;
        const color = Array.isArray(stop.color) ? stop.color : [0, 0, 0, 1];
        stops.push({
          id: typeof stop.id === "string" ? stop.id : createOverlayId(),
          position: numberOr(stop.position, 0),
          color: [numberOr(color[0], 0), numberOr(color[1], 0), numberOr(color[2], 0), numberOr(color[3], 1)],
        });
      }
      result.push(normalizeEditorOverlayLayer({
        ...base,
        type: "gradient",
        gradientConfig: {
          kind: (config.kind === "radial" || config.kind === "luminance") ? config.kind : "linear",
          stops,
          reverse: config.reverse === true,
          reflect: config.reflect === true,
          repeat: config.repeat === true,
        },
      }));
      continue;
    }

    const sourceId = typeof layer.sourceId === "string" ? layer.sourceId : "";
    if (!sourceId && typeof layer.sourceDataUrl !== "string") continue;
    result.push(normalizeEditorOverlayLayer({
      ...base,
      type: "image",
      sourceId: sourceId || "legacy",
      sourceDataUrl: typeof layer.sourceDataUrl === "string" ? layer.sourceDataUrl : undefined,
      sourceWidth: clamp(numberOr(layer.sourceWidth, 1), 1, 100000),
      sourceHeight: clamp(numberOr(layer.sourceHeight, 1), 1, 100000),
    }));
  }
  return result;
}

export function createEditorOverlayLayer(input: {
  name: string;
  sourceId: string;
  sourceDataUrl: string;
  width: number;
  height: number;
  imageAspect: number;
  categoryId?: string;
}): ImageOverlayLayer {
  const sourceAspect = input.width / Math.max(1, input.height);
  const width = Math.min(0.72, sourceAspect / Math.max(0.01, input.imageAspect) * 0.72);
  const height = Math.min(0.72, input.imageAspect / Math.max(0.01, sourceAspect) * 0.72);
  return {
    id: createOverlayId(),
    type: "image",
    name: input.name.replace(/\.[^.]+$/, "") || "Overlay",
    sourceId: input.sourceId,
    categoryId: input.categoryId,
    sourceDataUrl: input.sourceDataUrl,
    sourceWidth: input.width,
    sourceHeight: input.height,
    position: [0.5, 0.5],
    scale: [width, height],
    angle: 0,
    blendMode: "SCREEN",
    opacity: 1,
    fill: 1,
    visible: true,
    locked: false,
    mask: null,
  };
}

export function createGradientOverlayLayer(): GradientOverlayLayer {
  return {
    id: createOverlayId(),
    type: "gradient",
    name: "Gradient",
    position: [0.5, 0.5],
    scale: [1, 1],
    angle: 0,
    blendMode: "NORMAL",
    opacity: 1,
    fill: 1,
    visible: true,
    locked: false,
    mask: null,
    gradientConfig: {
      kind: "linear",
      stops: defaultGradientStops(),
      reverse: false,
      reflect: false,
      repeat: false,
    },
  };
}

function deserializeEditorOverlayMask(raw: unknown): EditorOverlayMask | null {
  if (!raw || typeof raw !== "object") return null;
  const mask = raw as EditorOverlayMask;
  const supported = ["color-pick", "radial", "gradient", "brush", "luminance", "depth"];
  return supported.includes(mask.type) ? cloneEditorOverlayMask(mask) : null;
}
