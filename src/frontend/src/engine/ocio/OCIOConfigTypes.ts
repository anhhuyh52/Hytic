export const OCIO_INSPECT_ONLY_NOTE =
  "OCIO config import is experimental inspection and OCIO-style mapping; not full OCIO processor evaluation yet.";

export type OCIOTransformSupportLevel =
  | "inspect-only"
  | "internally-mappable"
  | "unsupported-runtime"
  | "requires-external-LUT";

export type ImportedOCIOConfig = {
  id: string;
  name: string;
  fileName: string;
  rawText: string;

  ocioVersion?: string;

  roles: Record<string, string>;

  colorSpaces: OCIOColorSpaceSummary[];

  displays: OCIODisplaySummary[];

  looks: OCIOLookSummary[];

  namedTransforms: OCIONamedTransformSummary[];

  warnings: string[];
  unsupportedFeatures: string[];
  fileTransformRefs: string[];

  importedAt: number;
};

export type OCIOColorSpaceSummary = {
  name: string;
  family?: string;
  aliases: string[];
  description?: string;

  isData?: boolean;
  allocation?: string;

  hasToReferenceTransform: boolean;
  hasFromReferenceTransform: boolean;

  transformTypes: string[];
  transformNodes: OCIOTransformNode[];
  fileTransformRefs: string[];
};

export type OCIODisplaySummary = {
  name: string;
  views: OCIOViewSummary[];
};

export type OCIOViewSummary = {
  name: string;
  colorspace?: string;
  looks?: string;
  rule?: string;
};

export type OCIOLookSummary = {
  name: string;
  processSpace?: string;
  transformTypes: string[];
  transformNodes: OCIOTransformNode[];
  fileTransformRefs: string[];
};

export type OCIONamedTransformSummary = {
  name: string;
  family?: string;
  transformTypes: string[];
  transformNodes: OCIOTransformNode[];
  fileTransformRefs: string[];
};

export type OCIOTransformNode = {
  type: string;
  filePath?: string;
  interpolation?: string;
  direction?: string;
  matrix?: number[];
  range?: {
    minIn?: number[];
    maxIn?: number[];
    minOut?: number[];
    maxOut?: number[];
  };
};

export type OCIOExternalFileType = "cube" | "clf" | "spi1d" | "spi3d" | "ctf" | "unknown";

export type OCIOExternalFile = {
  id: string;
  configId: string;
  originalPath: string;
  fileName: string;
  type: OCIOExternalFileType;
  blobId: string;
  parsed?: {
    kind: "cube" | "clf";
    lut?: import("../interchange/InterchangeTypes").LUTData3D;
    warnings: string[];
  };
  errors: string[];
  importedAt: number;
};

export type OCIOSelection = {
  inputColorSpace?: string;
  workingColorSpace?: string;
  display?: string;
  view?: string;
  look?: string;
};

export type ProjectOCIOState = {
  selectedConfigId?: string;
  inputColorSpaceName?: string;
  workingColorSpaceName?: string;
  displayName?: string;
  viewName?: string;
  lookName?: string;
};

export type OCIOConfigSummary = {
  id: string;
  name: string;
  fileName: string;
  ocioVersion?: string;
  colorSpaceCount: number;
  displayCount: number;
  lookCount: number;
  importedAt: number;
  warningCount: number;
  unsupportedFeatureCount: number;
};

export type OCIOValidationResult = {
  errors: string[];
  warnings: string[];
  unsupportedFeatures: string[];
};

export const OCIO_TRANSFORM_TYPES = [
  "MatrixTransform",
  "RangeTransform",
  "ExponentTransform",
  "LogTransform",
  "LogAffineTransform",
  "FileTransform",
  "GroupTransform",
  "ColorSpaceTransform",
  "DisplayViewTransform",
  "LookTransform",
  "CDLTransform",
  "FixedFunctionTransform",
  "GradingPrimaryTransform",
  "GradingRGBCurveTransform",
  "GradingToneTransform",
  "ExposureContrastTransform",
  "BuiltinTransform",
] as const;

export type OCIOTransformType = (typeof OCIO_TRANSFORM_TYPES)[number];

export type {
  OCIORuntimeMode,
  OCIORuntimeState,
  OCIOProcessorStage,
  OCIOProcessorRuntimeResult,
  OCIOTransformPlan,
} from "./runtime/OCIORuntimeTypes";
