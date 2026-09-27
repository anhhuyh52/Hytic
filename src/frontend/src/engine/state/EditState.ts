import type { ColorManagementState } from "../color/ColorManagementTypes";
import {
  cloneColorManagementState,
  DEFAULT_COLOR_MANAGEMENT_STATE,
} from "../color/ColorManagementTypes";
import { DEFAULT_ENGINE_SETTINGS, type EngineSettingsState } from "../lut/LUTStorageTypes";
import { cloneMatchState, DEFAULT_MATCH_STATE, type MatchState } from "./MatchTypes";
import {
  clonePresentationBorder,
  DEFAULT_PRESENTATION_BORDER,
  type PresentationBorderSettings,
} from "../../features/presentation/border/borderTypes";
import {
  cloneDistortState,
  DEFAULT_DISTORT_STATE,
  type DistortState,
} from "../../features/distort/distortStore";
import { cloneEditorOverlayLayer, type EditorOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import {
  cloneRetouchState,
  DEFAULT_RETOUCH_STATE,
  type RetouchState,
} from "../../features/retouch/retouchTypes";

export type { ColorManagementState };
export type { EngineSettingsState };
export type { MatchState };
export type { PresentationBorderSettings };
export type { DistortState };
export type { RetouchSpot, RetouchState, SpotRemovalMode } from "../../features/retouch/retouchTypes";

export type CurvePoint = {
  x: number;
  y: number;
};


export type MaskType =
  | "color-pick"
  | "luminosity"
  | "brush"
  | "radial"
  | "gradient"
  | "luminance"
  | "depth";

// ─── Brush Mask types ─────────────────────────────────────────────────────────

export type BrushPoint = {
  x: number;        // image UV x, 0..1
  y: number;        // image UV y, 0..1
  pressure: number; // 0..1
  time: number;
};

export type BrushStroke = {
  id: string;
  mode: "mask" | "erase";
  points: BrushPoint[];

  radius: number;
  opacity: number;
  hardness: number;
  masking: number;

  spacing: number;
  interpolate: boolean;
  randomize: number;
};

export type BrushMaskComponent = {
  type: "brush";
  id: string;

  brush: BrushStroke[] | null;

  brush_radius: number;   // 0..1
  brush_opacity: number;  // 0..1, Polarr UI name: Flow
  brush_hardness: number; // 0..1
  brush_masking: number;  // 0 = OFF, 1 = ON (edge-aware toggle)
  brush_erase: boolean;   // current paint mode: false = paint, true = erase

  invert: boolean;
  opacity: number;
  alpha: number;

  mode?: "mask" | "combine";
  showOverlay?: boolean;
};

export function cloneBrushMaskComponent(comp: BrushMaskComponent): BrushMaskComponent {
  return {
    ...comp,
    brush_erase: comp.brush_erase ?? false,
    brush: comp.brush
      ? comp.brush.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((p) => ({ ...p })),
        }))
      : null,
  };
}

export type ColorPickMaskComponent = {
  id: string;
  type: "color-pick" | "luminosity" | "radial";
  sampleX: number;
  sampleY: number;
  position: [number, number];
  size: [number, number];
  angle: number;
  useRadius: boolean;
  sampledColor: [number, number, number];
  selectedColor: [number, number, number];
  useSelectedColor: boolean;
  threshold: number;
  feather: number;
  invert: boolean;
  opacity: number;
  alpha: number;

  // Luminosity mask properties (optional, used when type === "luminosity")
  luminosityCenter?: number;  // 0-1, target luminosity
  luminosityRange?: number;   // 0-1, range of luminosity selection

  // Brush mask properties (optional, used when type === "brush")
  brushMask?: unknown;         // Texture for brush mask
  brushMaskSize?: [number, number];  // Size of brush mask texture
  brushHardness?: number;     // 0-1, edge softness

  // Radial mask properties — also repurposes position/size/angle/feather/invert/opacity/alpha
  showOverlay?: boolean;      // Whether the SVG ellipse overlay is visible
};

/** Narrowed view of a radial mask component for type-safe access. */
export type RadialMaskComponent = ColorPickMaskComponent & {
  type: "radial";
};

/**
 * Gradient mask component.
 * startPoint = transparent side, endPoint = fully-opaque side (image UV 0..1).
 * The gradient is linear and perpendicular to the line connecting the two points.
 * reflect = true → centre-line is brightest, both sides fade out symmetrically.
 */
export type GradientMaskComponent = {
  id: string;
  type: "gradient";
  startPoint: [number, number];  // UV — transparent / low side
  endPoint:   [number, number];  // UV — opaque / high side
  reflect: boolean;
  invert:  boolean;
  opacity: number;
  alpha:   number;
  showOverlay?: boolean;
};

/**
 * Luminance mask component.
 * Selects pixels by brightness/luminance.
 *
 * target     – 0 = shadows, 0.5 = midtones, 1 = highlights
 * range      – width of the selected brightness band (0 = narrow, 1 = broad)
 * smoothness – feather/softness of the range boundary (0 = hard, 1 = soft)
 * invert     – flip selected/unselected brightness areas
 */
export type LuminanceMaskComponent = {
  type: "luminance";
  id: string;
  /** 0..1 brightness target. 0 = shadows, 1 = highlights. */
  target: number;
  /** 0..1 width of selected luminance range. */
  range: number;
  /** 0..1 feather/softness of range boundary. */
  smoothness: number;
  invert: boolean;
  opacity: number;
  alpha: number;
  showOverlay?: boolean;
};

/**
 * Depth mask component.
 * Selects pixels based on the source image depth map.
 *
 * target – 0..1 selected depth value
 * range  – 0..1 width of selected depth band
 * invert – flip selected/unselected depth areas
 */
export type DepthMaskComponent = {
  type: "depth";
  id: string;
  /** 0..1 selected depth value. */
  target: number;
  /** 0..1 width of selected depth band. */
  range: number;
  invert: boolean;
  opacity: number;
  alpha: number;
  showOverlay?: boolean;
};

export function cloneDepthMaskComponent(comp: DepthMaskComponent): DepthMaskComponent {
  return { ...comp };
}

export type LocalAdjustmentLayer = {
  id: string;
  name: string;
  enabled: boolean;
  components: (ColorPickMaskComponent | GradientMaskComponent | BrushMaskComponent | LuminanceMaskComponent | DepthMaskComponent)[];
  adjustments: ColorState;
};

export type ManualCurveMode = "linear" | "cubic" | "bezier";

export type CurveMode = ManualCurveMode;

export type CurveState = {
  bypass: boolean;
  mode: CurveMode;
  points: CurvePoint[];
};

/**
 * A grading curve model: a point array in [0,1]² with **y = 0.5
 * neutral** (NOT exposure stops), plus an interpolation mode. Used by the
 * faithful Density (hueVsDensity), Chroma (chromaVsDensity), Saturation
 * (lumaVsDensity) and Radiance (hueVsLuma) panels — see CurveModelTexture.
 */
export type CurveModel = {
  points: CurvePoint[];
  mode: ManualCurveMode;
};

export function cloneCurveModel(curve: CurveModel): CurveModel {
  return { mode: curve.mode, points: curve.points.map((p) => ({ ...p })) };
}

export type ContrastCurvePoint = {
  x: number; // 0..1 linear luminance input
  y: number; // local contrast amount, -1..1
};

export type ContrastCurveMode =
  | "linear"
  | "cubic"
  | "bezier"
  | "gain"
  | "parabola"
  | "pcurve"
  | "almostUnitIdentity"
  | "expImpulse"
  | "cubicPulse";

export type ContrastCurveState = {
  bypass: boolean;
  mode: ContrastCurveMode;
  points: ContrastCurvePoint[];
  amount: number;
  gain: number;
  parabolaPower: number;
  pcurveA: number;
  pcurveB: number;
  expImpulseK: number;
  cubicPulseCenter: number;
  cubicPulseWidth: number;
};

export type ContrastState = {
  amount: number;
  pivot: number;
  enabled: boolean;
  bypass: boolean;
  curve: ContrastCurveState;
};

export type BalanceState = {
  enabled: boolean;
  bypass: boolean;
  // Legacy Balance exposes 4 axes across two 2-axis pads: exposure/saturation
  // and temperature/tint. exposure is in stops; saturation is -1..1.
  exposure: number;
  saturation: number;
  temperature: number;
  tint: number;
  red: number;
  green: number;
  blue: number;
};

/**
 * Saturation — faithful legacy `lumaVsDensity` curve: saturation amount as a
 * function of luma (`mix(gray, color, curve(luma) * 2)`, 0.5 = identity).
 */
export type SaturationState = {
  enabled: boolean;
  bypass: boolean;
  curve: CurveModel;
};

export type RGBMixerRow = {
  r: number;
  g: number;
  b: number;
};

export type RGBMixerState = {
  enabled: boolean;
  bypass: boolean;
  red: RGBMixerRow;
  green: RGBMixerRow;
  blue: RGBMixerRow;
  preserveLuminance: boolean;
};

/**
 * Density + Chroma — `dns()` curve model. `density` is the legacy
 * `hueVsDensity` curve (density vs hue), `chroma` is `chromaVsDensity` (density
 * vs chroma). y = 0.5 neutral. The "density" and "chroma" UI panels each edit
 * one curve. `bypass` remains the shared/master flag for saved-state compatibility;
 * the panel-specific flags let either curve be bypassed independently.
 */
export type DensityChromaState = {
  enabled: boolean;
  bypass: boolean;
  densityBypass?: boolean;
  chromaBypass?: boolean;
  density: CurveModel;
  chroma: CurveModel;
};

/**
 * Radiance — `hueVsLuma` curve: per-hue luma modulation,
 * weighted by chroma and darkness (`mix(c, c * (curve(hue)*4-1), hvlInf)`).
 * y = 0.5 neutral.
 */
export type RadianceState = {
  enabled: boolean;
  bypass: boolean;
  curve: CurveModel;
};

/**
 * Tone — the Contrast panel, a `lumaVsLuma` curve run
 * through the `lch_mod` op (NOT the color-management tone *mapping*). The
 * curve (sampled by the cct-space YIQ luma) is the *target* luma; lch_mod remaps
 * luma toward it and rescales chroma by the implied contrast. Unlike the
 * 0.5-neutral density/radiance curves, this curve's neutral is an **identity
 * diagonal (y = x)** — lch_mod is a no-op when target luma == source luma. See
 * NEUTRAL_LUMA_VS_LUMA.
 */
export type ToneState = {
  enabled: boolean;
  bypass: boolean;
  curve: CurveModel;
};

/**
 * Shadow / Highlight — `rng_mod` op:
 * per-channel RGB black point (shadows) and white point (highlights) that lift
 * brightness and introduce hue shifts in the dark / bright ends of the tone
 * range. Each point is a [r,g,b] triplet in [0,1] with **0.5 = neutral**.
 * `blackLinked`/`whiteLinked` are UI-only (move the 3 channels together; they do
 * not affect the render — the shader only consumes the resolved points).
 */
export type ShadowHighlightState = {
  enabled: boolean;
  bypass: boolean;
  blackPoint: [number, number, number];
  whitePoint: [number, number, number];
  blackLinked: boolean;
  whiteLinked: boolean;
};

/**
 * Exposure — `expVsLuma`
 * offset curve (0.5 neutral): a per-luma brightness multiplier applied in the cct
 * log space (`cct *= curve(smoothstep(luma)) + 0.5`). Distinct from the old
 * stops-based `curve` (CurveState), which is kept inert for the project's own
 * preset/persistence systems.
 */
export type ExposureState = {
  enabled: boolean;
  bypass: boolean;
  curve: CurveModel;
};

/**
 * Scattering (Phase 7 — ported legacy science). Physically-motivated shadow /
 * highlight ambient tinting: the shadow wheel adds ambient color to dark
 * pixels, the highlight wheel tints bright pixels. Wheel points are in [0,1]²
 * with center (0.5,0.5) = neutral; the engine derives a hue direction + amount.
 */
export type ScatteringState = {
  enabled: boolean;
  bypass: boolean;
  shadowX: number;
  shadowY: number;
  highlightX: number;
  highlightY: number;
  balance: number; // -1..1 shadow/highlight luminance split bias
  preserveLuminance: boolean;
};

/**
 * Refraction (Phase 7 — faithful port of the legacy `rfc` science). Filmic
 * per-hue HSL with independent shadow/highlight control for each of the 6
 * primary hue vectors (R,Y,G,C,B,M). `mapVectors` is length 24 — 6 primaries ×
 * [shadowAngleDeg, shadowDensity, highlightAngleDeg, highlightDensity]. Neutral =
 * angle at the primary base (i*60) + density 1. `separation` is the shadow↔
 * highlight luminance split (0..1).
 */
export type RefractionState = {
  enabled: boolean;
  bypass: boolean;
  mapVectors: number[]; // 24 = 6 × [shAngle, shDensity, hlAngle, hlDensity]
  separation: number;
  preserveLuminance: boolean;
};

/** Identity refraction mapVectors: each primary at its base angle, density 1. */
export const IDENTITY_REFRACTION_VECTORS: number[] = [
  0, 1, 0, 1, 60, 1, 60, 1, 120, 1, 120, 1, 180, 1, 180, 1, 240, 1, 240, 1, 300, 1, 300, 1,
];

export type PresetState = {
  enabled: boolean;
  bypass: boolean;
  selectedPresetId?: string;
  strength: number;
  preserveUserAdjustments: boolean;
};

/**
 * Texture FX — faithful port of the legacy "Texture FX" panel (render-only, NOT baked into
 * the LUT). Legacy 0..1 normalized control values; shader-side mappings live in the FX passes.
 *   amount      = grainDensity (Film Grain)
 *   acutance    = acutanceAmount (Film Acutance — image-adaptive local-contrast/clarity pass)
 *   resolution  = filmResolution (Film Resolution, shown in μm) — sets the grain cell size and
 *                 couples to sharpen (>0.5) / soften (<0.5)
 *   colorAmount = grainChroma (Grain Chroma)
 */
export type GrainState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  acutance: number;
  resolution: number;
  colorAmount: number;
  seed: number;
};

export type FXQuality = "low" | "medium" | "high";

/**
 * Halation FX — faithful port of the legacy "Halation FX" panel. A render-only
 * image-space glow (NOT baked into the LUT). All fields are the legacy 0..1
 * normalized control values; the shader-side mappings live in CompositePass.
 *   amount     = halationMix (Halation knob; 0 = off)
 *   spill      = halationSpl (Light Spill — how far the glow spills into darks)
 *   hue        = halationHue (Color Shift — 0.5 neutral, shown as ±20°)
 *   saturation = halationSat (Saturation of the glow — 0.5 default, shown 0..100%)
 */
export type HalationState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  spill: number;
  hue: number;
  saturation: number;
  quality: FXQuality;
};

/**
 * Diffusion FX — faithful port of the legacy "Diffusion FX" panel. A render-only
 * soft-bloom (NOT baked into the LUT). Legacy 0..1 normalized control values;
 * shader-side mappings live in CompositePass.
 *   amount       = diffusionAmount (Diffusion knob; 0 = off)
 *   fog          = diffusionFadeLevel (Fog — lifts black levels)
 *   threshold    = diffusionThreshold (protects darker areas)
 *   focusProtect = diffusionCenterProtection (Focus — protects the focus point)
 *   centerX/Y    = diffusionCenter (Focus Center Point pad; 0.5,0.5 = centre)
 */
export type DiffusionState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  fog: number;
  threshold: number;
  focusProtect: number;
  centerX: number;
  centerY: number;
  quality: FXQuality;
};

/**
 * Spotlight (legacy "Spotlight" FX panel) — faithful port of the legacy relight
 * pass. A render-only image-space effect (NOT baked into the LUT): a localized
 * re-illumination that pops the subject via a luma-derived matte + an
 * aspect-corrected radial mask centred at (centerX, centerY). `amount` 0 = off.
 */
export type SpotlightState = {
  enabled: boolean;
  bypass: boolean;
  amount: number; // 0..1 strength (0 = off)
  contrast: number; // 0..1 pop (0.5 neutral)
  bias: number; // 0..1 inside/outside balance (0.5 neutral)
  focus: number; // 0..1 falloff size (0.5 neutral)
  centerX: number; // 0..1 image-space center
  centerY: number; // 0..1 image-space center
};


export type ImageFXState = {
  grain: GrainState;
  halation: HalationState;
  diffusion: DiffusionState;
  spotlight: SpotlightState;
};

export type ColorState = {
  curve: CurveState;
  contrast: ContrastState;
  balance: BalanceState;
  scattering: ScatteringState;
  refraction: RefractionState;
  saturation: SaturationState;
  rgbMixer: RGBMixerState;
  densityChroma: DensityChromaState;
  radiance: RadianceState;
  tone: ToneState;
  shadowHighlight: ShadowHighlightState;
  exposure: ExposureState;
};

export const ASPECT_RATIO_PRESETS = [
  "free",
  "original",
  "1:1",
  "5:4",
  "5:3",
  "4:3",
  "3:2",
  "16:9",
  "16:10",
  "21:9",
  "65:24",
  "4:5",
  "3:5",
  "3:4",
  "2:3",
  "9:16",
  "10:16",
  "9:21",
  "24:65",
  "1.85:1",
  "2.00:1",
  "2.35:1",
  "2.39:1",
  "2.40:1",
] as const;

export type AspectRatioPreset = (typeof ASPECT_RATIO_PRESETS)[number];

export type TransformState = {
  enabled: boolean;
  cropEnabled: boolean;
  cropX: number; // 0..1, top-left of crop rect in display UV space
  cropY: number;
  cropWidth: number; // 0..1
  cropHeight: number;
  aspectRatio: AspectRatioPreset;
  orientation: 0 | 90 | 180 | 270; // 90-degree rotation steps (CW)
  straighten: number; // fine rotation -45..45 degrees
  flipX: boolean;
  flipY: boolean;
};

export type EditState = ColorState &
  ImageFXState & {
    preset: PresetState;
    match: MatchState;
    transform: TransformState;
    distort: DistortState;
    retouch: RetouchState;
    presentationBorder: PresentationBorderSettings;
    colorManagement: ColorManagementState;
    engineSettings: EngineSettingsState;
    localAdjustments: LocalAdjustmentLayer[];
    overlays: EditorOverlayLayer[];
  };

export type CurvePreviewInput = {
  key: "curve" | "contrast" | "exposure" | "radiance" | "tone" | "saturation" | "densityChroma.density" | "densityChroma.chroma";
  points: CurvePoint[];
  mode: ManualCurveMode;
};

export const DEFAULT_CURVE_STATE: CurveState = {
  bypass: true,
  mode: "linear",
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
  ],
};

export const DEFAULT_CONTRAST_CURVE_STATE: ContrastCurveState = {
  bypass: true,
  mode: "linear",
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
  ],
  amount: 0,
  gain: 1,
  parabolaPower: 1,
  pcurveA: 1,
  pcurveB: 1,
  expImpulseK: 1,
  cubicPulseCenter: 0.5,
  cubicPulseWidth: 0.5,
};

export function cloneContrastCurveState(curve: ContrastCurveState): ContrastCurveState {
  return {
    ...curve,
    points: curve.points.map((point) => ({ ...point })),
  };
}

export function cloneCurveState(curve: CurveState): CurveState {
  return {
    ...curve,
    points: curve.points.map((point) => ({ ...point })),
  };
}

export function cloneRGBMixerState(rgbMixer: RGBMixerState): RGBMixerState {
  return {
    ...rgbMixer,
    red: { ...rgbMixer.red },
    green: { ...rgbMixer.green },
    blue: { ...rgbMixer.blue },
  };
}

export function cloneColorPickMaskComponent(comp: ColorPickMaskComponent): ColorPickMaskComponent {
  return {
    ...comp,
    position: [...comp.position],
    size: [...comp.size],
    sampledColor: [...comp.sampledColor],
    selectedColor: [...comp.selectedColor],
    brushMaskSize: comp.brushMaskSize ? [...comp.brushMaskSize] : undefined,
  };
}

export function cloneLocalAdjustmentLayer(
  layer: LocalAdjustmentLayer,
  options: { cloneBrushPoints?: boolean } = {},
): LocalAdjustmentLayer {
  return {
    ...layer,
    components: layer.components.map((c) => {
      if (c.type === "gradient") {
        return { ...c, startPoint: [...(c as any).startPoint], endPoint: [...(c as any).endPoint] };
      }
      if (c.type === "brush") {
        const brush = c as BrushMaskComponent;
        if (options.cloneBrushPoints !== false) return cloneBrushMaskComponent(brush);
        return { ...brush, brush: brush.brush ? [...brush.brush] : null };
      }
      if (c.type === "luminance") {
        return { ...c };
      }
      if (c.type === "depth") {
        return { ...c };
      }
      return cloneColorPickMaskComponent(c as any);
    }) as any,
    adjustments: cloneColorState(layer.adjustments),
  };
}

/**
 * Engine snapshots need fresh component objects for reactive nested edits, but
 * committed brush strokes are immutable. Reusing their point arrays avoids a
 * deep copy of the entire painted mask whenever unrelated editor state changes.
 */
export function snapshotLocalAdjustmentLayer(layer: LocalAdjustmentLayer): LocalAdjustmentLayer {
  return cloneLocalAdjustmentLayer(layer, { cloneBrushPoints: false });
}

export function cloneColorState(state: ColorState): ColorState {
  return {
    curve: cloneCurveState(state.curve),
    contrast: {
      ...state.contrast,
      curve: cloneContrastCurveState(state.contrast.curve),
    },
    balance: { ...state.balance },
    scattering: { ...state.scattering },
    refraction: {
      ...state.refraction,
      mapVectors: [...state.refraction.mapVectors],
    },
    saturation: { ...state.saturation, curve: cloneCurveModel(state.saturation.curve) },
    rgbMixer: cloneRGBMixerState(state.rgbMixer),
    densityChroma: {
      ...state.densityChroma,
      density: cloneCurveModel(state.densityChroma.density),
      chroma: cloneCurveModel(state.densityChroma.chroma),
    },
    radiance: { ...state.radiance, curve: cloneCurveModel(state.radiance.curve) },
    tone: { ...state.tone, curve: cloneCurveModel(state.tone.curve) },
    shadowHighlight: {
      ...state.shadowHighlight,
      blackPoint: [...state.shadowHighlight.blackPoint],
      whitePoint: [...state.shadowHighlight.whitePoint],
    },
    exposure: { ...state.exposure, curve: cloneCurveModel(state.exposure.curve) },
  };
}

export function cloneEditState(state: EditState): EditState {
  return {
    ...cloneColorState(state),
    preset: { ...state.preset },
    match: cloneMatchState(state.match),
    grain: { ...state.grain },
    halation: { ...state.halation },
    diffusion: { ...state.diffusion },
    spotlight: { ...state.spotlight },
    transform: { ...state.transform },
    distort: cloneDistortState(state.distort),
    retouch: cloneRetouchState(state.retouch),
    presentationBorder: clonePresentationBorder(state.presentationBorder),
    colorManagement: cloneColorManagementState(state.colorManagement),
    engineSettings: { ...state.engineSettings },
    localAdjustments: state.localAdjustments
      ? state.localAdjustments.map((layer) => cloneLocalAdjustmentLayer(layer))
      : [],
    overlays: state.overlays ? state.overlays.map(cloneEditorOverlayLayer) : [],
  };
}

export const DEFAULT_CONTRAST_STATE: ContrastState = {
  amount: 0,
  pivot: 0.18,
  enabled: true,
  bypass: false,
  curve: cloneContrastCurveState(DEFAULT_CONTRAST_CURVE_STATE),
};

export const DEFAULT_BALANCE_STATE: BalanceState = {
  enabled: true,
  bypass: false,
  exposure: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  red: 0,
  green: 0,
  blue: 0,
};

export const DEFAULT_SCATTERING_STATE: ScatteringState = {
  enabled: true,
  bypass: false,
  shadowX: 0.5,
  shadowY: 0.5,
  highlightX: 0.5,
  highlightY: 0.5,
  balance: 0,
  preserveLuminance: false,
};

export const DEFAULT_REFRACTION_STATE: RefractionState = {
  enabled: true,
  bypass: false,
  mapVectors: [...IDENTITY_REFRACTION_VECTORS],
  separation: 0.5,
  preserveLuminance: false,
};

// Neutral curve point sets (all y = 0.5), matching the default
// control points + interpolation modes (package.min.js modules "d"/"l").
export const NEUTRAL_HUE_VS_DENSITY: CurveModel = {
  mode: "bezier",
  points: [
    { x: 0, y: 0.5 },
    { x: 0.167, y: 0.5 },
    { x: 0.333, y: 0.5 },
    { x: 0.583, y: 0.5 },
    { x: 0.805, y: 0.5 },
    { x: 1, y: 0.5 },
  ],
};
export const NEUTRAL_CHROMA_VS_DENSITY: CurveModel = {
  mode: "cubic",
  points: [
    { x: 0, y: 0.5 },
    { x: 0.333, y: 0.5 },
    { x: 0.667, y: 0.5 },
    { x: 1, y: 0.5 },
  ],
};
export const NEUTRAL_LUMA_VS_DENSITY: CurveModel = {
  mode: "bezier",
  points: [
    { x: 0, y: 0.5 },
    { x: 0.25, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.5 },
    { x: 1, y: 0.5 },
  ],
};
export const NEUTRAL_HUE_VS_LUMA: CurveModel = {
  mode: "bezier",
  points: [
    { x: 0, y: 0.5 },
    { x: 0.167, y: 0.5 },
    { x: 0.333, y: 0.5 },
    { x: 0.583, y: 0.5 },
    { x: 0.805, y: 0.5 },
    { x: 1, y: 0.5 },
  ],
};
// Tone (lumaVsLuma) is the one grading curve model whose neutral is an IDENTITY
// DIAGONAL (y = x), not a flat 0.5 — lch_mod is a no-op only when target == source
// luma. Uses the default control points + "Cubic" interpolation.
export const NEUTRAL_LUMA_VS_LUMA: CurveModel = {
  mode: "cubic",
  points: [
    { x: 0, y: 0 },
    { x: 0.167, y: 0.167 },
    { x: 0.333, y: 0.333 },
    { x: 0.833, y: 0.833 },
    { x: 1, y: 1 },
  ],
};
// Exposure (expVsLuma): a flat 0.5-neutral offset curve (legacy default points + "Cubic").
export const NEUTRAL_EXP_VS_LUMA: CurveModel = {
  mode: "cubic",
  points: [
    { x: 0, y: 0.5 },
    { x: 0.333, y: 0.5 },
    { x: 0.667, y: 0.5 },
    { x: 1, y: 0.5 },
  ],
};

export const DEFAULT_SATURATION_STATE: SaturationState = {
  enabled: true,
  bypass: false,
  curve: cloneCurveModel(NEUTRAL_LUMA_VS_DENSITY),
};

export const DEFAULT_RGB_MIXER_STATE: RGBMixerState = {
  enabled: true,
  bypass: false,
  red: { r: 1, g: 0, b: 0 },
  green: { r: 0, g: 1, b: 0 },
  blue: { r: 0, g: 0, b: 1 },
  preserveLuminance: true,
};

export const DEFAULT_DENSITY_CHROMA_STATE: DensityChromaState = {
  enabled: true,
  bypass: false,
  densityBypass: false,
  chromaBypass: false,
  density: cloneCurveModel(NEUTRAL_HUE_VS_DENSITY),
  chroma: cloneCurveModel(NEUTRAL_CHROMA_VS_DENSITY),
};

export const DEFAULT_RADIANCE_STATE: RadianceState = {
  enabled: true,
  bypass: false,
  curve: cloneCurveModel(NEUTRAL_HUE_VS_LUMA),
};

export const DEFAULT_TONE_STATE: ToneState = {
  enabled: true,
  bypass: false,
  curve: cloneCurveModel(NEUTRAL_LUMA_VS_LUMA),
};

export const DEFAULT_SHADOW_HIGHLIGHT_STATE: ShadowHighlightState = {
  enabled: true,
  bypass: false,
  blackPoint: [0.5, 0.5, 0.5],
  whitePoint: [0.5, 0.5, 0.5],
  blackLinked: true,
  whiteLinked: true,
};

export const DEFAULT_EXPOSURE_STATE: ExposureState = {
  enabled: true,
  bypass: false,
  curve: cloneCurveModel(NEUTRAL_EXP_VS_LUMA),
};

export const DEFAULT_PRESET_STATE: PresetState = {
  enabled: true,
  bypass: false,
  selectedPresetId: undefined,
  strength: 1,
  preserveUserAdjustments: true,
};

export const DEFAULT_GRAIN_STATE: GrainState = {
  enabled: true,
  bypass: false,
  amount: 0,
  acutance: 0,
  resolution: 0.5,
  colorAmount: 0.5,
  seed: 1,
};

export const DEFAULT_HALATION_STATE: HalationState = {
  enabled: true,
  bypass: false,
  amount: 0,
  spill: 0.5,
  hue: 0.5,
  saturation: 0.5,
  quality: "medium",
};

export const DEFAULT_DIFFUSION_STATE: DiffusionState = {
  enabled: true,
  bypass: false,
  amount: 0,
  fog: 0,
  threshold: 0,
  focusProtect: 0,
  centerX: 0.5,
  centerY: 0.5,
  quality: "medium",
};

export const DEFAULT_SPOTLIGHT_STATE: SpotlightState = {
  enabled: true,
  bypass: false,
  amount: 0,
  contrast: 0.5,
  bias: 0.5,
  focus: 0.5,
  centerX: 0.5,
  centerY: 0.5,
};

export const DEFAULT_TRANSFORM_STATE: TransformState = {
  enabled: true,
  cropEnabled: false,
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  aspectRatio: "free",
  orientation: 0,
  straighten: 0,
  flipX: false,
  flipY: false,
};

export const DEFAULT_COLOR_STATE: ColorState = {
  curve: cloneCurveState(DEFAULT_CURVE_STATE),
  contrast: {
    ...DEFAULT_CONTRAST_STATE,
    curve: cloneContrastCurveState(DEFAULT_CONTRAST_STATE.curve),
  },
  balance: { ...DEFAULT_BALANCE_STATE },
  scattering: { ...DEFAULT_SCATTERING_STATE },
  refraction: {
    ...DEFAULT_REFRACTION_STATE,
    mapVectors: [...DEFAULT_REFRACTION_STATE.mapVectors],
  },
  saturation: {
    ...DEFAULT_SATURATION_STATE,
    curve: cloneCurveModel(DEFAULT_SATURATION_STATE.curve),
  },
  rgbMixer: cloneRGBMixerState(DEFAULT_RGB_MIXER_STATE),
  densityChroma: {
    ...DEFAULT_DENSITY_CHROMA_STATE,
    density: cloneCurveModel(DEFAULT_DENSITY_CHROMA_STATE.density),
    chroma: cloneCurveModel(DEFAULT_DENSITY_CHROMA_STATE.chroma),
  },
  radiance: { ...DEFAULT_RADIANCE_STATE, curve: cloneCurveModel(DEFAULT_RADIANCE_STATE.curve) },
  tone: { ...DEFAULT_TONE_STATE, curve: cloneCurveModel(DEFAULT_TONE_STATE.curve) },
  shadowHighlight: {
    ...DEFAULT_SHADOW_HIGHLIGHT_STATE,
    blackPoint: [...DEFAULT_SHADOW_HIGHLIGHT_STATE.blackPoint],
    whitePoint: [...DEFAULT_SHADOW_HIGHLIGHT_STATE.whitePoint],
  },
  exposure: { ...DEFAULT_EXPOSURE_STATE, curve: cloneCurveModel(DEFAULT_EXPOSURE_STATE.curve) },
};

export const DEFAULT_EDIT_STATE: EditState = {
  ...cloneColorState(DEFAULT_COLOR_STATE),
  preset: { ...DEFAULT_PRESET_STATE },
  match: cloneMatchState(DEFAULT_MATCH_STATE),
  grain: { ...DEFAULT_GRAIN_STATE },
  halation: { ...DEFAULT_HALATION_STATE },
  diffusion: { ...DEFAULT_DIFFUSION_STATE },
  spotlight: { ...DEFAULT_SPOTLIGHT_STATE },
  transform: { ...DEFAULT_TRANSFORM_STATE },
  distort: cloneDistortState(DEFAULT_DISTORT_STATE),
  retouch: cloneRetouchState(DEFAULT_RETOUCH_STATE),
  presentationBorder: clonePresentationBorder(DEFAULT_PRESENTATION_BORDER),
  colorManagement: cloneColorManagementState(DEFAULT_COLOR_MANAGEMENT_STATE),
  engineSettings: { ...DEFAULT_ENGINE_SETTINGS },
  localAdjustments: [],
  overlays: [],
};
