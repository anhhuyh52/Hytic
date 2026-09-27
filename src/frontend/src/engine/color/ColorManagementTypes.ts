import type { ProjectOCIOState } from "../ocio/OCIOConfigTypes";
import {
  DEFAULT_OCIO_RUNTIME_STATE,
  type OCIORuntimeState,
} from "../ocio/runtime/OCIORuntimeTypes";

// Internal color-management state (ACES/OCIO-style abstraction). This is NOT a
// real OCIO config or official ACES implementation — see ColorTransforms.ts and
// the shader comments for the documented approximations.

export type InputColorSpace =
  // Standard display/encoding spaces
  | "srgb"
  | "rec709"
  | "linear-srgb"
  // Camera/log formats (internal approximations — see InputTransforms.ts)
  | "sony-slog3-sgamut3cine"
  | "arri-logc3-awg3"
  | "canon-clog3-cinema-gamut"
  | "panasonic-vlog-vgamut"
  | "red-log3g10-rwg"
  // ACES
  | "acescg"
  | "aces2065-1";

export type WorkingColorSpace = "linear-srgb" | "acescg";

export type DisplayColorSpace = "srgb" | "rec709-gamma24" | "display-p3" | "rec2020";

export type ViewTransform = "none" | "standard" | "filmic" | "aces-like" | "soft-clip";

export type ColorManagementDebugView =
  | "none"
  | "input"
  | "working"
  | "toneMapped"
  | "output"
  | "clipping";

export type ToneMappingState = {
  enabled: boolean;
  exposureBias: number; // -3..3 stops
  highlightCompression: number; // 0..1 (soft-clip strength)
  shoulderStrength: number; // 0..1 (soft-clip blend)
  blackLift: number; // 0..0.2
};

export type ColorManagementState = {
  enabled: boolean;

  inputColorSpace: InputColorSpace;
  workingColorSpace: WorkingColorSpace;
  displayColorSpace: DisplayColorSpace;
  viewTransform: ViewTransform;

  useOutputTransform: boolean;
  useGamutMapping: boolean;

  // When true, the grade is rendered inside the ACES-style IDT -> creative ops
  // in ACES AP1 -> RRT + ODT pipeline used by the product preset system. When
  // false, the alternate color-management path is used. The input/display color
  // spaces apply in BOTH modes (gated by `enabled`).
  useAcesPipeline: boolean;
  // IDT (input) / ODT (display) ids — the full per-camera/display taxonomy.
  // Only used by the useAcesPipeline path.
  inputColorSpaceId: string;
  displayColorSpaceId: string;

  toneMapping: ToneMappingState;

  debugView: ColorManagementDebugView;

  ocio: ProjectOCIOState;
  ocioRuntime: OCIORuntimeState;
};

export const DEFAULT_TONE_MAPPING_STATE: ToneMappingState = {
  enabled: true,
  exposureBias: 0,
  highlightCompression: 0.5,
  shoulderStrength: 0.5,
  blackLift: 0,
};

export const DEFAULT_COLOR_MANAGEMENT_STATE: ColorManagementState = {
  enabled: true,

  inputColorSpace: "srgb",
  workingColorSpace: "linear-srgb",
  displayColorSpace: "srgb",
  viewTransform: "standard",

  useOutputTransform: true,
  useGamutMapping: true,

  useAcesPipeline: true,
  inputColorSpaceId: "sRGB",
  displayColorSpaceId: "sRGB",

  toneMapping: { ...DEFAULT_TONE_MAPPING_STATE },

  debugView: "none",

  ocio: {},
  ocioRuntime: { ...DEFAULT_OCIO_RUNTIME_STATE },
};

export function cloneColorManagementState(state: ColorManagementState): ColorManagementState {
  return {
    ...state,
    toneMapping: { ...state.toneMapping },
    ocio: { ...state.ocio },
    ocioRuntime: { ...state.ocioRuntime },
  };
}
