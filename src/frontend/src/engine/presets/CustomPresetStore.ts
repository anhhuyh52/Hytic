import { createSignal } from "solid-js";
import type { PresetDefinition } from "./PresetTypes";
import { DEFAULT_PRESETS } from "./defaultPresets";
import { parsePresetFile } from "./importPreset";
import { presetFileToBlob } from "./exportPreset";
import { downloadBlob, slugify } from "../../ui/util/downloadBlob";

const STORAGE_KEY = "poto-custom-presets";

// ── persistence ────────────────────────────────────────────────────────────

function isPlausiblePreset(v: unknown): v is PresetDefinition {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PresetDefinition).id === "string" &&
    typeof (v as PresetDefinition).name === "string" &&
    typeof (v as PresetDefinition).look === "object" &&
    (v as PresetDefinition).look !== null
  );
}

function loadFromStorage(): PresetDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlausiblePreset);
  } catch {
    return [];
  }
}

function persist(presets: PresetDefinition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage may be full or unavailable (private mode) — non-fatal.
  }
}

// ── reactive store ───────────────────────────────────────────────────────

const [customPresets, setCustomPresets] = createSignal<PresetDefinition[]>(loadFromStorage());

/** Reactive accessor for custom (imported / saved-look) presets. */
export { customPresets };

/** All presets the engine should resolve against: built-ins + custom. */
export function allPresets(): PresetDefinition[] {
  return [...DEFAULT_PRESETS, ...customPresets()];
}

export function listCustomPresets(): PresetDefinition[] {
  return customPresets();
}

/** Inserts or updates a custom preset (matched by id) and persists. */
export function saveCustomPreset(preset: PresetDefinition): void {
  const list = customPresets();
  const index = list.findIndex((p) => p.id === preset.id);
  const next =
    index >= 0 ? [...list.slice(0, index), preset, ...list.slice(index + 1)] : [...list, preset];
  setCustomPresets(next);
  persist(next);
}

export function deleteCustomPreset(id: string): void {
  const next = customPresets().filter((p) => p.id !== id);
  setCustomPresets(next);
  persist(next);
}

/** Generates an id that doesn't collide with any built-in or custom preset. */
function makeUniqueId(baseId: string): string {
  const existing = new Set(allPresets().map((p) => p.id));
  if (!existing.has(baseId)) return baseId;
  let suffix = 2;
  while (existing.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

/**
 * Reads + validates a `.json` preset file, assigns a conflict-free id, stores
 * it, and returns it. Does NOT apply the preset — the caller decides that.
 * Throws PresetImportError for invalid files.
 */
export async function importPreset(file: File): Promise<PresetDefinition> {
  const text = await file.text();
  const parsed = parsePresetFile(text);
  const preset: PresetDefinition = { ...parsed, id: makeUniqueId(parsed.id) };
  saveCustomPreset(preset);
  return preset;
}

/** Downloads a preset (built-in or custom) as a `.json` file. */
export function exportPreset(id: string): void {
  const preset = allPresets().find((p) => p.id === id);
  if (!preset) throw new Error(`Preset ${id} not found.`);
  downloadBlob(presetFileToBlob(preset), `${slugify(preset.name)}.json`);
}
