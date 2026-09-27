import type {
  AspectRatioPreset,
  ContrastCurveMode,
  CurveMode,
  EditState,
  FXQuality,
  CurveModel,
  MaskType,
} from "../engine/state/EditState";
import {
  DEFAULT_BALANCE_STATE,
  DEFAULT_SCATTERING_STATE,
  DEFAULT_REFRACTION_STATE,
  DEFAULT_CONTRAST_CURVE_STATE,
  DEFAULT_CONTRAST_STATE,
  DEFAULT_CURVE_STATE,
  DEFAULT_DENSITY_CHROMA_STATE,
  DEFAULT_DIFFUSION_STATE,
  DEFAULT_EDIT_STATE,
  DEFAULT_GRAIN_STATE,
  DEFAULT_HALATION_STATE,
  DEFAULT_RADIANCE_STATE,
  DEFAULT_RGB_MIXER_STATE,
  DEFAULT_SATURATION_STATE,
  DEFAULT_SHADOW_HIGHLIGHT_STATE,
  DEFAULT_SPOTLIGHT_STATE,
  DEFAULT_EXPOSURE_STATE,
  DEFAULT_TONE_STATE,
  DEFAULT_TRANSFORM_STATE,
  ASPECT_RATIO_PRESETS,
} from "../engine/state/EditState";
import { DEFAULT_DISTORT_STATE } from "../features/distort/distortStore";
import type { DistortionPoints } from "../features/distort/distortTypes";
import {
  DEFAULT_RETOUCH_STATE,
  createRetouchSpotId,
  MAX_RETOUCH_SPOTS,
  type RetouchSpot,
} from "../features/retouch/retouchTypes";
import { DEFAULT_COLOR_MANAGEMENT_STATE } from "../engine/color/ColorManagementTypes";
import { isInputTransformId, isDisplayTransformId } from "../engine/color/colorSpaceCatalog";
import { DEFAULT_MATCH_STATE, type MatchStatus } from "../engine/state/MatchTypes";
import { DEFAULT_ENGINE_SETTINGS, type LUTStorageMode } from "../engine/lut/LUTStorageTypes";
import { OCIO_RUNTIME_MODES, type OCIORuntimeMode } from "../engine/ocio/runtime/OCIORuntimeTypes";
import type { SerializedEditState } from "./ProjectTypes";
import {
  DEFAULT_PRESENTATION_BORDER,
  normalizePresentationBorder,
  type PresentationBorderAspectRatio,
  type PresentationBorderBackgroundMode,
  type PresentationBorderPreset,
  type PresentationBorderSettings,
} from "../features/presentation/border/borderTypes";
import { deserializeEditorOverlays } from "../features/overlays/editorOverlayTypes";

// ── low-level safe accessors ───────────────────────────────────────────────

type AnyObj = Record<string, unknown>;

function obj(v: unknown): AnyObj {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as AnyObj) : {};
}

function num(v: unknown, def: number, lo = -Infinity, hi = Infinity): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

function str<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

function firstString(o: AnyObj, keys: readonly string[], def: string): string {
  for (const key of keys) {
    const value = o[key];
    if (typeof value === "string" && value) return value;
  }
  return def;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}


function color255(v: unknown, fallback: [number, number, number]): [number, number, number] {
  const a = arr(v);
  return [
    num(a[0], fallback[0], 0, 255),
    num(a[1], fallback[1], 0, 255),
    num(a[2], fallback[2], 0, 255),
  ];
}

// ── individual field deserializers ─────────────────────────────────────────

const CURVE_MODES: CurveMode[] = ["linear", "cubic", "bezier"];
const CONTRAST_CURVE_MODES: ContrastCurveMode[] = [
  "linear",
  "cubic",
  "bezier",
  "gain",
  "parabola",
  "pcurve",
  "almostUnitIdentity",
  "expImpulse",
  "cubicPulse",
];
const ASPECT_RATIOS: AspectRatioPreset[] = [...ASPECT_RATIO_PRESETS];
const FX_QUALITIES: FXQuality[] = ["low", "medium", "high"];
const PRESENTATION_BORDER_PRESETS: PresentationBorderPreset[] = [
  "none",
  "white-gallery",
  "black-matte",
  "polaroid",
  "cinematic",
  "social-4x5",
  "blur-background",
];
const PRESENTATION_BORDER_ASPECTS: PresentationBorderAspectRatio[] = [
  "original",
  "1:1",
  "4:5",
  "5:4",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "2.39:1",
];
const PRESENTATION_BORDER_BACKGROUNDS: PresentationBorderBackgroundMode[] = [
  "solid",
  "blur",
  "image",
];

function desCurvePoints(raw: unknown, def = DEFAULT_CURVE_STATE.points, lo = -2, hi = 2) {
  const items = arr(raw);
  if (items.length < 2) return def.map((p) => ({ ...p }));
  return items.map((item) => {
    const o = obj(item);
    return { x: num(o.x, 0, 0, 1), y: num(o.y, 0, lo, hi) };
  });
}

// Legacy grading curve (y in [0,1], 0.5 neutral). Falls back to the neutral
// default when absent or malformed (e.g. pre-curve projects with old scalars).
function desCurveModel(raw: unknown, fallback: CurveModel): CurveModel {
  const o = obj(raw);
  return {
    mode: str(o.mode, CURVE_MODES, fallback.mode),
    points: desCurvePoints(o.points, fallback.points, 0, 1),
  };
}

function desCurve(raw: unknown): EditState["curve"] {
  const o = obj(raw);
  return {
    bypass: bool(o.bypass, DEFAULT_CURVE_STATE.bypass),
    mode: str(o.mode, CURVE_MODES, DEFAULT_CURVE_STATE.mode),
    points: desCurvePoints(o.points, DEFAULT_CURVE_STATE.points, -2, 2),
  };
}

function desContrastCurve(raw: unknown): EditState["contrast"]["curve"] {
  const d = DEFAULT_CONTRAST_CURVE_STATE;
  const o = obj(raw);
  return {
    bypass: bool(o.bypass, d.bypass),
    mode: str(o.mode, CONTRAST_CURVE_MODES, d.mode),
    points: desCurvePoints(o.points, d.points, -1, 1),
    amount: num(o.amount, d.amount, -2, 2),
    gain: num(o.gain, d.gain, 0, 10),
    parabolaPower: num(o.parabolaPower, d.parabolaPower, 0.1, 10),
    pcurveA: num(o.pcurveA, d.pcurveA, 0, 10),
    pcurveB: num(o.pcurveB, d.pcurveB, 0, 10),
    expImpulseK: num(o.expImpulseK, d.expImpulseK, 0.01, 50),
    cubicPulseCenter: num(o.cubicPulseCenter, d.cubicPulseCenter, 0, 1),
    cubicPulseWidth: num(o.cubicPulseWidth, d.cubicPulseWidth, 0.001, 2),
  };
}

function desContrast(raw: unknown): EditState["contrast"] {
  const d = DEFAULT_CONTRAST_STATE;
  const o = obj(raw);
  return {
    amount: num(o.amount, d.amount, -2, 2),
    pivot: num(o.pivot, d.pivot, 0, 1),
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    curve: desContrastCurve(o.curve),
  };
}

function desBalance(raw: unknown): EditState["balance"] {
  const d = DEFAULT_BALANCE_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    exposure: num(o.exposure, d.exposure, -1, 1),
    saturation: num(o.saturation, d.saturation, -1, 1),
    temperature: num(o.temperature, d.temperature, -1, 1),
    tint: num(o.tint, d.tint, -1, 1),
    red: num(o.red, d.red, -1, 1),
    green: num(o.green, d.green, -1, 1),
    blue: num(o.blue, d.blue, -1, 1),
  };
}

function desScattering(raw: unknown): EditState["scattering"] {
  const d = DEFAULT_SCATTERING_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    shadowX: num(o.shadowX, d.shadowX, 0, 1),
    shadowY: num(o.shadowY, d.shadowY, 0, 1),
    highlightX: num(o.highlightX, d.highlightX, 0, 1),
    highlightY: num(o.highlightY, d.highlightY, 0, 1),
    balance: num(o.balance, d.balance, -1, 1),
    preserveLuminance: bool(o.preserveLuminance, d.preserveLuminance),
  };
}

function desRefraction(raw: unknown): EditState["refraction"] {
  const d = DEFAULT_REFRACTION_STATE;
  const o = obj(raw);
  const vectors =
    Array.isArray(o.mapVectors) && o.mapVectors.length === 24
      ? o.mapVectors.map((v, i) => num(v, d.mapVectors[i], -360, 360))
      : [...d.mapVectors];
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    mapVectors: vectors,
    separation: num(o.separation, d.separation, 0, 1),
    preserveLuminance: bool(o.preserveLuminance, d.preserveLuminance),
  };
}

function desSaturation(raw: unknown): EditState["saturation"] {
  const d = DEFAULT_SATURATION_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    curve: desCurveModel(o.curve, d.curve),
  };
}

function desRGBRow(raw: unknown, def: EditState["rgbMixer"]["red"]): EditState["rgbMixer"]["red"] {
  const o = obj(raw);
  return {
    r: num(o.r, def.r, -2, 2),
    g: num(o.g, def.g, -2, 2),
    b: num(o.b, def.b, -2, 2),
  };
}

function desRGBMixer(raw: unknown): EditState["rgbMixer"] {
  const d = DEFAULT_RGB_MIXER_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    red: desRGBRow(o.red, d.red),
    green: desRGBRow(o.green, d.green),
    blue: desRGBRow(o.blue, d.blue),
    preserveLuminance: bool(o.preserveLuminance, d.preserveLuminance),
  };
}

function desDensityChroma(raw: unknown): EditState["densityChroma"] {
  const d = DEFAULT_DENSITY_CHROMA_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    densityBypass: bool(o.densityBypass, d.densityBypass ?? false),
    chromaBypass: bool(o.chromaBypass, d.chromaBypass ?? false),
    density: desCurveModel(o.density, d.density),
    chroma: desCurveModel(o.chroma, d.chroma),
  };
}

function desRadiance(raw: unknown): EditState["radiance"] {
  const d = DEFAULT_RADIANCE_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    curve: desCurveModel(o.curve, d.curve),
  };
}

function desTone(raw: unknown): EditState["tone"] {
  const d = DEFAULT_TONE_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    curve: desCurveModel(o.curve, d.curve),
  };
}

function desPoint3(raw: unknown, def: [number, number, number]): [number, number, number] {
  const a = arr(raw);
  return [num(a[0], def[0], 0, 1), num(a[1], def[1], 0, 1), num(a[2], def[2], 0, 1)];
}

function desShadowHighlight(raw: unknown): EditState["shadowHighlight"] {
  const d = DEFAULT_SHADOW_HIGHLIGHT_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    blackPoint: desPoint3(o.blackPoint, d.blackPoint),
    whitePoint: desPoint3(o.whitePoint, d.whitePoint),
    blackLinked: bool(o.blackLinked, d.blackLinked),
    whiteLinked: bool(o.whiteLinked, d.whiteLinked),
  };
}

function desExposure(raw: unknown): EditState["exposure"] {
  const d = DEFAULT_EXPOSURE_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    curve: desCurveModel(o.curve, d.curve),
  };
}

function desPreset(raw: unknown): EditState["preset"] {
  const d = { ...DEFAULT_EDIT_STATE.preset };
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    selectedPresetId: typeof o.selectedPresetId === "string" ? o.selectedPresetId : undefined,
    strength: num(o.strength, d.strength, 0, 1),
    preserveUserAdjustments: bool(o.preserveUserAdjustments, d.preserveUserAdjustments),
  };
}

function desGrain(raw: unknown): EditState["grain"] {
  const d = DEFAULT_GRAIN_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    amount: num(o.amount, d.amount, 0, 1),
    acutance: num(o.acutance, d.acutance, 0, 1),
    resolution: num(o.resolution, d.resolution, 0, 1),
    colorAmount: num(o.colorAmount, d.colorAmount, 0, 1),
    seed: num(o.seed, d.seed, 0, 9999),
  };
}

function desHalation(raw: unknown): EditState["halation"] {
  const d = DEFAULT_HALATION_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    amount: num(o.amount, d.amount, 0, 1),
    spill: num(o.spill, d.spill, 0, 1),
    hue: num(o.hue, d.hue, 0, 1),
    saturation: num(o.saturation, d.saturation, 0, 1),
    quality: str(o.quality, FX_QUALITIES, d.quality),
  };
}

function desDiffusion(raw: unknown): EditState["diffusion"] {
  const d = DEFAULT_DIFFUSION_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    amount: num(o.amount, d.amount, 0, 1),
    fog: num(o.fog, d.fog, 0, 1),
    threshold: num(o.threshold, d.threshold, 0, 1),
    focusProtect: num(o.focusProtect, d.focusProtect, 0, 1),
    centerX: num(o.centerX, d.centerX, 0, 1),
    centerY: num(o.centerY, d.centerY, 0, 1),
    quality: str(o.quality, FX_QUALITIES, d.quality),
  };
}

function desSpotlight(raw: unknown): EditState["spotlight"] {
  const d = DEFAULT_SPOTLIGHT_STATE;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    bypass: bool(o.bypass, d.bypass),
    amount: num(o.amount, d.amount, 0, 1),
    contrast: num(o.contrast, d.contrast, 0, 1),
    bias: num(o.bias, d.bias, 0, 1),
    focus: num(o.focus, d.focus, 0, 1),
    centerX: num(o.centerX, d.centerX, 0, 1),
    centerY: num(o.centerY, d.centerY, 0, 1),
  };
}

function desTransform(raw: unknown): EditState["transform"] {
  const d = DEFAULT_TRANSFORM_STATE;
  const o = obj(raw);
  const rawOri = o.orientation;
  const orientation = ([0, 90, 180, 270] as const).includes(rawOri as 0 | 90 | 180 | 270)
    ? (rawOri as 0 | 90 | 180 | 270)
    : d.orientation;
  return {
    enabled: bool(o.enabled, d.enabled),
    cropEnabled: bool(o.cropEnabled, d.cropEnabled),
    cropX: num(o.cropX, d.cropX, 0, 1),
    cropY: num(o.cropY, d.cropY, 0, 1),
    cropWidth: num(o.cropWidth, d.cropWidth, 0.001, 1),
    cropHeight: num(o.cropHeight, d.cropHeight, 0.001, 1),
    aspectRatio: str(o.aspectRatio, ASPECT_RATIOS, d.aspectRatio),
    orientation,
    straighten: num(o.straighten, d.straighten, -45, 45),
    flipX: bool(o.flipX, d.flipX),
    flipY: bool(o.flipY, d.flipY),
  };
}

function desDistortionPoints(raw: unknown): DistortionPoints {
  const d = DEFAULT_DISTORT_STATE.distortionPoints;
  const a = arr(raw);
  if (a.length !== 8) return [...d] as DistortionPoints;
  return a.map((value, index) => num(value, d[index], -1.75, 1.75)) as DistortionPoints;
}

function desDistort(raw: unknown): EditState["distort"] {
  const d = DEFAULT_DISTORT_STATE;
  const o = obj(raw);
  const mesh = arr(o.distortionMesh)
    .map((value) => num(value, 0, -4, 4))
    .filter(Number.isFinite);
  return {
    enabled: bool(o.enabled, d.enabled),
    distortionAmount: num(o.distortionAmount, d.distortionAmount, -100, 100),
    distortionHorizontal: num(o.distortionHorizontal, d.distortionHorizontal, -100, 100),
    distortionVertical: num(o.distortionVertical, d.distortionVertical, -100, 100),
    distortionPoints: desDistortionPoints(o.distortionPoints),
    distortionMesh: mesh.length > 0 ? new Float32Array(mesh) : null,
    perspectiveMode: bool(o.perspectiveMode, d.perspectiveMode),
    showGrid: bool(o.showGrid, d.showGrid),
    autoCrop: bool(o.autoCrop, d.autoCrop),
  };
}

function desRetouch(raw: unknown): EditState["retouch"] {
  const o = obj(raw);
  const spots = arr(o.spots).slice(0, MAX_RETOUCH_SPOTS).map((rawSpot): RetouchSpot => {
    const spot = obj(rawSpot);
    const position = arr(spot.position);
    const sourcePosition = arr(spot.sourcePosition);
    const size = arr(spot.size);
    return {
      id: typeof spot.id === "string" && spot.id ? spot.id : createRetouchSpotId(),
      type: "spot",
      position: [num(position[0], 0, -2, 2), num(position[1], 0, -2, 2)],
      sourcePosition: [
        num(sourcePosition[0], 0.2, -2, 2),
        num(sourcePosition[1], 0.2, -2, 2),
      ],
      size: [num(size[0], 0.2, 0.001, 4), num(size[1], 0.2, 0.001, 4)],
      angle: num(spot.angle, 0, -3600, 3600),
      feather: num(spot.feather, 0.4, 0, 1),
      opacity: num(spot.opacity, 1, 0, 1),
      mode: num(spot.mode, 1, 0, 1) < 0.5 ? 0 : 1,
      disabled: bool(spot.disabled, false) || undefined,
    };
  });
  return {
    enabled: bool(o.enabled, DEFAULT_RETOUCH_STATE.enabled),
    bypass: bool(o.bypass, DEFAULT_RETOUCH_STATE.bypass),
    spots,
  };
}

const INPUT_COLOR_SPACES: EditState["colorManagement"]["inputColorSpace"][] = [
  "srgb",
  "rec709",
  "linear-srgb",
  "sony-slog3-sgamut3cine",
  "arri-logc3-awg3",
  "canon-clog3-cinema-gamut",
  "panasonic-vlog-vgamut",
  "red-log3g10-rwg",
  "acescg",
  "aces2065-1",
];
const WORKING_COLOR_SPACES: EditState["colorManagement"]["workingColorSpace"][] = [
  "linear-srgb",
  "acescg",
];
const DISPLAY_COLOR_SPACES: EditState["colorManagement"]["displayColorSpace"][] = [
  "srgb",
  "rec709-gamma24",
  "display-p3",
  "rec2020",
];
const VIEW_TRANSFORMS: EditState["colorManagement"]["viewTransform"][] = [
  "none",
  "standard",
  "filmic",
  "aces-like",
  "soft-clip",
];
const DEBUG_VIEWS: EditState["colorManagement"]["debugView"][] = [
  "none",
  "input",
  "working",
  "toneMapped",
  "output",
  "clipping",
];
const LUT_STORAGE_MODES: LUTStorageMode[] = ["auto", "2d-atlas", "3d-texture"];
const OCIO_LUT_SIZES = [17, 33, 64] as const;

function desOCIOState(raw: unknown): EditState["colorManagement"]["ocio"] {
  const o = obj(raw);
  return {
    selectedConfigId: typeof o.selectedConfigId === "string" ? o.selectedConfigId : undefined,
    inputColorSpaceName:
      typeof o.inputColorSpaceName === "string" ? o.inputColorSpaceName : undefined,
    workingColorSpaceName:
      typeof o.workingColorSpaceName === "string" ? o.workingColorSpaceName : undefined,
    displayName: typeof o.displayName === "string" ? o.displayName : undefined,
    viewName: typeof o.viewName === "string" ? o.viewName : undefined,
    lookName: typeof o.lookName === "string" ? o.lookName : undefined,
  };
}

function desOCIORuntimeState(raw: unknown): EditState["colorManagement"]["ocioRuntime"] {
  const d = DEFAULT_COLOR_MANAGEMENT_STATE.ocioRuntime;
  const o = obj(raw);
  const rawSize = num(o.bakedLUTSize, d.bakedLUTSize);
  const bakedLUTSize = (OCIO_LUT_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as 17 | 33 | 64)
    : d.bakedLUTSize;
  return {
    enabled: bool(o.enabled, d.enabled),
    mode: str(o.mode, OCIO_RUNTIME_MODES as OCIORuntimeMode[], d.mode),
    selectedConfigId: typeof o.selectedConfigId === "string" ? o.selectedConfigId : undefined,
    sourceColorSpace: typeof o.sourceColorSpace === "string" ? o.sourceColorSpace : undefined,
    display: typeof o.display === "string" ? o.display : undefined,
    view: typeof o.view === "string" ? o.view : undefined,
    look: typeof o.look === "string" ? o.look : undefined,
    selectedPlanId: typeof o.selectedPlanId === "string" ? o.selectedPlanId : undefined,
    externalFileRefs: arr(o.externalFileRefs).filter(
      (item): item is string => typeof item === "string",
    ),
    bakedLUTSize,
    useBakedLUT: bool(o.useBakedLUT, d.useBakedLUT),
  };
}

function desToneMapping(raw: unknown): EditState["colorManagement"]["toneMapping"] {
  const d = DEFAULT_COLOR_MANAGEMENT_STATE.toneMapping;
  const o = obj(raw);
  return {
    enabled: bool(o.enabled, d.enabled),
    exposureBias: num(o.exposureBias, d.exposureBias, -3, 3),
    highlightCompression: num(o.highlightCompression, d.highlightCompression, 0, 1),
    shoulderStrength: num(o.shoulderStrength, d.shoulderStrength, 0, 1),
    blackLift: num(o.blackLift, d.blackLift, 0, 0.2),
  };
}

function desColorManagement(raw: unknown): EditState["colorManagement"] {
  const d = DEFAULT_COLOR_MANAGEMENT_STATE;
  const o = obj(raw);
  // Phase 28 "log-placeholder" was removed in Phase 29 — migrate it to sRGB.
  const rawInput = o.inputColorSpace === "log-placeholder" ? "srgb" : o.inputColorSpace;
  // Phase 28/29 display "rec709" was renamed to "rec709-gamma24" in Phase 30.
  const rawDisplay = o.displayColorSpace === "rec709" ? "rec709-gamma24" : o.displayColorSpace;
  const inputColorSpaceId = firstString(
    o,
    ["inputColorSpaceId", "legacyInputId", "legacyInputID", "idt", "IDT", "inputId", "inputID"],
    d.inputColorSpaceId,
  );
  const displayColorSpaceId = firstString(
    o,
    [
      "displayColorSpaceId",
      "legacyDisplayId",
      "legacyDisplayID",
      "odt",
      "ODT",
      "displayId",
      "displayID",
      "outputId",
      "outputID",
    ],
    d.displayColorSpaceId,
  );
  return {
    enabled: bool(o.enabled, d.enabled),
    inputColorSpace: str(rawInput, INPUT_COLOR_SPACES, d.inputColorSpace),
    workingColorSpace: str(o.workingColorSpace, WORKING_COLOR_SPACES, d.workingColorSpace),
    displayColorSpace: str(rawDisplay, DISPLAY_COLOR_SPACES, d.displayColorSpace),
    viewTransform: str(o.viewTransform, VIEW_TRANSFORMS, d.viewTransform),
    useOutputTransform: bool(o.useOutputTransform, d.useOutputTransform),
    useGamutMapping: bool(o.useGamutMapping, d.useGamutMapping),
    useAcesPipeline: bool(o.useAcesPipeline, bool(o.useLegacyAces, d.useAcesPipeline)),
    inputColorSpaceId: isInputTransformId(inputColorSpaceId)
      ? inputColorSpaceId
      : d.inputColorSpaceId,
    displayColorSpaceId: isDisplayTransformId(displayColorSpaceId)
      ? displayColorSpaceId
      : d.displayColorSpaceId,
    toneMapping: desToneMapping(o.toneMapping),
    debugView: str(o.debugView, DEBUG_VIEWS, d.debugView),
    ocio: desOCIOState(o.ocio),
    ocioRuntime: desOCIORuntimeState(o.ocioRuntime),
  };
}

const MATCH_STATUS: MatchStatus[] = ["idle", "analyzing", "active", "error"];

// The baked 16³ half-float LUT (legacy stored Array.from of it). Accept only a
// fully-sized grid (16³ RGB = 12288 entries); anything else falls back to no match.
function desMatchLut(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 16 ** 3 * 3) return null;
  return v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0));
}

function desMatch(raw: unknown): EditState["match"] {
  const d = DEFAULT_MATCH_STATE;
  const o = obj(raw);
  const lut = desMatchLut(o.lut);
  const sourceId = firstString(
    o,
    ["sourceId", "sourceID", "source", "sourceMediaId", "sourceMediaID"],
    d.sourceId,
  );
  const sourceIdt = firstString(
    o,
    [
      "sourceIdt",
      "sourceIDT",
      "sourceIdT",
      "sourceIDt",
      "IDT",
      "idt",
      "inputColorSpaceId",
      "legacyInputId",
      "legacyInputID",
    ],
    d.sourceIdt,
  );
  return {
    referenceId: typeof o.referenceId === "string" ? o.referenceId : d.referenceId,
    referenceName: typeof o.referenceName === "string" ? o.referenceName : undefined,
    sourceId,
    sourceIdt,
    sourceSignature: typeof o.sourceSignature === "string" ? o.sourceSignature : d.sourceSignature,
    colorMix: num(o.colorMix, d.colorMix, 0, 1),
    lumaMix: num(o.lumaMix, d.lumaMix, 0, 1),
    lut,
    generatedAt: typeof o.generatedAt === "number" ? o.generatedAt : d.generatedAt,
    bypass: bool(o.bypass, d.bypass),
    status: lut ? "active" : str(o.status, MATCH_STATUS, "idle"),
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

function desEngineSettings(raw: unknown): EditState["engineSettings"] {
  const d = DEFAULT_ENGINE_SETTINGS;
  const o = obj(raw);
  return {
    lutStorageMode: str(o.lutStorageMode, LUT_STORAGE_MODES, d.lutStorageMode),
  };
}

function desPresentationBorder(raw: unknown): PresentationBorderSettings {
  const d = DEFAULT_PRESENTATION_BORDER;
  const o = obj(raw);
  const frameImage = obj(o.frameImage);
  return normalizePresentationBorder({
    enabled: bool(o.enabled, d.enabled),
    preset: str(o.preset, PRESENTATION_BORDER_PRESETS, d.preset),
    color: color255(o.color, d.color),
    opacity: num(o.opacity, d.opacity, 0, 1),
    backgroundMode: str(o.backgroundMode, PRESENTATION_BORDER_BACKGROUNDS, d.backgroundMode),
    frameImage:
      typeof frameImage.dataUrl === "string" && frameImage.dataUrl
        ? {
            dataUrl: frameImage.dataUrl,
            name: typeof frameImage.name === "string" ? frameImage.name : "Frame image",
            width: num(frameImage.width, 1, 1),
            height: num(frameImage.height, 1, 1),
            rotationDegrees: ([0, 90, 180, 270] as const).includes(
              frameImage.rotationDegrees as 0 | 90 | 180 | 270,
            )
              ? (frameImage.rotationDegrees as 0 | 90 | 180 | 270)
              : 0,
          }
        : undefined,
    blurAmount: num(o.blurAmount, d.blurAmount, 0, 80),
    aspectRatio: str(o.aspectRatio, PRESENTATION_BORDER_ASPECTS, d.aspectRatio),
    imageScale: num(o.imageScale, d.imageScale, 0.5, 1),
    imageRadius: num(o.imageRadius, d.imageRadius, 0, 1),
    frameRadius: num(o.frameRadius, d.frameRadius, 0, 1),
    imageShadow: num(o.imageShadow, d.imageShadow, 0, 1),
    imageInnerShadow: num(o.imageInnerShadow, d.imageInnerShadow, 0, 1),
    size: num(o.size, d.size, 0, 0.5),
    linked: bool(o.linked, d.linked),
    top: num(o.top, d.top, 0, 0.5),
    right: num(o.right, d.right, 0, 0.5),
    bottom: num(o.bottom, d.bottom, 0, 0.5),
    left: num(o.left, d.left, 0, 0.5),
  });
}

const MASK_TYPES = [
  "color-pick",
  "luminosity",
  "brush",
  "radial",
  "gradient",
  "luminance",
  "depth",
] as const;

function desLocalAdjustments(raw: unknown): EditState["localAdjustments"] {
  const items = arr(raw);
  return items.map((item) => {
    const layer = obj(item);
    const rawComps = arr(layer.components);
    const components = rawComps.map((cRaw) => {
      const c = obj(cRaw);
      const type = str(c.type, MASK_TYPES as any, "color-pick") as MaskType;
      
      if (type === "gradient") {
        return {
          id: typeof c.id === "string" ? c.id : "",
          type: "gradient" as const,
          startPoint: [num(arr(c.startPoint)[0], 0.5, 0, 1), num(arr(c.startPoint)[1], 0.75, 0, 1)] as [number, number],
          endPoint: [num(arr(c.endPoint)[0], 0.5, 0, 1), num(arr(c.endPoint)[1], 0.25, 0, 1)] as [number, number],
          reflect: bool(c.reflect, false),
          invert: bool(c.invert, false),
          opacity: num(c.opacity, 1, 0, 1),
          alpha: num(c.alpha, 1, 0, 1),
          showOverlay: c.showOverlay !== undefined ? bool(c.showOverlay, true) : undefined,
        };
      }

      if (type === "luminance") {
        return {
          id: typeof c.id === "string" ? c.id : "",
          type: "luminance" as const,
          target:     num(c.target,     1,   0, 1),
          range:      num(c.range,      0.7, 0, 1),
          smoothness: num(c.smoothness, 1,   0, 1),
          invert:     bool(c.invert, false),
          opacity:    num(c.opacity, 1, 0, 1),
          alpha:      num(c.alpha,   1, 0, 1),
          showOverlay: c.showOverlay !== undefined ? bool(c.showOverlay, true) : undefined,
        };
      }

      if (type === "depth") {
        return {
          id: typeof c.id === "string" ? c.id : "",
          type: "depth" as const,
          target: num(c.target, 1, 0, 1),
          range: num(c.range, 0.25, 0, 1),
          invert: bool(c.invert, false),
          opacity: num(c.opacity, 1, 0, 1),
          alpha: num(c.alpha, 1, 0, 1),
          showOverlay: c.showOverlay !== undefined ? bool(c.showOverlay, true) : undefined,
        };
      }

      if (type === "brush") {
        const brush = c.brush == null
          ? null
          : arr(c.brush).map((strokeRaw, strokeIndex) => {
              const stroke = obj(strokeRaw);
              return {
                id: typeof stroke.id === "string" ? stroke.id : `stroke-${strokeIndex}`,
                mode: str(stroke.mode, ["mask", "erase"] as const, "mask"),
                points: arr(stroke.points).map((pointRaw) => {
                  const point = obj(pointRaw);
                  return {
                    x: num(point.x, 0.5, 0, 1),
                    y: num(point.y, 0.5, 0, 1),
                    pressure: num(point.pressure, 0.5, 0, 1),
                    time: num(point.time, 0, 0),
                  };
                }),
                radius: num(stroke.radius, 0.15, 0.0001, 1),
                opacity: num(stroke.opacity, 0.8, 0, 1),
                hardness: num(stroke.hardness, 0, 0, 1),
                masking: num(stroke.masking, 0, 0, 1),
                spacing: num(stroke.spacing, 0.25, 0.001, 1),
                interpolate: bool(stroke.interpolate, true),
                randomize: num(stroke.randomize, 0, 0, 1),
              };
            });

        return {
          id: typeof c.id === "string" ? c.id : "",
          type: "brush" as const,
          brush,
          brush_radius: num(c.brush_radius, 0.15, 0.01, 1),
          brush_opacity: num(c.brush_opacity, 0.8, 0, 1),
          brush_hardness: num(c.brush_hardness, 0, 0, 1),
          brush_masking: num(c.brush_masking, 0, 0, 1),
          brush_erase: bool(c.brush_erase, false),
          invert: bool(c.invert, false),
          opacity: num(c.opacity, 1, 0, 1),
          alpha: num(c.alpha, 1, 0, 1),
          mode: str(c.mode, ["mask", "combine"] as const, "mask"),
          showOverlay: c.showOverlay !== undefined ? bool(c.showOverlay, true) : undefined,
        };
      }

      return {
        id: typeof c.id === "string" ? c.id : "",
        type,
        sampleX: num(c.sampleX, 0.5, 0, 1),
        sampleY: num(c.sampleY, 0.5, 0, 1),
        position: [num(arr(c.position)[0], 0.5, 0, 1), num(arr(c.position)[1], 0.5, 0, 1)] as [number, number],
        size: [num(arr(c.size)[0], 0.25, 0.0001, 10), num(arr(c.size)[1], 0.25, 0.0001, 10)] as [number, number],
        angle: num(c.angle, 0),
        useRadius: bool(c.useRadius, false),
        sampledColor: color255(c.sampledColor, [1, 0, 0]),
        selectedColor: color255(c.selectedColor ?? c.sampledColor, [1, 0, 0]),
        useSelectedColor: bool(c.useSelectedColor, false),
        threshold: num(c.threshold, 0.25, 0, 1),
        feather: num(c.feather, 0.25, 0, 1),
        invert: bool(c.invert, false),
        opacity: num(c.opacity, 1, 0, 1),
        alpha: num(c.alpha, 1, 0, 1),
        // Luminosity mask properties
        luminosityCenter: type === "luminosity" ? num(c.luminosityCenter, 0.5, 0, 1) : undefined,
        luminosityRange: type === "luminosity" ? num(c.luminosityRange, 0.3, 0, 1) : undefined,
        // Brush mask properties
        brushMask: c.brushMask,
        brushMaskSize: c.brushMaskSize ? [
          num(arr(c.brushMaskSize)[0], 0),
          num(arr(c.brushMaskSize)[1], 0),
        ] as [number, number] : undefined,
        brushHardness: c.brushHardness !== undefined
          ? num(c.brushHardness, 0.8, 0, 1)
          : undefined,
        // Radial mask property
        showOverlay: type === "radial" ? bool(c.showOverlay, true) : undefined,
      };
    });
    const adjs = obj(layer.adjustments);
    return {
      id: typeof layer.id === "string" ? layer.id : "",
      name: typeof layer.name === "string" ? layer.name : "Mask",
      enabled: bool(layer.enabled, true),
      components,
      adjustments: deserializeColorState(adjs),
    };
  });
}

// ── main entry point ───────────────────────────────────────────────────────

/**
 * Safely converts a SerializedEditState (or unknown JSON blob) into a valid
 * EditState, filling any missing fields with defaults and clamping out-of-range
 * numbers. Never throws for well-formed JSON objects.
 */
export function deserializeColorState(o: AnyObj) {
  return {
    curve: desCurve(o.curve),
    contrast: desContrast(o.contrast),
    balance: desBalance(o.balance),
    scattering: desScattering(o.scattering),
    refraction: desRefraction(o.refraction),
    saturation: desSaturation(o.saturation),
    rgbMixer: desRGBMixer(o.rgbMixer),
    densityChroma: desDensityChroma(o.densityChroma),
    radiance: desRadiance(o.radiance),
    tone: desTone(o.tone),
    shadowHighlight: desShadowHighlight(o.shadowHighlight),
    exposure: desExposure(o.exposure),
  };
}

export function deserializeEditState(raw: SerializedEditState | unknown): EditState {
  const o = obj(raw);
  return {
    ...deserializeColorState(o),
    preset: desPreset(o.preset),
    match: desMatch(o.match),
    grain: desGrain(o.grain),
    halation: desHalation(o.halation),
    diffusion: desDiffusion(o.diffusion),
    spotlight: desSpotlight(o.spotlight),
    transform: desTransform(o.transform),
    distort: desDistort(o.distort),
    retouch: desRetouch(o.retouch),
    presentationBorder: desPresentationBorder(o.presentationBorder),
    colorManagement: desColorManagement(o.colorManagement),
    engineSettings: desEngineSettings(o.engineSettings),
    localAdjustments: desLocalAdjustments(o.localAdjustments),
    overlays: deserializeEditorOverlays(o.overlays),
  };
}

