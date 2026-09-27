import {
  createGradientOverlayLayer,
  normalizeGradientStops,
  type EditorOverlayBlendMode,
  type GradientOverlayLayer,
  type GradientStop as EditorGradientStop,
} from "./editorOverlayTypes";
import { createOverlayId } from "./overlayIds";

type GradientStop = {
  offset: number;
  color: string;
};

type EditorGradientOverlayPreset = {
  id: string;
  name: string;
  blendMode: EditorOverlayBlendMode;
  strength: number;
  preview: string;
  kind: "linear" | "radial";
  angle?: number;
  stops: readonly GradientStop[];
};

const GRADIENT_SOURCE_PREFIX = "gradient:";
const GRADIENT_TEXTURE_SIZE = 1024;

export const EDITOR_GRADIENT_OVERLAY_PRESETS: readonly EditorGradientOverlayPreset[] = [
  {
    id: "red_cyan",
    name: "Red Cyan",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 255, 255))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(255, 0, 0, 0.72)" },
      { offset: 1, color: "rgba(0, 255, 255, 0.72)" },
    ],
  },
  {
    id: "purple_amber",
    name: "Purple Amber",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(71, 0, 194), rgb(255, 161, 0))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(71, 0, 194, 0.72)" },
      { offset: 1, color: "rgba(255, 161, 0, 0.72)" },
    ],
  },
  {
    id: "teal_lime",
    name: "Teal Lime",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(0, 141, 122), rgb(204, 255, 0))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(0, 141, 122, 0.72)" },
      { offset: 1, color: "rgba(204, 255, 0, 0.72)" },
    ],
  },
  {
    id: "flame_gold",
    name: "Flame Gold",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(255, 50, 0), rgb(255, 203, 0))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(255, 50, 0, 0.72)" },
      { offset: 1, color: "rgba(255, 203, 0, 0.72)" },
    ],
  },
  {
    id: "crimson_wheat",
    name: "Crimson Wheat",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(128, 32, 32), rgb(255, 205, 121))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(128, 32, 32, 0.72)" },
      { offset: 1, color: "rgba(255, 205, 121, 0.72)" },
    ],
  },
  {
    id: "navy_red",
    name: "Navy Red",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(29, 44, 73), rgb(255, 0, 0))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(29, 44, 73, 0.72)" },
      { offset: 1, color: "rgba(255, 0, 0, 0.72)" },
    ],
  },
  {
    id: "fire_rose",
    name: "Fire Rose",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(255, 42, 0), rgb(255, 0, 144))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(255, 42, 0, 0.72)" },
      { offset: 1, color: "rgba(255, 0, 144, 0.72)" },
    ],
  },
  {
    id: "aqua_ember",
    name: "Aqua Ember",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(24, 218, 198), rgb(255, 110, 0))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(24, 218, 198, 0.72)" },
      { offset: 1, color: "rgba(255, 110, 0, 0.72)" },
    ],
  },
  {
    id: "sky_coral",
    name: "Sky Coral",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(24, 173, 218), rgb(255, 105, 60))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(24, 173, 218, 0.72)" },
      { offset: 1, color: "rgba(255, 105, 60, 0.72)" },
    ],
  },
  {
    id: "indigo_ice",
    name: "Indigo Ice",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(76, 24, 218), rgb(60, 235, 255))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(76, 24, 218, 0.72)" },
      { offset: 1, color: "rgba(60, 235, 255, 0.72)" },
    ],
  },
  {
    id: "violet_azure",
    name: "Violet Azure",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(178, 0, 255), rgb(0, 144, 255))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(178, 0, 255, 0.72)" },
      { offset: 1, color: "rgba(0, 144, 255, 0.72)" },
    ],
  },
  {
    id: "violet_acid",
    name: "Violet Acid",
    blendMode: "OVERLAY",
    strength: 0.55,
    preview: "linear-gradient(90deg, rgb(178, 0, 255), rgb(119, 255, 0))",
    kind: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "rgba(178, 0, 255, 0.72)" },
      { offset: 1, color: "rgba(119, 255, 0, 0.72)" },
    ],
  },
];

export function createGradientSourceId(presetId: string): string {
  return `${GRADIENT_SOURCE_PREFIX}${presetId}`;
}

export function getGradientPresetFromSourceId(sourceId: string): EditorGradientOverlayPreset | undefined {
  if (!sourceId.startsWith(GRADIENT_SOURCE_PREFIX)) return undefined;
  return EDITOR_GRADIENT_OVERLAY_PRESETS.find(
    (preset) => preset.id === sourceId.slice(GRADIENT_SOURCE_PREFIX.length),
  );
}

export function createEditorGradientDataUrl(presetId: string): string | undefined {
  const preset = EDITOR_GRADIENT_OVERLAY_PRESETS.find((item) => item.id === presetId);
  if (!preset) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = GRADIENT_TEXTURE_SIZE;
  canvas.height = GRADIENT_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const gradient =
    preset.kind === "radial"
      ? context.createRadialGradient(
        GRADIENT_TEXTURE_SIZE / 2,
        GRADIENT_TEXTURE_SIZE / 2,
        0,
        GRADIENT_TEXTURE_SIZE / 2,
        GRADIENT_TEXTURE_SIZE / 2,
        GRADIENT_TEXTURE_SIZE / 2,
      )
      : createAngledGradient(context, preset.angle ?? 90);
  for (const stop of preset.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function createEditorGradientOverlayLayer(presetId: string): GradientOverlayLayer | undefined {
  const preset = EDITOR_GRADIENT_OVERLAY_PRESETS.find((item) => item.id === presetId);
  if (!preset) return undefined;
  const layer = createGradientOverlayLayer();
  const stops: EditorGradientStop[] = preset.stops.map((stop) => ({
    id: createOverlayId(),
    position: stop.offset,
    color: parseCssColor(stop.color),
  }));
  return {
    ...layer,
    name: preset.name,
    angle: preset.kind === "linear" ? (preset.angle ?? 90) - 90 : 0,
    blendMode: preset.blendMode,
    opacity: preset.strength,
    gradientConfig: {
      ...layer.gradientConfig,
      kind: preset.kind,
      stops: normalizeGradientStops(stops),
    },
  };
}

function parseCssColor(value: string): EditorGradientStop["color"] {
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return [
    Math.min(1, Math.max(0, (channels[0] ?? 0) / 255)),
    Math.min(1, Math.max(0, (channels[1] ?? 0) / 255)),
    Math.min(1, Math.max(0, (channels[2] ?? 0) / 255)),
    Math.min(1, Math.max(0, channels[3] ?? 1)),
  ];
}

function createAngledGradient(context: CanvasRenderingContext2D, angle: number): CanvasGradient {
  const radians = ((angle - 90) * Math.PI) / 180;
  const half = GRADIENT_TEXTURE_SIZE / 2;
  const x = Math.cos(radians) * half;
  const y = Math.sin(radians) * half;
  return context.createLinearGradient(half - x, half - y, half + x, half + y);
}
