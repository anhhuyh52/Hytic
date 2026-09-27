import type { LUTData3D, LUTInterchangeSize } from "../../interchange/InterchangeTypes";
import type { OCIOTransformNode } from "../OCIOConfigTypes";

export type OCIORuntimeMode =
  | "inspect-only"
  | "internal-mapping"
  | "baked-lut-prototype"
  | "wasm-ocio-unavailable";

export type OCIOProcessorStage =
  | "input-to-working"
  | "working-to-display"
  | "display-view"
  | "look"
  | "full-chain";

export type OCIOTransformPlan = {
  id: string;
  configId: string;
  sourceColorSpace?: string;
  destinationColorSpace?: string;
  display?: string;
  view?: string;
  look?: string;
  stage: OCIOProcessorStage;
  mode: OCIORuntimeMode;
  supported: boolean;
  requiredFiles: string[];
  resolvedFiles: string[];
  unresolvedFiles: string[];
  ambiguousFiles: string[];
  unsupportedTransforms: string[];
  transformNodes: OCIOTransformNode[];
  warnings: string[];
  cacheKey: string;
};

export type OCIOProcessorRuntimeResult = {
  supported: boolean;
  mode: OCIORuntimeMode;
  lut?: LUTData3D;
  warnings: string[];
  errors: string[];
};

export type OCIORuntimeState = {
  enabled: boolean;
  mode: OCIORuntimeMode;
  selectedConfigId?: string;
  sourceColorSpace?: string;
  display?: string;
  view?: string;
  look?: string;
  selectedPlanId?: string;
  externalFileRefs: string[];
  bakedLUTSize: LUTInterchangeSize;
  useBakedLUT: boolean;
};

export const DEFAULT_OCIO_RUNTIME_STATE: OCIORuntimeState = {
  enabled: false,
  mode: "inspect-only",
  externalFileRefs: [],
  bakedLUTSize: 33,
  useBakedLUT: false,
};

export const OCIO_RUNTIME_PROTOTYPE_WARNING =
  "OCIO runtime prototype is experimental and not full production OCIO yet.";

export const OCIO_BAKED_LUT_PROTOTYPE_WARNING =
  "Baked LUT prototype uses internal mapping, not full OCIO processor evaluation.";

export const OCIO_RUNTIME_MODES: OCIORuntimeMode[] = [
  "inspect-only",
  "internal-mapping",
  "baked-lut-prototype",
  "wasm-ocio-unavailable",
];

export const OCIO_PROCESSOR_STAGES: OCIOProcessorStage[] = [
  "input-to-working",
  "working-to-display",
  "display-view",
  "look",
  "full-chain",
];
