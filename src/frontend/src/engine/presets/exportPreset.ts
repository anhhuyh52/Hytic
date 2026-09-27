import type { ColorState } from "../state/EditState";
import type { PartialPresetLook, PresetDefinition } from "./PresetTypes";

export const PRESET_FILE_TYPE = "color-engine-preset" as const;
export const PRESET_SCHEMA_VERSION = 1 as const;
const APP_VERSION = "phase-25";

/**
 * The on-disk JSON wrapper for a single exported preset/look. Contains only
 * plain color-look JSON — never image data, project ids, transform, FX, masks,
 * local layers, or scopes/UI state.
 */
export type ExportedPresetFile = {
  schemaVersion: typeof PRESET_SCHEMA_VERSION;
  type: typeof PRESET_FILE_TYPE;
  preset: PresetDefinition;
  createdAt: number;
  appVersion?: string;
};

export function generatePresetId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Captures the current resolved global color state as a reusable preset look.
 * Deep-clones every section so the result shares no references with the engine
 * state. Only the seven global color panels are included.
 */
export function colorStateToPresetLook(color: ColorState): PartialPresetLook {
  return {
    curve: {
      bypass: color.curve.bypass,
      mode: color.curve.mode,
      points: color.curve.points.map((p) => ({ x: p.x, y: p.y })),
    },
    contrast: {
      amount: color.contrast.amount,
      pivot: color.contrast.pivot,
      enabled: color.contrast.enabled,
      bypass: color.contrast.bypass,
      curve: {
        bypass: color.contrast.curve.bypass,
        mode: color.contrast.curve.mode,
        points: color.contrast.curve.points.map((p) => ({ x: p.x, y: p.y })),
        amount: color.contrast.curve.amount,
        gain: color.contrast.curve.gain,
        parabolaPower: color.contrast.curve.parabolaPower,
        pcurveA: color.contrast.curve.pcurveA,
        pcurveB: color.contrast.curve.pcurveB,
        expImpulseK: color.contrast.curve.expImpulseK,
        cubicPulseCenter: color.contrast.curve.cubicPulseCenter,
        cubicPulseWidth: color.contrast.curve.cubicPulseWidth,
      },
    },
    balance: { ...color.balance },
    saturation: { ...color.saturation },
    rgbMixer: {
      enabled: color.rgbMixer.enabled,
      bypass: color.rgbMixer.bypass,
      red: { ...color.rgbMixer.red },
      green: { ...color.rgbMixer.green },
      blue: { ...color.rgbMixer.blue },
      preserveLuminance: color.rgbMixer.preserveLuminance,
    },
    densityChroma: { ...color.densityChroma },
    radiance: { ...color.radiance },
  };
}

export function createPresetFromColorState(params: {
  name: string;
  color: ColorState;
  description?: string;
  category?: string;
  id?: string;
}): PresetDefinition {
  return {
    id: params.id ?? generatePresetId(),
    name: params.name.trim() || "Custom Preset",
    description: params.description,
    category: params.category ?? "Custom",
    look: colorStateToPresetLook(params.color),
  };
}

export function wrapPresetForExport(preset: PresetDefinition): ExportedPresetFile {
  return {
    schemaVersion: PRESET_SCHEMA_VERSION,
    type: PRESET_FILE_TYPE,
    preset,
    createdAt: Date.now(),
    appVersion: APP_VERSION,
  };
}

/** Serializes a preset definition to a pretty-printed JSON Blob for download. */
export function presetFileToBlob(preset: PresetDefinition): Blob {
  const json = JSON.stringify(wrapPresetForExport(preset), null, 2);
  return new Blob([json], { type: "application/json" });
}
