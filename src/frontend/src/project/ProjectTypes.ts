import type {
  AspectRatioPreset,
  ContrastCurveMode,
  CurveMode,
  FXQuality,
} from "../engine/state/EditState";
import type {
  ColorManagementDebugView,
  DisplayColorSpace,
  InputColorSpace,
  ViewTransform,
  WorkingColorSpace,
} from "../engine/color/ColorManagementTypes";
import type { LUTStorageMode } from "../engine/lut/LUTStorageTypes";
import type { EditorOverlayLayer } from "../features/overlays/editorOverlayTypes";
import type { ProjectOCIOState } from "../engine/ocio/OCIOConfigTypes";
import type { OCIORuntimeState } from "../engine/ocio/runtime/OCIORuntimeTypes";
import type { MatchState } from "../engine/state/MatchTypes";
import type { MediaKind, SerializedVideoState, VideoMetadata } from "../video/types";
import type { PresentationBorderSettings } from "../features/presentation/border/borderTypes";
import type { DistortionPoints } from "../features/distort/distortTypes";
import type { RetouchState } from "../features/retouch/retouchTypes";

// ── Schema versioning ──────────────────────────────────────────────────────

export type ProjectSchemaVersion = 1;
export const CURRENT_SCHEMA_VERSION: ProjectSchemaVersion = 1;

// ── Catalog types ──────────────────────────────────────────────────────────

export type MediaRating = 0 | 1 | 2 | 3 | 4 | 5;
export type MediaFlag = "none" | "pick" | "reject";

export type MediaCatalogFields = {
  schemaVersion: 1;
  rating: MediaRating;
  flag: MediaFlag;
  /** Trimmed, deduplicated case-preserving values; matching uses lowercase. */
  keywords: string[];
  importedAt: number;
  catalogUpdatedAt: number;
  sourceIdentity: {
    fileName: string;
    size: number;
    lastModified?: number;
    contentHash?: string;
  };
};

export type CatalogMediaRef = { projectId: string; assetId: string };

export type CollectionRecord = {
  id: string;
  accountId: string;
  kind: "manual" | "smart" | "saved-search";
  name: string;
  items: CatalogMediaRef[];
  query?: SmartCollectionQuery;
  createdAt: number;
  updatedAt: number;
};

export type SmartCollectionField =
  | "rating"
  | "flag"
  | "keywords"
  | "project"
  | "filename"
  | "camera"
  | "lens"
  | "iso"
  | "aperture"
  | "shutter"
  | "focalLength"
  | "captureDate"
  | "mediaType";

export type SmartCollectionPredicate = {
  type: "predicate";
  field: SmartCollectionField;
  operator:
    | "equals"
    | "not-equals"
    | "contains"
    | "not-contains"
    | "gte"
    | "lte"
    | "between"
    | "in";
  value: string | number | Array<string | number>;
};

export type SmartCollectionQuery =
  | SmartCollectionPredicate
  | { type: "and" | "or"; children: SmartCollectionQuery[] }
  | { type: "not"; child: SmartCollectionQuery };

export type CatalogSearchDocument = MediaCatalogFields & {
  key: string;
  accountId: string;
  projectId: string;
  projectName: string;
  assetId: string;
  fileName: string;
  width: number;
  height: number;
  mediaType: MediaKind;
  camera: string;
  lens: string;
  iso?: number;
  aperture?: number;
  shutter?: number;
  focalLength?: number;
  captureDate?: number;
};

// ── Serialized edit-state types ────────────────────────────────────────────
// Mirrors EditState for JSON persistence.

export type SerializedCurvePoint = { x: number; y: number };

export type SerializedCurveState = {
  bypass: boolean;
  mode: CurveMode;
  points: SerializedCurvePoint[];
};

/** A grading curve ([0,1] y, 0.5 neutral) for Density/Chroma/Saturation/Radiance. */
export type SerializedCurveModel = {
  points: SerializedCurvePoint[];
  mode: CurveMode;
};

export type SerializedContrastCurveState = {
  bypass: boolean;
  mode: ContrastCurveMode;
  points: SerializedCurvePoint[];
  amount: number;
  gain: number;
  parabolaPower: number;
  pcurveA: number;
  pcurveB: number;
  expImpulseK: number;
  cubicPulseCenter: number;
  cubicPulseWidth: number;
};

export type SerializedContrastState = {
  amount: number;
  pivot: number;
  enabled: boolean;
  bypass: boolean;
  curve: SerializedContrastCurveState;
};

export type SerializedBalanceState = {
  enabled: boolean;
  bypass: boolean;
  // Optional so projects saved before Phase 7 (balance exposure/saturation) still validate.
  exposure?: number;
  saturation?: number;
  temperature: number;
  tint: number;
  red: number;
  green: number;
  blue: number;
};

export type SerializedScatteringState = {
  enabled: boolean;
  bypass: boolean;
  shadowX: number;
  shadowY: number;
  highlightX: number;
  highlightY: number;
  balance: number;
  preserveLuminance: boolean;
};

export type SerializedRefractionState = {
  enabled: boolean;
  bypass: boolean;
  mapVectors: number[];
  separation: number;
  preserveLuminance: boolean;
};

export type SerializedSaturationState = {
  enabled: boolean;
  bypass: boolean;
  // Optional so pre-curve projects validate; deserialize fills the neutral curve.
  curve?: SerializedCurveModel;
};

export type SerializedRGBMixerRow = { r: number; g: number; b: number };

export type SerializedRGBMixerState = {
  enabled: boolean;
  bypass: boolean;
  red: SerializedRGBMixerRow;
  green: SerializedRGBMixerRow;
  blue: SerializedRGBMixerRow;
  preserveLuminance: boolean;
};

export type SerializedDensityChromaState = {
  enabled: boolean;
  bypass: boolean;
  // Optional so pre-curve projects validate; deserialize fills neutral curves.
  density?: SerializedCurveModel;
  chroma?: SerializedCurveModel;
  // Optional per-curve bypass flags (added later; absent in older project files).
  densityBypass?: boolean;
  chromaBypass?: boolean;
};

export type SerializedRadianceState = {
  enabled: boolean;
  bypass: boolean;
  // Optional so pre-curve projects validate; deserialize fills the neutral curve.
  curve?: SerializedCurveModel;
};

export type SerializedToneState = {
  enabled: boolean;
  bypass: boolean;
  // Optional; deserialize fills the neutral identity-diagonal (y = x) curve.
  curve?: SerializedCurveModel;
};

export type SerializedShadowHighlightState = {
  enabled: boolean;
  bypass: boolean;
  blackPoint: [number, number, number];
  whitePoint: [number, number, number];
  blackLinked: boolean;
  whiteLinked: boolean;
};

export type SerializedExposureState = {
  enabled: boolean;
  bypass: boolean;
  // Optional; deserialize fills the neutral (flat 0.5) expVsLuma curve.
  curve?: SerializedCurveModel;
};

export type SerializedPresetState = {
  enabled: boolean;
  bypass: boolean;
  selectedPresetId?: string;
  strength: number;
  preserveUserAdjustments: boolean;
};

export type SerializedGrainState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  acutance: number;
  resolution: number;
  colorAmount: number;
  seed: number;
};

export type SerializedHalationState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  spill: number;
  hue: number;
  saturation: number;
  quality?: FXQuality;
};

export type SerializedDiffusionState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  fog: number;
  threshold: number;
  focusProtect: number;
  centerX: number;
  centerY: number;
  quality?: FXQuality;
};

export type SerializedSpotlightState = {
  enabled: boolean;
  bypass: boolean;
  amount: number;
  contrast: number;
  bias: number;
  focus: number;
  centerX: number;
  centerY: number;
};


export type SerializedTransformState = {
  enabled: boolean;
  cropEnabled: boolean;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  aspectRatio: AspectRatioPreset;
  orientation: 0 | 90 | 180 | 270;
  straighten: number;
  flipX: boolean;
  flipY: boolean;
};

export type SerializedDistortState = {
  enabled: boolean;
  distortionAmount: number;
  distortionHorizontal: number;
  distortionVertical: number;
  distortionPoints: DistortionPoints;
  distortionMesh: number[] | null;
  perspectiveMode: boolean;
  showGrid: boolean;
  autoCrop: boolean;
};

export type SerializedColorState = {
  curve: SerializedCurveState;
  contrast: SerializedContrastState;
  balance: SerializedBalanceState;
  // Optional so projects saved before Phase 7 (scattering) still validate; deserialize fills defaults.
  scattering?: SerializedScatteringState;
  // Optional so projects saved before Phase 7 (refraction) still validate; deserialize fills defaults.
  refraction?: SerializedRefractionState;
  saturation: SerializedSaturationState;
  rgbMixer: SerializedRGBMixerState;
  densityChroma: SerializedDensityChromaState;
  radiance: SerializedRadianceState;
  // Optional so projects saved before the lumaVsLuma tone curve still validate; deserialize fills the neutral diagonal.
  tone?: SerializedToneState;
  // Optional so projects saved before the Shadow/Highlight panel still validate; deserialize fills neutral points.
  shadowHighlight?: SerializedShadowHighlightState;
  // Optional so projects saved before the faithful Exposure curve still validate; deserialize fills the neutral curve.
  exposure?: SerializedExposureState;
};

export type SerializedMaskType = "color-pick" | "luminosity" | "brush" | "radial" | "gradient";

export type SerializedColorPickMaskComponent = {
  id: string;
  type: SerializedMaskType;
  sampleX: number;
  sampleY: number;
  position: [number, number];
  size: [number, number];
  angle: number;
  useRadius: boolean;
  sampledColor: [number, number, number];
  useSelectedColor: boolean;
  threshold: number;
  feather: number;
  invert: boolean;
  opacity: number;
  alpha: number;
  // Optional luminosity mask properties
  luminosityCenter?: number;
  luminosityRange?: number;
  // Optional brush mask properties
  brushMask?: unknown;
  brushMaskSize?: [number, number];
  brushHardness?: number;
};

export type SerializedGradientMaskComponent = {
  id: string;
  type: "gradient";
  startPoint: [number, number];
  endPoint: [number, number];
  reflect: boolean;
  invert: boolean;
  opacity: number;
  alpha: number;
  showOverlay?: boolean;
};

export type SerializedLocalAdjustmentLayer = {
  id: string;
  name: string;
  enabled: boolean;
  components: (SerializedColorPickMaskComponent | SerializedGradientMaskComponent)[];
  adjustments: SerializedColorState;
};

export type SerializedToneMappingState = {
  enabled: boolean;
  exposureBias: number;
  highlightCompression: number;
  shoulderStrength: number;
  blackLift: number;
};

export type SerializedColorManagementState = {
  enabled: boolean;
  inputColorSpace: InputColorSpace;
  workingColorSpace: WorkingColorSpace;
  displayColorSpace: DisplayColorSpace;
  viewTransform: ViewTransform;
  useOutputTransform: boolean;
  useGamutMapping: boolean;
  // Optional so projects saved before the ACES pipeline toggle still validate;
  // deserialize defaults it to true.
  useAcesPipeline?: boolean;
  // Optional so projects saved before the full IDT/ODT selector still validate;
  // deserialize defaults both to "sRGB".
  inputColorSpaceId?: string;
  displayColorSpaceId?: string;
  // Read aliases for projects saved before the runtime naming cleanup.
  useLegacyAces?: boolean;
  legacyInputId?: string;
  legacyDisplayId?: string;
  // Optional so Phase 28/29 projects still validate; deserialize fills defaults.
  toneMapping?: SerializedToneMappingState;
  debugView: ColorManagementDebugView;
  // Optional so projects saved before Phase 35 still validate; raw OCIO text is stored separately.
  ocio?: ProjectOCIOState;
  // Optional so projects saved before Phase 36 still validate; baked LUT data is not stored here.
  ocioRuntime?: OCIORuntimeState;
};

export type SerializedEngineSettingsState = {
  lutStorageMode: LUTStorageMode;
};

export type SerializedEditState = SerializedColorState & {
  preset: SerializedPresetState;
  // Optional so projects saved before Color Match still validate; deserialize fills defaults.
  match?: MatchState;
  grain: SerializedGrainState;
  halation: SerializedHalationState;
  diffusion: SerializedDiffusionState;
  // Optional so projects saved before the Spotlight FX still validate; deserialize fills the off default.
  spotlight?: SerializedSpotlightState;
  transform: SerializedTransformState;
  // Optional so projects saved before Distort still validate; deserialize fills neutral defaults.
  distort?: SerializedDistortState;
  // Optional so projects saved before Spot Removal still validate.
  retouch?: RetouchState;
  // Optional so projects saved before presentation borders still validate.
  presentationBorder?: PresentationBorderSettings;
  // Optional so projects saved before Phase 28 still validate; deserialize fills defaults.
  colorManagement?: SerializedColorManagementState;
  // Optional so projects saved before Phase 31 default to auto LUT storage.
  engineSettings?: SerializedEngineSettingsState;
  // Optional so projects saved before local adjustments still validate.
  localAdjustments?: SerializedLocalAdjustmentLayer[];
  overlays?: EditorOverlayLayer[];
};

export type SmartPreviewPolicy = "off" | 1280 | 2560 | 4096;

export type ManagedCacheUsage = {
  sourceBytes: number;
  smartPreviewBytes: number;
  thumbnailBytes: number;
  runtimeBytes: number;
};

export type WatchedFolderRecord = {
  id: string;
  accountId: string;
  projectId: string;
  name: string;
  handleKey: string;
  status: "connected" | "disconnected" | "permission-expired" | "error";
  lastError?: string;
  lastScanAt: number;
  scanIntervalMs: number;
  files: Array<{
    relativePath: string;
    size: number;
    lastModified: number;
    contentHash?: string;
    assetId?: string;
    missing?: boolean;
  }>;
};

export type BatchEditJournalEntry = {
  assetId: string;
  before: SerializedEditState;
  after: SerializedEditState;
  status: "pending" | "applied" | "rolled-back" | "failed" | "skipped";
  error?: string;
};

export type BatchEditJournal = {
  id: string;
  projectId: string;
  primaryAssetId: string;
  moduleKeys: string[];
  status: "prepared" | "applying" | "committed" | "rolling-back" | "rolled-back";
  entries: BatchEditJournalEntry[];
  createdAt: number;
  updatedAt: number;
};

export type MediaVersionSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  editState: SerializedEditState;
  /** Video-only temporal selection. Older snapshots imply the full clip. */
  videoState?: SerializedVideoState;
};

// ── Project types ──────────────────────────────────────────────────────────

/**
 * Reserved project id for the auto-saved "current session" — the working image +
 * edits persisted continuously so reloading the page restores what you were doing.
 * Hidden from the project browser (listProjects filters it out).
 */
export const SESSION_PROJECT_ID = "__current_session__";

export type SavedProjectImage = {
  id: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  // How the image blob was stored:
  //  "original"  → the source file as-uploaded (JPG/PNG/etc.) — reload via decode.
  //  "developed" → the decoded source re-encoded (PNG) for formats whose decode is
  //                heavy (RAW/TIFF/DPX/EXR/HEIC), so reopening skips re-decoding.
  // Optional/defaulted so projects saved before this change still load.
  storage?: "original" | "developed";
};

export type SavedProject = {
  id: string;
  schemaVersion: ProjectSchemaVersion;
  name: string;
  createdAt: number;
  updatedAt: number;
  image: SavedProjectImage;
  editState: SerializedEditState;
};

export type SavedProjectSummary = {
  id: string;
  name: string;
  fileName: string;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  assetCount?: number;
  /** Small JPEG thumbnail for the project browser (absent for older projects). */
  thumbnail?: Blob;
};

export type LoadedProject = {
  project: SavedProject;
  imageBlob: Blob;
  editState: SerializedEditState;
};

// ── Multi-asset project model ────────────────────────────────────────────────
//
// Mirrors the OPFS-style project layout in IndexedDB:
//   active.txt              → AppSession (the singleton "current" record)
//   project state.json      → ProjectRecord ({ id, name, activeUserMedia, … })
//   user-media/{id}/state.json + metadata.json → MediaRecord (per asset)
//   user-media/{id}/image.data | image.ext     → images store (by imageId)
//   user-media/{id}/thumbnail.jpeg             → thumbnails store (by thumbnailId)
//
// The current app edits one asset at a time (global editState + state.image),
// but a project owns an ordered asset list; activeAssetId selects the live one.

/** The single persisted boot pointer (active.txt equivalent). */
export type AppSession = {
  /** Fixed key so there is exactly one session record. */
  id: "current";
  activeProjectId: string | null;
  activeAssetId: string | null;
  lastOpenedAt: number;
};

export const APP_SESSION_KEY = "current" as const;

/** A project record that owns an ordered list of media assets. */
export type ProjectRecord = {
  id: string;
  schemaVersion: ProjectSchemaVersion;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** assetId of the last-selected media, or null. */
  activeUserMedia: string | null;
  /** Ordered asset ids belonging to this project. */
  assetIds: string[];
};

/**
 * How a media asset's pixels are cached:
 *  - "data"      → decoded, orientation-applied raw RGBA (Uint8ClampedArray buffer
 *                  + width/height) — rebuilt via new ImageData(), ZERO decode on reload.
 *  - "original"  → the source file as-uploaded (browser-native JPG/PNG/etc.).
 *  - "developed" → a decoded source re-encoded as PNG (older records only).
 */
export type MediaImageStorage = "data" | "original" | "developed";

/** Project-local pixels shared by an original and all of its virtual copies. */
export type MediaSourceRecord = {
  sourceId: string;
  projectId: string;
  imageId: string;
  thumbnailId: string;
  galleryPreviewId?: string;
  smartPreviewId?: string;
  smartPreviewPolicy?: SmartPreviewPolicy;
  storage: MediaImageStorage;
  mimeType: string;
  format?: string;
  width: number;
  height: number;
  sizeBytes: number;
  captureMetadata: Record<string, unknown>;
  primaryAssetId: string;
  refCount: number;
  createdAt: number;
  updatedAt: number;
};

export type MediaVariantKind = "original" | "virtual-copy";

/** Variant-only identity/state. MediaRecord remains the persisted compatibility shape. */
export type MediaVariantRecord = {
  assetId: string;
  projectId: string;
  sourceId: string;
  variantKind: MediaVariantKind;
  variantName: string;
  isPrimary: boolean;
  catalog: MediaCatalogFields;
  editState: SerializedEditState;
  snapshots: MediaVersionSnapshot[];
  viewport?: { zoom: number; panX: number; panY: number };
  createdAt: number;
  updatedAt: number;
};

/** Per-asset persistent state. */
export type MediaRecord = {
  assetId: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  /** Optional for compatibility; absent records are images. */
  mediaKind?: MediaKind;
  videoMetadata?: VideoMetadata;
  videoState?: SerializedVideoState;
  /** Detected source format id (for the RAW/EXR default-IDT decision on reload). */
  format?: string;
  width: number;
  height: number;
  sizeBytes: number;
  storage: MediaImageStorage;
  /** Source image metadata captured at import (EXIF/ICC fields when available). */
  metadata?: Record<string, unknown>;
  /** Additive catalog metadata; absent legacy records hydrate to neutral defaults. */
  catalog?: MediaCatalogFields;
  /** Owner of catalog metadata in the legacy IndexedDB fallback. */
  catalogAccountId?: string;
  /** Shared-source identity. Missing legacy records are migrated on first copy. */
  sourceId?: string;
  variantKind?: MediaVariantKind;
  variantName?: string;
  isPrimary?: boolean;
  /** Key into the images store for this asset's pixels. */
  imageId: string;
  /** Key into the thumbnails store for this asset's JPEG. */
  thumbnailId: string;
  /** Key into the gallery store for this asset's preview. */
  galleryPreviewId?: string;
  smartPreviewId?: string;
  smartPreviewPolicy?: SmartPreviewPolicy;
  /** Crop & Rotate backup: first pre-transform image cache. */
  originalImageId?: string;
  /** Crop & Rotate backup thumbnail. */
  originalThumbnailId?: string;
  /** Crop & Rotate backup gallery preview. */
  originalGalleryPreviewId?: string;
  /** Metadata needed to restore the pre-transform cache after Reset + Done. */
  originalImageMeta?: {
    width: number;
    height: number;
    sizeBytes: number;
    storage: MediaImageStorage;
    mimeType: string;
    format?: string;
  };
  /** The asset's edit state. */
  editState: SerializedEditState;
  snapshots?: MediaVersionSnapshot[];
  /** Persisted viewport (restored after texture dims are known; else fit-to-screen). */
  viewport?: { zoom: number; panX: number; panY: number };
  createdAt: number;
  updatedAt: number;
};

/** Stored image-blob record (images store). Raw RGBA lives in `buffer`. */
export type StoredImageRecord = {
  id: string;
  kind: MediaImageStorage;
  blob?: Blob;
  buffer?: ArrayBuffer;
  width?: number;
  height?: number;
};

export type MatchReferenceRecord = {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
  sizeBytes: number;
  updatedAt: number;
};

/** A cached asset resolved for loading (mediaStore.loadCachedImageAsset). */
export type LoadedImageAsset =
  | { kind: "data"; imageData: ImageData; fileName: string }
  | { kind: "blob"; blob: Blob; fileName: string; mimeType: string }
  | { kind: "missing" };

/** Lightweight asset summary for the media strip. */
export type MediaSummary = {
  assetId: string;
  projectId: string;
  fileName: string;
  width: number;
  height: number;
  updatedAt: number;
  thumbnail?: Blob;
  catalog?: MediaCatalogFields;
  metadata?: Record<string, unknown>;
  sourceId?: string;
  variantKind?: MediaVariantKind;
  variantName?: string;
  isPrimary?: boolean;
};

export type OverlayLibraryItem = {
  id: string;
  name: string;
  blob: Blob;
  thumbnailBlob: Blob;
  addedAt: number;
};
