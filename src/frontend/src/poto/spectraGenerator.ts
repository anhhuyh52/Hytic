/*
 * Spectra preset generator — faithful port of the legacy "preset-generator"
 * modal (package.min.js:28191). Despite the "AI" branding, the legacy
 * generator is a positional random remix of the installed preset pool:
 *
 * - Horizontal cell grid layout (1x9 grid); the center cell is the origin state itself.
 * - Each cell remixes panels s/d/l/r from random presets; with probability
 *   (x+y)/2 a panel is built per-property from *different* presets
 *   (top-right = chaotic hybrids, bottom-left = coherent whole panels).
 * - Position skews the result: x pushes s.colorBalance[0] cool→warm,
 *   y sets s.colorVolume[1] (exposure) dark→bright, both remapped to 0.3..0.7.
 * - When the origin is not the neutral state, variants are anchored to it:
 *   shadow/highlight wheels lerp 35–75% from origin toward the random value,
 *   the origin's map vectors are copied verbatim, and the origin's entire
 *   `l` panel (tone curves + black/white point) is kept — so the user's
 *   tonality is preserved and only color/density/texture vary.
 *
 * Variants stay in preset-data format; preview/commit reuses the
 * applyPreset converter the preset panel already uses.
 */
import { createSignal } from "solid-js";
import type { PresetData } from "../engine/presets/officialPacks";
import type { CurveModel, ManualCurveMode } from "../engine/state/EditState";
import { presetExpectedLook, setLook, snapshotLook, type LookState } from "./applyPreset";
import {
  installedPresets,
  clearSelectedPreset,
  disposePresetLookPreview,
  saveCustomPreset,
  isDefaultPreset,
  selectedPresetId,
  transmitPresetLook,
} from "./presetPacksStore";

export const ROWS = 3;
export const COLS = 3;
export const CENTER_INDEX = Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2);

export type GeneratedCell = {
  id: string; // "Origin" for the center, else a 6-char id
  /** Legacy preset data, or null = "the look captured when the modal opened". */
  data: PresetData | null;
  /** Cell swatch color; null for the origin cell (transparent). */
  grey: string | null;
};

// ── Session state ───────────────────────────────────────────────────────────
const [generatorOpen, setGeneratorOpen] = createSignal(false);
const [cells, setCells] = createSignal<GeneratedCell[]>([]);
const [selectedIndex, setSelectedIndex] = createSignal(-1);
export type GeneratorAnchor = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

const [generatorAnchor, setGeneratorAnchor] = createSignal<GeneratorAnchor | null>(null);
export { generatorOpen, generatorAnchor, cells, selectedIndex };

export const selectedVariantId = (): string => cells()[selectedIndex()]?.id ?? "------";

// Look committed before the modal opened — Cancel restores it; the null-data
// origin cell re-transmits it (avoids a lossy legacy round-trip for the
// poto-native slices a legacy preset can't represent: curve/contrast/rgbMixer).
let committedSnapshot: LookState | null = null;

// ── Random helpers (legacy Yt / C_ / lv / Wt / Bu) ─────────────────────────
function randId(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i += 1) {
    const v = bytes[i] & 63;
    out += v < 36 ? v.toString(36) : (v - 26).toString(36).toUpperCase();
  }
  return out;
}
const randInt = (lo: number, hi: number) => Math.floor(Math.random() * (hi - lo + 1) + lo);
const randFloat = (lo: number, hi: number) => Math.random() * (hi - lo) + lo;
const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;
const remap = (v: number, inLo: number, inHi: number, outLo: number, outHi: number) =>
  ((v - inLo) * (outHi - outLo)) / (inHi - inLo) + outLo;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── Neutral legacy data (the legacy module defaults: s/d/l/r) ──────────────
export function defaultPresetData(): PresetData {
  return {
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
    g: { presetID: "kalar" },
  };
}

// ── EditState → legacy data (inverse of presetExpectedLook) ────────────────
const capMode = (mode: ManualCurveMode): string => mode.charAt(0).toUpperCase() + mode.slice(1);
const curvePts = (curve: CurveModel): number[][] => curve.points.map((p) => [p.x, p.y]);

/** Serializes the managed look slices back into legacy s/d/l/r preset data. */
export function lookToPresetData(look: LookState): PresetData {
  const out = defaultPresetData();
  const s = out.s as Record<string, unknown>;
  const d = out.d as Record<string, unknown>;
  const l = out.l as Record<string, unknown>;
  const r = out.r as Record<string, unknown>;
  const c = out.c as Record<string, unknown>;
  const g = out.g as Record<string, unknown>;

  const bal = look.balance;
  s.colorVolume = [bal.saturation / 2 + 0.5, bal.exposure / 2 + 0.5];
  s.colorBalance = [bal.temperature / 2 + 0.5, bal.tint / 2 + 0.5];
  s.shadows = [look.scattering.shadowX, look.scattering.shadowY];
  s.highlights = [look.scattering.highlightX, look.scattering.highlightY];
  const mv = look.refraction.mapVectors;
  s.shadowMapVectors = [0, 1, 2, 3, 4, 5].map((i) => [mv[i * 4], mv[i * 4 + 1]]);
  s.highlightMapVectors = [0, 1, 2, 3, 4, 5].map((i) => [mv[i * 4 + 2], mv[i * 4 + 3]]);
  s.separation = look.refraction.separation;

  d.hueVsDensity = curvePts(look.densityChroma.density);
  d.hvdInterpolation = capMode(look.densityChroma.density.mode);
  d.chromaVsDensity = curvePts(look.densityChroma.chroma);
  d.cvdInterpolation = capMode(look.densityChroma.chroma.mode);
  d.lumaVsDensity = curvePts(look.saturation.curve);
  d.lvdInterpolation = capMode(look.saturation.curve.mode);

  l.lumaVsLuma = curvePts(look.tone.curve);
  l.lvlInterpolation = capMode(look.tone.curve.mode);
  l.hueVsLuma = curvePts(look.radiance.curve);
  l.hvlInterpolation = capMode(look.radiance.curve.mode);
  l.expVsLuma = curvePts(look.exposure.curve);
  l.evlInterpolation = capMode(look.exposure.curve.mode);
  l.blackPoint = [...look.shadowHighlight.blackPoint];
  l.whitePoint = [...look.shadowHighlight.whitePoint];
  l.bpLinked = look.shadowHighlight.blackLinked;
  l.wpLinked = look.shadowHighlight.whiteLinked;

  r.acutanceAmount = look.grain.acutance;
  r.filmResolution = look.grain.resolution;
  r.grainDensity = look.grain.amount;
  r.grainChroma = Math.cbrt(look.grain.colorAmount);
  r.halationMix = look.halation.amount;
  r.halationHue = look.halation.hue;
  r.halationSat = look.halation.saturation;
  r.halationSpl = look.halation.spill;
  r.diffusionAmount = look.diffusion.amount;
  r.diffusionThreshold = look.diffusion.threshold;
  r.diffusionFadeLevel = look.diffusion.fog;
  r.diffusionCenterProtection = look.diffusion.focusProtect;
  r.diffusionCenter = [look.diffusion.centerX, look.diffusion.centerY];
  r.spotlightAmount = look.spotlight.amount;
  r.spotlightContrast = look.spotlight.contrast;
  r.spotlightBias = look.spotlight.bias;
  r.spotlightFocus = look.spotlight.focus;
  r.spotlightCenter = [look.spotlight.centerX, look.spotlight.centerY];
  c.colorMix = look.match.colorMix;
  c.lumaMix = look.match.lumaMix;
  c.lut = look.match.lut ? [...look.match.lut] : null;
  c.referenceID = look.match.referenceId;
  c.sourceID = look.match.sourceId;
  c.sourceIDT = look.match.sourceIdt;
  g.presetID = selectedPresetId() ?? "kalar";
  return out;
}

// ── Generation (legacy jr inner function) ──────────────────────────────────
const GENERATED_PANELS = ["s", "d", "l", "r"] as const;

type SPanel = {
  colorVolume?: number[];
  colorBalance?: number[];
  shadows?: number[];
  highlights?: number[];
  shadowMapVectors?: unknown;
  highlightMapVectors?: unknown;
};

function generateGrid(
  origin: PresetData,
  centerData: PresetData | null,
  pool: PresetData[],
): GeneratedCell[] {
  const schema = defaultPresetData();
  // Legacy anchors variants only when the origin isn't the neutral "kalar"
  // preset; key order is stable here because lookToPresetData builds on the
  // same defaultPresetData() shape.
  const originIsNeutral = (origin.g as { presetID?: unknown } | undefined)?.presetID === "kalar";
  const randomOf = () => pool[Math.floor(Math.random() * pool.length)];
  const out: GeneratedCell[] = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (row * COLS + col === CENTER_INDEX) {
        out.push({ id: "Origin", data: centerData, grey: null });
        continue;
      }
      const x = COLS > 1 ? col / (COLS - 1) : 0.5;
      const y = ROWS > 1 ? (ROWS - 1 - row) / (ROWS - 1) : 0.5;
      const mixChance = (x + y) / 2;
      const tempSkew = remap(x, 0, 1, 0.3, 0.7);
      const exposure = remap(y, 0, 1, 0.3, 0.7);

      const v: PresetData = {};
      for (const panel of GENERATED_PANELS) {
        const tpl = schema[panel] as Record<string, unknown>;
        if (Math.random() < mixChance) {
          const mixed: Record<string, unknown> = {};
          for (const prop in tpl) {
            const src = randomOf()[panel] as Record<string, unknown> | undefined;
            mixed[prop] = clone(src?.[prop] ?? tpl[prop]);
          }
          v[panel] = mixed;
        } else {
          v[panel] = clone((randomOf()[panel] ?? tpl) as Record<string, unknown>);
        }
      }

      const s = v.s as SPanel | undefined;
      if (s?.colorBalance && s.colorVolume) {
        const t = s.colorBalance[0];
        s.colorBalance[0] = tempSkew < 0.5 ? t * tempSkew * 2 : t + (1 - t) * (tempSkew - 0.5) * 2;
        s.colorVolume[1] = exposure;
      }

      if (!originIsNeutral) {
        const os = origin.s as SPanel | undefined;
        if (s && os) {
          const k = randFloat(0.35, 0.75);
          if (s.shadows && os.shadows) {
            s.shadows[0] = lerp(os.shadows[0], s.shadows[0], k);
            s.shadows[1] = lerp(os.shadows[1], s.shadows[1], k);
          }
          if (s.highlights && os.highlights) {
            s.highlights[0] = lerp(os.highlights[0], s.highlights[0], k);
            s.highlights[1] = lerp(os.highlights[1], s.highlights[1], k);
          }
          if (os.shadowMapVectors) s.shadowMapVectors = clone(os.shadowMapVectors);
          if (os.highlightMapVectors) s.highlightMapVectors = clone(os.highlightMapVectors);
        }
        if (origin.l) v.l = clone(origin.l);
      }

      out.push({ id: randId(6), data: v, grey: `hsl(0deg 0% ${randInt(15, 50)}%)` });
    }
  }
  return out;
}

// ── Modal lifecycle / transmit ──────────────────────────────────────────────
/** Opens the generator around the current look. False when no presets exist. */
export function openGenerator(anchor?: GeneratorAnchor | null): boolean {
  if (installedPresets().filter((preset) => !isDefaultPreset(preset.entry)).length === 0)
    return false;
  committedSnapshot = snapshotLook();
  setGeneratorAnchor(
    anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : null,
  );
  setGeneratorOpen(true);
  regenerate("extend");
  return true;
}

/** "all" = legacy Re-Generate All (origin = neutral); "extend" = More Like
 *  This (origin = selected variant, falling back to the look at open). */
export function regenerate(mode: "all" | "extend"): void {
  const pool = installedPresets()
    .filter((preset) => !isDefaultPreset(preset.entry))
    .map((p) => p.data);
  if (pool.length === 0) return;
  let origin: PresetData;
  let centerData: PresetData | null;
  if (mode === "all") {
    origin = defaultPresetData();
    centerData = origin;
  } else {
    const sel = cells()[selectedIndex()];
    if (sel && sel.data !== null) {
      origin = {
        ...lookToPresetData(committedSnapshot ?? snapshotLook()),
        ...clone(sel.data),
      };
      centerData = sel.data;
    } else {
      origin = lookToPresetData(committedSnapshot ?? snapshotLook());
      centerData = null;
    }
  }
  setCells(generateGrid(origin, centerData, pool));
  setSelectedIndex(-1);
  selectCell(CENTER_INDEX); // legacy re-selects the origin after every fill
}

/** Applies only the legacy modules carried by a generated cell. This mirrors
 * state.transmit(), which overlays s/d/l/r while preserving c/g and any native
 * editor slices that did not exist in the legacy state model. */
function lookForCell(cell: GeneratedCell): LookState | null {
  const base = committedSnapshot ? clone(committedSnapshot) : null;
  if (!base || cell.data === null) return base;
  const generated = presetExpectedLook(cell.data);
  if (cell.data.s) {
    base.balance = generated.balance;
    base.scattering = generated.scattering;
    base.refraction = generated.refraction;
  }
  if (cell.data.d) {
    base.densityChroma = generated.densityChroma;
    base.saturation = generated.saturation;
  }
  if (cell.data.l) {
    base.tone = generated.tone;
    base.radiance = generated.radiance;
    base.exposure = generated.exposure;
    base.shadowHighlight = generated.shadowHighlight;
  }
  if (cell.data.r) {
    base.grain = generated.grain;
    base.halation = generated.halation;
    base.diffusion = generated.diffusion;
    base.spotlight = generated.spotlight;
  }
  if (cell.data.c) base.match = generated.match;
  return base;
}

/** Selects a cell and transmits its look to the image (live preview). */
export function selectCell(index: number): LookState | null {
  const cell = cells()[index];
  if (!cell) return null;
  const look = lookForCell(cell);
  if (index !== selectedIndex()) {
    setSelectedIndex(index);
    if (look) transmitPresetLook(look);
  }
  return look;
}

export function selectedGeneratorLook(): LookState | null {
  const cell = cells()[selectedIndex()];
  return cell ? lookForCell(cell) : null;
}

/** Commits the previewed variant (legacy z.applyTransmitted). */
export function applyGenerator(): void {
  const cell = cells()[selectedIndex()];
  if (cell) {
    const look = lookForCell(cell);
    if (look) setLook(clone(look));
  }
  // A real variant no longer corresponds to any library preset.
  if (cell && cell.data !== null) clearSelectedPreset();
  disposePresetLookPreview();
  committedSnapshot = null;
  closeGenerator();
}

/** Reverts to the look at open (legacy z.disposeTransmitted). */
export function cancelGenerator(): void {
  disposePresetLookPreview();
  committedSnapshot = null;
  closeGenerator();
}

function closeGenerator(): void {
  setGeneratorOpen(false);
  setGeneratorAnchor(null);
  setCells([]);
  setSelectedIndex(-1);
}

/** Saves the selected variant into the Custom pack. Returns its name. */
export function selectedVariantPresetData(): PresetData | null {
  const cell = cells()[selectedIndex()];
  if (!cell) return null;
  const look = lookForCell(cell);
  if (!look) return null;
  const data = lookToPresetData(look);
  data.g = { presetID: randId(12) };
  return data;
}

/** Saves the selected variant into the Custom pack. Returns its name. */
export function saveSelectedVariant(name?: string): string | null {
  const cell = cells()[selectedIndex()];
  if (!cell) return null;
  const data = selectedVariantPresetData();
  if (!data) return null;
  const presetName = name?.trim() || `Variation: ${cell.id}`;
  saveCustomPreset(presetName, data);
  return presetName;
}
