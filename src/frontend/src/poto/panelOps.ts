/*
 * Per-panel reset / bypass operations for the control-panel-button hooks.
 * Reset restores the panel's editState slice to its engine default; bypass
 * toggles the slice's `bypass` flag (the engine honors it during render).
 */
import { editState, setEditState } from "../app/editor-store";
import {
  DEFAULT_BALANCE_STATE,
  DEFAULT_SCATTERING_STATE,
  DEFAULT_REFRACTION_STATE,
  DEFAULT_TONE_STATE,
  DEFAULT_SATURATION_STATE,
  DEFAULT_RADIANCE_STATE,
  DEFAULT_HALATION_STATE,
  DEFAULT_DIFFUSION_STATE,
  DEFAULT_SPOTLIGHT_STATE,

  DEFAULT_GRAIN_STATE,
  DEFAULT_EXPOSURE_STATE,
  DEFAULT_PRESET_STATE,
  DEFAULT_SHADOW_HIGHLIGHT_STATE,
  NEUTRAL_HUE_VS_DENSITY,
  NEUTRAL_CHROMA_VS_DENSITY,
  cloneCurveModel,
  type EditState,
} from "../engine/state/EditState";
import { DEFAULT_DISTORT_STATE, cloneDistortState } from "../features/distort/distortStore";
import { DEFAULT_RETOUCH_STATE, cloneRetouchState } from "../features/retouch/retouchTypes";
import { DEFAULT_MATCH_STATE, cloneMatchState } from "../engine/state/MatchTypes";
import type { PanelKey } from "./panels";
import { presetExpectedLook, MANAGED_SLICES, setLook, type ManagedSlice } from "./applyPreset";
import { clearSelectedPreset } from "./presetPacksStore";

type PresetsBypassSnapshot = Partial<Record<ManagedSlice, boolean>> & { preset?: boolean };

let presetsBypassSnapshot: PresetsBypassSnapshot | null = null;

function resetAllPresetEffects() {
  presetsBypassSnapshot = null;
  setLook(presetExpectedLook({}));
  setEditState("preset", { ...DEFAULT_PRESET_STATE });
  clearSelectedPreset();
}

function allPresetEffectsBypassed(state: EditState = editState): boolean {
  return MANAGED_SLICES.every((key) => !!state[key]?.bypass);
}

function toggleAllPresetEffectsBypass() {
  if (allPresetEffectsBypassed()) {
    const snapshot = presetsBypassSnapshot;
    for (const key of MANAGED_SLICES) {
      setEditState(key, "bypass", snapshot?.[key] ?? false);
    }
    setEditState("preset", "bypass", snapshot?.preset ?? false);
    presetsBypassSnapshot = null;
    return;
  }

  presetsBypassSnapshot = {};
  for (const key of MANAGED_SLICES) {
    presetsBypassSnapshot[key] = !!editState[key]?.bypass;
    setEditState(key, "bypass", true);
  }
  presetsBypassSnapshot.preset = editState.preset.bypass;
  setEditState("preset", "bypass", true);
}

export function resetPanel(key: PanelKey, setStore: any = setEditState) {
  switch (key) {
    case "balance":
      setStore("balance", { ...DEFAULT_BALANCE_STATE });
      break;
    case "distort":
      setEditState("distort", cloneDistortState(DEFAULT_DISTORT_STATE));
      break;
    case "retouch":
      setStore("retouch", cloneRetouchState(DEFAULT_RETOUCH_STATE));
      break;
    case "scattering":
      setStore("scattering", { ...DEFAULT_SCATTERING_STATE });
      break;
    case "refraction":
      setStore("refraction", {
        ...DEFAULT_REFRACTION_STATE,
        mapVectors: [...DEFAULT_REFRACTION_STATE.mapVectors],
      });
      break;
    case "contrast":
      // The legacy Contrast panel edits the faithful lumaVsLuma `tone` curve.
      setStore("tone", {
        ...DEFAULT_TONE_STATE,
        curve: cloneCurveModel(DEFAULT_TONE_STATE.curve),
      });
      break;
    case "saturation":
      setStore("saturation", {
        ...DEFAULT_SATURATION_STATE,
        curve: cloneCurveModel(DEFAULT_SATURATION_STATE.curve),
      });
      break;
    case "density":
      setStore("densityChroma", "density", cloneCurveModel(NEUTRAL_HUE_VS_DENSITY));
      break;
    case "chroma":
      setStore("densityChroma", "chroma", cloneCurveModel(NEUTRAL_CHROMA_VS_DENSITY));
      break;
    case "radiance":
      setStore("radiance", {
        ...DEFAULT_RADIANCE_STATE,
        curve: cloneCurveModel(DEFAULT_RADIANCE_STATE.curve),
      });
      break;
    case "halation":
      setStore("halation", { ...DEFAULT_HALATION_STATE });
      break;
    case "diffusion":
      setStore("diffusion", { ...DEFAULT_DIFFUSION_STATE });
      break;
    case "spotlight":
      setStore("spotlight", { ...DEFAULT_SPOTLIGHT_STATE });
      break;

    case "texture":
      setStore("grain", { ...DEFAULT_GRAIN_STATE });
      break;
    case "exposure":
      // The legacy Exposure Curve panel edits the faithful expVsLuma curve.
      setStore("exposure", {
        ...DEFAULT_EXPOSURE_STATE,
        curve: cloneCurveModel(DEFAULT_EXPOSURE_STATE.curve),
      });
      break;
    case "rgb":
      // The legacy "Shadow Highlight" panel edits the faithful rng_mod points.
      setStore("shadowHighlight", {
        ...DEFAULT_SHADOW_HIGHLIGHT_STATE,
        blackPoint: [...DEFAULT_SHADOW_HIGHLIGHT_STATE.blackPoint],
        whitePoint: [...DEFAULT_SHADOW_HIGHLIGHT_STATE.whitePoint],
      });
      break;
    case "presets":
      if (setStore === setEditState) resetAllPresetEffects();
      break;
    case "match":
      setStore("match", cloneMatchState(DEFAULT_MATCH_STATE));
      break;
    default:
      break;
  }
}

const BYPASS_PATH: Partial<Record<PanelKey, string>> = {
  match: "match",
  distort: "distort",
  retouch: "retouch",
  balance: "balance",
  scattering: "scattering",
  refraction: "refraction",
  contrast: "tone",
  saturation: "saturation",
  radiance: "radiance",
  halation: "halation",
  diffusion: "diffusion",
  spotlight: "spotlight",

  texture: "grain",
  exposure: "exposure",
  rgb: "shadowHighlight",
  presets: "preset",
};

export function getPanelBypass(key: PanelKey, state: EditState = editState): boolean {
  if (key === "presets") return allPresetEffectsBypassed(state);
  if (key === "distort") return !state.distort.enabled;
  if (key === "density") {
    return state.densityChroma.bypass || !!state.densityChroma.densityBypass;
  }
  if (key === "chroma") {
    return state.densityChroma.bypass || !!state.densityChroma.chromaBypass;
  }

  const path = BYPASS_PATH[key];
  if (!path) return false;
  return !!(state as any)[path]?.bypass;
}

export function togglePanelBypass(key: PanelKey, state: any = editState, setStore: any = setEditState) {
  if (key === "presets") {
    if (setStore === setEditState) toggleAllPresetEffectsBypass();
    return;
  }

  if (key === "density" || key === "chroma") {
    const field = key === "density" ? "densityBypass" : "chromaBypass";
    if (state.densityChroma.bypass) {
      // Migrate a legacy/shared bypass into independent flags while turning the
      // clicked panel back on and leaving the sibling bypassed.
      setStore("densityChroma", {
        ...state.densityChroma,
        bypass: false,
        densityBypass: key !== "density",
        chromaBypass: key !== "chroma",
      });
    } else {
      setStore("densityChroma", field, !getPanelBypass(key, state));
    }
    return;
  }

  const path = BYPASS_PATH[key];
  if (!path) return;
  if (key === "distort") {
    setStore("distort", "enabled", !state.distort.enabled);
    return;
  }
  setStore(path as any, "bypass", !getPanelBypass(key, state));
}
