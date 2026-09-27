import type {
  BalanceState,
  ContrastCurveMode,
  ContrastCurvePoint,
  ContrastCurveState,
  ContrastState,
  CurveMode,
  CurvePoint,
  CurveState,
  DensityChromaState,
  EditState,
  CurveModel,
  RGBMixerRow,
  RGBMixerState,
  RadianceState,
  SaturationState,
} from "../state/EditState";
import { DEFAULT_EDIT_STATE, cloneEditState } from "../state/EditState";
import type { PartialPresetLook, PresetDefinition } from "./PresetTypes";

type CurveLikePoint = CurvePoint | ContrastCurvePoint;

export function resolvePresetState(baseState: EditState, presets: PresetDefinition[]): EditState {
  const baseClone = cloneEditState(baseState);
  const strength = clamp01(baseState.preset.strength);

  if (
    !baseState.preset.enabled ||
    baseState.preset.bypass ||
    !baseState.preset.selectedPresetId ||
    strength === 0
  ) {
    return baseClone;
  }

  const selectedPreset = presets.find((preset) => preset.id === baseState.preset.selectedPresetId);

  if (!selectedPreset) {
    return baseClone;
  }

  const resolved = cloneEditState(baseState);
  applyPresetLook(
    resolved,
    baseState,
    DEFAULT_EDIT_STATE,
    selectedPreset.look,
    strength,
    baseState.preset.preserveUserAdjustments,
  );

  return resolved;
}

function applyPresetLook(
  resolved: EditState,
  baseState: EditState,
  defaultState: EditState,
  look: PartialPresetLook,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  applyCurveLook(
    resolved.curve,
    baseState.curve,
    defaultState.curve,
    look.curve,
    strength,
    preserveUserAdjustments,
  );
  applyContrastLook(
    resolved.contrast,
    baseState.contrast,
    defaultState.contrast,
    look.contrast,
    strength,
    preserveUserAdjustments,
  );
  applyBalanceLook(
    resolved.balance,
    baseState.balance,
    defaultState.balance,
    look.balance,
    strength,
    preserveUserAdjustments,
  );
  applySaturationLook(
    resolved.saturation,
    baseState.saturation,
    defaultState.saturation,
    look.saturation,
    strength,
    preserveUserAdjustments,
  );
  applyRGBMixerLook(
    resolved.rgbMixer,
    baseState.rgbMixer,
    defaultState.rgbMixer,
    look.rgbMixer,
    strength,
    preserveUserAdjustments,
  );
  applyDensityChromaLook(
    resolved.densityChroma,
    baseState.densityChroma,
    defaultState.densityChroma,
    look.densityChroma,
    strength,
    preserveUserAdjustments,
  );
  applyRadianceLook(
    resolved.radiance,
    baseState.radiance,
    defaultState.radiance,
    look.radiance,
    strength,
    preserveUserAdjustments,
  );
}

function applyCurveLook(
  resolved: CurveState,
  base: CurveState,
  defaults: CurveState,
  look: Partial<CurveState> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  resolved.mode = blendDiscrete(base.mode, look.mode, strength);
  resolved.points = blendCurvePoints(
    base.points,
    defaults.points,
    look.points,
    strength,
    preserveUserAdjustments,
  );
}

function applyContrastLook(
  resolved: ContrastState,
  base: ContrastState,
  defaults: ContrastState,
  look: PartialPresetLook["contrast"],
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.amount = resolveNumber(
    base.amount,
    defaults.amount,
    look.amount,
    strength,
    preserveUserAdjustments,
  );
  resolved.pivot = resolveNumber(
    base.pivot,
    defaults.pivot,
    look.pivot,
    strength,
    preserveUserAdjustments,
  );
  resolved.enabled = blendBoolean(base.enabled, look.enabled, strength);
  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  applyContrastCurveLook(
    resolved.curve,
    base.curve,
    defaults.curve,
    look.curve,
    strength,
    preserveUserAdjustments,
  );
}

function applyContrastCurveLook(
  resolved: ContrastCurveState,
  base: ContrastCurveState,
  defaults: ContrastCurveState,
  look: Partial<ContrastCurveState> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  resolved.mode = blendDiscrete(base.mode, look.mode, strength);
  resolved.points = blendCurvePoints(
    base.points,
    defaults.points,
    look.points,
    strength,
    preserveUserAdjustments,
  );
  resolved.amount = resolveNumber(
    base.amount,
    defaults.amount,
    look.amount,
    strength,
    preserveUserAdjustments,
  );
  resolved.gain = resolveNumber(
    base.gain,
    defaults.gain,
    look.gain,
    strength,
    preserveUserAdjustments,
  );
  resolved.parabolaPower = resolveNumber(
    base.parabolaPower,
    defaults.parabolaPower,
    look.parabolaPower,
    strength,
    preserveUserAdjustments,
  );
  resolved.pcurveA = resolveNumber(
    base.pcurveA,
    defaults.pcurveA,
    look.pcurveA,
    strength,
    preserveUserAdjustments,
  );
  resolved.pcurveB = resolveNumber(
    base.pcurveB,
    defaults.pcurveB,
    look.pcurveB,
    strength,
    preserveUserAdjustments,
  );
  resolved.expImpulseK = resolveNumber(
    base.expImpulseK,
    defaults.expImpulseK,
    look.expImpulseK,
    strength,
    preserveUserAdjustments,
  );
  resolved.cubicPulseCenter = resolveNumber(
    base.cubicPulseCenter,
    defaults.cubicPulseCenter,
    look.cubicPulseCenter,
    strength,
    preserveUserAdjustments,
  );
  resolved.cubicPulseWidth = resolveNumber(
    base.cubicPulseWidth,
    defaults.cubicPulseWidth,
    look.cubicPulseWidth,
    strength,
    preserveUserAdjustments,
  );
}

function applyBalanceLook(
  resolved: BalanceState,
  base: BalanceState,
  defaults: BalanceState,
  look: Partial<BalanceState> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.enabled = blendBoolean(base.enabled, look.enabled, strength);
  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  resolved.temperature = resolveNumber(
    base.temperature,
    defaults.temperature,
    look.temperature,
    strength,
    preserveUserAdjustments,
  );
  resolved.tint = resolveNumber(
    base.tint,
    defaults.tint,
    look.tint,
    strength,
    preserveUserAdjustments,
  );
  resolved.red = resolveNumber(base.red, defaults.red, look.red, strength, preserveUserAdjustments);
  resolved.green = resolveNumber(
    base.green,
    defaults.green,
    look.green,
    strength,
    preserveUserAdjustments,
  );
  resolved.blue = resolveNumber(
    base.blue,
    defaults.blue,
    look.blue,
    strength,
    preserveUserAdjustments,
  );
}

// Blends a legacy [0,1] grading curve (mode + points) by preset strength.
function applyCurveModelLook(
  resolved: CurveModel,
  base: CurveModel,
  defaults: CurveModel,
  look: Partial<CurveModel> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;
  resolved.mode = blendDiscrete(base.mode, look.mode, strength);
  resolved.points = blendCurvePoints(
    base.points,
    defaults.points,
    look.points,
    strength,
    preserveUserAdjustments,
  );
}

function applySaturationLook(
  resolved: SaturationState,
  base: SaturationState,
  defaults: SaturationState,
  look: Partial<SaturationState> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.enabled = blendBoolean(base.enabled, look.enabled, strength);
  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  applyCurveModelLook(
    resolved.curve,
    base.curve,
    defaults.curve,
    look.curve,
    strength,
    preserveUserAdjustments,
  );
}

function applyRGBMixerLook(
  resolved: RGBMixerState,
  base: RGBMixerState,
  defaults: RGBMixerState,
  look: PartialPresetLook["rgbMixer"],
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.enabled = blendBoolean(base.enabled, look.enabled, strength);
  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  applyRGBMixerRowLook(
    resolved.red,
    base.red,
    defaults.red,
    look.red,
    strength,
    preserveUserAdjustments,
  );
  applyRGBMixerRowLook(
    resolved.green,
    base.green,
    defaults.green,
    look.green,
    strength,
    preserveUserAdjustments,
  );
  applyRGBMixerRowLook(
    resolved.blue,
    base.blue,
    defaults.blue,
    look.blue,
    strength,
    preserveUserAdjustments,
  );
  resolved.preserveLuminance = blendBoolean(
    base.preserveLuminance,
    look.preserveLuminance,
    strength,
  );
}

function applyRGBMixerRowLook(
  resolved: RGBMixerRow,
  base: RGBMixerRow,
  defaults: RGBMixerRow,
  look: Partial<RGBMixerRow> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.r = resolveNumber(base.r, defaults.r, look.r, strength, preserveUserAdjustments);
  resolved.g = resolveNumber(base.g, defaults.g, look.g, strength, preserveUserAdjustments);
  resolved.b = resolveNumber(base.b, defaults.b, look.b, strength, preserveUserAdjustments);
}

function applyDensityChromaLook(
  resolved: DensityChromaState,
  base: DensityChromaState,
  defaults: DensityChromaState,
  look: Partial<DensityChromaState> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.enabled = blendBoolean(base.enabled, look.enabled, strength);
  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  applyCurveModelLook(
    resolved.density,
    base.density,
    defaults.density,
    look.density,
    strength,
    preserveUserAdjustments,
  );
  applyCurveModelLook(
    resolved.chroma,
    base.chroma,
    defaults.chroma,
    look.chroma,
    strength,
    preserveUserAdjustments,
  );
}

function applyRadianceLook(
  resolved: RadianceState,
  base: RadianceState,
  defaults: RadianceState,
  look: Partial<RadianceState> | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (!look) return;

  resolved.enabled = blendBoolean(base.enabled, look.enabled, strength);
  resolved.bypass = blendBoolean(base.bypass, look.bypass, strength);
  applyCurveModelLook(
    resolved.curve,
    base.curve,
    defaults.curve,
    look.curve,
    strength,
    preserveUserAdjustments,
  );
}

function resolveNumber(
  baseValue: number,
  defaultValue: number,
  presetValue: number | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
) {
  if (presetValue === undefined) {
    return baseValue;
  }

  if (preserveUserAdjustments) {
    return baseValue + (presetValue - defaultValue) * strength;
  }

  return blendNumber(baseValue, presetValue, strength);
}

function blendNumber(baseValue: number, presetValue: number, strength: number) {
  return baseValue + (presetValue - baseValue) * strength;
}

function blendBoolean(baseValue: boolean, presetValue: boolean | undefined, strength: number) {
  return presetValue === undefined || strength < 0.5 ? baseValue : presetValue;
}

function blendDiscrete<T extends CurveMode | ContrastCurveMode>(
  baseValue: T,
  presetValue: T | undefined,
  strength: number,
) {
  return presetValue === undefined || strength < 0.5 ? baseValue : presetValue;
}

function blendCurvePoints<TPoint extends CurveLikePoint>(
  basePoints: TPoint[],
  defaultPoints: TPoint[],
  presetPoints: TPoint[] | undefined,
  strength: number,
  preserveUserAdjustments: boolean,
): TPoint[] {
  if (!presetPoints) {
    return basePoints.map((point) => ({ ...point }));
  }

  if (basePoints.length !== presetPoints.length) {
    return strength >= 1
      ? presetPoints.map((point) => ({ ...point }))
      : basePoints.map((point) => ({ ...point }));
  }

  const canUseDefaultDeltas =
    preserveUserAdjustments && defaultPoints.length === presetPoints.length;

  return basePoints.map((basePoint, index) => {
    const presetPoint = presetPoints[index];
    const defaultPoint = canUseDefaultDeltas ? defaultPoints[index] : basePoint;

    return {
      ...basePoint,
      x: resolveNumber(basePoint.x, defaultPoint.x, presetPoint.x, strength, canUseDefaultDeltas),
      y: resolveNumber(basePoint.y, defaultPoint.y, presetPoint.y, strength, canUseDefaultDeltas),
    } as TPoint;
  });
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
