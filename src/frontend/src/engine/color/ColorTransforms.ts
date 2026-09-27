import type {
  ColorManagementDebugView,
  DisplayColorSpace,
  InputColorSpace,
  ViewTransform,
  WorkingColorSpace,
} from "./ColorManagementTypes";
import { INPUT_TRANSFORM_DESCRIPTORS } from "./InputTransforms";

// ── Enum → shader int maps ───────────────────────────────────────────────────
// These MUST stay in sync with the int meanings documented in generateLUT.frag.
// Input transfer-curve ints are the single source of truth in InputTransforms.ts.

export const inputColorSpaceToInt = Object.fromEntries(
  INPUT_TRANSFORM_DESCRIPTORS.map((d) => [d.id, d.transferInt]),
) as Record<InputColorSpace, number>;

export const workingColorSpaceToInt: Record<WorkingColorSpace, number> = {
  "linear-srgb": 0,
  acescg: 1,
};

export const displayColorSpaceToInt: Record<DisplayColorSpace, number> = {
  srgb: 0,
  "rec709-gamma24": 1,
  "display-p3": 2,
  rec2020: 3,
};

export const viewTransformToInt: Record<ViewTransform, number> = {
  none: 0,
  standard: 1,
  filmic: 2,
  "aces-like": 3,
  "soft-clip": 4,
};

export const debugViewToInt: Record<ColorManagementDebugView, number> = {
  none: 0,
  input: 1,
  working: 2,
  toneMapped: 3,
  output: 4,
  clipping: 5,
};

// ── Human-readable labels (UI + .cube metadata) ─────────────────────────────

export const inputColorSpaceLabels = Object.fromEntries(
  INPUT_TRANSFORM_DESCRIPTORS.map((d) => [d.id, d.verified ? d.label : `${d.label} (approx)`]),
) as Record<InputColorSpace, string>;

export const workingColorSpaceLabels: Record<WorkingColorSpace, string> = {
  "linear-srgb": "Linear sRGB",
  acescg: "ACEScg (approx)",
};

export const displayColorSpaceLabels: Record<DisplayColorSpace, string> = {
  srgb: "sRGB",
  "rec709-gamma24": "Rec.709 Gamma 2.4 (approx)",
  "display-p3": "Display P3 (approx)",
  rec2020: "Rec.2020 (approx)",
};

export const viewTransformLabels: Record<ViewTransform, string> = {
  none: "None",
  standard: "Standard",
  filmic: "Filmic (approx)",
  "aces-like": "ACES-like (approx)",
  "soft-clip": "Soft Clip",
};

export const debugViewLabels: Record<ColorManagementDebugView, string> = {
  none: "None",
  input: "Input",
  working: "Working",
  toneMapped: "Tone Mapped",
  output: "Output",
  clipping: "Clipping",
};
