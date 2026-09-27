import type { InputColorSpace, WorkingColorSpace } from "./ColorManagementTypes";
import type { Mat3, Primaries } from "./ColorSpaceMatrices";
import { rgbToRgb } from "./ColorSpaceMatrices";
import {
  AP0_PRIMARIES,
  AP1_PRIMARIES,
  ARRI_WG3_PRIMARIES,
  CANON_CINEMA_GAMUT_PRIMARIES,
  PANASONIC_V_GAMUT_PRIMARIES,
  RED_WIDE_GAMUT_PRIMARIES,
  S_GAMUT3_CINE_PRIMARIES,
  SRGB_PRIMARIES,
} from "./CameraColorSpaces";

export type InputTransferCurve =
  | "srgb"
  | "rec709"
  | "linear"
  | "slog3"
  | "logc3"
  | "clog3"
  | "vlog"
  | "log3g10";

export type InputColorSpaceGroup = "standard" | "camera-log" | "aces";

export type InputColorSpaceDescriptor = {
  id: InputColorSpace;
  label: string;
  group: InputColorSpaceGroup;
  transferCurve: InputTransferCurve;
  /** Source gamut used to derive the source→working matrix. */
  gamut: Primaries;
  /** Shader int for the transfer-curve switch (see inputTransforms.glsl). */
  transferInt: number;
  /** true only for transforms that are exact (not approximations). */
  verified: boolean;
};

// Order here defines the shader transfer int (transferInt) and must match the
// switch in inputTransforms.glsl AND inputColorSpaceToInt in ColorTransforms.ts.
export const INPUT_TRANSFORM_DESCRIPTORS: InputColorSpaceDescriptor[] = [
  {
    id: "srgb",
    label: "sRGB",
    group: "standard",
    transferCurve: "srgb",
    gamut: SRGB_PRIMARIES,
    transferInt: 0,
    verified: true,
  },
  {
    id: "rec709",
    label: "Rec.709",
    group: "standard",
    transferCurve: "rec709",
    gamut: SRGB_PRIMARIES,
    transferInt: 1,
    verified: false,
  },
  {
    id: "linear-srgb",
    label: "Linear sRGB",
    group: "standard",
    transferCurve: "linear",
    gamut: SRGB_PRIMARIES,
    transferInt: 2,
    verified: true,
  },

  {
    id: "sony-slog3-sgamut3cine",
    label: "Sony S-Log3 / S-Gamut3.Cine",
    group: "camera-log",
    transferCurve: "slog3",
    gamut: S_GAMUT3_CINE_PRIMARIES,
    transferInt: 3,
    verified: false,
  },
  {
    id: "arri-logc3-awg3",
    label: "ARRI LogC3 / AWG3",
    group: "camera-log",
    transferCurve: "logc3",
    gamut: ARRI_WG3_PRIMARIES,
    transferInt: 4,
    verified: false,
  },
  {
    id: "canon-clog3-cinema-gamut",
    label: "Canon C-Log3 / Cinema Gamut",
    group: "camera-log",
    transferCurve: "clog3",
    gamut: CANON_CINEMA_GAMUT_PRIMARIES,
    transferInt: 5,
    verified: false,
  },
  {
    id: "panasonic-vlog-vgamut",
    label: "Panasonic V-Log / V-Gamut",
    group: "camera-log",
    transferCurve: "vlog",
    gamut: PANASONIC_V_GAMUT_PRIMARIES,
    transferInt: 6,
    verified: false,
  },
  {
    id: "red-log3g10-rwg",
    label: "RED Log3G10 / REDWideGamutRGB",
    group: "camera-log",
    transferCurve: "log3g10",
    gamut: RED_WIDE_GAMUT_PRIMARIES,
    transferInt: 7,
    verified: false,
  },

  {
    id: "acescg",
    label: "ACEScg",
    group: "aces",
    transferCurve: "linear",
    gamut: AP1_PRIMARIES,
    transferInt: 8,
    verified: false,
  },
  {
    id: "aces2065-1",
    label: "ACES2065-1",
    group: "aces",
    transferCurve: "linear",
    gamut: AP0_PRIMARIES,
    transferInt: 9,
    verified: false,
  },
];

const DESCRIPTOR_BY_ID = new Map<InputColorSpace, InputColorSpaceDescriptor>(
  INPUT_TRANSFORM_DESCRIPTORS.map((d) => [d.id, d]),
);

export function getInputDescriptor(id: InputColorSpace): InputColorSpaceDescriptor {
  return DESCRIPTOR_BY_ID.get(id) ?? INPUT_TRANSFORM_DESCRIPTORS[0];
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Linear source-gamut RGB → linear working-gamut RGB (row-major mat3), derived
 * from documented primaries with Bradford white adaptation. The transfer curve
 * is applied separately in the shader; this is purely the gamut step.
 */
export function getSourceToWorkingMatrix(input: InputColorSpace, working: WorkingColorSpace): Mat3 {
  const src = getInputDescriptor(input).gamut;
  const dst = working === "acescg" ? AP1_PRIMARIES : SRGB_PRIMARIES;
  // Same primaries + white → exact identity (avoids tiny float drift).
  if (src === dst) return IDENTITY;
  return rgbToRgb(src, dst);
}
