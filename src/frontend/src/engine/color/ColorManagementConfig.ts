import type {
  ColorManagementDebugView,
  ColorManagementState,
  DisplayColorSpace,
  InputColorSpace,
  ViewTransform,
  WorkingColorSpace,
} from "./ColorManagementTypes";
import {
  debugViewLabels,
  displayColorSpaceLabels,
  inputColorSpaceLabels,
  viewTransformLabels,
  workingColorSpaceLabels,
} from "./ColorTransforms";
import { INPUT_TRANSFORM_DESCRIPTORS, type InputColorSpaceGroup } from "./InputTransforms";

/**
 * A minimal, internal OCIO-style config abstraction. This is NOT real OCIO and
 * does not parse OCIO config files — it just enumerates the color spaces,
 * displays and views the engine understands so the UI and .cube metadata have a
 * single source of truth. Real OCIO/ACES interchange is intentionally deferred.
 */
export type ColorSpaceOption<T extends string> = {
  id: T;
  label: string;
  description: string;
};

export type InputColorSpaceGroupOption = {
  group: InputColorSpaceGroup;
  label: string;
  options: ColorSpaceOption<InputColorSpace>[];
};

export type ColorManagementConfig = {
  name: string;
  inputColorSpaces: ColorSpaceOption<InputColorSpace>[];
  inputColorSpaceGroups: InputColorSpaceGroupOption[];
  workingColorSpaces: ColorSpaceOption<WorkingColorSpace>[];
  displayColorSpaces: ColorSpaceOption<DisplayColorSpace>[];
  viewTransforms: ColorSpaceOption<ViewTransform>[];
  debugViews: ColorSpaceOption<ColorManagementDebugView>[];
};

const GROUP_LABELS: Record<InputColorSpaceGroup, string> = {
  standard: "Standard",
  "camera-log": "Camera Log (approx)",
  aces: "ACES",
};

const inputOptions: ColorSpaceOption<InputColorSpace>[] = INPUT_TRANSFORM_DESCRIPTORS.map((d) => ({
  id: d.id,
  label: inputColorSpaceLabels[d.id],
  description: d.verified
    ? "Exact transform."
    : "Internal WebGL approximation — validate visually before delivery.",
}));

const inputGroups: InputColorSpaceGroupOption[] = (
  ["standard", "camera-log", "aces"] as InputColorSpaceGroup[]
).map((group) => ({
  group,
  label: GROUP_LABELS[group],
  options: INPUT_TRANSFORM_DESCRIPTORS.filter((d) => d.group === group).map((d) => ({
    id: d.id,
    label: inputColorSpaceLabels[d.id],
    description: d.verified ? "Exact transform." : "Internal WebGL approximation.",
  })),
}));

export const COLOR_MANAGEMENT_CONFIG: ColorManagementConfig = {
  name: "poto-internal-v2",
  inputColorSpaces: inputOptions,
  inputColorSpaceGroups: inputGroups,
  workingColorSpaces: [
    {
      id: "linear-srgb",
      label: workingColorSpaceLabels["linear-srgb"],
      description: "Scene-linear, sRGB/Rec.709 primaries (v1 path).",
    },
    {
      id: "acescg",
      label: workingColorSpaceLabels.acescg,
      description: "Scene-linear ACEScg (AP1). Matrix approximation.",
    },
  ],
  displayColorSpaces: [
    {
      id: "srgb",
      label: displayColorSpaceLabels.srgb,
      description: "Standard sRGB encode (exact).",
    },
    {
      id: "rec709-gamma24",
      label: displayColorSpaceLabels["rec709-gamma24"],
      description: "Pure gamma 2.4 encode (approximate).",
    },
    {
      id: "display-p3",
      label: displayColorSpaceLabels["display-p3"],
      description: "Display P3 primaries + sRGB transfer (approximate).",
    },
    {
      id: "rec2020",
      label: displayColorSpaceLabels.rec2020,
      description: "Rec.2020 primaries + gamma 2.4 (approximate).",
    },
  ],
  viewTransforms: [
    {
      id: "none",
      label: viewTransformLabels.none,
      description: "No tone mapping — display encode only (debug).",
    },
    {
      id: "standard",
      label: viewTransformLabels.standard,
      description: "Neutral — clamp only, matches v1.",
    },
    {
      id: "filmic",
      label: viewTransformLabels.filmic,
      description: "Filmic shoulder (approximate).",
    },
    {
      id: "aces-like",
      label: viewTransformLabels["aces-like"],
      description: "Narkowicz ACES fit (approximate, NOT official ACES ODT).",
    },
    {
      id: "soft-clip",
      label: viewTransformLabels["soft-clip"],
      description: "Soft highlight rolloff (uses tone-mapping sliders).",
    },
  ],
  debugViews: [
    { id: "none", label: debugViewLabels.none, description: "Normal output." },
    { id: "input", label: debugViewLabels.input, description: "Show raw input (identity)." },
    { id: "working", label: debugViewLabels.working, description: "Show working-space values." },
    {
      id: "toneMapped",
      label: debugViewLabels.toneMapped,
      description: "Show tone-mapped linear before encode.",
    },
    { id: "output", label: debugViewLabels.output, description: "Show final output." },
    {
      id: "clipping",
      label: debugViewLabels.clipping,
      description: "Red = over 1, blue = below 0.",
    },
  ],
};

/** Builds the `# ...` metadata comment lines for a `.cube` export. */
export function buildCubeColorManagementComments(state: ColorManagementState): string[] {
  const tm = state.toneMapping;
  const comments = [
    `# INPUT_COLOR_SPACE: ${inputColorSpaceLabels[state.inputColorSpace]}`,
    `# WORKING_COLOR_SPACE: ${workingColorSpaceLabels[state.workingColorSpace]}`,
    `# DISPLAY_COLOR_SPACE: ${displayColorSpaceLabels[state.displayColorSpace]}`,
    `# VIEW_TRANSFORM: ${viewTransformLabels[state.viewTransform]}`,
    `# TONE_MAPPING_ENABLED: ${tm.enabled ? "true" : "false"}`,
    `# TONE_MAPPING: exposureBias=${tm.exposureBias} highlightCompression=${tm.highlightCompression} shoulderStrength=${tm.shoulderStrength} blackLift=${tm.blackLift}`,
    `# OUTPUT_TRANSFORM: ${state.useOutputTransform ? "on" : "off"}`,
    `# GAMUT_MAPPING: ${state.useGamutMapping ? "on" : "off"}`,
    `# COLOR_MANAGEMENT_ENABLED: ${state.enabled ? "true" : "false"}`,
    "# NOTE: This LUT is generated by the app's internal transform chain.",
    "# NOTE: ACES-like view is approximate and not an official ACES ODT.",
    "# NOTE: Camera/log input transforms are internal approximations unless marked verified.",
    "# NOTE: A LUT made from a non-sRGB input/display is NOT a generic sRGB-in/sRGB-out LUT — match the encodings above.",
  ];
  if (state.ocioRuntime.useBakedLUT) {
    comments.push("# NOTE: OCIO baked prototype: internal mapping, not full OCIO processor.");
    comments.push("# NOTE: Includes baked OCIO prototype transform.");
    comments.push("# NOTE: Limited transform-chain evaluation.");
    comments.push("# NOTE: Not full OCIO runtime.");
    comments.push(`# OCIO_RUNTIME_MODE: ${state.ocioRuntime.mode}`);
    comments.push(`# OCIO_RUNTIME_PLAN_ID: ${state.ocioRuntime.selectedPlanId ?? "none"}`);
  }
  return comments;
}
