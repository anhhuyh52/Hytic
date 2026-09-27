import type { Primaries, XY } from "./ColorSpaceMatrices";

// Documented primary chromaticities + white points for every source/working
// gamut the engine understands. Sources are vendor white papers and the ACES
// system documentation. Deriving conversion matrices from these (see
// ColorSpaceMatrices.ts) avoids hand-transcribing 3×3 constants.
//
// NB: these chromaticities are accurate to published values, but the overall
// camera transforms (curve + gamut, no per-EI handling, single white point
// assumption) remain documented APPROXIMATIONS — not certified IDTs.

const D65: XY = { x: 0.3127, y: 0.329 };
const ACES_WHITE: XY = { x: 0.32168, y: 0.33767 }; // ~D60

// sRGB / Rec.709 (BT.709 primaries, D65)
export const SRGB_PRIMARIES: Primaries = {
  r: { x: 0.64, y: 0.33 },
  g: { x: 0.3, y: 0.6 },
  b: { x: 0.15, y: 0.06 },
  white: D65,
};

// ACEScg working gamut (AP1, ACES white ~D60)
export const AP1_PRIMARIES: Primaries = {
  r: { x: 0.713, y: 0.293 },
  g: { x: 0.165, y: 0.83 },
  b: { x: 0.128, y: 0.044 },
  white: ACES_WHITE,
};

// ACES2065-1 (AP0, ACES white ~D60)
export const AP0_PRIMARIES: Primaries = {
  r: { x: 0.7347, y: 0.2653 },
  g: { x: 0.0, y: 1.0 },
  b: { x: 0.0001, y: -0.077 },
  white: ACES_WHITE,
};

// Sony S-Gamut3.Cine (D65)
export const S_GAMUT3_CINE_PRIMARIES: Primaries = {
  r: { x: 0.766, y: 0.275 },
  g: { x: 0.225, y: 0.8 },
  b: { x: 0.089, y: -0.087 },
  white: D65,
};

// ARRI Wide Gamut 3 (AWG3, D65)
export const ARRI_WG3_PRIMARIES: Primaries = {
  r: { x: 0.684, y: 0.313 },
  g: { x: 0.221, y: 0.848 },
  b: { x: 0.0861, y: -0.102 },
  white: D65,
};

// Canon Cinema Gamut (D65)
export const CANON_CINEMA_GAMUT_PRIMARIES: Primaries = {
  r: { x: 0.74, y: 0.27 },
  g: { x: 0.17, y: 1.14 },
  b: { x: 0.08, y: -0.1 },
  white: D65,
};

// Panasonic V-Gamut (D65)
export const PANASONIC_V_GAMUT_PRIMARIES: Primaries = {
  r: { x: 0.73, y: 0.28 },
  g: { x: 0.165, y: 0.84 },
  b: { x: 0.1, y: -0.03 },
  white: D65,
};

// REDWideGamutRGB (D65)
export const RED_WIDE_GAMUT_PRIMARIES: Primaries = {
  r: { x: 0.780308, y: 0.304253 },
  g: { x: 0.121595, y: 1.493994 },
  b: { x: 0.095612, y: -0.084589 },
  white: D65,
};

// ── Display gamuts (output side) ─────────────────────────────────────────────

// Display P3 (DCI-P3 primaries, D65 white, sRGB-like transfer)
export const DISPLAY_P3_PRIMARIES: Primaries = {
  r: { x: 0.68, y: 0.32 },
  g: { x: 0.265, y: 0.69 },
  b: { x: 0.15, y: 0.06 },
  white: D65,
};

// Rec.2020 (BT.2020 primaries, D65)
export const REC2020_PRIMARIES: Primaries = {
  r: { x: 0.708, y: 0.292 },
  g: { x: 0.17, y: 0.797 },
  b: { x: 0.131, y: 0.046 },
  white: D65,
};
