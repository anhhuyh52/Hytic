import type { DisplayColorSpace, WorkingColorSpace } from "./ColorManagementTypes";
import type { Mat3 } from "./ColorSpaceMatrices";
import { rgbToRgb } from "./ColorSpaceMatrices";
import {
  AP1_PRIMARIES,
  DISPLAY_P3_PRIMARIES,
  REC2020_PRIMARIES,
  SRGB_PRIMARIES,
} from "./CameraColorSpaces";

// Display-side descriptors. `verified` is true only for transforms that are
// exact; everything else is a documented approximation (see color-management.md).
export type DisplayColorSpaceDescriptor = {
  id: DisplayColorSpace;
  label: string;
  verified: boolean;
};

export const DISPLAY_DESCRIPTORS: DisplayColorSpaceDescriptor[] = [
  { id: "srgb", label: "sRGB", verified: true },
  { id: "rec709-gamma24", label: "Rec.709 Gamma 2.4", verified: false },
  { id: "display-p3", label: "Display P3", verified: false },
  { id: "rec2020", label: "Rec.2020", verified: false },
];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function displayPrimaries(display: DisplayColorSpace) {
  switch (display) {
    case "display-p3":
      return DISPLAY_P3_PRIMARIES;
    case "rec2020":
      return REC2020_PRIMARIES;
    case "srgb":
    case "rec709-gamma24":
    default:
      // sRGB and Rec.709 gamma-2.4 share Rec.709 primaries; only the encode differs.
      return SRGB_PRIMARIES;
  }
}

/**
 * Linear working-gamut RGB → linear display-gamut RGB (row-major mat3), derived
 * from documented primaries with Bradford white adaptation (e.g. ACEScg D60 →
 * display D65). The display transfer/encode is applied separately in the shader.
 */
export function getWorkingToDisplayMatrix(
  working: WorkingColorSpace,
  display: DisplayColorSpace,
): Mat3 {
  const src = working === "acescg" ? AP1_PRIMARIES : SRGB_PRIMARIES;
  const dst = displayPrimaries(display);
  if (src === dst) return IDENTITY;
  return rgbToRgb(src, dst);
}
