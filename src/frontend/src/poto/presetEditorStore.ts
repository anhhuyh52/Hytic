import { createSignal } from "solid-js";
import type { PresetData, PresetMeta } from "../engine/presets/officialPacks";
import type { FlatPreset } from "./presetPacksStore";

export type PresetEditorMode = "create" | "update";

export type PresetEditorDraftPreset = {
  name: string;
  data: PresetData;
  meta?: PresetMeta;
};

export type PresetEditorRequest = {
  mode: PresetEditorMode;
  preset: FlatPreset | PresetEditorDraftPreset;
  useActiveImageState: boolean;
  anchor: { x: number; y: number } | null;
};

const [presetEditorRequest, setPresetEditorRequest] = createSignal<PresetEditorRequest | null>(
  null,
);

export { presetEditorRequest };

export function openPresetEditor(
  x: number | null,
  y: number | null,
  request: Omit<PresetEditorRequest, "anchor">,
): void {
  setPresetEditorRequest({
    ...request,
    anchor: Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null,
  });
}

export function closePresetEditor(): void {
  setPresetEditorRequest(null);
}
