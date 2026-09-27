import type { SerializedEditState } from "../project/ProjectTypes";
import { cloneJson, mergeJsonPatch } from "./jsonState";

export type MediaEditModuleKey =
  | "idt"
  | "odt"
  | "match"
  | "distort"
  | "retouch"
  | "balance"
  | "exposure"
  | "contrast"
  | "scatter"
  | "refract"
  | "density"
  | "chroma"
  | "radiance"
  | "sat"
  | "rgb"
  | "spotlight"

  | "halation"
  | "diffusion"
  | "texture"
  | "transform"
  | "masks";

export type MediaEditPatch = Record<string, unknown>;

function ensurePatchObject(patch: MediaEditPatch, key: string): Record<string, unknown> {
  const current = patch[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  patch[key] = next;
  return next;
}

function addColorManagementFields(
  patch: MediaEditPatch,
  source: SerializedEditState,
  fields: string[],
): void {
  const colorManagement = source.colorManagement as unknown as Record<string, unknown> | undefined;
  if (!colorManagement) return;
  const target = ensurePatchObject(patch, "colorManagement");
  for (const field of fields) {
    if (colorManagement[field] !== undefined) {
      target[field] = cloneJson(colorManagement[field]);
    }
  }
}

function addDensityChromaField(
  patch: MediaEditPatch,
  source: SerializedEditState,
  field: "density" | "chroma",
): void {
  const target = ensurePatchObject(patch, "densityChroma");
  target.enabled = source.densityChroma.enabled;
  target.bypass = source.densityChroma.bypass;
  target.densityBypass = source.densityChroma.densityBypass;
  target.chromaBypass = source.densityChroma.chromaBypass;
  target[field] = cloneJson(source.densityChroma[field]);
}

function addTopLevelEditModule<K extends keyof SerializedEditState>(
  patch: MediaEditPatch,
  source: SerializedEditState,
  key: K,
): void {
  const value = source[key];
  if (value !== undefined) patch[key] = cloneJson(value);
}

export function buildMediaEditPatch(
  source: SerializedEditState,
  modules: MediaEditModuleKey[],
): MediaEditPatch {
  const selected = new Set(modules);
  const patch: MediaEditPatch = {
    // Legacy Km always seeds copied edits with the selected preset identity.
    preset: cloneJson(source.preset),
  };

  if (selected.has("idt")) {
    addColorManagementFields(patch, source, ["enabled", "inputColorSpace", "inputColorSpaceId"]);
  }
  if (selected.has("odt")) {
    addColorManagementFields(patch, source, [
      "enabled",
      "displayColorSpace",
      "displayColorSpaceId",
      "viewTransform",
      "useOutputTransform",
      "useGamutMapping",
      "useAcesPipeline",
      "toneMapping",
    ]);
  }
  if (selected.has("match")) addTopLevelEditModule(patch, source, "match");
  if (selected.has("distort")) addTopLevelEditModule(patch, source, "distort");
  if (selected.has("retouch")) addTopLevelEditModule(patch, source, "retouch");
  if (selected.has("balance")) addTopLevelEditModule(patch, source, "balance");
  if (selected.has("exposure")) addTopLevelEditModule(patch, source, "exposure");
  if (selected.has("contrast")) addTopLevelEditModule(patch, source, "tone");
  if (selected.has("scatter")) addTopLevelEditModule(patch, source, "scattering");
  if (selected.has("refract")) addTopLevelEditModule(patch, source, "refraction");
  if (selected.has("density")) addDensityChromaField(patch, source, "density");
  if (selected.has("chroma")) addDensityChromaField(patch, source, "chroma");
  if (selected.has("radiance")) addTopLevelEditModule(patch, source, "radiance");
  if (selected.has("sat")) addTopLevelEditModule(patch, source, "saturation");
  if (selected.has("rgb")) addTopLevelEditModule(patch, source, "shadowHighlight");
  if (selected.has("spotlight")) addTopLevelEditModule(patch, source, "spotlight");

  if (selected.has("halation")) addTopLevelEditModule(patch, source, "halation");
  if (selected.has("diffusion")) addTopLevelEditModule(patch, source, "diffusion");
  if (selected.has("texture")) addTopLevelEditModule(patch, source, "grain");
  if (selected.has("transform")) addTopLevelEditModule(patch, source, "transform");
  if (selected.has("masks")) addTopLevelEditModule(patch, source, "localAdjustments");

  return patch;
}

export function mergeMediaEditPatch(
  target: SerializedEditState,
  patch: MediaEditPatch,
): SerializedEditState {
  return mergeJsonPatch(target, patch);
}
