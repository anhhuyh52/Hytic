import type {
  BalanceState,
  ContrastCurveState,
  ContrastState,
  CurveState,
  DensityChromaState,
  RGBMixerRow,
  RGBMixerState,
  RadianceState,
  SaturationState,
} from "../state/EditState";

export type PartialPresetLook = {
  curve?: Partial<CurveState>;
  contrast?: Omit<Partial<ContrastState>, "curve"> & {
    curve?: Partial<ContrastCurveState>;
  };
  balance?: Partial<BalanceState>;
  saturation?: Partial<SaturationState>;
  rgbMixer?: Omit<Partial<RGBMixerState>, "red" | "green" | "blue"> & {
    red?: Partial<RGBMixerRow>;
    green?: Partial<RGBMixerRow>;
    blue?: Partial<RGBMixerRow>;
  };
  densityChroma?: Partial<DensityChromaState>;
  radiance?: Partial<RadianceState>;
};

export type PresetDefinition = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  look: PartialPresetLook;
};
