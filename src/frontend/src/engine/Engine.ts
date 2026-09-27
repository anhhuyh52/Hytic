import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  RedFormat,
  Scene,
  Texture,
  UnsignedByteType,
  VideoTexture,
  WebGLRenderer,
} from "three";
import { isBorderVisible, toBorderSettings } from "../features/presentation/presentationBridge";
import { resolvePresentationGeometry } from "../features/presentation/presentationGeometry";
import type { BorderSettings } from "../features/presentation/presentationTypes";
import { VIEWER_CANVAS_CLEAR_COLOR, VIEWER_FIT_PADDING } from "../config/viewerConstants";
import { ImageLoader, type LoadedImage } from "./ImageLoader";
import {
  detectEngineCapabilities,
  type EngineCapabilities,
} from "./capabilities/EngineCapabilities";
import { LUTGenerator } from "./lut/LUTGenerator";
import { LUT3DTextureGenerator } from "./lut/LUT3DTextureGenerator";
import { LocalLUTManager } from "./lut/LocalLUTManager";
import { LUT_SIZE } from "./lut/lutConstants";
import type { CubeExportSize } from "./lut/exportCube";
import type { LutWriteResult, LutWriteSettings } from "./lut/lutFormatWriters";
import { readRenderTargetRgba8 } from "./export/readRenderTarget";
import type { LUTData3D } from "./interchange/InterchangeTypes";
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineSettingsState,
  type LUTMemoryEstimate,
  type LUTTextureHandle,
  type LUTTextureKind,
} from "./lut/LUTStorageTypes";
import {
  estimateLUTMemory,
  getLUTPathLabel,
  getLUTStorageWarning,
  resolveLUTTextureKind,
} from "./lut/LUTTextureAdapter";
import {
  FXPipeline,
  type EngineDebugView,
  type FXPipelineCounters,
  type FXPipelineRenderParams,
} from "./fx/FXPipeline";
import { ColorMaskPass } from "./passes/masking/ColorMaskPass";
import { MaskOverlayPass } from "./passes/masking/MaskOverlayPass";
import { RadialMaskPass } from "./passes/masking/RadialMaskPass";
import { GradientMaskPass } from "./passes/masking/GradientMaskPass";
import { BrushMaskTexturePass } from "./passes/masking/BrushMaskTexturePass";
import { BrushMaskPass } from "./passes/masking/BrushMaskPass";
import { DepthMaskPass } from "./passes/masking/DepthMaskPass";
import { DepthSamplePass } from "./passes/masking/DepthSamplePass";
import { DEFAULT_DEPTH_RESOURCE, resetDepthResource, setDepthResource } from "../features/masking/depthMaskCapability";
import { EditorOverlayPass } from "./passes/EditorOverlayPass";
import type { EditorOverlayLayer } from "../features/overlays/editorOverlayTypes";
import type { GrainViewport } from "./passes/fx/GrainPass";
import type { ColorManagementState } from "./color/ColorManagementTypes";
import {
  cloneColorManagementState,
  DEFAULT_COLOR_MANAGEMENT_STATE,
} from "./color/ColorManagementTypes";
import { buildColorPrewarmCombos } from "./color/colorPrewarm";
import type { ExportImageRequest, ExportOptions } from "./passes/ExportPass";
import {
  getPotoPerfSnapshot,
  recordCreateImageBitmap,
  recordCreateImageBitmapDuringSwitch,
  recordStaleBitmapClosed,
  recordFullImageDataWrite,
  recordHistogramReadback,
  recordRenderFrame,
  recordRenderRequest,
  recordSourceTextureUpload,
  recordTransmittedStateSet,
  recordUniformUpdate,
  type PotoPerfSnapshot,
} from "../app/performanceCounters";

/** Thrown when export is requested with no ready image, so the UI can show a safe message. */
export class ExportNotReadyError extends Error {
  constructor(message = "Nothing to export") {
    super(message);
    this.name = "ExportNotReadyError";
  }
}

export type RendererDebugSnapshot = {
  source: {
    loaded: boolean;
    fileName: string;
    format: string;
    mimeType: string;
    bitDepth: number;
    hasAlpha: boolean;
    orientationApplied: boolean;
    originalWidth: number;
    originalHeight: number;
    width: number;
    height: number;
    textureReady: boolean;
    textureVersion: number;
    sourceTextureCreates: number;
    fileLoads: number;
    cachedDataLoads: number;
    imageDataReadbacks: number;
  };
  render: {
    previewMode: "draft" | "refined";
    previewWidth: number;
    previewHeight: number;
    processedWidth: number;
    processedHeight: number;
    processedDirty: boolean;
    rafPending: boolean;
    splitEnabled: boolean;
    splitX: number;
  };
  color: {
    useAcesPipeline: boolean;
    inputColorSpaceId: string;
    displayColorSpaceId: string;
    lutKind: LUTTextureKind;
    lutInterpolationMode: LUTInterpolationMode;
    lutReadbackIs8Bit: boolean;
  };
  fxCounters: FXPipelineCounters;
  perf: PotoPerfSnapshot;
};

import type { ColorMatchImage } from "./reference/ColorMatchService";
import { isMatchActive, type MatchState } from "./state/MatchTypes";
import { READ_MAX_RES, type ScopeReadback } from "./scopes/ScopeTypes";
import type { ColorState, DistortState, EditState, ImageFXState, TransformState, CurvePreviewInput } from "./state/EditState";
import type { RetouchState } from "./state/EditState";
import { DEFAULT_EDIT_STATE, DEFAULT_TRANSFORM_STATE } from "./state/EditState";
import { DEFAULT_DISTORT_STATE, cloneDistortState } from "../features/distort/distortStore";
import {
  DEFAULT_RETOUCH_STATE,
  cloneRetouchState,
} from "../features/retouch/retouchTypes";
import { getTransformOutputDimensions } from "./transform/transformGeometry";
import {
  IntegrationPass,
  type IntegrationDebugMode,
  type LUTInterpolationMode,
} from "./passes/IntegrationPass";
import {
  ViewportController,
  type RestoredViewport,
  type ViewportTransform,
} from "./ViewportController";
import type { ImageInfo, ViewportInfo } from "../app/editor-store";
import type { ColorMaskPreview, RadialMaskPreview, GradientMaskPreview, LuminanceMaskPreview, DepthMaskPreview, BrushMaskPreview } from "../ui/Viewer";

const DEBUG_ENGINE = false;

// Render reasons that only change the VIEW (pan/zoom/resize) and so don't require
// re-running the FX pipeline unless the zoom now needs a materially different
// preview resolution.
const VIEW_ONLY_RENDER_REASONS = new Set([
  "viewport-change",
  "viewer-resize",
  "zoom-100",
  "zoom-fit",
]);

const INTERACTIVE_PREVIEW_REASONS = new Set([
  "edit-state",
  "preview-edit",
  "curve-preview",
  "transform-edit",
  "brush-edit",
]);

const OVERLAY_PREVIEW_REASONS = new Set([
  "overlay-draft",
  "overlay-draft-cancelled",
  "overlay-draft-applied",
  "overlay-preview-texture-ready",
]);

const COLOR_PREVIEW_KEYS = new Set<keyof EditState>([
  "curve",
  "contrast",
  "balance",
  "scattering",
  "refraction",
  "saturation",
  "rgbMixer",
  "densityChroma",
  "radiance",
  "tone",
  "shadowHighlight",
  "exposure",
  "localAdjustments",
]);

const FX_PREVIEW_KEYS = new Set<keyof EditState>([
  "grain",
  "halation",
  "diffusion",
  "spotlight",
  "retouch",

]);

const GEOMETRY_PREVIEW_KEYS = new Set<keyof EditState>(["distort", "transform"]);

const DRAFT_PREVIEW_RENDER_SIDE = 2048;
// Keep interactive preview work bounded for very large RAW/cached-RGBA sources.
// Full-resolution export still uses the original dimensions; this only limits the
// on-screen source proxy + graded preview render target used while zooming/editing.
// A 4096px ceiling made high-resolution PNG/TIFF/RAW sources visibly soft at
// 100% zoom because both the source texture and processed result were enlarged
// beyond their preview resolution. Allow an 8K/64MP refined preview; actual GPU
// limits and the platform source-pixel budget still apply below. The 64MP area
// budget equals 8K square while allowing wider non-square camera images.
const REFINED_PREVIEW_RENDER_SIDE = 16_384;
const REFINED_PREVIEW_RENDER_PIXELS = 67_108_864;
const SOURCE_PREVIEW_TEXTURE_SIDE = 16_384;
const SOURCE_PREVIEW_TEXTURE_PIXELS = 67_108_864;
// Keep wheel/pinch zoom compositing the already-graded texture. Large RAW
// createImageBitmap resizes and full FX renders begin only after interaction has
// settled, and only when resolution differs materially; the former 1% threshold
// queued expensive rebuilds for nearly every zoom step.
const PREVIEW_REFINE_IDLE_MS = 400;
const PREVIEW_DOWNGRADE_IDLE_MS = 1000;
const PREVIEW_REBUILD_THRESHOLD = 0.15;
const IOS_MAX_SOURCE_PIXELS = 16_777_216;
const ANDROID_MAX_SOURCE_PIXELS = 117_418_896;
const DESKTOP_MAX_SOURCE_PIXELS = 268_435_456;

type PreviewRenderMode = "draft" | "refined";

type EngineOptions = {
  onViewportChange?(viewport: ViewportInfo): void;
  onViewportInteractionChange?(active: boolean): void;
  onProcessedChange?(): void;
  onLUTStatusChange?(status: EngineLUTStatus): void;
  onRenderComplete?(): void;
};

export type EngineLUTStatus = {
  capabilities: EngineCapabilities;
  storageMode: EngineSettingsState["lutStorageMode"];
  textureKind: LUTTextureKind;
  pathLabel: string;
  warning?: string;
  memory: LUTMemoryEstimate;
};

export class Engine {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly capabilities: EngineCapabilities;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly imageLoader = new ImageLoader();
  private readonly integrationPass: IntegrationPass;
  private readonly baseLUTGenerator: LUTGenerator;
  private readonly baseLUT3DGenerator = new LUT3DTextureGenerator();
  private readonly localLUTManager: LocalLUTManager;
  private currentLocalLUTs: Array<{ layer: import("./state/EditState").LocalAdjustmentLayer; handle: import("./lut/LUTStorageTypes").LUTTextureHandle }> = [];
  private readonly fxPipeline: FXPipeline;
  private readonly colorMaskPass = new ColorMaskPass();
  private readonly maskOverlayPass = new MaskOverlayPass();
  private readonly radialMaskPass = new RadialMaskPass();
  private readonly gradientMaskPass = new GradientMaskPass();
  private readonly brushMaskTexturePass = new BrushMaskTexturePass();
  private readonly brushMaskPass = new BrushMaskPass();
  private readonly depthMaskPass = new DepthMaskPass();
  private readonly depthSamplePass = new DepthSamplePass();
  private readonly editorOverlayPass = new EditorOverlayPass();
  private readonly editorOverlayPreviewPass = new EditorOverlayPass();

  // ── Depth texture (set externally when the loaded image has depth data) ─────
  private depthTexture: import("three").Texture | null = null;
  private readonly onProcessedChange?: () => void;
  private readonly onLUTStatusChange?: (status: EngineLUTStatus) => void;
  private readonly onRenderComplete?: () => void;
  private readonly viewportController: ViewportController;
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  // The processed (FX-graded) texture only changes when the image, edits, LUT, or
  // crop transform change — NOT when the viewport pans/zooms. We cache it and skip
  // the (full-resolution, expensive) FX re-render on pure view changes, so zoom/pan
  // stays smooth on large RAW images (re-running the 48MP pass per frame was the
  // jank). View-only renders just re-composite the cached texture (a cheap quad).
  private processedDirty = true;
  private previewRenderMode: PreviewRenderMode = "refined";
  private previewRefineTimer = 0;
  private viewportRefineTimer = 0;
  private processedPreviewWidth = 0;
  private processedPreviewHeight = 0;
  private sourcePreviewWidth = 0;
  private sourcePreviewHeight = 0;
  private sourcePreviewRequestId = 0;
  private sourcePreviewPendingKey = "";
  private sourcePreviewTimer = 0;
  private sourceBitmapInstallInProgress = false;
  private loadRequestId = 0;
  private imageTexture?: Texture;
  private videoExportTexture?: Texture;
  private imageBitmap?: ImageBitmap;
  private imageTextureBitmap?: ImageBitmap;
  private videoElement?: HTMLVideoElement;
  private videoObjectUrl?: string;
  private videoFrameCallbackId = 0;
  private sourceFileName = "";
  private sourceFormat = "";
  private sourceMimeType = "";
  private sourceBitDepth = 0;
  private sourceHasAlpha = false;
  private sourceOrientationApplied = false;
  private sourceOriginalWidth = 1;
  private sourceOriginalHeight = 1;
  private imageWidth = 1;
  private imageHeight = 1;
  private sourceTextureVersion = 0;
  private sourceTextureCreateCount = 0;
  // Source-texture version at the last full applyEditState. Guards the IDT/ODT fast
  // path so it only fires for same-image color-space tweaks, never a media switch.
  private lastAppliedSourceTextureVersion = -1;
  private fileLoadCount = 0;
  private cachedDataLoadCount = 0;
  private sourceImageDataReadbackCount = 0;
  private lutInterpolationMode: LUTInterpolationMode = "tetrahedral";
  private engineSettings: EngineSettingsState = { ...DEFAULT_ENGINE_SETTINGS };
  private activeLUTKind: LUTTextureKind = "2d-atlas";
  private lutStorageWarning?: string;
  private baseLUT3DNeedsUpdate = true;
  private currentTransformState: TransformState = { ...DEFAULT_TRANSFORM_STATE };
  private currentDistortState: DistortState = cloneDistortState(DEFAULT_DISTORT_STATE);
  private currentRetouchState: RetouchState = cloneRetouchState(DEFAULT_RETOUCH_STATE);
  private currentFXState: ImageFXState = getFXState(DEFAULT_EDIT_STATE);
  private currentColorManagement: ColorManagementState = cloneColorManagementState(
    DEFAULT_COLOR_MANAGEMENT_STATE,
  );
  private currentDebugView: EngineDebugView | IntegrationDebugMode = "final";
  // Last IDT|ODT combo we kicked a background prewarm for (so we don't rebuild the
  // combo list on every unrelated edit).
  private lastColorPrewarmKey = "";
  private currentMatchActive = false;
  private currentMatchLut: number[] | null = null;
  private currentMatchGeneratedAt = 0;
  private currentMatchBypass = false;
  private splitEnabled = false;
  private cropEditMode = false;
  private presentationSettings: BorderSettings | null = null;
  private presentationBackgroundTexture: Texture | null = null;
  private presentationBackgroundBitmap: ImageBitmap | null = null;
  private presentationBackgroundKey = "";
  private presentationBackgroundRequestId = 0;
  private presentationDirty = false;
  /** Cached photo pipeline output before editor overlays are composited. */
  private lastBaseProcessedRT: import("three").WebGLRenderTarget | null = null;
  /** Cached texture currently presented by IntegrationPass (base + overlays). */
  private lastProcessedRT: import("three").WebGLRenderTarget | null = null;
  private overlayDirty = false;
  private overlayPreviewActive = false;
  private viewportImageWidth = 1;
  private viewportImageHeight = 1;
  private committedEditState: EditState = DEFAULT_EDIT_STATE;
  private committedBaseStateSignature = JSON.stringify({ ...DEFAULT_EDIT_STATE, overlays: [] });
  private hasAppliedEditState = false;
  private previewOverlayLayers: readonly EditorOverlayLayer[] = DEFAULT_EDIT_STATE.overlays;
  private transientPreviewActive = false;
  private transientPreviewKeys = new Set<keyof EditState>();
  private disposed = false;
  private deferredWarmupStarted = false;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions = {}) {
    this.canvas = canvas;
    this.onProcessedChange = options.onProcessedChange;
    this.onLUTStatusChange = options.onLUTStatusChange;
    this.onRenderComplete = options.onRenderComplete;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(VIEWER_CANVAS_CLEAR_COLOR, 1);
    this.capabilities = detectEngineCapabilities(this.renderer);
    this.activeLUTKind = resolveLUTTextureKind(
      this.engineSettings.lutStorageMode,
      this.capabilities,
    );
    this.lutStorageWarning = getLUTStorageWarning(
      this.engineSettings.lutStorageMode,
      this.capabilities,
    );
    this.camera.position.z = 10;
    this.integrationPass = new IntegrationPass();
    this.scene.add(this.integrationPass.mesh);
    this.baseLUTGenerator = new LUTGenerator(this.renderer, () =>
      this.requestRender("cube-loaded"),
    );
    this.localLUTManager = new LocalLUTManager(this.renderer, () =>
      this.requestRender("local-lut"),
    );
    this.baseLUT3DNeedsUpdate = true;
    this.fxPipeline = new FXPipeline(this.renderer);
    // Legacy IDT/ODT now live in small cached passes; this hook is retained for
    // older pipeline wiring but no longer delays selector updates.
    this.fxPipeline.setColorReadyCallback(() => this.requestRender());
    this.integrationPass.setUseLUT(true);
    this.emitLUTStatus();

    this.viewportController = new ViewportController({
      camera: this.camera,
      canvas,
      onChange: (transform, meta) => {
        this.applyViewportTransform(transform);
        if (meta.commit) {
          options.onViewportChange?.({
            zoom: transform.zoom,
            panX: transform.panX,
            panY: transform.panY,
          });
        }
      },
      onInteractionChange: options.onViewportInteractionChange,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.requestRender();
  }

  startDeferredWarmup(): void {
    if (this.deferredWarmupStarted) return;
    this.deferredWarmupStarted = true;
    const run = () => {
      if (this.disposed) return;
      // The first image render normally builds the base LUT already. Only rebuild
      // it here if an edit changed the LUT before this deferred task ran; otherwise
      // this warmup would repeat the LUT draw and invalidate the 3D copy for no gain.
      if (this.baseLUTGenerator.needsUpdate) {
        this.baseLUTGenerator.render();
        this.baseLUT3DNeedsUpdate = true;
        this.requestRender("deferred-warmup");
      }
      this.fxPipeline.prewarmColorPipeline();
    };
    requestAnimationFrame(() => {
      window.setTimeout(run, 0);
    });
  }

  async loadImage(file: File): Promise<ImageInfo> {
    if (file.name === "thumbnail.jpeg") {
      throw new Error("thumbnail.jpeg must not be used as main editor preview");
    }
    const requestId = ++this.loadRequestId;
    this.clearDepthTexture();
    resetDepthResource();
    this.fileLoadCount += 1;
    const loadedImage = await this.imageLoader.load(file);

    if (requestId !== this.loadRequestId) {
      loadedImage.bitmap.close();
      throw new Error("Image load was superseded");
    }

    const metadataHasDepth = loadedImage.metadata.hasDepth === true || !!loadedImage.depthMap;
    setDepthResource({
      ...DEFAULT_DEPTH_RESOURCE,
      metadataHasDepth,
      status: metadataHasDepth ? "loading" : "unavailable",
    });
    await this.setImage(loadedImage, requestId);
    if (requestId !== this.loadRequestId) return Promise.reject(new Error("Image load was superseded"));
    if (loadedImage.depthMap) {
      const depth = loadedImage.depthMap;
      const texture = new DataTexture(depth.data, depth.width, depth.height, RedFormat, FloatType);
      texture.colorSpace = NoColorSpace;
      texture.flipY = false;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      this.setDepthTexture(texture, depth.width, depth.height);
      setDepthResource("source", depth.source);
    } else if (metadataHasDepth) {
      setDepthResource({
        ...DEFAULT_DEPTH_RESOURCE,
        metadataHasDepth: true,
        status: "error",
        error: "Depth metadata was present but the decoder returned no depth map.",
      });
    }
    this.startDeferredWarmup();
    return {
      fileName: loadedImage.fileName,
      width: loadedImage.width,
      height: loadedImage.height,
      format: loadedImage.format,
      mimeType: loadedImage.mimeType,
      metadataHasDepth,
    };
  }

  cancelImageLoad(): void {
    this.loadRequestId += 1;
    this.sourcePreviewRequestId += 1;
  }

  /** Installs a browser-decoded video as a dynamic source for the shared GPU pipeline. */
  async loadVideo(file: File): Promise<ImageInfo> {
    const requestId = ++this.loadRequestId;
    this.clearDepthTexture();
    resetDepthResource();
    this.fileLoadCount += 1;
    const video = document.createElement("video");
    if (file.type && video.canPlayType(file.type) === "") {
      throw new Error("This video codec is not supported by your browser.");
    }
    const url = URL.createObjectURL(file);
    video.preload = "auto";
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Timed out while decoding the video.")),
        20_000,
      );
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      const fail = () => {
        clearTimeout(timeout);
        reject(new Error("This video codec is not supported by your browser."));
      };
      video.addEventListener("loadeddata", done, { once: true });
      video.addEventListener("error", fail, { once: true });
      video.load();
    }).catch((error) => {
      URL.revokeObjectURL(url);
      throw error;
    });
    if (requestId !== this.loadRequestId) {
      URL.revokeObjectURL(url);
      throw new Error("Video load was superseded");
    }
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      URL.revokeObjectURL(url);
      throw new Error("Unable to read video dimensions or duration.");
    }

    this.disposeImageResources();
    this.videoElement = video;
    this.videoObjectUrl = url;
    this.sourceFileName = file.name;
    this.sourceFormat = "video";
    this.sourceMimeType = file.type || "video/mp4";
    this.sourceBitDepth = 8;
    this.sourceHasAlpha = false;
    this.sourceOrientationApplied = true;
    this.sourceOriginalWidth = video.videoWidth;
    this.sourceOriginalHeight = video.videoHeight;
    this.imageWidth = video.videoWidth;
    this.imageHeight = video.videoHeight;
    this.viewportController.fitToImage(this.imageWidth, this.imageHeight);
    this.viewportImageWidth = this.imageWidth;
    this.viewportImageHeight = this.imageHeight;
    this.syncViewportImageSize();

    const texture = new VideoTexture(video);
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.colorSpace = NoColorSpace;
    // `loadeddata` fired before VideoTexture registered its frame callback, so
    // the already-decoded poster frame will not invalidate the texture itself.
    // Upload it explicitly so a paused clip is visible before the first play.
    texture.needsUpdate = true;
    this.imageTexture = texture;
    this.sourceTextureVersion += 1;
    this.sourceTextureCreateCount += 1;
    this.integrationPass.setImageTexture(texture, this.imageWidth, this.imageHeight);
    this.scheduleVideoFrame();
    this.requestRender("video-frame");
    this.startDeferredWarmup();
    this.maybePrewarmColorVariants();
    return {
      fileName: file.name,
      width: video.videoWidth,
      height: video.videoHeight,
      format: "video",
      mimeType: file.type || "video/mp4",
    };
  }

  private scheduleVideoFrame(): void {
    const video = this.videoElement;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;
    this.videoFrameCallbackId = video.requestVideoFrameCallback(() => {
      if (video !== this.videoElement) return;
      this.imageTexture!.needsUpdate = true;
      this.requestRender("video-frame");
      this.scheduleVideoFrame();
    });
  }

  getVideoElement(): HTMLVideoElement | undefined {
    return this.videoElement;
  }

  /** Renders one already-decoded video frame through the full export pipeline. */
  renderDecodedVideoFrame(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    canvas: OffscreenCanvas,
  ): { width: number; height: number } {
    if (!this.videoElement) throw new ExportNotReadyError("No video loaded");
    let texture = this.videoExportTexture;
    if (!texture) {
      texture = new Texture(source);
      texture.flipY = false;
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.colorSpace = NoColorSpace;
      this.videoExportTexture = texture;
    } else {
      texture.image = source;
    }
    texture.needsUpdate = true;
    const { width, height } = this.resolveExportDimensions({});
    const useHighPrecisionPipeline = this.supportsFloatColorBuffer();
    const baseTarget = this.fxPipeline.renderExport({
      imageTexture: texture,
      sourceWidth,
      sourceHeight,
      width,
      height,
      lutHandle: this.prepareBaseLUTHandle(),
      transform: this.currentTransformState,
      distort: this.currentDistortState,
      retouch: this.currentRetouchState,
      fxState: this.currentFXState,
      lutInterpolationMode: this.lutInterpolationMode,
      lutKind: this.activeLUTKind,
      localLUTs: this.currentLocalLUTs,
      directCreativeShader: this.baseLUTGenerator.directCreativeShader,
      depthTexture: this.depthTexture,
      colorManagement: {
        useAcesPipeline: this.currentColorManagement.useAcesPipeline,
        inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
        displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
        idtAtlas: this.baseLUTGenerator.idtCubeAtlas,
        odtAtlas: this.baseLUTGenerator.odtCubeAtlas,
      },
      exportQuality: "high",
      exportFloat: useHighPrecisionPipeline,
    });
    const target = this.editorOverlayPass.render(
      this.renderer,
      baseTarget.texture,
      this.committedEditState.overlays,
      width,
      height,
      baseTarget.texture.type,
      undefined,
      this.depthTexture,
    ) ?? baseTarget;
    const bottomUp = readRenderTargetRgba8(this.renderer, target, width, height);
    const topDown = new Uint8ClampedArray(bottomUp.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = (height - 1 - y) * rowBytes;
      topDown.set(bottomUp.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create the video export canvas.");
    context.putImageData(new ImageData(topDown, width, height), 0, 0);
    return { width, height };
  }

  /**
   * Encodes the DECODED source image (pre-grade, the bitmap the editor holds) to a
   * blob. Used to persist a project's image in developed form so reopening it skips
   * the heavy decode (e.g. the ~5s RAW develop) — like legacy storing the developed
   * `original.data` rather than the camera RAW. Lossless PNG by default so the stored
   * source is bit-exact with what the grade was built on.
   */
  async getSourceImageBlob(type = "image/png", quality?: number): Promise<Blob | null> {
    return this.drawSourceToBlob(this.imageWidth, this.imageHeight, type, quality);
  }

  /**
   * Reads back the DECODED, orientation-applied source RGBA (the bitmap the editor
   * holds) as a raw buffer. Cached as legacy `image.data` so reload rebuilds the
   * texture via new ImageData() with ZERO decode (no RAW worker, no re-develop).
   */
  getSourceImageData(): { buffer: ArrayBuffer; width: number; height: number } | null {
    const source = this.imageBitmap ?? this.videoElement;
    if (!source) return null;
    this.sourceImageDataReadbackCount += 1;
    const w = this.imageWidth;
    const h = this.imageHeight;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    return { buffer: data.data.buffer, width: w, height: h };
  }

  /**
   * Returns a small source sample for analysis without allocating a full-frame
   * RGBA readback. Content-bounds detection never needs more than 640px on the
   * long edge, so keeping this resize beside the retained ImageBitmap avoids a
   * second 100-250 MB main-thread buffer for large imports.
   */
  getSourceAnalysisImageData(maxDimension = 640): {
    imageData: ImageData;
    sourceWidth: number;
    sourceHeight: number;
  } | null {
    const source = this.imageBitmap;
    if (!source) return null;
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const scale = Math.min(1, Math.max(1, maxDimension) / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return {
      imageData: ctx.getImageData(0, 0, width, height),
      sourceWidth,
      sourceHeight,
    };
  }

  /**
   * Legacy Crop & Rotate apply: render only geometric transforms into a fresh
   * source-sized RGBA cache. Color grade, IDT/ODT, local layers and FX are not
   * baked here.
   */
  getTransformedSourceImageData(): { buffer: ArrayBuffer; width: number; height: number } | null {
    if (!this.imageTexture || !this.imageBitmap) return null;

    const { width, height } = this.resolveExportDimensions({});
    const maxTextureSize = this.renderer.capabilities.maxTextureSize;
    if (width > maxTextureSize || height > maxTextureSize) {
      throw new Error(
        `Crop output ${width}x${height} exceeds GPU maximum texture size ${maxTextureSize}`,
      );
    }

    const target = this.fxPipeline.renderExport({
      imageTexture: this.imageTexture,
      width,
      height,
      lutHandle: this.prepareBaseLUTHandle(),
      transform: this.currentTransformState,
      distort: DEFAULT_DISTORT_STATE,
      fxState: NEUTRAL_FX_STATE,
      lutInterpolationMode: this.lutInterpolationMode,
      lutKind: this.activeLUTKind,
      localLUTs: [],
      useLUT: false,
      depthTexture: this.depthTexture,
      colorManagement: {
        useAcesPipeline: false,
        inputColorSpaceId: "sRGB",
        displayColorSpaceId: "sRGB",
      },
      exportQuality: "high",
    });

    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    const topDown = new Uint8ClampedArray(pixels.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = (height - 1 - y) * rowBytes;
      topDown.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
    }
    this.sourceImageDataReadbackCount += 1;
    // Full developed-raster production (crop/rotate bake). Only on apply — never
    // during a panel drag.
    recordFullImageDataWrite();
    return { buffer: topDown.buffer, width, height };
  }

  /**
   * Loads a cached raw-RGBA buffer straight into a source texture (legacy au()/vh()).
   * Wraps the bytes in ImageData → ImageBitmap → the shared bitmap install path; no
   * decode worker runs. Mirrors loadImage()'s supersede guard.
   */
  async loadImageData(
    data: { buffer: ArrayBuffer; width: number; height: number },
    fileName: string,
  ): Promise<ImageInfo> {
    if (fileName === "thumbnail.jpeg") {
      throw new Error("thumbnail.jpeg must not be used as main editor preview");
    }
    const requestId = ++this.loadRequestId;
    this.clearDepthTexture();
    resetDepthResource();
    this.cachedDataLoadCount += 1;
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height);
    recordCreateImageBitmap();
    recordCreateImageBitmapDuringSwitch();
    const bitmap = await createImageBitmap(imageData, {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    if (requestId !== this.loadRequestId) {
      bitmap.close();
      recordStaleBitmapClosed();
      throw new Error("Image load was superseded");
    }
    this.sourceFileName = fileName;
    this.sourceFormat = "cached-rgba";
    this.sourceMimeType = "image/rgba";
    this.sourceBitDepth = 8;
    this.sourceHasAlpha = true;
    this.sourceOrientationApplied = true;
    await this.setSourceBitmap(bitmap, data.width, data.height, requestId);
    this.startDeferredWarmup();
    this.logSourceDebugInfo("cached-rgba");
    return {
      fileName,
      width: data.width,
      height: data.height,
      format: "cached-rgba",
      mimeType: "image/rgba",
    };
  }

  /** Small JPEG thumbnail of the source image for the project browser (legacy parity). */
  async getSourceThumbnailBlob(maxSize = 256): Promise<Blob | null> {
    const scale = Math.min(1, maxSize / Math.max(this.imageWidth, this.imageHeight, 1));
    const w = Math.max(1, Math.round(this.imageWidth * scale));
    const h = Math.max(1, Math.round(this.imageHeight * scale));
    return this.drawSourceToBlob(w, h, "image/jpeg", 0.7);
  }

  private async drawSourceToBlob(
    w: number,
    h: number,
    type: string,
    quality?: number,
  ): Promise<Blob | null> {
    const source = this.imageBitmap ?? this.videoElement;
    if (!source) return null;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return canvas.convertToBlob({ type, quality });
  }

  resetZoom() {
    this.viewportController.resetZoom();
    this.requestRender("zoom-100");
  }

  fitToScreen() {
    this.viewportController.fitToScreen("manual-fit");
    this.requestRender("zoom-fit");
  }

  clearImage() {
    this.resetSplitPreview();
    this.clearDepthTexture();
    resetDepthResource();
    this.disposeImageResources();
    this.imageWidth = 1;
    this.imageHeight = 1;
    this.sourceOriginalWidth = 1;
    this.sourceOriginalHeight = 1;
    this.viewportImageWidth = 1;
    this.viewportImageHeight = 1;
    this.sourceFileName = "";
    this.sourceFormat = "";
    this.sourceMimeType = "";
    this.sourceBitDepth = 0;
    this.sourceHasAlpha = false;
    this.sourceOrientationApplied = false;
    this.viewportController.clearImage();
    this.requestRender("image-cleared");
    this.onProcessedChange?.();
  }

  hasImage(): boolean {
    return !!(this.imageBitmap || this.videoElement || this.imageTexture);
  }

  restoreViewport(viewport: RestoredViewport) {
    this.viewportController.restoreViewport(viewport);
    this.requestRender("viewport-change");
  }

  setDebugMode(mode: IntegrationDebugMode | EngineDebugView) {
    this.currentDebugView = mode;
    this.integrationPass.setDebugMode(isIntegrationDebugMode(mode) ? mode : "final");
    this.requestRender("debug-view");
  }

  toggleSplit(): boolean {
    if (!this.hasImage()) {
      this.resetSplitPreview();
      return false;
    }
    this.splitEnabled = !this.splitEnabled;
    if (this.splitEnabled) {
      this.viewportController.setPanEventOverride((pointerCanvasX, _pointerCanvasY, canvasWidth) => {
        this.integrationPass.setSplit(Math.max(0.001, pointerCanvasX / Math.max(1, canvasWidth)));
        this.requestRender("split-drag");
      });
      this.integrationPass.setSplit(0.5);
    } else {
      this.viewportController.setPanEventOverride(null);
      this.integrationPass.setSplit(0);
    }
    this.requestRender("split-toggle");
    return this.splitEnabled;
  }

  setSplitPosition(x: number) {
    if (this.splitEnabled) {
      this.integrationPass.setSplit(Math.max(0.001, Math.min(1, x)));
      this.requestRender("split-drag");
    }
  }

  /**
   * Legacy split uses normalized canvas X, not transformed image UV. This keeps
   * the divider under the pointer regardless of pan, zoom, crop, rotate, or flip.
   */
  clientXToSplitPosition(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return 0.5;
    const canvasWidth = Math.max(1, this.canvas.width);
    const pointerCanvasX = (clientX - rect.left) * (canvasWidth / rect.width);
    return Math.max(0, Math.min(1, pointerCanvasX / canvasWidth));
  }

  isSplitEnabled(): boolean {
    return this.splitEnabled;
  }

  private resetSplitPreview(): void {
    this.splitEnabled = false;
    this.viewportController.setPanEventOverride(null);
    this.integrationPass.setSplit(0);
  }

  setPanEnabled(enabled: boolean) {
    this.viewportController.setPanEnabled(enabled);
  }

  setLUTInterpolationMode(mode: LUTInterpolationMode) {
    this.lutInterpolationMode = mode;
    this.integrationPass.setLUTInterpolationMode(mode);
    this.emitLUTStatus();
    this.requestRender("edit-state");
  }

  /**
   * Update transform state without touching the LUT pipeline.
   * cropEditMode can be toggled separately via setCropEditMode.
   */
  updateTransformState(state: TransformState): void {
    this.currentTransformState = state;
    this.syncViewportImageSize();
    this.integrationPass.updateTransformState(state, this.cropEditMode);
    this.requestRender("transform-edit");
  }

  /**
   * When active, the integration preview renders the full image (crop disabled)
   * so the user sees the crop overlay handles. Export is unaffected.
   */
  setCropEditMode(active: boolean): void {
    this.cropEditMode = active;
    this.viewportController.setFitPadding(active ? 1 : VIEWER_FIT_PADDING);
    this.syncViewportImageSize();
    this.integrationPass.updateTransformState(this.currentTransformState, active);
    this.requestRender("transform-edit");
  }

  setPresentationState(settings: BorderSettings | null): void {
    this.presentationSettings = settings;
    this.ensurePresentationBackgroundTexture(settings);
    this.presentationDirty = true;
    this.syncViewportImageSize();
    this.requestRender("presentation-change");
  }

  getPresentationState(): BorderSettings | null {
    return this.presentationSettings;
  }

  private syncPresentationStateFromEditState(state: EditState): void {
    this.presentationSettings = isBorderVisible(state.presentationBorder)
      ? toBorderSettings(state.presentationBorder)
      : null;
    this.ensurePresentationBackgroundTexture(this.presentationSettings);
    this.presentationDirty = true;
  }

  /**
   * Converts an image UV (0..1) to CSS pixel coordinates relative to the
   * canvas element's top-left. Used by the CropOverlay to position handles.
   */
  imageUVToCanvasRelative(u: number, v: number): { x: number; y: number } {
    return this.viewportController.imageUVToCanvasRelative(u, v);
  }

  /**
   * Converts a client (screen) point to image UV. Returns null outside image.
   */
  clientPointToImageUV(clientX: number, clientY: number): { u: number; v: number } | null {
    return this.viewportController.canvasPointToImageUV(clientX, clientY);
  }

  /**
   * Like clientPointToImageUV but clamps out-of-bounds points to the image
   * edge instead of returning null — crop-handle drags keep tracking the
   * pointer past the image like legacy.
   */
  clientPointToImageUVClamped(clientX: number, clientY: number): { u: number; v: number } | null {
    return this.viewportController.canvasPointToImageUV(clientX, clientY, { clamp: true });
  }

  /**
   * Like clientPointToImageUV but returns raw unclamped UV coordinates even if outside the image.
   * Useful for dragging mask handles that extend beyond the image boundaries.
   */
  clientPointToImageUVUnclamped(clientX: number, clientY: number): { u: number; v: number } | null {
    return this.viewportController.canvasPointToImageUV(clientX, clientY, { unclamped: true });
  }

  /**
   * Renders the processed pipeline to a low-resolution buffer and returns its
   * pixels for CPU scope analysis. Read-only — does not affect the canvas.
   */
  readScopesFrame(sampleSize: number): ScopeReadback | null {
    if (!this.imageTexture) return null;
    const maxSide = Math.max(16, Math.min(READ_MAX_RES, Math.floor(sampleSize)));
    const scale = maxSide / Math.max(this.imageWidth, this.imageHeight, 1);
    const width = Math.max(1, Math.round(this.imageWidth * scale));
    const height = Math.max(1, Math.round(this.imageHeight * scale));
    const target = this.fxPipeline.renderScopes({
      imageTexture: this.imageTexture,
      width,
      height,
      lutHandle: this.prepareBaseLUTHandle(),
      transform: this.currentTransformState,
      distort: this.currentDistortState,
      retouch: this.currentRetouchState,
      fxState: this.currentFXState,
      lutInterpolationMode: this.lutInterpolationMode,
      lutKind: this.activeLUTKind,
      localLUTs: this.currentLocalLUTs,
      directCreativeShader: this.baseLUTGenerator.directCreativeShader,
      depthTexture: this.depthTexture,
      colorManagement: {
        useAcesPipeline: this.currentColorManagement.useAcesPipeline,
        inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
        displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
        idtAtlas: this.baseLUTGenerator.idtCubeAtlas,
        odtAtlas: this.baseLUTGenerator.odtCubeAtlas,
      },
    });
    // Capped (<= READ_MAX_RES) scope/histogram readback — throttled by the scopes
    // window's refresh rate; never a full-resolution preview readback.
    recordHistogramReadback();
    const raw = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);

    const pixels = new Uint8Array(width * height * 4);
    const rowBytes = width * 4;
    for (let targetRow = 0; targetRow < height; targetRow += 1) {
      const sourceRow = height - 1 - targetRow;
      pixels.set(
        raw.subarray(sourceRow * rowBytes, sourceRow * rowBytes + rowBytes),
        targetRow * rowBytes,
      );
    }
    return {
      width,
      height,
      pixels,
      colorManagement: {
        inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
        workingColorSpaceId: this.currentColorManagement.workingColorSpace,
        displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
        viewTransformId: this.currentColorManagement.viewTransform,
        useAcesPipeline: this.currentColorManagement.useAcesPipeline,
      },
    };
  }

  updateEditState(state: EditState): void {
    const keepOverlayPreview =
      this.overlayPreviewActive && this.transientPreviewKeys.has("overlays");
    const nextBaseSignature = JSON.stringify({ ...state, overlays: [] });
    const overlayOnlyChange =
      this.hasAppliedEditState &&
      this.sourceTextureVersion === this.lastAppliedSourceTextureVersion &&
      nextBaseSignature === this.committedBaseStateSignature;
    this.committedEditState = state;
    this.committedBaseStateSignature = nextBaseSignature;
    this.transientPreviewActive = false;
    this.transientPreviewKeys.clear();
    this.overlayPreviewActive = keepOverlayPreview;
    if (overlayOnlyChange) {
      this.previewOverlayLayers = state.overlays;
      this.syncCommittedOverlayTextures(state.overlays);
      this.requestRender("overlay-texture-ready");
      return;
    }
    this.hasAppliedEditState = true;
    this.applyEditState(state, "edit-state");
  }

  private syncCommittedOverlayTextures(layers: readonly EditorOverlayLayer[]): void {
    const committedOverlaysReady = this.editorOverlayPass.sync(layers, () => {
      if (
        !this.transientPreviewActive &&
        this.editorOverlayPass.areLayersReady(this.committedEditState.overlays)
      ) {
        this.overlayPreviewActive = false;
      }
      this.requestRender("overlay-texture-ready");
    });
    if (committedOverlaysReady && !this.transientPreviewActive) {
      this.overlayPreviewActive = false;
    }
  }

  previewEditPatch(patch: Partial<EditState>, reason = "preview-edit"): void {
    recordTransmittedStateSet();
    this.transientPreviewActive = true;
    const keys = Object.keys(patch) as (keyof EditState)[];
    for (const key of keys) this.transientPreviewKeys.add(key);
    this.applyTransientState({ ...this.committedEditState, ...patch } as EditState, keys, reason);
  }

  previewCurveInput(input: CurvePreviewInput): void {
    recordTransmittedStateSet();
    this.transientPreviewActive = true;
    this.baseLUTGenerator.updateCurvePreview(input);
    this.requestRender("curve-preview");
  }

  clearPreviewPatch(reason = "preview-clear"): void {
    if (!this.transientPreviewActive) return;
    const keys = [...this.transientPreviewKeys];
    this.transientPreviewActive = false;
    this.transientPreviewKeys.clear();
    this.applyTransientState(this.committedEditState, keys, reason);
  }

  private applyTransientState(
    state: EditState,
    keys: readonly (keyof EditState)[],
    reason: string,
  ): void {
    let handled = true;
    let colorChanged = false;
    let fxChanged = false;
    let overlaysChanged = false;

    for (const key of keys) {
      if (COLOR_PREVIEW_KEYS.has(key)) {
        colorChanged = true;
      } else if (key === "retouch") {
        this.currentRetouchState = cloneRetouchState(state.retouch);
      } else if (FX_PREVIEW_KEYS.has(key)) {
        fxChanged = true;
      } else if (GEOMETRY_PREVIEW_KEYS.has(key)) {
        if (key === "transform") {
          this.currentTransformState = state.transform;
          this.syncViewportImageSize();
          this.integrationPass.updateTransformState(state.transform, this.cropEditMode);
        } else {
          this.currentDistortState = cloneDistortState(state.distort);
        }
      } else if (key === "match") {
        this.applyMatchState(state.match);
        this.setRuntimeMatchLUT(
          this.currentMatchBypass ? null : this.currentMatchLut,
          this.currentMatchGeneratedAt,
        );
      } else if (key === "overlays") {
        overlaysChanged = true;
      } else {
        handled = false;
      }
    }

    if (!handled) {
      this.applyEditState(state, reason);
      return;
    }

    if (colorChanged) {
      this.baseLUTGenerator.updateColorState(getColorState(state));
      this.currentLocalLUTs = this.localLUTManager.update(state.localAdjustments, state);
    }
    if (fxChanged) {
      this.currentFXState = getFXState(state);
    }
    if (overlaysChanged) {
      this.previewOverlayLayers = state.overlays;
      this.overlayPreviewActive = this.transientPreviewActive;
      this.editorOverlayPreviewPass.sync(state.overlays, () => {
        this.requestRender("overlay-preview-texture-ready");
      });
    }

    // Scopes/readback observe completed processed frames only. render() fires
    // onProcessedChange after the processed texture is actually rebuilt, so firing
    // it here (before the coalesced render) would trigger a premature readback of a
    // stale frame every pointermove.
    this.requestRender(reason);
  }

  private applyEditState(state: EditState, reason: string): void {
    if (DEBUG_ENGINE) console.log("[Engine] updateEditState called");
    const nextColorManagement = cloneColorManagementState(state.colorManagement);
    this.syncPresentationStateFromEditState(state);
    this.brushMaskTexturePass.retain(
      (state.localAdjustments ?? [])
        .filter((layer) => layer.components[0]?.type === "brush")
        .map((layer) => layer.id),
    );

    // The IDT/ODT fast path is only valid when the underlying image is unchanged
    // (a top-bar color-space selector tweak). On a media switch the source-texture
    // version changes; switching between formats with different default IDTs (e.g.
    // RAW "VisionLog" ↔ JPEG "sRGB") would otherwise fast-path and skip the new
    // media's grade/FX/transform/match, rendering the previous image's look.
    const imageChanged = this.sourceTextureVersion !== this.lastAppliedSourceTextureVersion;
    this.lastAppliedSourceTextureVersion = this.sourceTextureVersion;

    if (
      !imageChanged &&
      isInputDisplayTransformOnlyChange(this.currentColorManagement, nextColorManagement)
    ) {
      this.updateColorTransformState(nextColorManagement, reason);
      return;
    }

    this.updateEngineSettings(state.engineSettings);
    this.currentColorManagement = nextColorManagement;
    this.maybePrewarmColorVariants();
    this.baseLUTGenerator.updateColorState(getColorState(state));
    this.currentLocalLUTs = this.localLUTManager.update(state.localAdjustments, state);
    this.baseLUTGenerator.updateColorManagement(nextColorManagement);
    this.applyMatchState(state.match);
    this.setRuntimeMatchLUT(
      this.currentMatchBypass ? null : this.currentMatchLut,
      this.currentMatchGeneratedAt,
    );

    this.currentFXState = getFXState(state);
    this.currentDistortState = cloneDistortState(state.distort);
    this.currentRetouchState = cloneRetouchState(state.retouch);
    this.previewOverlayLayers = state.overlays;
    this.syncCommittedOverlayTextures(state.overlays);


    // Transform — does not regenerate LUT
    this.currentTransformState = state.transform;
    this.syncViewportImageSize();
    this.integrationPass.updateTransformState(state.transform, this.cropEditMode);

    this.viewportController.setPanEnabled(true);

    this.requestRender(reason);
    this.emitLUTStatus();
  }

  /**
   * Fast path for top-bar IDT/ODT selectors. These values only affect the
   * per-pixel legacy color transform passes, so changing them must not
   * walk image import, recreate textures, or rebake grade LUTs.
   */
  private updateColorTransformState(
    colorManagement: ColorManagementState,
    reason = "edit-state",
  ): void {
    this.currentColorManagement = colorManagement;
    this.maybePrewarmColorVariants();
    this.baseLUTGenerator.updateColorManagement(colorManagement);
    this.requestRender(reason);
  }

  /**
   * Kicks a background compile of the common small IDT/ODT pass materials for the
   * current selection. Only re-runs when the selection actually changes.
   */
  /**
   * Background-compiles specific legacy IDT/ODT color materials so a later switch
   * to them is a cache hit (instant) — the same end-behavior as the legacy app's
   * atlas-uniform swap, but keeping poto's exact per-pixel transform math. Callers
   * pass the combos used by the active project's media so switching between assets
   * (e.g. between RAWs) never pays the ~800ms cold compile. Safe to call repeatedly;
   * already-cached combos are skipped.
   */
  prewarmColorCombos(combos: ReadonlyArray<{ idtId: string; odtId: string }>): void {
    if (combos.length === 0) return;
    this.fxPipeline.prewarmColors(combos);
  }

  private maybePrewarmColorVariants(): void {
    const cm = this.currentColorManagement;
    if (!cm.useAcesPipeline) return;
    // Defer until an image is loaded so prewarming never competes with the initial
    // app load / first render; setImage() re-invokes this once a image is present.
    if (!this.imageTexture) return;
    const key = `${cm.inputColorSpaceId}|${cm.displayColorSpaceId}`;
    if (key === this.lastColorPrewarmKey) return;
    this.lastColorPrewarmKey = key;
    this.fxPipeline.prewarmColors(
      buildColorPrewarmCombos(cm.inputColorSpaceId, cm.displayColorSpaceId),
    );
  }

  /** Tracks the active Color Match LUT so snapshots can disable/restore it. */
  private applyMatchState(match: MatchState): void {
    this.currentMatchActive = isMatchActive(match);
    this.currentMatchLut = match.lut;
    this.currentMatchGeneratedAt = match.generatedAt;
    this.currentMatchBypass = match.bypass;
  }

  /**
   * Applies/removes the Color Match LUT on every active LUT generator. The match
   * snapshot uses this to disable CMT temporarily without changing edit state,
   * matching legacy's `useCmt = false` snapshot behavior.
   */
  private setRuntimeMatchLUT(lut: ArrayLike<number> | null, generatedAt: number): void {
    this.baseLUTGenerator.setMatchLUT(lut, generatedAt);
  }

  /**
   * Generates the legacy Color Match LUT for a reference image. Snapshots the
   * current grade (display sRGB, with the match disabled) at ~756px, then runs the
   * srp-static color-transfer in a worker. Returns the half-float 16³ LUT as a
   * plain number[] for the caller to store in editState.match (which flows back
   * through updateEditState to bake it into the base + local LUTs). Does not mutate
   * edit state.
   */
  async generateColorMatch(
    reference: ImageBitmap | HTMLImageElement,
    colorMix: number,
    lumaMix: number,
  ): Promise<number[]> {
    if (!this.imageTexture) {
      throw new Error("Open an image before matching.");
    }
    const source = this.renderMatchSnapshot(756);
    // Legacy reads the reference at its natural dimensions; only the source
    // snapshot is capped to ~756px. Downscaling the reference changes the SRP
    // statistics and produces a visibly different Color Match LUT.
    const ref = imageSourceToPixels(reference);
    if (!ref) {
      throw new Error("Could not read the reference image (2D canvas unavailable).");
    }
    const { generateColorMatchLUT } = await import("./reference/ColorMatchService");
    const lut = await generateColorMatchLUT(source, ref, colorMix, lumaMix);
    return Array.from(lut);
  }

  /**
   * Renders the current preview pipeline with Color Match disabled to a small
   * offscreen target and reads it back as RGBA8 — the snapshot the srp-static
   * algorithm matches against (legacy snapshots the display canvas with useCmt off).
   */
  private renderMatchSnapshot(maxSide: number): ColorMatchImage {
    const transform = this.getPreviewTransformState();
    const display = getTransformOutputDimensions(this.imageWidth, this.imageHeight, transform, {
      includeCrop: !this.cropEditMode,
    });
    const displayWidth = Math.max(1, display.width);
    const displayHeight = Math.max(1, display.height);
    const scale = Math.min(1, maxSide / Math.max(displayWidth, displayHeight, 1));
    const width = Math.max(1, Math.round(displayWidth * scale));
    const height = Math.max(1, Math.round(displayHeight * scale));

    // Legacy temporarily disables only the existing Color Match LUT before
    // snapshotting, so a new match is based on the current visible grade without
    // recursively matching an already-matched result. Keep transform and FX from
    // the current preview path.
    this.setRuntimeMatchLUT(null, 0);
    try {
      const target = this.fxPipeline.renderScopes({
        imageTexture: this.imageTexture!,
        sourceWidth: this.imageWidth,
        sourceHeight: this.imageHeight,
        width,
        height,
        lutHandle: this.prepareBaseLUTHandle(),
        transform,
        distort: this.currentDistortState,
        retouch: this.currentRetouchState,
        fxState: this.currentFXState,
        lutInterpolationMode: this.lutInterpolationMode,
        lutKind: this.activeLUTKind,
        localLUTs: this.currentLocalLUTs,
        directCreativeShader: this.baseLUTGenerator.directCreativeShader,
        depthTexture: this.depthTexture,
        colorManagement: {
          useAcesPipeline: this.currentColorManagement.useAcesPipeline,
          inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
          displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
          idtAtlas: this.baseLUTGenerator.idtCubeAtlas,
          odtAtlas: this.baseLUTGenerator.odtCubeAtlas,
        },
        previewZoom: this.viewportController.getState().zoom,
        grainViewport: this.getPreviewGrainViewport(),
        // Legacy snapshots the visible display canvas as RGBA8 before running
        // srp-static. The worker expects byte RGBA; reading a half-float preview
        // target into Uint8Array can yield zeros/invalid data and poison the LUT.
        renderTargetType: UnsignedByteType,
        debugView: "final",
      });
      const raw = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);
      return { data: new Uint8ClampedArray(raw.buffer, 0, raw.length), width, height };
    } finally {
      this.setRuntimeMatchLUT(
        this.currentMatchBypass ? null : this.currentMatchLut,
        this.currentMatchGeneratedAt,
      );
      this.processedDirty = true;
      this.requestRender("edit-state");
    }
  }

  /**
   * Exports the current GLOBAL color look as a `.cube` 3D LUT (sRGB-in/out).
   * Does not require an image, viewport, or canvas — only the global color
   * state baked into the base LUT. Excludes FX, masks, local layers, transform.
   */
  async exportCurrentCube(options: { title?: string; size?: CubeExportSize } = {}): Promise<Blob> {
    const lutData = await this.getCurrentGlobalLUTData3D(options.size ?? 64);
    const [{ buildCubeColorManagementComments }, { lutDataToCubeString }] = await Promise.all([
      import("./color/ColorManagementConfig"),
      import("./lut/exportCube"),
    ]);
    const comments = buildCubeColorManagementComments(this.currentColorManagement);
    if (this.currentMatchActive) {
      comments.push("Includes Color Match (reference color transfer).");
    }
    const text = lutDataToCubeString(lutData, {
      title: options.title,
      is8Bit: this.baseLUTGenerator.readbackIs8Bit,
      metadataComments: comments,
    });
    return new Blob([text], { type: "text/plain" });
  }

  async exportCurrentCLF(options: { title?: string; size?: CubeExportSize } = {}): Promise<Blob> {
    const baseTitle = options.title?.trim() || "Hytic Look";
    const title = this.currentMatchActive ? `${baseTitle} (includes Color Match)` : baseTitle;
    const lutData = await this.getCurrentGlobalLUTData3D(options.size ?? 64);
    const [{ buildLUTInterchangeMetadata }, { exportCLF }] = await Promise.all([
      import("./interchange/LUTData"),
      import("./interchange/exportCLF"),
    ]);
    const metadata = buildLUTInterchangeMetadata(this.currentColorManagement, title);
    return exportCLF(lutData, metadata);
  }

  /**
   * Exports the current GLOBAL color look to any legacy LUT destination (.cube/.cms/.clut/
   * .spi3d/.txt/.vlt/.dctl/.png). Bakes the full sRGB->display chain into a 64³ float grid
   * (renderFullBake + readAtlasRGB) then dispatches to the requested writer at the requested
   * size. Global color only — no FX, masks, local layers, crop, or transform (matches legacy ip).
   */
  async exportCurrentLUTFile(
    settings: LutWriteSettings,
  ): Promise<LutWriteResult & { is8Bit: boolean }> {
    const [{ resolveExportColorManagement }, { displayTransformLut }, { writeLUT }] =
      await Promise.all([
        import("./export/exportColorManagement"),
        import("./color/colorSpaceCatalog"),
        import("./lut/lutFormatWriters"),
      ]);
    const previewColorManagement = cloneColorManagementState(this.currentColorManagement);
    const exportColorManagement = resolveExportColorManagement(
      previewColorManagement,
      settings.colorSpace ?? "preview",
      settings.gammaCurve ?? "kalar",
    );
    try {
      this.baseLUTGenerator.updateColorManagement(exportColorManagement);
      const outputLut = displayTransformLut(exportColorManagement.displayColorSpaceId);
      if (outputLut) await this.baseLUTGenerator.getCubeAtlas(outputLut);
      this.baseLUTGenerator.renderFullBake();
      const baked = this.baseLUTGenerator.readAtlasRGB();
      const result = await writeLUT(baked, settings);
      return { ...result, is8Bit: baked.is8Bit };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate lookup table: ${detail}`, { cause: error });
    } finally {
      this.baseLUTGenerator.updateColorManagement(previewColorManagement);
      this.requestRender("export-lut-restore");
    }
  }

  async getCurrentGlobalLUTData3D(size: CubeExportSize = 64): Promise<LUTData3D> {
    // Standalone LUT export needs the full sRGB->display chain baked in (preview
    // bakes grade-only, with the IDT/ODT applied per-pixel).
    this.baseLUTGenerator.renderFullBake();
    const lut = this.baseLUTGenerator.readAtlasRGB();
    const { lutDataFromBakedLUT } = await import("./interchange/LUTData");
    return lutDataFromBakedLUT(lut, size);
  }

  /** True if LUT readback is 8-bit (precision-limited). Drives a UI warning. */
  get lutReadbackIs8Bit(): boolean {
    return this.baseLUTGenerator.readbackIs8Bit;
  }

  async exportImage(options: ExportOptions = {}): Promise<Blob> {
    if (!this.imageTexture) {
      throw new Error("No image loaded");
    }

    const { width, height } = this.resolveExportDimensions(options);
    const maxTextureSize = this.renderer.capabilities.maxTextureSize;
    if (width > maxTextureSize || height > maxTextureSize) {
      throw new Error(
        `Export size ${width}x${height} exceeds GPU maximum texture size ${maxTextureSize}`,
      );
    }

    // Keep every export in the same high-precision working pipeline as preview.
    // 8-bit formats quantize once during readback; PNG-16 preserves the half data.
    const useHighPrecisionPipeline = this.supportsFloatColorBuffer();
    const wantFloat = options.bitDepth === 16 && useHighPrecisionPipeline;

    const [exportImageModule, exportSource] = await Promise.all([
      import("./export/exportImage"),
      this.getExportSourceTexture(),
    ]);

    try {
      const baseTarget = this.fxPipeline.renderExport({
        imageTexture: exportSource.texture,
        width,
        height,
        lutHandle: this.prepareBaseLUTHandle(),
        transform: this.currentTransformState,
        distort: this.currentDistortState,
        retouch: this.currentRetouchState,
        fxState: this.currentFXState,
        lutInterpolationMode: this.lutInterpolationMode,
        lutKind: this.activeLUTKind,
        localLUTs: this.currentLocalLUTs,
        directCreativeShader: this.baseLUTGenerator.directCreativeShader,
        depthTexture: this.depthTexture,
        colorManagement: {
          useAcesPipeline: this.currentColorManagement.useAcesPipeline,
          inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
          displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
          idtAtlas: this.baseLUTGenerator.idtCubeAtlas,
          odtAtlas: this.baseLUTGenerator.odtCubeAtlas,
        },
        exportQuality: "high",
        exportFloat: useHighPrecisionPipeline,
      });
      const target = this.editorOverlayPass.render(
        this.renderer,
        baseTarget.texture,
        this.committedEditState.overlays,
        width,
        height,
        baseTarget.texture.type,
        undefined,
        this.depthTexture,
      ) ?? baseTarget;

      return exportImageModule.renderTargetToBlob(
        this.renderer,
        target,
        width,
        height,
        wantFloat ? "image/png" : (options.mimeType ?? "image/png"),
        options.quality,
        wantFloat,
      );
    } finally {
      if (exportSource.needsDispose) {
        const bmp = exportSource.texture.image as ImageBitmap | undefined;
        exportSource.texture.dispose();
        bmp?.close();
      }
    }
  }

  /** True when there is a ready source texture to export (not mid-load, no placeholder). */
  isExportReady(): boolean {
    return !!this.imageTexture && this.imageWidth > 0 && this.imageHeight > 0;
  }

  /** The crop/rotate-resolved base export dimensions, or 0×0 when no image is ready. */
  getExportBaseSize(): { width: number; height: number } {
    if (!this.isExportReady()) return { width: 0, height: 0 };
    return this.resolveExportDimensions({});
  }

  /**
   * Returns a full-resolution source texture suitable for export. When the current
   * preview proxy texture (`this.imageTexture`) is smaller than the source image
   * (because the viewer is zoomed out), this builds a temporary full-res texture
   * from the original decoded bitmap. The caller MUST dispose the returned texture
   * after export if `needsDispose` is true.
   */
  private async getExportSourceTexture(): Promise<{
    texture: Texture;
    needsDispose: boolean;
  }> {
    // If no original bitmap is held (video sources, etc.), fall through to the
    // current texture — it's already the only source we have.
    if (!this.imageBitmap) {
      return { texture: this.imageTexture!, needsDispose: false };
    }

    // Check if the current proxy is already at full source resolution.
    const currentWidth = this.imageTexture?.image?.width ?? 0;
    const currentHeight = this.imageTexture?.image?.height ?? 0;
    if (currentWidth >= this.imageWidth && currentHeight >= this.imageHeight) {
      return { texture: this.imageTexture!, needsDispose: false };
    }

    // Build a full-resolution texture from the original decoded bitmap.
    const bitmap = await createImageBitmap(this.imageBitmap, {
      resizeWidth: this.imageWidth,
      resizeHeight: this.imageHeight,
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
      resizeQuality: "high",
    });

    const texture = new Texture(bitmap);
    texture.needsUpdate = true;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.colorSpace = NoColorSpace;

    return { texture, needsDispose: true };
  }

  /**
   * Legacy-style image export (§2). Renders the FULL edited image at the requested size through
   * a dedicated export path — never the preview canvas/thumbnail/2048-cap — optionally in a
   * different output color space. The preview's color management is passed by value to
   * renderExport and is NEVER mutated, so there is nothing to restore and autosave sees no
   * transient change. Runs as one async task (no RAF). Returns the encoded Blob.
   */
  async renderExportImage(req: ExportImageRequest): Promise<Blob> {
    if (!this.isExportReady()) throw new ExportNotReadyError();

    const maxTextureSize = this.renderer.capabilities.maxTextureSize;
    const width = normalizeExportDimension(req.width);
    const height = normalizeExportDimension(req.height);

    const useHighPrecisionPipeline = this.supportsFloatColorBuffer();
    const wantFloat = req.format === "png-16" && useHighPrecisionPipeline;

    const [{ resolveExportColorManagement }, { displayTransformLut }, exportSource] =
      await Promise.all([
        import("./export/exportColorManagement"),
        import("./color/colorSpaceCatalog"),
        this.getExportSourceTexture(),
      ]);
    const exportColorManagement = resolveExportColorManagement(
      this.currentColorManagement,
      req.colorSpace,
      req.gammaCurve,
    );
    const outputLut = displayTransformLut(exportColorManagement.displayColorSpaceId);
    const odtAtlas = outputLut ? await this.baseLUTGenerator.getCubeAtlas(outputLut) : null;
    const colorManagement = {
      useAcesPipeline: exportColorManagement.useAcesPipeline,
      inputColorSpaceId: exportColorManagement.inputColorSpaceId,
      displayColorSpaceId: exportColorManagement.displayColorSpaceId,
      idtAtlas: this.baseLUTGenerator.idtCubeAtlas,
      odtAtlas: odtAtlas ?? this.baseLUTGenerator.odtCubeAtlas,
    };

    try {
      if (width > maxTextureSize || height > maxTextureSize) {
        const blob = await this.renderTiledExportImage(
          req,
          width,
          height,
          maxTextureSize,
          wantFloat,
          useHighPrecisionPipeline,
          colorManagement,
          exportSource.texture,
        );
        this.requestRender("export-restore");
        return blob;
      }

      const exportImageModule = import("./export/exportImage");
      const baseTarget = this.fxPipeline.renderExport({
        imageTexture: exportSource.texture,
        sourceWidth: this.imageWidth,
        sourceHeight: this.imageHeight,
        width,
        height,
        lutHandle: this.prepareBaseLUTHandle(),
        transform: this.currentTransformState,
        distort: this.currentDistortState,
        retouch: this.currentRetouchState,
        fxState: this.currentFXState,
        lutInterpolationMode: this.lutInterpolationMode,
        lutKind: this.activeLUTKind,
        localLUTs: this.currentLocalLUTs,
        directCreativeShader: this.baseLUTGenerator.directCreativeShader,
        depthTexture: this.depthTexture,
        colorManagement,
        exportQuality: "high",
        exportFloat: useHighPrecisionPipeline,
      });

      const target = this.editorOverlayPass.render(
        this.renderer,
        baseTarget.texture,
        this.committedEditState.overlays,
        width,
        height,
        baseTarget.texture.type,
        undefined,
        this.depthTexture,
      ) ?? baseTarget;
      const { encodeExportImageBlob } = await exportImageModule;
      const blob = await encodeExportImageBlob(this.renderer, target, width, height, {
        format: req.format,
        quality: req.quality,
        dpi: req.dpi,
        float16: wantFloat,
        metadata: req.metadata,
      });

      // The preview frame may have used a different ODT atlas; restore the on-screen render.
      this.requestRender("export-restore");
      return blob;
    } finally {
      if (exportSource.needsDispose) {
        const bmp = exportSource.texture.image as ImageBitmap | undefined;
        exportSource.texture.dispose();
        bmp?.close();
      }
    }

  }

  private async renderTiledExportImage(
    req: ExportImageRequest,
    width: number,
    height: number,
    maxTextureSize: number,
    wantFloat: boolean,
    useHighPrecisionPipeline: boolean,
    colorManagement: NonNullable<FXPipelineRenderParams["colorManagement"]>,
    exportTexture?: Texture,
  ): Promise<Blob> {
    const exportImageModule = await import("./export/exportImage");
    const overlap = Math.min(400, Math.max(32, Math.floor(maxTextureSize / 8)));
    const coreSize = maxTextureSize - overlap * 2;
    if (coreSize < 1) throw new Error("GPU maximum texture size is too small for tiled export");

    const output = wantFloat
      ? new Uint16Array(width * height * 4)
      : new Uint8Array(width * height * 4);
    const lutHandle = this.prepareBaseLUTHandle();

    for (let coreY = 0; coreY < height; coreY += coreSize) {
      const coreHeight = Math.min(coreSize, height - coreY);
      for (let coreX = 0; coreX < width; coreX += coreSize) {
        const coreWidth = Math.min(coreSize, width - coreX);
        const tileX = Math.max(0, coreX - overlap);
        const tileY = Math.max(0, coreY - overlap);
        const tileRight = Math.min(width, coreX + coreWidth + overlap);
        const tileTop = Math.min(height, coreY + coreHeight + overlap);
        const tileWidth = tileRight - tileX;
        const tileHeight = tileTop - tileY;
        const baseTarget = this.fxPipeline.renderExport({
          imageTexture: exportTexture ?? this.imageTexture!,
          sourceWidth: this.imageWidth,
          sourceHeight: this.imageHeight,
          width: tileWidth,
          height: tileHeight,
          outputViewport: {
            x: tileX,
            y: tileY,
            width: tileWidth,
            height: tileHeight,
            fullWidth: width,
            fullHeight: height,
          },
          lutHandle,
          transform: this.currentTransformState,
          distort: this.currentDistortState,
          retouch: this.currentRetouchState,
          fxState: this.currentFXState,
          lutInterpolationMode: this.lutInterpolationMode,
          lutKind: this.activeLUTKind,
          localLUTs: this.currentLocalLUTs,
          directCreativeShader: this.baseLUTGenerator.directCreativeShader,
          depthTexture: this.depthTexture,
          colorManagement,
          exportQuality: "high",
          exportFloat: useHighPrecisionPipeline,
        });
        const outputViewport = {
          x: tileX,
          y: tileY,
          width: tileWidth,
          height: tileHeight,
          fullWidth: width,
          fullHeight: height,
        };
        const target = this.editorOverlayPass.render(
          this.renderer,
          baseTarget.texture,
          this.committedEditState.overlays,
          tileWidth,
          tileHeight,
          baseTarget.texture.type,
          outputViewport,
          this.depthTexture,
        ) ?? baseTarget;
        const tile = wantFloat
          ? new Uint16Array(tileWidth * tileHeight * 4)
          : readRenderTargetRgba8(this.renderer, target, tileWidth, tileHeight);
        if (wantFloat) {
          this.renderer.readRenderTargetPixels(target, 0, 0, tileWidth, tileHeight, tile);
        }

        const localX = coreX - tileX;
        const localY = coreY - tileY;
        for (let row = 0; row < coreHeight; row += 1) {
          const sourceOffset = ((localY + row) * tileWidth + localX) * 4;
          const targetOffset = ((coreY + row) * width + coreX) * 4;
          output.set(tile.subarray(sourceOffset, sourceOffset + coreWidth * 4), targetOffset);
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    const blob = await exportImageModule.encodeExportPixels(output.buffer, width, height, {
      format: req.format,
      quality: req.quality,
      dpi: req.dpi,
      metadata: req.metadata,
      float16: wantFloat,
    });
    return blob;
  }

  /** True when the GPU can render to (and read back) a float color buffer. */
  private supportsFloatColorBuffer(): boolean {
    const ext = this.renderer.extensions;
    return this.renderer.capabilities.isWebGL2
      ? ext.has("EXT_color_buffer_float")
      : ext.has("OES_texture_half_float") && ext.has("EXT_color_buffer_half_float");
  }

  private colorMaskPreview: ColorMaskPreview | null = null;

  setColorMaskPreview(preview: ColorMaskPreview | null) {
    this.colorMaskPreview = preview;
    this.requestRender("mask-overlay");
  }

  private radialMaskPreview: RadialMaskPreview | null = null;

  setRadialMaskPreview(preview: RadialMaskPreview | null) {
    this.radialMaskPreview = preview;
    this.requestRender("mask-overlay");
  }

  private gradientMaskPreview: GradientMaskPreview | null = null;

  setGradientMaskPreview(preview: GradientMaskPreview | null) {
    this.gradientMaskPreview = preview;
    this.requestRender("mask-overlay");
  }

  private luminanceMaskPreview: LuminanceMaskPreview | null = null;

  setLuminanceMaskPreview(preview: LuminanceMaskPreview | null) {
    this.luminanceMaskPreview = preview;
    this.requestRender("mask-overlay");
  }

  // ── Depth texture API ─────────────────────────────────────────────────────

  hasDepthTexture(): boolean {
    return !!this.depthTexture;
  }

  readDepthPixelAtClient(clientX: number, clientY: number): number | null {
    const texture = this.depthTexture;
    const uv = this.clientPointToImageUVClamped(clientX, clientY);
    if (!texture || !uv) return null;
    const image = texture.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
    const data = image?.data;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    const u = Math.max(0, Math.min(1, uv.u));
    const sourceV = texture.flipY ? 1 - uv.v : uv.v;
    const v = Math.max(0, Math.min(1, sourceV));
    if (!data || width <= 0 || height <= 0) {
      return this.depthSamplePass.read(this.renderer, texture, u, v);
    }
    const x = Math.min(width - 1, Math.floor(u * width));
    const y = Math.min(height - 1, Math.floor(v * height));
    const channels = Math.max(1, Math.round(data.length / Math.max(1, width * height)));
    const raw = Number(data[(y * width + x) * channels] ?? 0);
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return raw / 255;
    if (data instanceof Uint16Array) return raw / 65535;
    return Math.max(0, Math.min(1, raw));
  }

  clearDepthTexture(): void {
    if (this.depthTexture) this.depthTexture.dispose();
    this.depthTexture = null;
    setDepthResource("hasEngineDepthTexture", false);
    this.depthMaskPreview = null;
    this.requestRender("depth-texture-change");
  }

  setDepthTexture(texture: import("three").Texture | null, width = 0, height = 0): void {
    if (!texture) {
      this.clearDepthTexture();
      return;
    }
    if (this.depthTexture && this.depthTexture !== texture) this.depthTexture.dispose();
    this.depthTexture = texture;
    setDepthResource({
      status: "ready",
      metadataHasDepth: true,
      hasEngineDepthTexture: true,
      width,
      height,
      source: "embedded",
      error: null,
    });
    this.requestRender("depth-texture-change");
  }

  // ── Depth mask preview ────────────────────────────────────────────────────

  private depthMaskPreview: DepthMaskPreview | null = null;

  setDepthMaskPreview(preview: DepthMaskPreview | null) {
    this.depthMaskPreview = preview;
    this.requestRender("mask-overlay");
  }

  private brushMaskPreview: BrushMaskPreview | null = null;

  setBrushMaskPreview(preview: BrushMaskPreview | null) {
    this.brushMaskPreview = preview;
    this.requestRender("mask-overlay");
  }

  dispose() {
    this.disposed = true;
    this.loadRequestId += 1;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.viewportController.dispose();
    this.disposeImageResources();
    this.integrationPass.dispose();
    this.fxPipeline.dispose();
    this.colorMaskPass.dispose();
    this.maskOverlayPass.dispose();
    this.radialMaskPass.dispose();
    this.editorOverlayPass.dispose();
    this.editorOverlayPreviewPass.dispose();
    this.gradientMaskPass.dispose();
    this.brushMaskTexturePass.dispose();
    this.brushMaskPass.dispose();
    this.depthMaskPass.dispose();
    this.depthSamplePass.dispose();
    if (this.depthTexture) {
      this.depthTexture.dispose();
      this.depthTexture = null;
    }
    resetDepthResource();
    this.baseLUTGenerator.dispose();
    this.localLUTManager.dispose();
    this.baseLUT3DGenerator.dispose();
    this.renderer.dispose();
  }

  private async setImage(image: LoadedImage, loadRequestId: number) {
    this.sourceFileName = image.fileName;
    this.sourceFormat = image.format;
    this.sourceMimeType = image.mimeType;
    this.sourceBitDepth = image.bitDepth ?? 0;
    this.sourceHasAlpha = image.hasAlpha;
    this.sourceOrientationApplied = image.orientationApplied;
    await this.setSourceBitmap(image.bitmap, image.width, image.height, loadRequestId);
    this.logSourceDebugInfo(image.format);
  }

  /**
   * Installs a decoded source bitmap as the live image: builds the source texture
   * (disposing the previous one), resizes brush painters, fits the viewport, and
   * requests a render. Shared by the decode path (setImage) and the cached
   * raw-RGBA path (loadImageData).
   */
  private async setSourceBitmap(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    loadRequestId: number,
  ): Promise<void> {
    const previousBitmap = this.imageBitmap;
    const previousImageWidth = this.imageWidth;
    const previousImageHeight = this.imageHeight;
    const previousOriginalWidth = this.sourceOriginalWidth;
    const previousOriginalHeight = this.sourceOriginalHeight;
    const previousViewportImageWidth = this.viewportImageWidth;
    const previousViewportImageHeight = this.viewportImageHeight;
    const previousViewport = this.viewportController.getState();

    this.cancelSourcePreviewRequests();
    if (loadRequestId !== this.loadRequestId) {
      bitmap.close();
      throw new Error("Image load was superseded");
    }
    this.resetSplitPreview();
    this.sourceBitmapInstallInProgress = true;

    // Switching to a still source: tear down any decoded video so it stops
    // decoding/playing and the viewer can drop the trim transport.
    this.disposeVideoElement();

    this.imageBitmap = bitmap;
    this.sourceOriginalWidth = width;
    this.sourceOriginalHeight = height;
    const sourceSize = this.getManagedSourceSize(width, height);
    this.imageWidth = sourceSize.width;
    this.imageHeight = sourceSize.height;
    this.sourcePreviewWidth = 0;
    this.sourcePreviewHeight = 0;
    this.viewportController.fitToImage(sourceSize.width, sourceSize.height);
    this.viewportImageWidth = sourceSize.width;
    this.viewportImageHeight = sourceSize.height;
    this.syncViewportImageSize();

    let baseBitmap = bitmap;
    let ownsBaseBitmap = false;
    const initialPreviewSize = this.getSourcePreviewSizeForZoom(
      this.viewportController.getState().targetZoom,
    );

    try {
      if (initialPreviewSize.width !== width || initialPreviewSize.height !== height) {
        recordCreateImageBitmap();
        baseBitmap = await createImageBitmap(bitmap, {
          resizeWidth: initialPreviewSize.width,
          resizeHeight: initialPreviewSize.height,
          imageOrientation: "none",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
          resizeQuality: "high",
        });
        ownsBaseBitmap = true;
      }

      if (loadRequestId !== this.loadRequestId) {
        throw new Error("Image load was superseded");
      }

      this.installSourcePreviewTexture(
        baseBitmap,
        initialPreviewSize.width,
        initialPreviewSize.height,
        ownsBaseBitmap,
      );
      ownsBaseBitmap = false;
      this.sourceBitmapInstallInProgress = false;
      this.sourcePreviewPendingKey = "";
      previousBitmap?.close();
    } catch (error) {
      if (ownsBaseBitmap) baseBitmap.close();
      if (this.imageBitmap === bitmap) {
        this.imageBitmap = previousBitmap;
        this.imageWidth = previousImageWidth;
        this.imageHeight = previousImageHeight;
        this.sourceOriginalWidth = previousOriginalWidth;
        this.sourceOriginalHeight = previousOriginalHeight;
        this.viewportImageWidth = previousViewportImageWidth;
        this.viewportImageHeight = previousViewportImageHeight;
        this.viewportController.restoreViewport(previousViewport);
        this.syncViewportImageSize();
      }
      bitmap.close();
      this.sourceBitmapInstallInProgress = false;
      this.sourcePreviewPendingKey = "";
      throw error;
    }

    this.requestRender("image-loaded");
    // Now that there's an image to grade, warm the common IDT/ODT color shaders in
    // the background so switching feels instant when the user explores them.
    this.maybePrewarmColorVariants();
    this.onProcessedChange?.();
  }

  private cancelSourcePreviewRequests(): void {
    this.sourcePreviewRequestId += 1;
    this.sourcePreviewPendingKey = "";
    if (this.sourcePreviewTimer) {
      window.clearTimeout(this.sourcePreviewTimer);
      this.sourcePreviewTimer = 0;
    }
  }

  private installSourcePreviewTexture(
    bitmap: ImageBitmap,
    textureWidth: number,
    textureHeight: number,
    ownsBitmap: boolean,
  ): void {
    const previousTexture = this.imageTexture;
    const previousBitmap = this.imageTextureBitmap;

    const texture = new Texture(bitmap);
    this.sourceTextureVersion += 1;
    this.sourceTextureCreateCount += 1;
    // The single source-texture upload point (initial load + zoom-settle proxy
    // refresh). Must NOT fire during a panel drag — the warning catches regressions.
    recordSourceTextureUpload();
    texture.needsUpdate = true;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.colorSpace = NoColorSpace;
    recordUniformUpdate(5);

    this.imageTexture = texture;
    this.imageTextureBitmap = ownsBitmap ? bitmap : undefined;
    this.sourcePreviewWidth = Math.max(1, textureWidth);
    this.sourcePreviewHeight = Math.max(1, textureHeight);
    this.integrationPass.setImageTexture(texture, this.imageWidth, this.imageHeight);

    previousTexture?.dispose();
    previousBitmap?.close();
    this.maybeLogPreviewLoading();
  }

  /**
   * Opt-in preview-loading trace (set `window.__DEBUG_PREVIEW_LOADING__ = true`).
   * Logged on every visible-preview swap so the zoom-driven upgrade/downgrade is
   * auditable and it's provable that the visible texture is a full-resolution
   * createImageBitmap resize of the decoded source — never the project thumbnail
   * and never the scopes/READ_MAX_RES readback.
   */
  private maybeLogPreviewLoading(): void {
    if (!(globalThis as { __DEBUG_PREVIEW_LOADING__?: boolean }).__DEBUG_PREVIEW_LOADING__) return;
    const zoom = Math.max(0, this.viewportController.getState().targetZoom);
    console.table({
      step: "install-source-preview-texture",
      mediaName: this.sourceFileName,
      mainPreviewSourceName: this.sourceFileName,
      mainPreviewSourceType: this.sourceFormat || "(unknown)",
      sourceType: this.sourceFormat || "(unknown)",
      originalWidth: this.sourceOriginalWidth,
      originalHeight: this.sourceOriginalHeight,
      metadataWidth: this.imageWidth,
      metadataHeight: this.imageHeight,
      previewTextureWidth: this.imageTexture?.image?.width ?? this.sourcePreviewWidth,
      previewTextureHeight: this.imageTexture?.image?.height ?? this.sourcePreviewHeight,
      textureWidth: this.imageTexture?.image?.width ?? this.sourcePreviewWidth,
      textureHeight: this.imageTexture?.image?.height ?? this.sourcePreviewHeight,
      previewWidth: this.sourcePreviewWidth,
      previewHeight: this.sourcePreviewHeight,
      viewerAspectRatio: Number(
        (this.viewportImageWidth / Math.max(1, this.viewportImageHeight)).toFixed(6),
      ),
      exportOriginalWidth: this.resolveExportDimensions({}).width,
      exportOriginalHeight: this.resolveExportDimensions({}).height,
      thumbnailWidth: undefined,
      thumbnailHeight: undefined,
      zoom: Number(zoom.toFixed(3)),
      previewScale: Number(Math.min(1, zoom).toFixed(3)),
      isUsingThumbnailAsMainPreview: this.sourceFileName === "thumbnail.jpeg",
      isUsingReadbackAsMainPreview: false,
      requestId: this.sourcePreviewRequestId,
      idt: this.currentColorManagement.inputColorSpaceId,
      odt: this.currentColorManagement.displayColorSpaceId,
      sourceTextureVersion: this.sourceTextureVersion,
      // The renderer only grades a valid installed texture (render() bails when
      // imageTexture is null), so the restored edit state is never applied to an
      // empty/black surface.
      stateAppliedAfterDraw: true,
    });
  }

  private async requestSourcePreviewForZoom(
    zoom: number,
    debounceDowngrade: boolean,
  ): Promise<void> {
    return this.requestSourcePreviewSize(this.getSourcePreviewSizeForZoom(zoom), debounceDowngrade);
  }

  private async requestSourcePreviewSize(
    wanted: { width: number; height: number },
    debounceDowngrade: boolean,
  ): Promise<void> {
    if (this.sourceBitmapInstallInProgress) return;
    if (!this.imageBitmap) return;

    if (!this.shouldRefreshSourcePreview(wanted.width, wanted.height)) return;
    const pendingKey = `${wanted.width}x${wanted.height}`;
    if (pendingKey === this.sourcePreviewPendingKey) return;

    const isDowngrade =
      this.sourcePreviewWidth > 0 &&
      wanted.width < this.sourcePreviewWidth &&
      wanted.height < this.sourcePreviewHeight;

    if (debounceDowngrade && isDowngrade) {
      if (this.sourcePreviewTimer) {
        window.clearTimeout(this.sourcePreviewTimer);
      }
      this.sourcePreviewTimer = window.setTimeout(() => {
        this.sourcePreviewTimer = 0;
        void this.requestSourcePreviewForZoom(this.viewportController.getState().targetZoom, false);
      }, PREVIEW_DOWNGRADE_IDLE_MS);
      return;
    }

    this.sourcePreviewPendingKey = pendingKey;
    const requestId = ++this.sourcePreviewRequestId;
    let bitmap: ImageBitmap;
    try {
      // Zoom/pan-settle proxy refresh (debounced) — must NOT fire per pointermove.
      recordCreateImageBitmap();
      bitmap = await createImageBitmap(this.imageBitmap, {
        resizeWidth: wanted.width,
        resizeHeight: wanted.height,
        imageOrientation: "none",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
        resizeQuality: "high",
      });
    } catch (error) {
      if (requestId === this.sourcePreviewRequestId) {
        this.sourcePreviewPendingKey = "";
      }
      console.warn("[Engine] preview resize failed; keeping current texture", error);
      return;
    }

    if (requestId !== this.sourcePreviewRequestId) {
      bitmap.close();
      return;
    }

    this.installSourcePreviewTexture(bitmap, wanted.width, wanted.height, true);
    this.sourcePreviewPendingKey = "";
    this.processedDirty = true;
    this.requestRender("preview-source-updated");
  }

  private getPreviewPixelRatio(): number {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const pixelRatioX = this.canvas.width / cssWidth;
    const pixelRatioY = this.canvas.height / cssHeight;
    const pixelRatio = Math.min(pixelRatioX || 1, pixelRatioY || 1);
    return Math.max(1, Math.min(2, pixelRatio || window.devicePixelRatio || 1));
  }

  private getSourcePreviewSizeForZoom(zoom: number): { width: number; height: number } {
    const maxSourceScale = this.getBoundedPreviewScale(
      this.imageWidth,
      this.imageHeight,
      SOURCE_PREVIEW_TEXTURE_SIDE,
      SOURCE_PREVIEW_TEXTURE_PIXELS,
    );
    const scale = Math.max(0, Math.min(maxSourceScale, zoom * this.getPreviewPixelRatio()));
    const targetWidth = Math.max(1, Math.round(this.imageWidth * scale));
    const targetHeight = Math.max(1, Math.round(this.imageHeight * scale));
    if (
      this.sourcePreviewWidth > 0 &&
      this.sourcePreviewWidth !== this.imageWidth &&
      maxSourceScale >= 1 &&
      Math.abs(targetWidth - this.imageWidth) / this.imageWidth < PREVIEW_REBUILD_THRESHOLD &&
      Math.abs(targetHeight - this.imageHeight) / this.imageHeight < PREVIEW_REBUILD_THRESHOLD
    ) {
      return { width: this.imageWidth, height: this.imageHeight };
    }
    return { width: targetWidth, height: targetHeight };
  }

  private getBoundedPreviewScale(
    width: number,
    height: number,
    maxSide: number,
    maxPixels: number,
  ): number {
    const nativeMaxSide = Math.max(1, width, height);
    const pixels = Math.max(1, width * height);
    return Math.min(1, maxSide / nativeMaxSide, Math.sqrt(maxPixels / pixels));
  }

  private getManagedSourceSize(width: number, height: number): { width: number; height: number } {
    const pixels = Math.max(1, width * height);
    const maxPixels = this.getMaxSourcePixels();
    if (pixels <= maxPixels) return { width, height };
    const scale = Math.sqrt(maxPixels) / Math.sqrt(pixels);
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
    };
  }

  private getMaxSourcePixels(): number {
    const nav = globalThis.navigator;
    const ua = nav?.userAgent?.toLowerCase() ?? "";
    const isIos =
      /iphone|ipad|ipod/.test(ua) ||
      (nav?.platform === "MacIntel" && (nav?.maxTouchPoints ?? 0) > 1);
    if (isIos) return IOS_MAX_SOURCE_PIXELS;
    if (/android/i.test(nav?.userAgent ?? "")) return ANDROID_MAX_SOURCE_PIXELS;
    return DESKTOP_MAX_SOURCE_PIXELS;
  }

  private shouldRefreshSourcePreview(width: number, height: number): boolean {
    if (!this.imageTexture || this.sourcePreviewWidth <= 0 || this.sourcePreviewHeight <= 0) {
      return true;
    }
    return (
      Math.abs(width - this.sourcePreviewWidth) / Math.max(1, width) >= PREVIEW_REBUILD_THRESHOLD ||
      Math.abs(height - this.sourcePreviewHeight) / Math.max(1, height) >= PREVIEW_REBUILD_THRESHOLD
    );
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.integrationPass.setCanvasSize(this.canvas.width, this.canvas.height);
    this.fxPipeline.resize(width, height);
    this.viewportController.setViewportSize(width, height);
    this.requestRender("viewer-resize");
  }

  private applyViewportTransform(transform: ViewportTransform) {
    const display = this.getViewportImageDimensions();
    this.integrationPass.mesh.position.set(transform.panX, transform.panY, 0);
    this.integrationPass.mesh.scale.set(
      display.width * transform.zoom,
      display.height * transform.zoom,
      1,
    );
    if (DEBUG_ENGINE) {
      console.table({
        imageWidth: this.imageWidth,
        imageHeight: this.imageHeight,
        fitZoom: transform.fitZoom,
        zoom: transform.zoom,
        zoomMode: transform.zoomMode,
        panX: transform.panX,
        panY: transform.panY,
        rendererWidth: this.canvas.width,
        rendererHeight: this.canvas.height,
        cameraLeft: this.camera.left,
        cameraRight: this.camera.right,
        cameraTop: this.camera.top,
        cameraBottom: this.camera.bottom,
        planeScaleX: this.integrationPass.mesh.scale.x,
        planeScaleY: this.integrationPass.mesh.scale.y,
      });
    }
    this.requestRender("viewport-change");
  }

  private getBaseViewportImageDimensions(): { width: number; height: number } {
    return getTransformOutputDimensions(
      this.imageWidth,
      this.imageHeight,
      this.getPreviewTransformState(),
      { includeCrop: !this.cropEditMode },
    );
  }

  private getViewportImageDimensions(): { width: number; height: number } {
    const base = this.getBaseViewportImageDimensions();
    const settings = this.presentationSettings;
    if (!settings?.enabled) return base;
    return resolvePresentationGeometry({
      sourceWidth: base.width,
      sourceHeight: base.height,
      settings,
    }).frame;
  }

  private getPreviewRenderSize(mode: PreviewRenderMode = this.previewRenderMode): {
    width: number;
    height: number;
  } {
    const transform = this.getPreviewTransformState();
    const display = getTransformOutputDimensions(this.imageWidth, this.imageHeight, transform, {
      includeCrop: !this.cropEditMode,
    });
    const imageWidth = Math.max(1, display.width);
    const imageHeight = Math.max(1, display.height);
    const nativeMaxSide = Math.max(imageWidth, imageHeight);
    const maxTextureSize = Math.max(1, this.capabilities.maxTextureSize || nativeMaxSide);

    // canvas.width/height are drawing-buffer pixels (CSS size × pixel ratio). If
    // resize has not run yet, fall back to the CSS rect.
    const zoom = Math.max(0, this.viewportController.getState().targetZoom);
    const pixelZoom = zoom * this.getPreviewPixelRatio();

    // Use enough backing pixels to cover the HiDPI canvas at fit, then scale up
    // with zoom so 100% view can use native RAW detail instead of magnifying a
    // fit-sized cache. Layout/camera stay in CSS pixels; only preview textures are
    // DPR-aware.
    const gpuScale = Math.min(1, maxTextureSize / nativeMaxSide);
    const boundedPreviewScale = this.getBoundedPreviewScale(
      imageWidth,
      imageHeight,
      REFINED_PREVIEW_RENDER_SIDE,
      REFINED_PREVIEW_RENDER_PIXELS,
    );
    const refinedScale = Math.min(gpuScale, boundedPreviewScale, pixelZoom);
    const draftScale = Math.min(refinedScale, DRAFT_PREVIEW_RENDER_SIDE / nativeMaxSide);
    const scale = Math.max(1 / nativeMaxSide, mode === "draft" ? draftScale : refinedScale);

    return {
      width: Math.max(1, Math.round(imageWidth * scale)),
      height: Math.max(1, Math.round(imageHeight * scale)),
    };
  }

  private syncViewportImageSize(): void {
    // Video sources have no imageBitmap (they render from a VideoTexture), but they
    // still need viewport sync: the default transform/dimensions are applied
    // asynchronously after loadVideo resolves, and this is what pushes the corrected
    // display size to the controller so the on-screen mesh is rescaled. Without it,
    // the clip renders at a stale aspect ratio until the first manual zoom/pan.
    if (!this.imageBitmap && !this.videoElement) return;
    const display = this.getViewportImageDimensions();
    const width = Math.max(1, Math.round(display.width));
    const height = Math.max(1, Math.round(display.height));
    if (width === this.viewportImageWidth && height === this.viewportImageHeight) {
      return;
    }
    this.viewportImageWidth = width;
    this.viewportImageHeight = height;
    this.viewportController.setImageSize(width, height);
  }

  private shouldRefreshPreviewForViewChange(): boolean {
    if (!this.imageTexture || !this.imageBitmap) return false;
    if (this.processedPreviewWidth <= 0 || this.processedPreviewHeight <= 0) return true;

    const next = this.getPreviewRenderSize("refined");
    return (
      Math.abs(next.width - this.processedPreviewWidth) / Math.max(1, next.width) >=
      PREVIEW_REBUILD_THRESHOLD ||
      Math.abs(next.height - this.processedPreviewHeight) / Math.max(1, next.height) >=
      PREVIEW_REBUILD_THRESHOLD
    );
  }

  private schedulePreviewRefine(): void {
    if (this.previewRefineTimer) {
      window.clearTimeout(this.previewRefineTimer);
    }

    this.previewRefineTimer = window.setTimeout(() => {
      this.previewRefineTimer = 0;
      if (!this.imageTexture || !this.imageBitmap) return;
      void this.requestSourcePreviewForZoom(this.viewportController.getState().targetZoom, false).finally(() => {
        if (!this.imageTexture || !this.imageBitmap) return;
        this.previewRenderMode = "refined";
        this.processedDirty = true;
        this.requestRender("preview-refine");
      });
    }, PREVIEW_REFINE_IDLE_MS);
  }

  private scheduleViewportRefine(): void {
    if (this.viewportRefineTimer) {
      window.clearTimeout(this.viewportRefineTimer);
    }

    this.viewportRefineTimer = window.setTimeout(() => {
      this.viewportRefineTimer = 0;
      if (!this.imageTexture || !this.imageBitmap) return;

      // Wait for the zoom-appropriate source proxy before grading. Previously
      // this rendered a large refined target immediately from the old proxy and
      // then rendered it a second time when the bitmap resize completed, causing
      // a pronounced hitch on high-resolution RAW files.
      void this.requestSourcePreviewForZoom(
        this.viewportController.getState().targetZoom,
        false,
      ).finally(() => {
        if (!this.imageTexture || !this.imageBitmap) return;
        if (this.isViewDependentFXActive() || this.shouldRefreshPreviewForViewChange()) {
          this.previewRenderMode = "refined";
          this.processedDirty = true;
          this.requestRender("preview-refine");
        }
      });
    }, PREVIEW_REFINE_IDLE_MS);
  }

  private render() {
    // Only re-run the (full-resolution) FX pipeline when the processed result is
    // actually stale. Pure pan/zoom/resize frames fall through to a cheap
    // re-composite of the cached processed texture below.
    if (this.imageTexture && this.processedDirty) {
      const previewSize = this.getPreviewRenderSize();
      const grainViewport = this.getPreviewGrainViewport();
      if ((globalThis as { __DEBUG_RENDER__?: boolean }).__DEBUG_RENDER__) {
        console.log("[Engine] render — processedDirty, calling renderPreview", {
          previewSize,
          grainViewport,
          imageWidth: this.imageWidth,
          imageHeight: this.imageHeight,
          imageTexture: !!this.imageTexture,
          currentColorManagement: this.currentColorManagement.useAcesPipeline,
          currentFXState: this.currentFXState,
          localLUTsCount: this.currentLocalLUTs.length,
        });
      }
      const processed = this.fxPipeline.renderPreview({
        imageTexture: this.imageTexture,
        sourceWidth: this.imageWidth,
        sourceHeight: this.imageHeight,
        width: previewSize.width,
        height: previewSize.height,
        lutHandle: this.prepareBaseLUTHandle(),
        transform: this.getPreviewTransformState(),
        distort: this.currentDistortState,
        retouch: this.currentRetouchState,
        fxState: this.currentFXState,
        lutInterpolationMode: this.lutInterpolationMode,
        lutKind: this.activeLUTKind,
        localLUTs: this.currentLocalLUTs,
        directCreativeShader: this.baseLUTGenerator.directCreativeShader,
        depthTexture: this.depthTexture,
        colorManagement: {
          useAcesPipeline: this.currentColorManagement.useAcesPipeline,
          inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
          displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
          idtAtlas: this.baseLUTGenerator.idtCubeAtlas,
          odtAtlas: this.baseLUTGenerator.odtCubeAtlas,
        },
        previewZoom: this.viewportController.getState().zoom,
        grainViewport,
        renderTargetType: this.getPreviewRenderTargetType(),
        debugView: isEngineDebugView(this.currentDebugView) ? this.currentDebugView : "final",
      });

      this.lastBaseProcessedRT = processed;
      const overlayProcessed = this.editorOverlayPass.render(
        this.renderer,
        processed.texture,
        this.committedEditState.overlays,
        previewSize.width,
        previewSize.height,
        this.getPreviewRenderTargetType(),
        undefined,
        this.depthTexture,
      );
      const displayed = overlayProcessed ?? processed;
      this.lastProcessedRT = displayed;

      if (this.presentationSettings?.enabled) {
        this.applyPresentationBorder(displayed.texture);
      } else {
        this.disposePresentationComposed();
        this.integrationPass.setProcessedTexture(displayed.texture);
        this.syncViewportImageSize();
      }

      this.processedPreviewWidth = previewSize.width;
      this.processedPreviewHeight = previewSize.height;
      this.processedDirty = false;
      this.overlayDirty = false;
      this.presentationDirty = false;
      this.onProcessedChange?.();
    } else if (this.overlayDirty && this.lastBaseProcessedRT) {
      // A committed overlay texture may finish loading after the base photo. Reuse
      // that cached base target and update only the committed compositor.
      const base = this.lastBaseProcessedRT;
      const overlayProcessed = this.editorOverlayPass.render(
        this.renderer,
        base.texture,
        this.committedEditState.overlays,
        base.width,
        base.height,
        base.texture.type,
        undefined,
        this.depthTexture,
      );
      const displayed = overlayProcessed ?? base;
      this.lastProcessedRT = displayed;

      if (this.presentationSettings?.enabled) {
        this.applyPresentationBorder(displayed.texture);
      } else {
        this.disposePresentationComposed();
        // Overlay-only updates replace pixels, not image geometry. Do not sync the
        // viewport image size here: doing so can reapply transformed/cropped output
        // dimensions and change the visible region while a layer draft is active.
        this.integrationPass.setProcessedTexture(displayed.texture);
      }

      this.overlayDirty = false;
      this.presentationDirty = false;
      this.onProcessedChange?.();
    } else if (this.presentationDirty && this.lastProcessedRT) {
      if (this.presentationSettings?.enabled) {
        this.applyPresentationBorder(this.lastProcessedRT.texture);
      } else {
        this.disposePresentationComposed();
        this.integrationPass.setProcessedTexture(this.lastProcessedRT.texture);
        this.syncViewportImageSize();
      }
      this.presentationDirty = false;
    }

    // Draw a draft through the normal IntegrationPass mesh. Painting the draft
    // afterward into a calculated screen rectangle scaled the full preview texture
    // into only the visible portion of a zoomed/panned image. Temporarily binding
    // the draft texture preserves the exact committed UV transform, aspect ratio,
    // crop, zoom, and pan without changing any viewport state.
    let restoreProcessedTexture: import("three").Texture | null = null;
    if (this.overlayPreviewActive && this.lastBaseProcessedRT) {
      const base = this.lastBaseProcessedRT;
      const previewTarget = this.editorOverlayPreviewPass.render(
        this.renderer,
        base.texture,
        this.previewOverlayLayers,
        base.width,
        base.height,
        base.texture.type,
        undefined,
        this.depthTexture,
      );
      // A null target means the draft has no renderable layers. Bind the clean
      // base explicitly instead of leaving the previously committed overlay
      // texture attached; this is what makes deleting (or hiding) the last layer
      // visible before the draft is applied.
      restoreProcessedTexture = this.lastProcessedRT?.texture ?? base.texture;
      this.integrationPass.setProcessedTexture(previewTarget?.texture ?? base.texture);
    }

    this.renderer.render(this.scene, this.camera);

    if (restoreProcessedTexture) {
      this.integrationPass.setProcessedTexture(restoreProcessedTexture);
    }

    if (this.colorMaskPreview?.enabled && this.imageTexture && this.colorMaskPreview.useSelectedColor) {
      const imageRect = this.getDisplayedImageRect();
      if (imageRect) {
        // imageRect is in the same logical canvas coordinate space expected by
        // THREE.WebGLRenderer.setViewport/setScissor. Do NOT multiply this rect by
        // devicePixelRatio here: WebGLRenderer applies its pixelRatio internally
        // when it forwards the viewport to gl.viewport(). Multiplying here again
        // shifts/scales the red mask overlay on HiDPI / browser-zoomed displays.
        const maskResolutionScale = this.getCanvasFramebufferScale();

        this.colorMaskPass.setCanvasSize(
          imageRect.width * maskResolutionScale.x,
          imageRect.height * maskResolutionScale.y,
        );
        const maskTarget = this.colorMaskPass.render(
          this.renderer,
          this.lastProcessedRT ? this.lastProcessedRT.texture : this.imageTexture,
          this.colorMaskPreview,
        );
        this.maskOverlayPass.render(
          this.renderer,
          maskTarget.texture,
          this.colorMaskPreview.overlayColor,
          this.colorMaskPreview.overlayOpacity,
          imageRect,
        );
      }
    }

    // Radial mask preview — pure geometric pass, no color sampling required.
    if (this.radialMaskPreview?.enabled && this.imageTexture) {
      const imageRect = this.getDisplayedImageRect();
      if (imageRect) {
        const maskResolutionScale = this.getCanvasFramebufferScale();
        this.radialMaskPass.setCanvasSize(
          imageRect.width * maskResolutionScale.x,
          imageRect.height * maskResolutionScale.y,
        );
        const radialMaskTarget = this.radialMaskPass.render(
          this.renderer,
          {
            position: this.radialMaskPreview.position,
            size:     this.radialMaskPreview.size,
            angle:    this.radialMaskPreview.angle,
            feather:  this.radialMaskPreview.feather,
            invert:   this.radialMaskPreview.invert,
            opacity:  this.radialMaskPreview.opacity,
            alpha:    this.radialMaskPreview.alpha,
          },
          this.imageWidth,
          this.imageHeight,
        );
        this.maskOverlayPass.render(
          this.renderer,
          radialMaskTarget.texture,
          this.radialMaskPreview.overlayColor,
          this.radialMaskPreview.overlayOpacity,
          imageRect,
        );
      }
    }

    // Gradient mask preview — linear gradient pass.
    if (this.gradientMaskPreview?.enabled && this.imageTexture) {
      const imageRect = this.getDisplayedImageRect();
      if (imageRect) {
        const maskResolutionScale = this.getCanvasFramebufferScale();
        this.gradientMaskPass.setCanvasSize(
          imageRect.width  * maskResolutionScale.x,
          imageRect.height * maskResolutionScale.y,
        );
        const gradientMaskTarget = this.gradientMaskPass.render(
          this.renderer,
          {
            startPoint: this.gradientMaskPreview.startPoint,
            endPoint:   this.gradientMaskPreview.endPoint,
            reflect:    this.gradientMaskPreview.reflect,
            invert:     this.gradientMaskPreview.invert,
            opacity:    this.gradientMaskPreview.opacity,
            alpha:      this.gradientMaskPreview.alpha,
          },
        );
        this.maskOverlayPass.render(
          this.renderer,
          gradientMaskTarget.texture,
          this.gradientMaskPreview.overlayColor,
          this.gradientMaskPreview.overlayOpacity,
          imageRect,
        );
      }
    }

    // Luminance mask preview — samples source image luminance in the shader.
    if (this.luminanceMaskPreview?.enabled && this.imageTexture) {
      const imageRect = this.getDisplayedImageRect();
      if (imageRect) {
        const maskResolutionScale = this.getCanvasFramebufferScale();
        const sourceTexture = this.lastProcessedRT?.texture ?? this.imageTexture;
        this.fxPipeline.luminanceMaskPass.setCanvasSize(
          imageRect.width  * maskResolutionScale.x,
          imageRect.height * maskResolutionScale.y,
        );
        const luminanceMaskTarget = this.fxPipeline.luminanceMaskPass.render(
          this.renderer,
          sourceTexture,
          {
            target:     this.luminanceMaskPreview.target,
            range:      this.luminanceMaskPreview.range,
            smoothness: this.luminanceMaskPreview.smoothness,
            invert:     this.luminanceMaskPreview.invert,
            opacity:    this.luminanceMaskPreview.opacity,
            alpha:      this.luminanceMaskPreview.alpha,
          },
        );
        this.maskOverlayPass.render(
          this.renderer,
          luminanceMaskTarget.texture,
          this.luminanceMaskPreview.overlayColor,
          this.luminanceMaskPreview.overlayOpacity,
          imageRect,
        );
      }
    }

    // Depth mask preview — samples depth texture in the shader.
    if (this.depthMaskPreview?.enabled && this.depthTexture) {
      const imageRect = this.getDisplayedImageRect();
      if (imageRect) {
        const maskResolutionScale = this.getCanvasFramebufferScale();
        this.depthMaskPass.setCanvasSize(
          imageRect.width  * maskResolutionScale.x,
          imageRect.height * maskResolutionScale.y,
        );
        const depthMaskTarget = this.depthMaskPass.render(
          this.renderer,
          this.depthTexture,
          {
            target:  this.depthMaskPreview.target,
            range:   this.depthMaskPreview.range,
            invert:  this.depthMaskPreview.invert,
            opacity: this.depthMaskPreview.opacity,
            alpha:   this.depthMaskPreview.alpha,
          },
        );
        this.maskOverlayPass.render(
          this.renderer,
          depthMaskTarget.texture,
          this.depthMaskPreview.overlayColor,
          this.depthMaskPreview.overlayOpacity,
          imageRect,
        );
      }
    }

    if (this.brushMaskPreview?.enabled && this.imageTexture) {
      const imageRect = this.getDisplayedImageRect();
      if (imageRect) {
        const maskResolutionScale = this.getCanvasFramebufferScale();
        const preview = this.brushMaskPreview;

        // Rebuild or reuse the cached brush texture.
        const brushTarget = this.brushMaskTexturePass.getOrBuildTexture({
          renderer: this.renderer,
          sourceTexture: this.lastProcessedRT?.texture ?? this.imageTexture,
          sourceWidth:  this.imageWidth,
          sourceHeight: this.imageHeight,
          maskId:       preview.maskId,
          component:    preview.component,
          liveStroke:   preview.liveStroke ?? null,
        });

        // Apply invert/opacity/alpha to get the final mask texture.
        this.brushMaskPass.setCanvasSize(
          imageRect.width  * maskResolutionScale.x,
          imageRect.height * maskResolutionScale.y,
        );
        const brushMaskTarget = this.brushMaskPass.render(
          this.renderer,
          brushTarget.texture,
          preview.component,
        );

        this.maskOverlayPass.render(
          this.renderer,
          brushMaskTarget.texture,
          preview.overlayColor,
          preview.overlayOpacity,
          imageRect,
        );
      }
    }

    this.onRenderComplete?.();  }

  private getDisplayedImageRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const canvasRect = this.canvas.getBoundingClientRect();

    const p0 = this.viewportController.imageUVToCanvasRelative(0, 0);
    const p1 = this.viewportController.imageUVToCanvasRelative(1, 1);

    if (!canvasRect || !p0 || !p1) return null;

    const cssLeft = Math.min(p0.x, p1.x);
    const cssTop = Math.min(p0.y, p1.y);
    const cssWidth = Math.abs(p1.x - p0.x);
    const cssHeight = Math.abs(p1.y - p0.y);

    // Return logical canvas viewport coordinates for THREE.WebGLRenderer.
    // x/width/height are CSS-pixel logical units; y is converted from CSS
    // top-left origin to WebGL bottom-left origin. Do not convert to drawing
    // buffer pixels here, because WebGLRenderer.setViewport applies pixelRatio.
    const x = cssLeft;
    const y = canvasRect.height - (cssTop + cssHeight);
    const width = cssWidth;
    const height = cssHeight;

    if (width <= 0 || height <= 0) return null;

    return { x, y, width, height };
  }

  private getCanvasFramebufferScale(): { x: number; y: number } {
    const canvasRect = this.canvas.getBoundingClientRect();

    return {
      x: this.canvas.width / Math.max(1, canvasRect.width),
      y: this.canvas.height / Math.max(1, canvasRect.height),
    };
  }

  /**
   * GPU presentation-border compositing. The graded picture (`processedTexture`) is
   * kept on the GPU and the integration shader places it inside the frame's picture
   * inset, filling the surrounding border region (solid color, or a blurred cover of
   * the picture). No CPU readback / canvas / texture upload — the grade stays fully
   * live during a drag, and the grade only ever touches the picture, never the border.
   */
  private ensurePresentationBackgroundTexture(settings: BorderSettings | null): void {
    const key =
      settings?.backgroundMode === "image" && settings.backgroundImage?.dataUrl
        ? settings.backgroundImage.dataUrl
        : "";
    if (key === this.presentationBackgroundKey) return;

    this.disposePresentationBackgroundTexture();
    this.presentationBackgroundKey = key;
    if (!key) return;

    const requestId = ++this.presentationBackgroundRequestId;
    void fetch(key)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (this.disposed || requestId !== this.presentationBackgroundRequestId) {
          bitmap.close();
          return;
        }
        const texture = new Texture(bitmap);
        texture.needsUpdate = true;
        texture.flipY = false;
        texture.generateMipmaps = false;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.colorSpace = NoColorSpace;
        this.presentationBackgroundBitmap = bitmap;
        this.presentationBackgroundTexture = texture;
        this.presentationDirty = true;
        this.requestRender("presentation-change");
      })
      .catch((error) => {
        if (requestId === this.presentationBackgroundRequestId) {
          console.warn("[Engine] Unable to load presentation frame image", error);
        }
      });
  }

  private disposePresentationBackgroundTexture(): void {
    this.presentationBackgroundRequestId += 1;
    this.presentationBackgroundTexture?.dispose();
    this.presentationBackgroundTexture = null;
    this.presentationBackgroundBitmap?.close();
    this.presentationBackgroundBitmap = null;
    this.presentationBackgroundKey = "";
  }

  private applyPresentationBorder(processedTexture: import("three").Texture): void {
    const settings = this.presentationSettings!;

    // Frame geometry at the on-screen display resolution (drives viewport sizing and
    // the picture inset). Geometry is top-down (canvas convention); UV is bottom-up.
    const baseDisplay = this.getBaseViewportImageDimensions();
    const geometry = resolvePresentationGeometry({
      sourceWidth: baseDisplay.width,
      sourceHeight: baseDisplay.height,
      settings,
    });
    const fw = Math.max(1, geometry.frame.width);
    const fh = Math.max(1, geometry.frame.height);
    const img = geometry.imageRect;

    const pictureRect: [number, number, number, number] = [
      img.x / fw,
      1 - (img.y + img.height) / fh,
      img.width / fw,
      img.height / fh,
    ];

    // Cover rect: the picture (blurred-image bg) or frame image scaled to cover the whole frame.
    const backgroundImageRotation =
      settings.backgroundMode === "image" ? settings.backgroundImage?.rotationDegrees ?? 0 : 0;
    const backgroundImageRotated =
      backgroundImageRotation === 90 || backgroundImageRotation === 270;
    const coverSourceWidth =
      settings.backgroundMode === "image" && settings.backgroundImage
        ? backgroundImageRotated
          ? settings.backgroundImage.height
          : settings.backgroundImage.width
        : baseDisplay.width;
    const coverSourceHeight =
      settings.backgroundMode === "image" && settings.backgroundImage
        ? backgroundImageRotated
          ? settings.backgroundImage.width
          : settings.backgroundImage.height
        : baseDisplay.height;
    const coverScale = Math.max(
      fw / Math.max(1, coverSourceWidth),
      fh / Math.max(1, coverSourceHeight),
    );
    const coverW = coverSourceWidth * coverScale;
    const coverH = coverSourceHeight * coverScale;
    const coverX = (fw - coverW) / 2;
    const coverY = (fh - coverH) / 2;
    const coverRect: [number, number, number, number] = [
      coverX / fw,
      1 - (coverY + coverH) / fh,
      coverW / fw,
      coverH / fh,
    ];

    const blurred = settings.backgroundMode === "blurred-image";
    const imageBackground =
      settings.backgroundMode === "image" && !!this.presentationBackgroundTexture;
    const blurPx = blurred ? Math.max(0, Math.min(80, settings.blurAmount || 0)) : 0;

    // Corner radii are authored as a fraction of the frame short edge; the shader
    // works in frame-height UV units, so express them as px / fh.
    const shortEdge = Math.min(fw, fh);
    const pictureRadius = (Math.max(0, settings.imageRadius || 0) * shortEdge) / fh;
    const frameRadius = (Math.max(0, settings.frameRadius || 0) * shortEdge) / fh;
    const pictureShadow = Math.max(0, Math.min(1, settings.imageShadow || 0));
    const pictureInnerShadow = Math.max(0, Math.min(1, settings.imageInnerShadow || 0));

    this.integrationPass.setProcessedTexture(processedTexture);
    this.integrationPass.setPresentationBorder({
      pictureRect,
      coverRect,
      color: [
        settings.backgroundColor[0] / 255,
        settings.backgroundColor[1] / 255,
        settings.backgroundColor[2] / 255,
      ],
      backgroundImageTexture: this.presentationBackgroundTexture,
      backgroundImageRotation,
      opacity: settings.backgroundOpacity,
      blurred,
      imageBackground,
      blur: [blurPx / fw, blurPx / fh],
      pictureRadius,
      frameRadius,
      pictureShadowOpacity: pictureShadow > 0 ? 0.16 + pictureShadow * 0.34 : 0,
      pictureShadowBlur: pictureShadow > 0 ? (shortEdge * (0.012 + pictureShadow * 0.055)) / fh : 0,
      pictureShadowOffset: [
        0,
        pictureShadow > 0 ? -(shortEdge * (0.004 + pictureShadow * 0.018)) / fh : 0,
      ],
      pictureInnerShadowOpacity: pictureInnerShadow > 0 ? 0.12 + pictureInnerShadow * 0.3 : 0,
      pictureInnerShadowBlur:
        pictureInnerShadow > 0 ? (shortEdge * (0.012 + pictureInnerShadow * 0.045)) / fh : 0,
      frameAspect: fw / fh,
      clearColor: [0x11 / 255, 0x11 / 255, 0x10 / 255],
    });

    if (fw !== this.viewportImageWidth || fh !== this.viewportImageHeight) {
      this.viewportImageWidth = fw;
      this.viewportImageHeight = fh;
      this.viewportController.setImageSize(fw, fh);
    }
  }

  private disposePresentationComposed(): void {
    this.integrationPass.setPresentationBorder(null);
  }

  private requestRender(reason = "render") {
    recordRenderRequest();

    if (reason === "presentation-change") {
      // Border changes only re-composite the frame around the already-graded
      // picture — render() reuses the cached processed texture (lastProcessedRT).
      // Grading applies to the picture, not the border, so we must NOT mark the
      // processed texture dirty here: re-running the FX pipeline on every border
      // tweak would be wasted work and would (incorrectly) couple grade to border.
      this.presentationDirty = true;
      if (this.animationFrame !== 0) return;
      this.animationFrame = requestAnimationFrame(() => {
        this.animationFrame = 0;
        this.render();
        recordRenderFrame();
      });
      return;
    }

    // Anything that isn't a pure view change invalidates the cached processed
    // texture, so the next frame re-runs the FX pipeline. Set this BEFORE the
    // in-flight-frame early return so a coalesced edit isn't dropped.
    if (reason === "overlay-texture-ready") {
      // The committed compositor can be refreshed from the cached photo without
      // rerunning the photo pipeline.
      this.overlayDirty = true;
      if (!this.lastBaseProcessedRT) {
        this.previewRenderMode = "refined";
        this.processedDirty = true;
      }
    } else if (OVERLAY_PREVIEW_REASONS.has(reason)) {
      // Same contract as mask-overlay: render() paints the provisional result
      // after the committed scene without invalidating its processed texture.
      if (!this.lastBaseProcessedRT) {
        this.previewRenderMode = "refined";
        this.processedDirty = true;
      }
    } else if (this.transientPreviewActive || INTERACTIVE_PREVIEW_REASONS.has(reason)) {
      this.previewRenderMode = "draft";
      this.schedulePreviewRefine();
      this.processedDirty = true;
    } else if (reason === "preview-refine") {
      this.previewRenderMode = "refined";
      this.processedDirty = true;
    } else if (reason === "mask-overlay") {
      // Overlay previews composite over the cached processed frame. They must not
      // invalidate the grading pipeline on every mask pointer event.
    } else if (!VIEW_ONLY_RENDER_REASONS.has(reason)) {
      this.previewRenderMode = "refined";
      this.processedDirty = true;
    } else if (this.isViewDependentFXActive() || this.shouldRefreshPreviewForViewChange()) {
      this.scheduleViewportRefine();
    }
    if (this.animationFrame !== 0) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.render();
      recordRenderFrame();
    });
  }

  private getPreviewGrainViewport(): GrainViewport {
    const viewport = this.viewportController.getState();
    const pixelRatioX = this.canvas.width / Math.max(1, viewport.containerWidth);
    const pixelRatioY = this.canvas.height / Math.max(1, viewport.containerHeight);
    const pixelRatio = Math.max(1e-4, Math.min(pixelRatioX, pixelRatioY));
    return {
      viewportWidth: Math.max(1, this.canvas.width),
      viewportHeight: Math.max(1, this.canvas.height),
      imageWidth: Math.max(1, viewport.imageWidth),
      imageHeight: Math.max(1, viewport.imageHeight),
      zoom: Math.max(1e-4, viewport.zoom * pixelRatio),
      panX: viewport.panX * pixelRatio,
      panY: viewport.panY * pixelRatio,
    };
  }

  private isViewDependentFXActive(): boolean {
    const grain = this.currentFXState.grain;
    return grain.enabled && !grain.bypass && grain.amount > 0;
  }

  private getPreviewRenderTargetType() {
    return this.capabilities.supportsHalfFloatTextures ? HalfFloatType : UnsignedByteType;
  }

  private logSourceDebugInfo(sourceType: string): void {
    if (!(globalThis as { __DEBUG_PREVIEW_LOADING__?: boolean }).__DEBUG_PREVIEW_LOADING__) return;
    if (!this.imageBitmap || !this.imageTexture) return;
    console.table({
      sourceType,
      decodedWidth: this.imageWidth,
      decodedHeight: this.imageHeight,
      displayedTextureWidth: this.imageTexture.image?.width ?? this.imageWidth,
      displayedTextureHeight: this.imageTexture.image?.height ?? this.imageHeight,
      textureWidth: this.imageTexture.image?.width ?? this.imageWidth,
      textureHeight: this.imageTexture.image?.height ?? this.imageHeight,
      viewerAspectRatio: Number(
        (this.viewportImageWidth / Math.max(1, this.viewportImageHeight)).toFixed(6),
      ),
      exportOriginalWidth: this.resolveExportDimensions({}).width,
      exportOriginalHeight: this.resolveExportDimensions({}).height,
      isThumbnail: false,
      bitDepth: this.sourceBitDepth,
      textureType: "ImageBitmap/Texture",
      renderTargetType:
        this.getPreviewRenderTargetType() === HalfFloatType ? "HalfFloatType" : "UnsignedByteType",
      idt: this.currentColorManagement.inputColorSpaceId,
      odt: this.currentColorManagement.displayColorSpaceId,
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
      imageOrientation: this.sourceOrientationApplied ? "codec-applied" : "none",
    });
  }

  /** Stops, unloads, and frees the decoded video source (and its object URL). */
  private disposeVideoElement(): void {
    if (this.videoElement) {
      if (
        this.videoFrameCallbackId &&
        typeof this.videoElement.cancelVideoFrameCallback === "function"
      ) {
        this.videoElement.cancelVideoFrameCallback(this.videoFrameCallbackId);
      }
      this.videoElement.pause();
      this.videoElement.removeAttribute("src");
      this.videoElement.load();
      this.videoElement = undefined;
      this.videoFrameCallbackId = 0;
    }
    if (this.videoObjectUrl) {
      URL.revokeObjectURL(this.videoObjectUrl);
      this.videoObjectUrl = undefined;
    }
  }

  private disposeImageResources() {
    this.cancelSourcePreviewRequests();
    this.integrationPass.clearImageTexture();
    this.integrationPass.setProcessedTexture(null);
    this.disposePresentationComposed();
    this.disposePresentationBackgroundTexture();
    this.lastBaseProcessedRT = null;
    this.lastProcessedRT = null;
    this.overlayDirty = false;
    this.overlayPreviewActive = false;

    this.imageTexture?.dispose();
    this.imageTexture = undefined;

    this.videoExportTexture?.dispose();
    this.videoExportTexture = undefined;

    this.imageTextureBitmap?.close();
    this.imageTextureBitmap = undefined;

    this.imageBitmap?.close();
    this.imageBitmap = undefined;
    this.disposeVideoElement();
    this.processedPreviewWidth = 0;
    this.processedPreviewHeight = 0;
    this.sourcePreviewWidth = 0;
    this.sourcePreviewHeight = 0;
    if (this.previewRefineTimer) {
      window.clearTimeout(this.previewRefineTimer);
      this.previewRefineTimer = 0;
    }
    if (this.viewportRefineTimer) {
      window.clearTimeout(this.viewportRefineTimer);
      this.viewportRefineTimer = 0;
    }
  }

  private updateEngineSettings(settings: EngineSettingsState): void {
    const nextSettings = { ...settings };
    const nextKind = resolveLUTTextureKind(nextSettings.lutStorageMode, this.capabilities);
    const nextWarning = getLUTStorageWarning(nextSettings.lutStorageMode, this.capabilities);

    this.engineSettings = nextSettings;
    this.lutStorageWarning = nextWarning;

    if (nextKind !== this.activeLUTKind) {
      this.activeLUTKind = nextKind;
      this.baseLUT3DNeedsUpdate = true;
      this.integrationPass.setLUTStorageMode(nextKind);
    }

    if (nextWarning && nextSettings.lutStorageMode === "3d-texture") {
      console.warn(`[Engine] ${nextWarning}`);
    }
  }

  private prepareBaseLUTHandle(): LUTTextureHandle {
    if (this.baseLUTGenerator.needsUpdate) {
      this.baseLUTGenerator.render();
      this.baseLUT3DNeedsUpdate = true;
    }

    if (this.activeLUTKind === "3d-texture") {
      if (this.baseLUT3DNeedsUpdate || !this.baseLUT3DGenerator.hasTexture) {
        this.baseLUT3DGenerator.updateFromAtlasPixels(
          this.baseLUTGenerator.readAtlasRGBA16F() ?? this.baseLUTGenerator.readAtlasRGBA8(),
        );
        this.baseLUT3DNeedsUpdate = false;
      }
      return { kind: "3d-texture", texture: this.baseLUT3DGenerator.texture, size: LUT_SIZE };
    }

    return { kind: "2d-atlas", texture: this.baseLUTGenerator.texture, size: LUT_SIZE };
  }

  private getPreviewTransformState(): TransformState {
    if (!this.cropEditMode) {
      return this.currentTransformState;
    }

    return { ...this.currentTransformState, cropEnabled: false };
  }

  private resolveExportDimensions(options: ExportOptions): { width: number; height: number } {
    if (options.width !== undefined && options.height !== undefined) {
      return {
        width: normalizeExportDimension(options.width),
        height: normalizeExportDimension(options.height),
      };
    }

    const fallback = getTransformOutputDimensions(
      this.imageWidth,
      this.imageHeight,
      this.currentTransformState,
    );

    return {
      width: normalizeExportDimension(options.width ?? fallback.width),
      height: normalizeExportDimension(options.height ?? fallback.height),
    };
  }

  getCurrentLUTMemoryEstimate(): LUTMemoryEstimate {
    return estimateLUTMemory(this.activeLUTKind, 1);
  }

  readDisplayPixelAtClient(clientX: number, clientY: number, mode?: "smooth"): [number, number, number] | null {
    void mode;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null;

    const gl = this.renderer.getContext();
    const pixelRatio = this.renderer.getPixelRatio();
    const px = Math.round(x * pixelRatio);
    const py = Math.round((rect.height - y) * pixelRatio);

    const buffer = new Uint8Array(4);

    const oldTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(null);

    // Temporarily disable the color mask overlay so we sample the pure graded image,
    // not the red mask itself!
    let oldMaskEnabled = false;
    if (this.colorMaskPreview) {
      oldMaskEnabled = this.colorMaskPreview.enabled;
      this.colorMaskPreview.enabled = false;
    }
    let oldRadialMaskEnabled = false;
    if (this.radialMaskPreview) {
      oldRadialMaskEnabled = this.radialMaskPreview.enabled;
      this.radialMaskPreview.enabled = false;
    }
    let oldGradientMaskEnabled = false;
    if (this.gradientMaskPreview) {
      oldGradientMaskEnabled = this.gradientMaskPreview.enabled;
      this.gradientMaskPreview.enabled = false;
    }
    let oldLuminanceMaskEnabled = false;
    if (this.luminanceMaskPreview) {
      oldLuminanceMaskEnabled = this.luminanceMaskPreview.enabled;
      this.luminanceMaskPreview.enabled = false;
    }
    let oldDepthMaskEnabled = false;
    if (this.depthMaskPreview) {
      oldDepthMaskEnabled = this.depthMaskPreview.enabled;
      this.depthMaskPreview.enabled = false;
    }

    this.render();
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buffer);

    if (this.colorMaskPreview) {
      this.colorMaskPreview.enabled = oldMaskEnabled;
    }
    if (this.radialMaskPreview) {
      this.radialMaskPreview.enabled = oldRadialMaskEnabled;
    }
    if (this.gradientMaskPreview) {
      this.gradientMaskPreview.enabled = oldGradientMaskEnabled;
    }
    if (this.luminanceMaskPreview) {
      this.luminanceMaskPreview.enabled = oldLuminanceMaskEnabled;
    }
    if (this.depthMaskPreview) {
      this.depthMaskPreview.enabled = oldDepthMaskEnabled;
    }

    // The sampling render above intentionally hides mask overlays. Restoring only
    // the flags leaves that overlay-free frame visible until some later render,
    // which makes the color picker flash while its sampled color is unchanged.
    // Repaint immediately with the original preview state before returning.
    this.render();
    this.renderer.setRenderTarget(oldTarget);

    return [buffer[0] / 255, buffer[1] / 255, buffer[2] / 255];
  }

  getLUTStatus(): EngineLUTStatus {
    return {
      capabilities: this.capabilities,
      storageMode: this.engineSettings.lutStorageMode,
      textureKind: this.activeLUTKind,
      pathLabel: getLUTPathLabel(this.activeLUTKind, this.lutInterpolationMode),
      warning: this.lutStorageWarning,
      memory: this.getCurrentLUTMemoryEstimate(),
    };
  }

  getRendererDebugSnapshot(): RendererDebugSnapshot {
    const preview = this.getPreviewRenderSize();
    return {
      source: {
        loaded: !!this.imageBitmap,
        fileName: this.imageBitmap ? this.sourceFileName : "",
        format: this.imageBitmap ? this.sourceFormat : "",
        mimeType: this.imageBitmap ? this.sourceMimeType : "",
        bitDepth: this.imageBitmap ? this.sourceBitDepth : 0,
        hasAlpha: this.imageBitmap ? this.sourceHasAlpha : false,
        orientationApplied: this.imageBitmap ? this.sourceOrientationApplied : false,
        originalWidth: this.sourceOriginalWidth,
        originalHeight: this.sourceOriginalHeight,
        width: this.imageWidth,
        height: this.imageHeight,
        textureReady: !!this.imageTexture,
        textureVersion: this.sourceTextureVersion,
        sourceTextureCreates: this.sourceTextureCreateCount,
        fileLoads: this.fileLoadCount,
        cachedDataLoads: this.cachedDataLoadCount,
        imageDataReadbacks: this.sourceImageDataReadbackCount,
      },
      render: {
        previewMode: this.previewRenderMode,
        previewWidth: preview.width,
        previewHeight: preview.height,
        processedWidth: this.processedPreviewWidth,
        processedHeight: this.processedPreviewHeight,
        processedDirty: this.processedDirty,
        rafPending: this.animationFrame !== 0,
        splitEnabled: this.splitEnabled,
        splitX: this.integrationPass.uniforms.uSplitX.value as number,
      },
      color: {
        useAcesPipeline: this.currentColorManagement.useAcesPipeline,
        inputColorSpaceId: this.currentColorManagement.inputColorSpaceId,
        displayColorSpaceId: this.currentColorManagement.displayColorSpaceId,
        lutKind: this.activeLUTKind,
        lutInterpolationMode: this.lutInterpolationMode,
        lutReadbackIs8Bit: this.baseLUTGenerator.readbackIs8Bit,
      },
      fxCounters: this.fxPipeline.getDebugCounters(),
      perf: getPotoPerfSnapshot(),
    };
  }

  private emitLUTStatus(): void {
    this.onLUTStatusChange?.(this.getLUTStatus());
  }
}

function getColorState(state: EditState): ColorState {
  return {
    curve: state.curve,
    contrast: state.contrast,
    balance: state.balance,
    scattering: state.scattering,
    refraction: state.refraction,
    saturation: state.saturation,
    rgbMixer: state.rgbMixer,
    densityChroma: state.densityChroma,
    radiance: state.radiance,
    tone: state.tone,
    shadowHighlight: state.shadowHighlight,
    exposure: state.exposure,
  };
}

function getFXState(state: EditState): ImageFXState {
  return {
    grain: state.grain,
    halation: state.halation,
    diffusion: state.diffusion,
    spotlight: state.spotlight,

  };
}

function isInputDisplayTransformOnlyChange(
  previous: ColorManagementState,
  next: ColorManagementState,
): boolean {
  if (
    previous.inputColorSpaceId === next.inputColorSpaceId &&
    previous.displayColorSpaceId === next.displayColorSpaceId
  ) {
    return false;
  }

  return (
    colorManagementExceptLegacyIdsSignature(previous) ===
    colorManagementExceptLegacyIdsSignature(next)
  );
}

function colorManagementExceptLegacyIdsSignature(state: ColorManagementState): string {
  return JSON.stringify({
    enabled: state.enabled,
    inputColorSpace: state.inputColorSpace,
    workingColorSpace: state.workingColorSpace,
    displayColorSpace: state.displayColorSpace,
    viewTransform: state.viewTransform,
    useOutputTransform: state.useOutputTransform,
    useGamutMapping: state.useGamutMapping,
    useAcesPipeline: state.useAcesPipeline,
    toneMapping: state.toneMapping,
    debugView: state.debugView,
    ocio: state.ocio,
    ocioRuntime: state.ocioRuntime,
  });
}

// Neutral FX used by Crop & Rotate apply, which bakes geometry only.
const NEUTRAL_FX_STATE: ImageFXState = getFXState(DEFAULT_EDIT_STATE);

/** Draws an image source to an OffscreenCanvas and reads RGBA8 pixels. */
function imageSourceToPixels(
  source: ImageBitmap | HTMLImageElement,
  maxSide?: number,
): ColorMatchImage | null {
  const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
  const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = maxSide ? Math.min(1, maxSide / Math.max(srcW, srcH, 1)) : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = scale !== 1;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}

function normalizeExportDimension(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Export size must be finite");
  }

  return Math.max(1, Math.floor(value));
}

function isIntegrationDebugMode(
  mode: IntegrationDebugMode | EngineDebugView,
): mode is IntegrationDebugMode {
  return mode === "final" || mode === "uv" || mode === "alpha" || mode === "checker";
}

function isEngineDebugView(mode: IntegrationDebugMode | EngineDebugView): mode is EngineDebugView {
  return (
    mode === "input" ||
    mode === "after-transform" ||
    mode === "after-idt" ||
    mode === "after-color" ||
    mode === "after-spotlight" ||
    mode === "after-acutance" ||
    mode === "after-diffusion" ||
    mode === "after-halation" ||

    mode === "after-grain" ||
    mode === "after-soften" ||
    mode === "after-sharpen" ||
    mode === "before-odt" ||
    mode === "after-odt" ||
    mode === "final"
  );
}
