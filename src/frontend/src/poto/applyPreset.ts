/*
 * Legacy preset apply — parity layer.
 *
 * Legacy `z.set(preset.data)` is a FULL-STATE replace: a preset is a complete
 * app-state snapshot across modules s/d/l/c/r/g. This module converts that data
 * into the project's editState for the modules the engine supports, and — as a
 * full-state apply — resets the other managed look slices to their defaults so
 * the preset defines the whole look (not a partial overlay).
 *
 * Mapped (engine-backed): s.colorVolume/colorBalance → Balance exposure/sat +
 * temp/tint; s.shadows/highlights/separation → Scattering; s.shadowMapVectors →
 * Refraction; l.expVsLuma → Exposure curve; d.hueVsDensity/chromaVsDensity →
 * Density/Chroma curves; d.lumaVsDensity → Saturation curve; l.hueVsLuma →
 * Radiance curve; l.lumaVsLuma → Tone curve (lch_mod); l.blackPoint/whitePoint →
 * Shadow/Highlight (rng_mod); r.* → grain/halation/diffusion/spotlight.
 *
 * Color-Match LUT (c.lut) is restored when a preset carries a baked legacy
 * 16^3 LUT; presets without a LUT reset match to the neutral bypass state.
 */
import { editState, setEditState } from "../app/editor-store";
import {
  BYPASS_REFERENCE_ID,
  DEFAULT_MATCH_STATE,
  cloneMatchState,
} from "../engine/state/MatchTypes";
import {
  DEFAULT_CURVE_STATE,
  DEFAULT_CONTRAST_STATE,
  DEFAULT_BALANCE_STATE,
  DEFAULT_SCATTERING_STATE,
  DEFAULT_REFRACTION_STATE,
  DEFAULT_SATURATION_STATE,
  DEFAULT_RGB_MIXER_STATE,
  DEFAULT_DENSITY_CHROMA_STATE,
  DEFAULT_RADIANCE_STATE,
  DEFAULT_TONE_STATE,
  DEFAULT_EXPOSURE_STATE,
  DEFAULT_SHADOW_HIGHLIGHT_STATE,
  DEFAULT_GRAIN_STATE,
  DEFAULT_HALATION_STATE,
  DEFAULT_DIFFUSION_STATE,
  DEFAULT_SPOTLIGHT_STATE,

  NEUTRAL_HUE_VS_DENSITY,
  NEUTRAL_CHROMA_VS_DENSITY,
  cloneCurveState,
  cloneContrastCurveState,
  cloneRGBMixerState,
  cloneCurveModel,
  type EditState,
  type CurvePoint,
  type ManualCurveMode,
} from "../engine/state/EditState";
import type { PresetData } from "../engine/presets/officialPacks";

// Managed look slices a preset apply owns (full-state replace touches all).
export const MANAGED_SLICES = [
  "curve",
  "contrast",
  "balance",
  "scattering",
  "refraction",
  "saturation",
  "rgbMixer",
  "densityChroma",
  "radiance",
  "tone",
  "exposure",
  "shadowHighlight",
  "match",
  "grain",
  "halation",
  "diffusion",
  "spotlight",

] as const;
export type ManagedSlice = (typeof MANAGED_SLICES)[number];
export type LookState = Pick<EditState, ManagedSlice>;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);

function interpMode(s: unknown): ManualCurveMode {
  const m = String(s ?? "").toLowerCase();
  return m === "cubic" || m === "bezier" || m === "linear" ? (m as ManualCurveMode) : "cubic";
}

/** Legacy [r,g,b] point triplet → clamped [0,1] tuple (0.5 = neutral). */
function triple(raw: unknown, def: number): [number, number, number] {
  const a = Array.isArray(raw) ? raw : [];
  return [clamp01(num(a[0], def)), clamp01(num(a[1], def)), clamp01(num(a[2], def))];
}

/** Legacy [x,y]∈0..1 grading curve (0.5 = neutral) → CurvePoint[] (y kept in 0..1). */
function rawCurvePoints(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const pts = raw
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ x: clamp01(Number(p[0])), y: clamp01(Number(p[1])) }));
  return pts.length >= 2 ? pts : null;
}

function presetMatchLut(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length < 16 ** 3 * 3) return null;
  return raw.map((v) => num(v, 0));
}

function lutSignature(lut: number[] | null): number {
  if (!lut) return 0;
  let hash = 2166136261;
  for (let i = 0; i < lut.length; i += 97) {
    hash ^= Math.round(lut[i]);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function defaultLook(): LookState {
  return {
    curve: cloneCurveState(DEFAULT_CURVE_STATE),
    contrast: {
      ...DEFAULT_CONTRAST_STATE,
      curve: cloneContrastCurveState(DEFAULT_CONTRAST_STATE.curve),
    },
    balance: { ...DEFAULT_BALANCE_STATE },
    scattering: { ...DEFAULT_SCATTERING_STATE },
    refraction: {
      ...DEFAULT_REFRACTION_STATE,
      mapVectors: [...DEFAULT_REFRACTION_STATE.mapVectors],
    },
    saturation: {
      ...DEFAULT_SATURATION_STATE,
      curve: cloneCurveModel(DEFAULT_SATURATION_STATE.curve),
    },
    rgbMixer: cloneRGBMixerState(DEFAULT_RGB_MIXER_STATE),
    densityChroma: {
      ...DEFAULT_DENSITY_CHROMA_STATE,
      density: cloneCurveModel(DEFAULT_DENSITY_CHROMA_STATE.density),
      chroma: cloneCurveModel(DEFAULT_DENSITY_CHROMA_STATE.chroma),
    },
    radiance: { ...DEFAULT_RADIANCE_STATE, curve: cloneCurveModel(DEFAULT_RADIANCE_STATE.curve) },
    tone: { ...DEFAULT_TONE_STATE, curve: cloneCurveModel(DEFAULT_TONE_STATE.curve) },
    exposure: { ...DEFAULT_EXPOSURE_STATE, curve: cloneCurveModel(DEFAULT_EXPOSURE_STATE.curve) },
    shadowHighlight: {
      ...DEFAULT_SHADOW_HIGHLIGHT_STATE,
      blackPoint: [...DEFAULT_SHADOW_HIGHLIGHT_STATE.blackPoint],
      whitePoint: [...DEFAULT_SHADOW_HIGHLIGHT_STATE.whitePoint],
    },
    match: cloneMatchState(DEFAULT_MATCH_STATE),
    grain: { ...DEFAULT_GRAIN_STATE },
    halation: { ...DEFAULT_HALATION_STATE },
    diffusion: { ...DEFAULT_DIFFUSION_STATE },
    spotlight: { ...DEFAULT_SPOTLIGHT_STATE },

  };
}

/** Converts legacy preset data → the full managed look state (mapped or default). */
export function presetExpectedLook(data: PresetData): LookState {
  const look = defaultLook();
  const s = data.s as Record<string, unknown> | undefined;
  const l = data.l as Record<string, unknown> | undefined;
  const r = data.r as Record<string, unknown> | undefined;
  const c = data.c as Record<string, unknown> | undefined;

  if (c) {
    const lut = presetMatchLut(c.lut);
    const referenceId =
      typeof c.referenceID === "string" && c.referenceID ? c.referenceID : BYPASS_REFERENCE_ID;
    look.match = {
      ...DEFAULT_MATCH_STATE,
      referenceId: lut ? referenceId : BYPASS_REFERENCE_ID,
      sourceId: typeof c.sourceID === "string" ? c.sourceID : "",
      sourceIdt: typeof c.sourceIDT === "string" ? c.sourceIDT : DEFAULT_MATCH_STATE.sourceIdt,
      colorMix: clamp01(num(c.colorMix, 1)),
      lumaMix: clamp01(num(c.lumaMix, 1)),
      lut,
      generatedAt: lutSignature(lut),
      bypass: !lut,
      status: lut ? "active" : "idle",
    };
  }

  // ── Balance (s.colorVolume = exposure/saturation, s.colorBalance = temp/tint)
  if (s) {
    const cv = s.colorVolume as number[] | undefined;
    const cb = s.colorBalance as number[] | undefined;
    if (Array.isArray(cv) || Array.isArray(cb)) {
      // Legacy colorVolume is [saturation, exposure] (state[0]→shader sat, [1]→exp,
      // per the Df setter); colorBalance is [temperature, tint].
      look.balance = {
        ...DEFAULT_BALANCE_STATE,
        saturation: cv ? clamp((num(cv[0], 0.5) - 0.5) * 2, -1, 1) : 0,
        exposure: cv ? clamp((num(cv[1], 0.5) - 0.5) * 2, -1, 1) : 0,
        temperature: cb ? clamp((num(cb[0], 0.5) - 0.5) * 2, -1, 1) : 0,
        tint: cb ? clamp((num(cb[1], 0.5) - 0.5) * 2, -1, 1) : 0,
      };
    }

    // ── Scattering (shadow/highlight wheels) ─────────────────────────────
    // Legacy stores each wheel as a point [x,y] in [0,1]²; the engine rebuilds
    // the ambient sk8 vec4 from those points (see buildScatterVec4). Legacy
    // scattering has no balance/separation of its own (separation belongs to
    // refraction), so those fields stay at their inert defaults.
    if (Array.isArray(s.shadows) && Array.isArray(s.highlights)) {
      const sh = s.shadows as number[];
      const hl = s.highlights as number[];
      look.scattering = {
        enabled: true,
        bypass: false,
        shadowX: clamp01(num(sh[0], 0.5)),
        shadowY: clamp01(num(sh[1], 0.5)),
        highlightX: clamp01(num(hl[0], 0.5)),
        highlightY: clamp01(num(hl[1], 0.5)),
        balance: DEFAULT_SCATTERING_STATE.balance,
        preserveLuminance: DEFAULT_SCATTERING_STATE.preserveLuminance,
      };
    }

    // ── Refraction (legacy rfc model: per-primary shadow + highlight
    //    [hueAngle°, density], interpolated by separation) ─────────────────
    const smv = s.shadowMapVectors as number[][] | undefined;
    const hmv = s.highlightMapVectors as number[][] | undefined;
    if (Array.isArray(smv) && smv.length >= 6) {
      const mapVectors: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        mapVectors.push(
          num(smv[i]?.[0], i * 60), // shadow angle
          num(smv[i]?.[1], 1), // shadow density
          num(hmv?.[i]?.[0], i * 60), // highlight angle
          num(hmv?.[i]?.[1], 1), // highlight density
        );
      }
      look.refraction = {
        enabled: true,
        bypass: false,
        mapVectors,
        separation: clamp01(num(s.separation, 0.5)),
        preserveLuminance: false,
      };
    }
  }

  // ── Density / Chroma / Saturation curves (data.d) ─────────────────────
  const d = data.d as Record<string, unknown> | undefined;
  if (d) {
    const density = rawCurvePoints(d.hueVsDensity);
    const chroma = rawCurvePoints(d.chromaVsDensity);
    if (density || chroma) {
      look.densityChroma = {
        enabled: true,
        bypass: false,
        density: density
          ? { points: density, mode: interpMode(d.hvdInterpolation) }
          : cloneCurveModel(NEUTRAL_HUE_VS_DENSITY),
        chroma: chroma
          ? { points: chroma, mode: interpMode(d.cvdInterpolation) }
          : cloneCurveModel(NEUTRAL_CHROMA_VS_DENSITY),
      };
    }
    const sat = rawCurvePoints(d.lumaVsDensity);
    if (sat) {
      look.saturation = {
        enabled: true,
        bypass: false,
        curve: { points: sat, mode: interpMode(d.lvdInterpolation) },
      };
    }
  }

  // ── Exposure (l.expVsLuma) + Radiance (l.hueVsLuma) curves ────────────
  if (l) {
    // Exposure: faithful legacy expVsLuma offset curve (0.5 neutral, y in 0..1).
    const evl = rawCurvePoints(l.expVsLuma);
    if (evl) {
      look.exposure = {
        enabled: true,
        bypass: false,
        curve: { points: evl, mode: interpMode(l.evlInterpolation) },
      };
    }
    const hvl = rawCurvePoints(l.hueVsLuma);
    if (hvl) {
      look.radiance = {
        enabled: true,
        bypass: false,
        curve: { points: hvl, mode: interpMode(l.hvlInterpolation) },
      };
    }
    // Tone: legacy lumaVsLuma curve (identity-diagonal y=x neutral; y kept in 0..1).
    const lvl = rawCurvePoints(l.lumaVsLuma);
    if (lvl) {
      look.tone = {
        enabled: true,
        bypass: false,
        curve: { points: lvl, mode: interpMode(l.lvlInterpolation) },
      };
    }
    // Shadow / Highlight: legacy blackPoint (shadows) + whitePoint (highlights),
    // each [r,g,b]∈0..1 (0.5 neutral); bpLinked/wpLinked are UI-only.
    if (Array.isArray(l.blackPoint) || Array.isArray(l.whitePoint)) {
      look.shadowHighlight = {
        enabled: true,
        bypass: false,
        blackPoint: triple(l.blackPoint, 0.5),
        whitePoint: triple(l.whitePoint, 0.5),
        blackLinked: typeof l.bpLinked === "boolean" ? l.bpLinked : true,
        whiteLinked: typeof l.wpLinked === "boolean" ? l.wpLinked : true,
      };
    }
  }

  // ── Render FX (data.r): grain / halation / diffusion ──────────────────
  if (r) {
    look.grain = {
      ...DEFAULT_GRAIN_STATE,
      enabled: true,
      bypass: false,
      amount: clamp01(num(r.grainDensity, 0)),
      acutance: clamp01(num(r.acutanceAmount, 0)),
      resolution: clamp01(num(r.filmResolution, 0.5)),
      colorAmount: clamp01(num(r.grainChroma, 0.5)),
    };
    // Halation / Diffusion map 1:1 from the legacy state (all 0..1 normalized controls).
    look.halation = {
      ...DEFAULT_HALATION_STATE,
      amount: clamp01(num(r.halationMix, 0)),
      spill: clamp01(num(r.halationSpl, 0.5)),
      hue: clamp01(num(r.halationHue, 0.5)),
      saturation: clamp01(num(r.halationSat, 0.5)),
    };
    const dc = r.diffusionCenter as number[] | undefined;
    look.diffusion = {
      ...DEFAULT_DIFFUSION_STATE,
      amount: clamp01(num(r.diffusionAmount, 0)),
      fog: clamp01(num(r.diffusionFadeLevel, 0)),
      threshold: clamp01(num(r.diffusionThreshold, 0)),
      focusProtect: clamp01(num(r.diffusionCenterProtection, 0)),
      centerX: clamp01(num(dc?.[0], 0.5)),
      centerY: clamp01(num(dc?.[1], 0.5)),
    };
    // Spotlight (relight FX): amount/contrast/bias/focus + [x,y] center.
    const sc = r.spotlightCenter as number[] | undefined;
    look.spotlight = {
      ...DEFAULT_SPOTLIGHT_STATE,
      amount: clamp01(num(r.spotlightAmount, 0)),
      contrast: clamp01(num(r.spotlightContrast, 0.5)),
      bias: clamp01(num(r.spotlightBias, 0.5)),
      focus: clamp01(num(r.spotlightFocus, 0.5)),
      centerX: clamp01(num(sc?.[0], 0.5)),
      centerY: clamp01(num(sc?.[1], 0.5)),
    };
  }

  return look;
}

/** Writes a managed look state into editState (full-state apply). */
export function setLook(look: LookState): void {
  // Solid merges a top-level object into the store. Keeping the full managed
  // look in one write matches legacy applyTransmitted() and produces one
  // history/performance commit instead of one commit per panel slice.
  setEditState(look);
}

/** Full-state apply of a legacy preset's data. */
export function applyPreset(data: PresetData): void {
  setLook(presetExpectedLook(data));
}

/** Deep clone of the current managed look slices (for hover-preview restore). */
export function snapshotLook(): LookState {
  const out: any = {};
  for (const key of MANAGED_SLICES) {
    out[key] = JSON.parse(JSON.stringify((editState as any)[key]));
  }
  return out as LookState;
}

/** Restores a previously-snapshotted look (hover leave). */
export function restoreLook(snap: LookState): void {
  setLook(snap);
}

/** True when the current editState equals the preset's expected look (edited = !this). */
export function currentMatchesPreset(data: PresetData): boolean {
  const expected = presetExpectedLook(data);
  for (const key of MANAGED_SLICES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = JSON.stringify((editState as any)[key]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = JSON.stringify((expected as any)[key]);
    if (a !== b) return false;
  }
  return true;
}

// Dev hooks for the preview harness.
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoApplyPreset = applyPreset;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoLook = snapshotLook;
}
