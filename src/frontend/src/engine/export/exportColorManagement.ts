import {
  cloneColorManagementState,
  type ColorManagementState,
} from "../color/ColorManagementTypes";
import type { ExportColorSpace } from "../passes/ExportPass";

export type ExportGammaCurve = "kalar" | "native";

type ExportTransform = { input: string; display: string };

const FIXED_TRANSFORMS: Partial<Record<ExportColorSpace, ExportTransform>> = {
  "display-p3": { input: "DisplayP3_IDT", display: "DisplayP3_ODT" },
  "p3-d65": { input: "P3D65_CSC", display: "P3D65" },
};

const GAMMA_TRANSFORMS: Record<
  Exclude<ExportColorSpace, "preview" | "display-p3" | "p3-d65">,
  Record<ExportGammaCurve, ExportTransform>
> = {
  "aces-cct": {
    kalar: { input: "ACES_CCT_VGAMMA", display: "ACES_CCT" },
    native: { input: "ACES_CCT", display: "ACES_CCT" },
  },
  dwg: {
    kalar: { input: "DaVinci_WideGamut_VGAMMA_IDT", display: "DaVinci_WideGamut_ODT" },
    native: { input: "DaVinci_WideGamut_IDT", display: "DaVinci_WideGamut_ODT" },
  },
  "log-c-3": {
    kalar: { input: "ArriLogC", display: "ArriLogC3" },
    native: { input: "ArriLogC_NO_VGAMMA", display: "ArriLogC3" },
  },
  "log-c-4": {
    kalar: { input: "ArriAlexa35", display: "ArriLogC4" },
    native: { input: "ArriAlexa35_NO_VGAMMA", display: "ArriLogC4" },
  },
  ipp2: {
    kalar: { input: "RedLog3G10WideGamutRGB", display: "RED_Log3G10_WideGamutRGB" },
    native: { input: "RedLog3G10WideGamutRGB_NO_VGAMMA", display: "RED_Log3G10_WideGamutRGB" },
  },
};

/** Resolves the legacy export-only IDT/ODT pair without mutating preview state. */
export function resolveExportColorManagement(
  preview: ColorManagementState,
  colorSpace: ExportColorSpace,
  gammaCurve: ExportGammaCurve,
): ColorManagementState {
  const result = cloneColorManagementState(preview);
  if (colorSpace === "preview") return result;

  const transform =
    FIXED_TRANSFORMS[colorSpace] ??
    GAMMA_TRANSFORMS[colorSpace as keyof typeof GAMMA_TRANSFORMS][gammaCurve];
  result.enabled = true;
  result.useAcesPipeline = true;
  result.inputColorSpaceId = transform.input;
  result.displayColorSpaceId = transform.display;
  return result;
}
