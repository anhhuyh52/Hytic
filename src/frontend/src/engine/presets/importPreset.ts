import type { ContrastCurveMode, CurveMode } from "../state/EditState";
import type { PartialPresetLook, PresetDefinition } from "./PresetTypes";
import { generatePresetId, PRESET_FILE_TYPE } from "./exportPreset";

/** Thrown for any invalid/unsupported preset file. Message is user-facing. */
export class PresetImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetImportError";
  }
}

// ── safe primitive accessors ───────────────────────────────────────────────

type AnyObj = Record<string, unknown>;

function isObj(v: unknown): v is AnyObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, def: number, lo = -Infinity, hi = Infinity): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function optNum(v: unknown, lo = -Infinity, hi = Infinity): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(hi, Math.max(lo, v));
}

const CURVE_MODES: CurveMode[] = ["linear", "cubic", "bezier"];
const CONTRAST_CURVE_MODES: ContrastCurveMode[] = [
  "linear",
  "cubic",
  "bezier",
  "gain",
  "parabola",
  "pcurve",
  "almostUnitIdentity",
  "expImpulse",
  "cubicPulse",
];

function optMode<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Drops keys whose value is undefined so the look stays minimal/partial. */
function compact<T extends AnyObj>(o: T): Partial<T> {
  const out: AnyObj = {};
  for (const [k, val] of Object.entries(o)) {
    if (val !== undefined) out[k] = val;
  }
  return out as Partial<T>;
}

// ── look sanitization ──────────────────────────────────────────────────────
// Each section is only included if present and an object. Within a section,
// only valid (finite, clamped) values survive. Unknown fields are ignored.

function sanCurvePoints(v: unknown, lo = -2, hi = 2): { x: number; y: number }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const pts = v.filter(isObj).map((p) => ({ x: num(p.x, 0, 0, 1), y: num(p.y, 0, lo, hi) }));
  return pts.length >= 2 ? pts : undefined;
}

/** A grading curve model (y in [0,1], 0.5 neutral) for density/chroma/sat/radiance. */
function sanitizeCurveModel(
  v: unknown,
): { points: { x: number; y: number }[]; mode: CurveMode } | undefined {
  if (!isObj(v)) return undefined;
  const points = sanCurvePoints(v.points, 0, 1);
  if (!points) return undefined;
  return { points, mode: optMode(v.mode, CURVE_MODES) ?? "cubic" };
}

function sanitizePresetLook(raw: unknown): PartialPresetLook {
  if (!isObj(raw)) return {};
  const look: PartialPresetLook = {};

  if (isObj(raw.curve)) {
    look.curve = compact({
      bypass: optBool(raw.curve.bypass),
      mode: optMode(raw.curve.mode, CURVE_MODES),
      points: sanCurvePoints(raw.curve.points, -2, 2),
    });
  }

  if (isObj(raw.contrast)) {
    const c = raw.contrast;
    const curve = isObj(c.curve)
      ? compact({
          bypass: optBool(c.curve.bypass),
          mode: optMode(c.curve.mode, CONTRAST_CURVE_MODES),
          points: sanCurvePoints(c.curve.points, -1, 1),
          amount: optNum(c.curve.amount, -2, 2),
          gain: optNum(c.curve.gain, 0, 10),
          parabolaPower: optNum(c.curve.parabolaPower, 0.1, 10),
          pcurveA: optNum(c.curve.pcurveA, 0, 10),
          pcurveB: optNum(c.curve.pcurveB, 0, 10),
          expImpulseK: optNum(c.curve.expImpulseK, 0.01, 50),
          cubicPulseCenter: optNum(c.curve.cubicPulseCenter, 0, 1),
          cubicPulseWidth: optNum(c.curve.cubicPulseWidth, 0.001, 2),
        })
      : undefined;
    look.contrast = compact({
      amount: optNum(c.amount, -2, 2),
      pivot: optNum(c.pivot, 0, 1),
      enabled: optBool(c.enabled),
      bypass: optBool(c.bypass),
      curve,
    });
  }

  if (isObj(raw.balance)) {
    const b = raw.balance;
    look.balance = compact({
      enabled: optBool(b.enabled),
      bypass: optBool(b.bypass),
      temperature: optNum(b.temperature, -1, 1),
      tint: optNum(b.tint, -1, 1),
      red: optNum(b.red, -1, 1),
      green: optNum(b.green, -1, 1),
      blue: optNum(b.blue, -1, 1),
    });
  }

  if (isObj(raw.saturation)) {
    const s = raw.saturation;
    look.saturation = compact({
      enabled: optBool(s.enabled),
      bypass: optBool(s.bypass),
      curve: sanitizeCurveModel(s.curve),
    });
  }

  if (isObj(raw.rgbMixer)) {
    const m = raw.rgbMixer;
    const row = (rv: unknown) =>
      isObj(rv)
        ? compact({ r: optNum(rv.r, -2, 2), g: optNum(rv.g, -2, 2), b: optNum(rv.b, -2, 2) })
        : undefined;
    look.rgbMixer = compact({
      enabled: optBool(m.enabled),
      bypass: optBool(m.bypass),
      red: row(m.red),
      green: row(m.green),
      blue: row(m.blue),
      preserveLuminance: optBool(m.preserveLuminance),
    });
  }

  if (isObj(raw.densityChroma)) {
    const d = raw.densityChroma;
    look.densityChroma = compact({
      enabled: optBool(d.enabled),
      bypass: optBool(d.bypass),
      density: sanitizeCurveModel(d.density),
      chroma: sanitizeCurveModel(d.chroma),
    });
  }

  if (isObj(raw.radiance)) {
    const r = raw.radiance;
    look.radiance = compact({
      enabled: optBool(r.enabled),
      bypass: optBool(r.bypass),
      curve: sanitizeCurveModel(r.curve),
    });
  }

  return look;
}

/**
 * Parses + validates a preset JSON file's text. Throws PresetImportError with a
 * clear message for invalid JSON, wrong type, unsupported schema, or a missing/
 * malformed preset. The returned look is sanitized (clamped, unknown fields
 * dropped) but preserves partial semantics — absent sections stay absent.
 */
export function parsePresetFile(text: string): PresetDefinition {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PresetImportError("File is not valid JSON.");
  }

  if (!isObj(json)) {
    throw new PresetImportError("Preset file must be a JSON object.");
  }

  if (json.type !== PRESET_FILE_TYPE) {
    throw new PresetImportError(
      `Not a color preset file (expected type "${PRESET_FILE_TYPE}", got "${String(json.type)}").`,
    );
  }

  if (json.schemaVersion !== 1) {
    throw new PresetImportError(
      `Unsupported preset schema version: ${String(json.schemaVersion)}. ` +
        `This file may have been made with a newer version of Hytic.`,
    );
  }

  if (!isObj(json.preset)) {
    throw new PresetImportError("Preset file is missing the 'preset' object.");
  }

  const p = json.preset;
  if (typeof p.name !== "string" || !p.name.trim()) {
    throw new PresetImportError("Preset is missing a name.");
  }
  if (!isObj(p.look)) {
    throw new PresetImportError("Preset is missing a valid 'look'.");
  }

  return {
    id: typeof p.id === "string" && p.id ? p.id : generatePresetId(),
    name: p.name.trim(),
    description: typeof p.description === "string" ? p.description : undefined,
    category: typeof p.category === "string" ? p.category : "Imported",
    look: sanitizePresetLook(p.look),
  };
}
