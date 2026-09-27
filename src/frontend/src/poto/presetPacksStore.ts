import { createSignal, createRoot, createEffect, untrack } from "solid-js";
import { activeAssetId } from "./sessionController";
import {
  OFFICIAL_PACKS,
  loadOfficialPack,
  type PresetData,
  type PresetEntry,
  type PresetMeta,
  type OfficialPack,
} from "../engine/presets/officialPacks";
import {
  applyPreset,
  presetExpectedLook,
  currentMatchesPreset,
  type LookState,
} from "./applyPreset";
import { downloadBlob } from "../ui/util/downloadBlob";

const STORAGE_KEY = "poto-preset-packs-v2";
const LEGACY_INSTALLED_KEY = "poto-installed-packs";
const LEGACY_CUSTOM_KEY = "poto-custom-presets";
export const CUSTOM_PACK_NAME = "Custom";

// Standalone preset-library overlay visibility. Kept here so every entry point
// observes one state and the legacy overlay can still be mounted independently.
export const [libraryOpen, setLibraryOpen] = createSignal(false);
const DEFAULT_PRESET_ID = "kalar";
const ALL_PACKS_KEY = "all";
const ALLOWED_DATA_KEYS = new Set(["c", "s", "d", "l", "r", "g"]);
const IMPORT_ACCEPT_EXT = ".json";
const IMPORT_ERROR_FORMAT = "Could not import - unsupported file format";
const IMPORT_ERROR_ENCODING = "Could not import - unsupported file encoding";

const PRESET_DATA_DEFAULTS: Required<PresetData> = {
  c: {
    colorMix: 1,
    lumaMix: 1,
    lut: null,
    referenceID: "dZ8IUECXuQAl",
    sourceID: "",
    sourceIDT: "sRGB",
  },
  s: {
    colorVolume: [0.5, 0.5],
    colorBalance: [0.5, 0.5],
    shadows: [0.5, 0.5],
    highlights: [0.5, 0.5],
    shadowMapVectors: [
      [0, 1],
      [60, 1],
      [120, 1],
      [180, 1],
      [240, 1],
      [300, 1],
    ],
    highlightMapVectors: [
      [0, 1],
      [60, 1],
      [120, 1],
      [180, 1],
      [240, 1],
      [300, 1],
    ],
    separation: 0.5,
  },
  d: {
    hueVsDensity: [
      [0, 0.5],
      [0.167, 0.5],
      [0.333, 0.5],
      [0.583, 0.5],
      [0.805, 0.5],
      [1, 0.5],
    ],
    hvdInterpolation: "Bezier",
    chromaVsDensity: [
      [0, 0.5],
      [0.333, 0.5],
      [0.667, 0.5],
      [1, 0.5],
    ],
    cvdInterpolation: "Cubic",
    lumaVsDensity: [
      [0, 0.5],
      [0.25, 0.5],
      [0.5, 0.5],
      [0.75, 0.5],
      [1, 0.5],
    ],
    lvdInterpolation: "Bezier",
  },
  l: {
    lumaVsLuma: [
      [0, 0],
      [0.167, 0.167],
      [0.333, 0.333],
      [0.833, 0.833],
      [1, 1],
    ],
    lvlInterpolation: "Cubic",
    hueVsLuma: [
      [0, 0.5],
      [0.167, 0.5],
      [0.333, 0.5],
      [0.583, 0.5],
      [0.805, 0.5],
      [1, 0.5],
    ],
    hvlInterpolation: "Bezier",
    expVsLuma: [
      [0, 0.5],
      [0.333, 0.5],
      [0.667, 0.5],
      [1, 0.5],
    ],
    evlInterpolation: "Cubic",
    blackPoint: [0.5, 0.5, 0.5],
    whitePoint: [0.5, 0.5, 0.5],
    bpLinked: true,
    wpLinked: true,
  },
  r: {
    acutanceAmount: 0,
    filmResolution: 0.5,
    grainDensity: 0,
    grainChroma: 0.5,
    halationMix: 0,
    halationHue: 0.5,
    halationSat: 0.5,
    halationSpl: 0.5,
    diffusionAmount: 0,
    diffusionThreshold: 0,
    diffusionFadeLevel: 0,
    diffusionCenterProtection: 0,
    diffusionCenter: [0.5, 0.5],
    spotlightAmount: 0,
    spotlightContrast: 0.5,
    spotlightBias: 0.5,
    spotlightFocus: 0.5,
    spotlightCenter: [0.5, 0.5],
  },
  g: {
    presetID: DEFAULT_PRESET_ID,
  },
};

export type PresetPack = {
  name: string;
  lastModified: number;
  presets: PresetEntry[];
};

export type FlatPreset = {
  id: string;
  packSlug: string;
  packTitle: string;
  name: string;
  data: PresetData;
  meta: PresetMeta;
  entry: PresetEntry;
};

export type OfficialPackState =
  | "not_installed"
  | "installed"
  | "missing"
  | "out_of_sync"
  | "modified";

export type OfficialPackStatus = {
  installed: number;
  modified: number;
  expected: number;
  state: OfficialPackState;
};

export type ImportPresetResult = {
  success: boolean;
  message: string;
};

export type SavePresetEditorInput = {
  mode: "create" | "update";
  source?: FlatPreset;
  name: string;
  description: string;
  packName: string;
  data: PresetData;
  generated?: boolean;
};

function defaultPreset(): PresetEntry {
  return {
    name: "Custom",
    data: { g: { presetID: DEFAULT_PRESET_ID } },
    meta: { packName: CUSTOM_PACK_NAME },
  };
}

function clonePreset(preset: PresetEntry): PresetEntry {
  return JSON.parse(JSON.stringify(preset)) as PresetEntry;
}

function clonePacks(packs: PresetPack[]): PresetPack[] {
  return packs.map((pack) => ({
    name: pack.name,
    lastModified: pack.lastModified,
    presets: pack.presets.map(clonePreset),
  }));
}

function now() {
  return Date.now();
}

function makeId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function presetIdOf(preset: PresetEntry): string {
  const gid = (preset.data?.g as { presetID?: unknown } | undefined)?.presetID;
  return typeof gid === "string" && gid ? gid : "";
}

function assignPresetId(preset: PresetEntry, id = makeId()) {
  if (!preset.data || typeof preset.data !== "object") preset.data = {};
  const g = (preset.data.g && typeof preset.data.g === "object" ? preset.data.g : {}) as Record<
    string,
    unknown
  >;
  g.presetID = id;
  preset.data.g = g;
}

function ensureMeta(preset: PresetEntry): PresetMeta {
  if (!preset.meta || typeof preset.meta !== "object") preset.meta = {};
  return preset.meta;
}

function ensureDefaultPack(packs: PresetPack[]): PresetPack[] {
  const next = clonePacks(packs);
  let custom = next.find((pack) => pack.name === CUSTOM_PACK_NAME);
  if (!custom) {
    custom = { name: CUSTOM_PACK_NAME, lastModified: 0, presets: [] };
    next.unshift(custom);
  } else if (next.indexOf(custom) > 0) {
    next.splice(next.indexOf(custom), 1);
    next.unshift(custom);
  }

  const defaultIndex = custom.presets.findIndex(
    (preset) => presetIdOf(preset) === DEFAULT_PRESET_ID,
  );
  if (defaultIndex < 0) {
    custom.presets.unshift(defaultPreset());
  } else if (defaultIndex > 0) {
    const [preset] = custom.presets.splice(defaultIndex, 1);
    custom.presets.unshift(preset);
  }
  custom.presets[0].meta = { ...custom.presets[0].meta, packName: CUSTOM_PACK_NAME };
  return next;
}

function loadStored(): PresetPack[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return ensureDefaultPack(parsed as PresetPack[]);
  } catch {
    // fall through to migration/default
  }
  return ensureDefaultPack(migrateOldStorage());
}

function migrateOldStorage(): PresetPack[] {
  const packs: PresetPack[] = [];
  try {
    const customRaw = localStorage.getItem(LEGACY_CUSTOM_KEY);
    const customParsed: unknown = customRaw ? JSON.parse(customRaw) : [];
    if (Array.isArray(customParsed) && customParsed.length) {
      packs.push({
        name: CUSTOM_PACK_NAME,
        lastModified: now(),
        presets: customParsed
          .map((preset) => normalizeImportedPreset(preset, CUSTOM_PACK_NAME, true))
          .filter(Boolean) as PresetEntry[],
      });
    }
  } catch {
    // ignore malformed old custom data
  }

  try {
    const installedRaw = localStorage.getItem(LEGACY_INSTALLED_KEY);
    const installedParsed: unknown = installedRaw ? JSON.parse(installedRaw) : {};
    if (installedParsed && typeof installedParsed === "object") {
      for (const pack of OFFICIAL_PACKS) {
        const list = (installedParsed as Record<string, unknown>)[pack.slug];
        if (!Array.isArray(list)) continue;
        packs.push({
          name: pack.name,
          lastModified: now(),
          presets: list.map((preset) =>
            markOfficialPreset(preset as PresetEntry, pack.name, pack.source),
          ),
        });
      }
    }
  } catch {
    // ignore malformed old official data
  }

  return packs;
}

function persist(packs: PresetPack[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
  } catch {
    // quota/private mode: keep session state reactive.
  }
}

const [packs, setPacks] = createSignal<PresetPack[]>(loadStored());
export { packs };

function savePacks(next: PresetPack[]) {
  const normalized = ensureDefaultPack(next);
  setPacks(normalized);
  persist(normalized);
}

function presetIdExists(id: string): boolean {
  return packs().some((pack) => pack.presets.some((preset) => presetIdOf(preset) === id));
}

function selectedPresetStillExists(): boolean {
  const selected = selectedPresetId();
  return !selected || presetIdExists(selected);
}

function selectFallbackPreset(): void {
  const fallback = packs()[0]?.presets[0];
  if (!fallback) {
    clearSelectedPreset();
    return;
  }
  setPreviewLook(null);
  applyPreset(fallback.data);
  setSelectedPresetId(presetIdOf(fallback));
  setSelectedPresetData(fallback.data);
}

function ensureSelectedPresetValid(): void {
  if (!selectedPresetStillExists()) selectFallbackPreset();
}

function findPack(name: string): PresetPack | undefined {
  return packs().find((pack) => pack.name === name);
}

export function presetPackNames(): string[] {
  return packs().map((pack) => pack.name);
}

function getOrCreatePack(list: PresetPack[], name: string, index: number): PresetPack {
  let pack = list.find((p) => p.name === name);
  if (pack) return pack;
  pack = { name, lastModified: now(), presets: [] };
  let insertIndex = index;
  if (name === CUSTOM_PACK_NAME) insertIndex = 0;
  else if (insertIndex === 0) insertIndex = 1;
  list.splice(Math.max(0, Math.min(insertIndex, list.length)), 0, pack);
  return pack;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateValue(defaultValue: unknown, value: unknown): unknown {
  if (defaultValue === value) return cloneValue(defaultValue);
  if (Array.isArray(defaultValue))
    return Array.isArray(value) ? cloneValue(value) : cloneValue(defaultValue);
  if (defaultValue === null) return typeof value === "object" ? cloneValue(value) : null;
  if (isRecord(defaultValue)) {
    if (!isRecord(value)) return cloneValue(defaultValue);
    return validateModule(defaultValue, value);
  }
  return typeof value === typeof defaultValue ? cloneValue(value) : cloneValue(defaultValue);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateModule(
  defaults: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaults)) out[key] = validateValue(defaults[key], source[key]);
  return out;
}

function normalizeData(raw: unknown): PresetData | null {
  if (!isRecord(raw)) return null;
  const out: PresetData = {};
  for (const [key, value] of Object.entries(raw)) {
    if (ALLOWED_DATA_KEYS.has(key) && isRecord(value)) {
      (out as Record<string, Record<string, unknown>>)[key] = validateModule(
        PRESET_DATA_DEFAULTS[key as keyof PresetData],
        value,
      );
    }
  }
  return Object.keys(out).length ? out : null;
}

function normalizeImportedPreset(
  raw: unknown,
  packName: string,
  preserveId = false,
): PresetEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as PresetEntry;
  if (typeof source.name !== "string" || !source.name.trim()) return null;
  const data = normalizeData(source.data);
  if (!data) return null;
  const preset: PresetEntry = {
    name: source.name.trim(),
    data,
    meta: { ...(source.meta && typeof source.meta === "object" ? source.meta : {}) },
  };
  const meta = ensureMeta(preset);
  const stamp = now();
  meta.packName = packName;
  meta.installDate = stamp;
  meta.lastModified = stamp;
  if (!preserveId) assignPresetId(preset);
  else if (!presetIdOf(preset)) assignPresetId(preset);
  return preset;
}

function markOfficialPreset(raw: PresetEntry, packName: string, source: string): PresetEntry {
  const preset = clonePreset(raw);
  const meta = ensureMeta(preset);
  const baseId = presetIdOf(preset);
  const stamp = now();
  meta.packName = packName;
  meta.basePackName = packName;
  meta.basePackSource = source;
  meta.basePresetID = baseId;
  meta.installDate = stamp;
  meta.lastModified = stamp;
  meta.modifiedFromBase = false;
  return preset;
}

export function installedPresets(): FlatPreset[] {
  return packs().flatMap((pack) =>
    pack.presets.map((preset) => ({
      id: presetIdOf(preset),
      packSlug: pack.name,
      packTitle: pack.name,
      name: preset.name,
      data: preset.data,
      meta: ensureMeta(preset),
      entry: preset,
    })),
  );
}

export function visiblePresetCount(): number {
  return installedPresets().length;
}

export const isDefaultPreset = (preset: PresetEntry) => presetIdOf(preset) === DEFAULT_PRESET_ID;
export const isDefaultPack = (packName: string) => packName === CUSTOM_PACK_NAME;
export const isInstalled = (name: string, source = "official") =>
  packs().some((pack) =>
    pack.presets.some(
      (preset) => preset.meta?.basePackName === name && preset.meta?.basePackSource === source,
    ),
  );

export async function resolveOfficialPackState(pack: OfficialPack): Promise<OfficialPackStatus> {
  const installed = packs()
    .flatMap((p) => p.presets)
    .filter(
      (preset) =>
        preset.meta?.basePackName === pack.name && preset.meta?.basePackSource === pack.source,
    );
  const modified = installed.filter((preset) => preset.meta?.modifiedFromBase).length;
  if (installed.length === 0) {
    return { installed: 0, modified: 0, expected: 0, state: "not_installed" };
  }
  if (modified > 0) {
    return { installed: installed.length, modified, expected: installed.length, state: "modified" };
  }
  const expected = (await loadOfficialPack(pack)).length;
  if (installed.length === expected) {
    return { installed: installed.length, modified, expected, state: "installed" };
  }
  return {
    installed: installed.length,
    modified,
    expected,
    state: installed.length < expected ? "missing" : "out_of_sync",
  };
}

export async function installPack(pack: OfficialPack): Promise<void> {
  const sourcePresets = await loadOfficialPack(pack);
  const next = clonePacks(packs());
  const target = getOrCreatePack(next, pack.name, 0);
  target.presets.unshift(
    ...sourcePresets.map((preset) => markOfficialPreset(preset, pack.name, pack.source)),
  );
  target.lastModified = now();
  savePacks(next);
}

export async function installMissingPackPresets(pack: OfficialPack): Promise<void> {
  const sourcePresets = await loadOfficialPack(pack);
  const existingIds = new Set(
    packs()
      .flatMap((p) => p.presets)
      .filter(
        (preset) =>
          preset.meta?.basePackName === pack.name && preset.meta?.basePackSource === pack.source,
      )
      .map((preset) => preset.meta?.basePresetID || presetIdOf(preset)),
  );
  const missing = sourcePresets.filter((preset) => !existingIds.has(presetIdOf(preset)));
  if (!missing.length) return;
  const next = clonePacks(packs());
  const target = getOrCreatePack(next, pack.name, 0);
  target.presets.unshift(
    ...missing.map((preset) => markOfficialPreset(preset, pack.name, pack.source)),
  );
  target.lastModified = now();
  savePacks(next);
}

export function uninstallPack(name: string, source = "official"): void {
  const next = clonePacks(packs());
  for (const pack of next) {
    pack.presets = pack.presets.filter(
      (preset) => !(preset.meta?.basePackName === name && preset.meta?.basePackSource === source),
    );
  }
  savePacks(next.filter((pack) => pack.name === CUSTOM_PACK_NAME || pack.presets.length > 0));
  ensureSelectedPresetValid();
}

export async function reinstallPack(pack: OfficialPack): Promise<void> {
  uninstallPack(pack.name, pack.source);
  await installPack(pack);
}

export async function runOfficialPackPrimaryAction(
  pack: OfficialPack,
  state: OfficialPackState,
): Promise<void> {
  if (state === "not_installed") return installPack(pack);
  if (state === "missing") return installMissingPackPresets(pack);
  if (state === "modified" || state === "out_of_sync") return reinstallPack(pack);
}

export async function importPresetFile(file: File | undefined): Promise<ImportPresetResult | null> {
  if (!file) return null;
  if (!file.name.toLowerCase().endsWith(IMPORT_ACCEPT_EXT)) {
    throw new Error(IMPORT_ERROR_FORMAT);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error(IMPORT_ERROR_ENCODING);
  }

  const rawPresets = Array.isArray(parsed) ? parsed : [parsed];
  if (!rawPresets.length) {
    return { success: false, message: "Could not import - no presets found in file." };
  }

  const firstPackName = getRawPackName(rawPresets[0]);
  const importPack =
    firstPackName && rawPresets.every((preset) => getRawPackName(preset) === firstPackName)
      ? firstPackName
      : CUSTOM_PACK_NAME;
  const next = clonePacks(packs());
  const target = getOrCreatePack(next, importPack, 0);
  let failed = 0;

  for (const raw of rawPresets) {
    const preset = normalizeImportedPreset(raw, importPack);
    if (!preset) {
      failed += 1;
      continue;
    }
    if (importPack === CUSTOM_PACK_NAME) target.presets.splice(1, 0, preset);
    else target.presets.unshift(preset);
  }

  target.lastModified = now();
  savePacks(next);

  if (failed === rawPresets.length) {
    return {
      success: false,
      message: IMPORT_ERROR_ENCODING,
    };
  }
  if (failed) {
    return {
      success: true,
      message: `Import complete. (${failed} preset${failed > 1 ? "s" : ""} could not be imported because the encoding was not accepted.)`,
    };
  }
  return {
    success: true,
    message:
      rawPresets.length === 1 ? "Preset imported successfully" : "Presets imported successfully",
  };
}

function getRawPackName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = (raw as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const packName = (meta as { packName?: unknown }).packName;
  return typeof packName === "string" && packName.trim() ? packName.trim() : null;
}

export function exportPreset(preset: FlatPreset): void {
  if (isDefaultPreset(preset.entry) || preset.meta.basePackName) return;
  downloadBlob(
    new Blob([JSON.stringify(preset.entry)], { type: "application/json" }),
    `${preset.name}.json`,
  );
}

export function exportPack(packName: string): void {
  const pack = findPack(packName);
  if (!pack) return;
  const presets = pack.name === CUSTOM_PACK_NAME ? pack.presets.slice(1) : pack.presets;
  downloadBlob(
    new Blob([JSON.stringify(presets)], { type: "application/json" }),
    `${packName}.json`,
  );
}

export function renamePack(oldName: string, newName: string): void {
  const clean = newName.trim();
  if (!clean || oldName === CUSTOM_PACK_NAME || oldName === clean || findPack(clean)) return;
  const next = clonePacks(packs());
  const pack = next.find((p) => p.name === oldName);
  if (!pack) return;
  pack.name = clean;
  pack.lastModified = now();
  for (const preset of pack.presets) ensureMeta(preset).packName = clean;
  savePacks(next);
}

export function deletePack(packName: string): void {
  if (packName === CUSTOM_PACK_NAME) return;
  savePacks(packs().filter((pack) => pack.name !== packName));
  ensureSelectedPresetValid();
}

export function deletePreset(preset: FlatPreset): void {
  if (isDefaultPreset(preset.entry) || preset.meta.basePackName) return;
  const next = clonePacks(packs());
  const pack = next.find((candidate) => candidate.name === preset.packSlug);
  if (!pack) return;
  const id = preset.id;
  pack.presets = pack.presets.filter((entry) => presetIdOf(entry) !== id);
  savePacks(
    next.filter((candidate) => candidate.name === CUSTOM_PACK_NAME || candidate.presets.length > 0),
  );
  ensureSelectedPresetValid();
}

export function renamePreset(preset: FlatPreset, name: string): void {
  const clean = name.trim();
  if (!clean || isDefaultPreset(preset.entry) || preset.meta.basePackName) return;
  const next = clonePacks(packs());
  const pack = next.find((candidate) => candidate.name === preset.packSlug);
  const entry = pack?.presets.find((candidate) => presetIdOf(candidate) === preset.id);
  if (!entry) return;
  entry.name = clean;
  ensureMeta(entry).lastModified = now();
  pack!.lastModified = now();
  savePacks(next);
}

export function updatePreset(preset: FlatPreset, data: PresetData): void {
  if (isDefaultPreset(preset.entry) || preset.meta.basePackName) return;
  const next = clonePacks(packs());
  const pack = next.find((candidate) => candidate.name === preset.packSlug);
  const entry = pack?.presets.find((candidate) => presetIdOf(candidate) === preset.id);
  if (!entry) return;
  entry.data = JSON.parse(JSON.stringify(data)) as PresetData;
  ensureMeta(entry).lastModified = now();
  pack!.lastModified = now();
  savePacks(next);
  setSelectedPresetData(entry.data);
}

export function saveCustomPreset(name: string, data: PresetData): void {
  const next = clonePacks(packs());
  const target = getOrCreatePack(next, CUSTOM_PACK_NAME, 0);
  const preset: PresetEntry = {
    name,
    data: JSON.parse(JSON.stringify(data)) as PresetData,
    meta: { generated: true, packName: CUSTOM_PACK_NAME, installDate: now(), lastModified: now() },
  };
  assignPresetId(preset);
  target.presets.splice(1, 0, preset);
  target.lastModified = now();
  savePacks(next);
}

function pruneEmptyNonDefaultPacks(list: PresetPack[]): PresetPack[] {
  return list.filter((pack) => pack.name === CUSTOM_PACK_NAME || pack.presets.length > 0);
}

export function savePresetFromEditor(input: SavePresetEditorInput): void {
  const cleanName = input.name.trim();
  const cleanPackName = input.packName.trim();
  if (!cleanName || !cleanPackName) return;
  if (input.mode === "update" && (!input.source || isDefaultPreset(input.source.entry))) return;
  if (input.mode === "update" && input.source?.meta.basePackName) return;

  const stamp = now();
  const next = clonePacks(packs());
  let entry: PresetEntry | null = null;

  if (input.mode === "update" && input.source) {
    const sourcePack = next.find((candidate) => candidate.name === input.source!.packSlug);
    const sourceIndex =
      sourcePack?.presets.findIndex((candidate) => presetIdOf(candidate) === input.source!.id) ??
      -1;
    if (!sourcePack || sourceIndex < 0) return;
    [entry] = sourcePack.presets.splice(sourceIndex, 1);
    sourcePack.lastModified = stamp;
  } else {
    entry = {
      name: cleanName,
      data: cloneValue(input.data),
      meta: {},
    };
    assignPresetId(entry);
  }

  entry.name = cleanName;
  entry.data = cloneValue(input.data);
  if (input.mode === "update" && input.source) assignPresetId(entry, input.source.id);
  else assignPresetId(entry);

  const meta = ensureMeta(entry);
  meta.description = input.description;
  meta.packName = cleanPackName;
  meta.lastModified = stamp;
  if (!meta.installDate) meta.installDate = stamp;
  if (input.generated) meta.generated = true;

  const target = getOrCreatePack(next, cleanPackName, 0);
  const insertIndex = cleanPackName === CUSTOM_PACK_NAME ? 1 : 0;
  target.presets.splice(insertIndex, 0, entry);
  target.lastModified = stamp;

  savePacks(pruneEmptyNonDefaultPacks(next));
  if (input.mode === "update" && input.source?.id === selectedPresetId()) {
    setSelectedPresetData(entry.data);
  }
}

const [selectedPresetId, setSelectedPresetId] = createSignal<string | null>(null);
export { selectedPresetId, setSelectedPresetId };
const [selectedPresetData, setSelectedPresetData] = createSignal<PresetData | null>(null);

export function clearSelectedPreset(): void {
  setSelectedPresetId(null);
  setSelectedPresetData(null);
}

let loadingDefaultOfficialPacks = false;

/** Keep every official preset visible and available in the local editor. */
async function ensureDefaultOfficialPacks(): Promise<void> {
  if (loadingDefaultOfficialPacks) return;
  loadingDefaultOfficialPacks = true;
  try {
    // Sequential installation is intentional: each update builds on the previous
    // reactive pack state instead of concurrent writes overwriting one another.
    for (const pack of OFFICIAL_PACKS) await installMissingPackPresets(pack);
  } catch (error) {
    console.warn("[presets] Unable to load all default preset packs", error);
  } finally {
    loadingDefaultOfficialPacks = false;
  }
}

createRoot(() => {
  untrack(() => void ensureDefaultOfficialPacks());
});

// The selected preset (panel "active" highlight + "edited" badge) is per-image
// session state: the look itself is restored from each asset's editState, but
// "which preset that look came from" is not serialized. These signals are
// module-global, so without this they leak across images — switching to a
// different photo would keep the previous photo's preset highlighted and
// compare the new photo's look against the wrong preset (a spurious "edited"
// badge). Remember the selection per asset and swap it in on every image change.
type PresetSelection = { id: string; data: PresetData };
const selectionByAsset = new Map<string, PresetSelection | null>();

createRoot(() => {
  let prevAsset: string | null = null;
  let initialized = false;
  createEffect(() => {
    const asset = activeAssetId();
    untrack(() => {
      if (initialized && prevAsset !== asset) {
        // Persist the outgoing asset's current selection.
        if (prevAsset !== null) {
          const id = selectedPresetId();
          const data = selectedPresetData();
          selectionByAsset.set(prevAsset, id && data ? { id, data } : null);
        }
        // Restore the incoming asset's selection (or clear if it has none).
        const saved = asset ? selectionByAsset.get(asset) : null;
        if (saved && presetIdExists(saved.id)) {
          setSelectedPresetId(saved.id);
          setSelectedPresetData(saved.data);
        } else {
          if (asset && saved) selectionByAsset.set(asset, null);
          clearSelectedPreset();
        }
      }
      prevAsset = asset;
      initialized = true;
    });
  });
});

const [previewLook, setPreviewLook] = createSignal<LookState | null>(null);
export { previewLook };

/** Renderer-only preset preview, equivalent to legacy state.transmit(). */
export function transmitPresetLook(look: LookState): void {
  setPreviewLook(look);
}

/** Disposes a renderer-only preset preview without touching committed state. */
export function disposePresetLookPreview(): void {
  setPreviewLook(null);
}

export function previewPreset(p: FlatPreset): void {
  transmitPresetLook(presetExpectedLook(p.data));
}

export function endPreview(): void {
  disposePresetLookPreview();
}

export function commitPreset(p: FlatPreset): boolean {
  setPreviewLook(null);
  applyPreset(p.data);
  setSelectedPresetId(p.id);
  setSelectedPresetData(p.data);
  return true;
}

export function presetEdited(): boolean {
  const data = selectedPresetData();
  return data != null && !currentMatchesPreset(data);
}

export function packFilterOptions(): Array<{ slug: string; title: string }> {
  return [
    { slug: ALL_PACKS_KEY, title: "All Packs" },
    ...packs().map((pack) => {
      return {
        slug: pack.name,
        title: pack.name,
      };
    }),
  ];
}
