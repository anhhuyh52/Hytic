import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Engine, type EngineLUTStatus, type RendererDebugSnapshot } from "../engine/Engine";
import { resolvePresetState } from "../engine/presets/resolvePresetState";
import { allPresets } from "../engine/presets/CustomPresetStore";
import type { CubeExportSize } from "../engine/lut/exportCube";
import type { LutWriteResult, LutWriteSettings } from "../engine/lut/lutFormatWriters";
import type { LUTData3D } from "../engine/interchange/InterchangeTypes";
import type { ExportImageRequest, ExportOptions } from "../engine/passes/ExportPass";
import type { CurvePreviewInput, EditState } from "../engine/state/EditState";
import { snapshotLocalAdjustmentLayer } from "../engine/state/EditState";
import type { BorderSettings } from "../features/presentation/presentationTypes";
import { clonePresentationBorder } from "../features/presentation/border/borderTypes";
import { cloneEditorOverlayLayer } from "../features/overlays/editorOverlayTypes";
import { VIEWER_BACKGROUND_COLOR, VIEWER_EMPTY_BACKGROUND_COLOR } from "../config/viewerConstants";
import { cloneMatchState } from "../engine/state/MatchTypes";
import { cloneRetouchState } from "../features/retouch/retouchTypes";
import type { EngineDebugView } from "../engine/fx/FXPipeline";
import type { IntegrationDebugMode, LUTInterpolationMode } from "../engine/passes/IntegrationPass";
import { scopesState, type ImageInfo, type ViewportInfo } from "../app/editor-store";
import { preventNativeDefault } from "../poto/contextMenuGuards";
import { isVideoFile, type SerializedVideoState } from "../video/types";
import type { VideoExportArtifact, VideoExportContainer } from "../video/exportVideo";
import { ScopesWindow } from "./scopes/ScopesWindow";

export type ColorMaskPreview = {
  enabled: boolean;
  sampleX: number;
  sampleY: number;
  position: [number, number];
  size: [number, number];
  angle: number;
  useRadius: boolean;
  selectedColor: [number, number, number] | null;
  useSelectedColor: boolean;
  threshold: number;
  feather: number;
  invert: boolean;
  opacity: number;
  alpha: number;
  overlayColor: [number, number, number];
  overlayOpacity: number;
};

/**
 * Red-preview params for a pure radial (ellipse) mask.
 * Drives RadialMaskPass + MaskOverlayPass in Engine.
 */
export type RadialMaskPreview = {
  enabled: boolean;
  /** Normalized image-UV center (0..1). */
  position: [number, number];
  /** Normalized image-UV diameter per axis (0..1). */
  size: [number, number];
  /** Rotation angle in radians. */
  angle: number;
  feather: number;
  invert: boolean;
  opacity: number;
  alpha: number;
  overlayColor: [number, number, number];
  overlayOpacity: number;
};

/**
 * Red-preview params for a linear gradient mask.
 * Drives GradientMaskPass + MaskOverlayPass in Engine.
 */
export type GradientMaskPreview = {
  enabled: boolean;
  startPoint: [number, number]; // image UV — transparent side
  endPoint:   [number, number]; // image UV — opaque side
  reflect:    boolean;
  invert:     boolean;
  opacity:    number;
  alpha:      number;
  overlayColor:   [number, number, number];
  overlayOpacity: number;
};

/**
 * Red-preview params for a luminance mask.
 * Drives LuminanceMaskPass + MaskOverlayPass in Engine.
 */
export type LuminanceMaskPreview = {
  enabled: boolean;
  target:     number;
  range:      number;
  smoothness: number;
  invert:     boolean;
  opacity:    number;
  alpha:      number;
  overlayColor:   [number, number, number];
  overlayOpacity: number;
};

import type { BrushMaskComponent, BrushStroke } from "../engine/state/EditState";

/**
 * Live-preview params for a brush mask.
 * Drives BrushMaskTexturePass + BrushMaskPass + MaskOverlayPass in Engine.
 */
export type BrushMaskPreview = {
  enabled:        boolean;
  maskId:         string;
  component:      BrushMaskComponent;
  /** Optional in-progress stroke appended on top of committed strokes. */
  liveStroke:     BrushStroke | null;
  overlayColor:   [number, number, number];
  overlayOpacity: number;
};

/**
 * Red-preview params for a depth mask.
 * Drives DepthMaskPass + MaskOverlayPass in Engine.
 */
export type DepthMaskPreview = {
  enabled: boolean;
  target:  number;
  range:   number;
  invert:  boolean;
  opacity: number;
  alpha:   number;
  overlayColor:   [number, number, number];
  overlayOpacity: number;
};

export type ViewerApi = {
  resetZoom(): void;
  fitToScreen(): void;
  clearImage(): void;
  hasImage(): boolean;
  cancelImageLoad(): void;
  restoreViewport(viewport: { zoom: number; panX: number; panY: number }): void;
  previewEditPatch(patch: Partial<EditState>, reason?: string): void;
  previewCurveInput(input: CurvePreviewInput): void;
  clearPreviewPatch(reason?: string): void;
  setDebugMode(mode: IntegrationDebugMode | EngineDebugView): void;
  toggleSplit(): boolean;
  isSplitEnabled(): boolean;
  setLUTInterpolationMode(mode: LUTInterpolationMode): void;
  exportImage(options?: ExportOptions): Promise<Blob>;
  renderExportImage(req: ExportImageRequest): Promise<Blob>;
  isExportReady(): boolean;
  getExportBaseSize(): { width: number; height: number };
  setCropEditMode(active: boolean): void;
  exportCube(options?: { title?: string; size?: CubeExportSize }): Promise<Blob>;
  exportCLF(options?: { title?: string; size?: CubeExportSize }): Promise<Blob>;
  exportLUT(settings: LutWriteSettings): Promise<LutWriteResult & { is8Bit: boolean }>;
  getCurrentGlobalLUTData3D(size?: CubeExportSize): Promise<LUTData3D>;
  getSourceImageBlob(type?: string, quality?: number): Promise<Blob | null>;
  getSourceThumbnailBlob(maxSize?: number): Promise<Blob | null>;
  /** Decoded raw RGBA of the source (cached as legacy image.data for zero-decode reload). */
  getSourceImageData(): { buffer: ArrayBuffer; width: number; height: number } | null;
  /** Small source sample for analysis; never allocates a full-resolution readback. */
  getSourceAnalysisImageData(maxDimension?: number): {
    imageData: ImageData;
    sourceWidth: number;
    sourceHeight: number;
  } | null;
  /** Source RGBA after Crop & Rotate geometry only, for legacy apply-transformations. */
  getTransformedSourceImageData(): { buffer: ArrayBuffer; width: number; height: number } | null;
  /** Background-compiles the given IDT/ODT combos so switching to them is instant. */
  prewarmColorCombos(combos: ReadonlyArray<{ idtId: string; odtId: string }>): void;
  lutReadbackIs8Bit(): boolean;
  getLUTStatus(): EngineLUTStatus;
  getRendererDebugSnapshot(): RendererDebugSnapshot;
  generateColorMatch(
    reference: ImageBitmap | HTMLImageElement,
    colorMix: number,
    lumaMix: number,
  ): Promise<number[]>;
  setPresentationState(settings: BorderSettings | null): void;
  getVideoElement(): HTMLVideoElement | undefined;
  exportVideo(options: {
    file: File;
    trim: SerializedVideoState;
    container: VideoExportContainer;
    signal?: AbortSignal;
    onProgress?(progress: number): void;
  }): Promise<VideoExportArtifact>;
  getCanvasElement(): HTMLCanvasElement | null;
  getCanvasClientRect(): DOMRect | null;
  clientPointToImageUV(clientX: number, clientY: number): { u: number; v: number } | null;
  clientPointToImageUVClamped(clientX: number, clientY: number): { u: number; v: number } | null;
  clientPointToImageUVUnclamped(clientX: number, clientY: number): { u: number; v: number } | null;
  imageUVToCanvasRelative(u: number, v: number): { x: number; y: number } | null;
  setInteractionLock(locked: boolean): void;
  setColorMaskPreview(preview: ColorMaskPreview | null): void;
  setRadialMaskPreview(preview: RadialMaskPreview | null): void;
  setGradientMaskPreview(preview: GradientMaskPreview | null): void;
  setLuminanceMaskPreview(preview: LuminanceMaskPreview | null): void;
  setDepthMaskPreview(preview: DepthMaskPreview | null): void;
  hasDepthTexture(): boolean;
  setBrushMaskPreview(preview: BrushMaskPreview | null): void;
  readDisplayPixelAtClient(clientX: number, clientY: number, mode?: "smooth"): [number, number, number] | null;
  readDepthPixelAtClient(clientX: number, clientY: number): number | null;
};

/** Cached raw-RGBA source restored on reload (legacy image.data — zero decode). */
export type RestoreImageData = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  fileName: string;
  /** Bumped per restore so re-selecting the same buffer reloads. */
  token: number;
};

type ViewerProps = {
  file?: File;
  /** When set (and newer than the last load), loads cached RGBA instead of decoding a file. */
  imageData?: RestoreImageData;
  editState: EditState;
  /**
   * Transient preview overlay (preset hover): managed look slices merged over the
   * committed editState for the ENGINE only, so the image previews without moving
   * the panel controls. Null = no preview.
   */
  previewLook?: Partial<EditState> | null;
  onImageLoaded(image: ImageInfo): void;
  onViewportChange(viewport: ViewportInfo): void;
  onViewportInteractionChange(active: boolean): void;
  onError(error: string): void;
  onReady(api: ViewerApi): void;
  onLUTStatusChange(status: EngineLUTStatus): void;
  /** Whether the crop overlay is active (controlled by parent). */
  cropEditMode: boolean;
  /** When true, the parent renders its own empty state over the stage. */
  suppressEmptyState?: boolean;
  /** Source width fallback while a cached image is loading. */
  imageWidth?: number;
  onVideoElementChange(video: HTMLVideoElement | undefined): void;
};

export function Viewer(props: ViewerProps) {
  let canvasRef!: HTMLCanvasElement;
  const [engine, setEngine] = createSignal<Engine>();
  const [readyApi, setReadyApi] = createSignal<ViewerApi>();
  let loadedFile: File | undefined;
  let loadedImageDataToken = -1;
  let loadVersion = 0;
  let splitDragging = false;
  const [processedRevision, setProcessedRevision] = createSignal(0);

  onCleanup(() => props.onVideoElementChange(undefined));

  // Re-deliver the existing API when a parent callback is replaced by Vite HMR.
  // Without this, PotoApp can recreate its viewerReadyPromise while Viewer stays
  // mounted, leaving startup permanently at "Opening project...".
  createEffect(() => {
    const api = readyApi();
    const onReady = props.onReady;
    if (api) onReady(api);
  });

  const onPointerDown = (event: PointerEvent) => {
    const instance = engine();
    if (!instance) return;

    // Split-drag takes priority when split is active
    if (instance.isSplitEnabled()) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      splitDragging = true;
      instance.setPanEnabled(false);
      canvasRef.setPointerCapture(event.pointerId);
      const splitX = instance.clientXToSplitPosition(event.clientX);
      instance.setSplitPosition(splitX);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

  };

  const onPointerMove = (event: PointerEvent) => {
    const instance = engine();
    if (!instance) return;

    if (splitDragging) {
      const splitX = instance.clientXToSplitPosition(event.clientX);
      instance.setSplitPosition(splitX);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

  };

  const onPointerUp = (event: PointerEvent) => {
    const instance = engine();

    if (splitDragging) {
      splitDragging = false;
      instance?.setPanEnabled(true);
      if (canvasRef.hasPointerCapture(event.pointerId)) {
        canvasRef.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  };

  const editStateSnapshot = createMemo<EditState>(() => ({
    curve: {
      bypass: props.editState.curve.bypass,
      mode: props.editState.curve.mode,
      points: props.editState.curve.points.map((point) => ({
        x: point.x,
        y: point.y,
      })),
    },
    contrast: {
      amount: props.editState.contrast.amount,
      pivot: props.editState.contrast.pivot,
      enabled: props.editState.contrast.enabled,
      bypass: props.editState.contrast.bypass,
      curve: {
        bypass: props.editState.contrast.curve.bypass,
        mode: props.editState.contrast.curve.mode,
        amount: props.editState.contrast.curve.amount,
        gain: props.editState.contrast.curve.gain,
        parabolaPower: props.editState.contrast.curve.parabolaPower,
        pcurveA: props.editState.contrast.curve.pcurveA,
        pcurveB: props.editState.contrast.curve.pcurveB,
        expImpulseK: props.editState.contrast.curve.expImpulseK,
        cubicPulseCenter: props.editState.contrast.curve.cubicPulseCenter,
        cubicPulseWidth: props.editState.contrast.curve.cubicPulseWidth,
        points: props.editState.contrast.curve.points.map((point) => ({
          x: point.x,
          y: point.y,
        })),
      },
    },
    balance: {
      enabled: props.editState.balance.enabled,
      bypass: props.editState.balance.bypass,
      exposure: props.editState.balance.exposure,
      saturation: props.editState.balance.saturation,
      temperature: props.editState.balance.temperature,
      tint: props.editState.balance.tint,
      red: props.editState.balance.red,
      green: props.editState.balance.green,
      blue: props.editState.balance.blue,
    },
    scattering: {
      enabled: props.editState.scattering.enabled,
      bypass: props.editState.scattering.bypass,
      shadowX: props.editState.scattering.shadowX,
      shadowY: props.editState.scattering.shadowY,
      highlightX: props.editState.scattering.highlightX,
      highlightY: props.editState.scattering.highlightY,
      balance: props.editState.scattering.balance,
      preserveLuminance: props.editState.scattering.preserveLuminance,
    },
    refraction: {
      enabled: props.editState.refraction.enabled,
      bypass: props.editState.refraction.bypass,
      mapVectors: props.editState.refraction.mapVectors.map((v) => v),
      separation: props.editState.refraction.separation,
      preserveLuminance: props.editState.refraction.preserveLuminance,
    },
    saturation: {
      enabled: props.editState.saturation.enabled,
      bypass: props.editState.saturation.bypass,
      curve: {
        mode: props.editState.saturation.curve.mode,
        points: props.editState.saturation.curve.points.map((p) => ({ x: p.x, y: p.y })),
      },
    },
    rgbMixer: {
      enabled: props.editState.rgbMixer.enabled,
      bypass: props.editState.rgbMixer.bypass,
      red: {
        r: props.editState.rgbMixer.red.r,
        g: props.editState.rgbMixer.red.g,
        b: props.editState.rgbMixer.red.b,
      },
      green: {
        r: props.editState.rgbMixer.green.r,
        g: props.editState.rgbMixer.green.g,
        b: props.editState.rgbMixer.green.b,
      },
      blue: {
        r: props.editState.rgbMixer.blue.r,
        g: props.editState.rgbMixer.blue.g,
        b: props.editState.rgbMixer.blue.b,
      },
      preserveLuminance: props.editState.rgbMixer.preserveLuminance,
    },
    densityChroma: {
      enabled: props.editState.densityChroma.enabled,
      bypass: props.editState.densityChroma.bypass,
      densityBypass: props.editState.densityChroma.densityBypass,
      chromaBypass: props.editState.densityChroma.chromaBypass,
      density: {
        mode: props.editState.densityChroma.density.mode,
        points: props.editState.densityChroma.density.points.map((p) => ({ x: p.x, y: p.y })),
      },
      chroma: {
        mode: props.editState.densityChroma.chroma.mode,
        points: props.editState.densityChroma.chroma.points.map((p) => ({ x: p.x, y: p.y })),
      },
    },
    radiance: {
      enabled: props.editState.radiance.enabled,
      bypass: props.editState.radiance.bypass,
      curve: {
        mode: props.editState.radiance.curve.mode,
        points: props.editState.radiance.curve.points.map((p) => ({ x: p.x, y: p.y })),
      },
    },
    tone: {
      enabled: props.editState.tone.enabled,
      bypass: props.editState.tone.bypass,
      curve: {
        mode: props.editState.tone.curve.mode,
        points: props.editState.tone.curve.points.map((p) => ({ x: p.x, y: p.y })),
      },
    },
    shadowHighlight: {
      enabled: props.editState.shadowHighlight.enabled,
      bypass: props.editState.shadowHighlight.bypass,
      blackPoint: [
        props.editState.shadowHighlight.blackPoint[0],
        props.editState.shadowHighlight.blackPoint[1],
        props.editState.shadowHighlight.blackPoint[2],
      ],
      whitePoint: [
        props.editState.shadowHighlight.whitePoint[0],
        props.editState.shadowHighlight.whitePoint[1],
        props.editState.shadowHighlight.whitePoint[2],
      ],
      blackLinked: props.editState.shadowHighlight.blackLinked,
      whiteLinked: props.editState.shadowHighlight.whiteLinked,
    },
    exposure: {
      enabled: props.editState.exposure.enabled,
      bypass: props.editState.exposure.bypass,
      curve: {
        mode: props.editState.exposure.curve.mode,
        points: props.editState.exposure.curve.points.map((p) => ({ x: p.x, y: p.y })),
      },
    },
    preset: {
      enabled: props.editState.preset.enabled,
      bypass: props.editState.preset.bypass,
      selectedPresetId: props.editState.preset.selectedPresetId,
      strength: props.editState.preset.strength,
      preserveUserAdjustments: props.editState.preset.preserveUserAdjustments,
    },
    match: cloneMatchState(props.editState.match),
    grain: {
      enabled: props.editState.grain.enabled,
      bypass: props.editState.grain.bypass,
      amount: props.editState.grain.amount,
      acutance: props.editState.grain.acutance,
      resolution: props.editState.grain.resolution,
      colorAmount: props.editState.grain.colorAmount,
      seed: props.editState.grain.seed,
    },
    halation: {
      enabled: props.editState.halation.enabled,
      bypass: props.editState.halation.bypass,
      amount: props.editState.halation.amount,
      spill: props.editState.halation.spill,
      hue: props.editState.halation.hue,
      saturation: props.editState.halation.saturation,
      quality: props.editState.halation.quality,
    },
    diffusion: {
      enabled: props.editState.diffusion.enabled,
      bypass: props.editState.diffusion.bypass,
      amount: props.editState.diffusion.amount,
      fog: props.editState.diffusion.fog,
      threshold: props.editState.diffusion.threshold,
      focusProtect: props.editState.diffusion.focusProtect,
      centerX: props.editState.diffusion.centerX,
      centerY: props.editState.diffusion.centerY,
      quality: props.editState.diffusion.quality,
    },
    spotlight: {
      enabled: props.editState.spotlight.enabled,
      bypass: props.editState.spotlight.bypass,
      amount: props.editState.spotlight.amount,
      contrast: props.editState.spotlight.contrast,
      bias: props.editState.spotlight.bias,
      focus: props.editState.spotlight.focus,
      centerX: props.editState.spotlight.centerX,
      centerY: props.editState.spotlight.centerY,
    },

    transform: {
      enabled: props.editState.transform.enabled,
      cropEnabled: props.editState.transform.cropEnabled,
      cropX: props.editState.transform.cropX,
      cropY: props.editState.transform.cropY,
      cropWidth: props.editState.transform.cropWidth,
      cropHeight: props.editState.transform.cropHeight,
      aspectRatio: props.editState.transform.aspectRatio,
      orientation: props.editState.transform.orientation,
      straighten: props.editState.transform.straighten,
      flipX: props.editState.transform.flipX,
      flipY: props.editState.transform.flipY,
    },
    distort: {
      enabled: props.editState.distort.enabled,
      distortionAmount: props.editState.distort.distortionAmount,
      distortionHorizontal: props.editState.distort.distortionHorizontal,
      distortionVertical: props.editState.distort.distortionVertical,
      distortionPoints: [...props.editState.distort.distortionPoints],
      distortionMesh: props.editState.distort.distortionMesh
        ? new Float32Array(props.editState.distort.distortionMesh)
        : null,
      perspectiveMode: props.editState.distort.perspectiveMode,
      showGrid: props.editState.distort.showGrid,
      autoCrop: props.editState.distort.autoCrop,
    },
    retouch: cloneRetouchState(props.editState.retouch),
    presentationBorder: clonePresentationBorder(props.editState.presentationBorder),
    colorManagement: {
      enabled: props.editState.colorManagement.enabled,
      inputColorSpace: props.editState.colorManagement.inputColorSpace,
      workingColorSpace: props.editState.colorManagement.workingColorSpace,
      displayColorSpace: props.editState.colorManagement.displayColorSpace,
      viewTransform: props.editState.colorManagement.viewTransform,
      useOutputTransform: props.editState.colorManagement.useOutputTransform,
      useGamutMapping: props.editState.colorManagement.useGamutMapping,
      useAcesPipeline: props.editState.colorManagement.useAcesPipeline,
      inputColorSpaceId: props.editState.colorManagement.inputColorSpaceId,
      displayColorSpaceId: props.editState.colorManagement.displayColorSpaceId,
      toneMapping: {
        enabled: props.editState.colorManagement.toneMapping.enabled,
        exposureBias: props.editState.colorManagement.toneMapping.exposureBias,
        highlightCompression: props.editState.colorManagement.toneMapping.highlightCompression,
        shoulderStrength: props.editState.colorManagement.toneMapping.shoulderStrength,
        blackLift: props.editState.colorManagement.toneMapping.blackLift,
      },
      debugView: props.editState.colorManagement.debugView,
      ocio: {
        selectedConfigId: props.editState.colorManagement.ocio.selectedConfigId,
        inputColorSpaceName: props.editState.colorManagement.ocio.inputColorSpaceName,
        workingColorSpaceName: props.editState.colorManagement.ocio.workingColorSpaceName,
        displayName: props.editState.colorManagement.ocio.displayName,
        viewName: props.editState.colorManagement.ocio.viewName,
        lookName: props.editState.colorManagement.ocio.lookName,
      },
      ocioRuntime: {
        enabled: props.editState.colorManagement.ocioRuntime.enabled,
        mode: props.editState.colorManagement.ocioRuntime.mode,
        selectedConfigId: props.editState.colorManagement.ocioRuntime.selectedConfigId,
        sourceColorSpace: props.editState.colorManagement.ocioRuntime.sourceColorSpace,
        display: props.editState.colorManagement.ocioRuntime.display,
        view: props.editState.colorManagement.ocioRuntime.view,
        look: props.editState.colorManagement.ocioRuntime.look,
        selectedPlanId: props.editState.colorManagement.ocioRuntime.selectedPlanId,
        externalFileRefs: props.editState.colorManagement.ocioRuntime.externalFileRefs.map(
          (ref) => ref,
        ),
        bakedLUTSize: props.editState.colorManagement.ocioRuntime.bakedLUTSize,
        useBakedLUT: props.editState.colorManagement.ocioRuntime.useBakedLUT,
      },
    },
    engineSettings: {
      lutStorageMode: props.editState.engineSettings.lutStorageMode,
    },
    localAdjustments: props.editState.localAdjustments
      ? props.editState.localAdjustments.map(snapshotLocalAdjustmentLayer)
      : [],
    overlays: props.editState.overlays ? props.editState.overlays.map(cloneEditorOverlayLayer) : [],
  }));

  const committedEngineEditState = createMemo<EditState>(() => {
    const snapshot = editStateSnapshot();
    return resolvePresetState(snapshot, allPresets());
  });

  onMount(() => {
    let instance: Engine;
    try {
      instance = new Engine(canvasRef, {
        onViewportChange: (vp) => {
          props.onViewportChange(vp);
        },
        onViewportInteractionChange: props.onViewportInteractionChange,
        onProcessedChange: () => setProcessedRevision((n) => n + 1),
        onLUTStatusChange: props.onLUTStatusChange,
      });
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Unable to initialize renderer");
      return;
    }
    setEngine(instance);

    // Dev-only: expose the engine so the preview harness can read back rendered
    // frames (window.__potoEngine().readScopesFrame(n)) when verifying grading.
    if (import.meta.env.DEV) {
      (window as any).__potoEngine = () => instance;
      (window as any).__potoRendererDebug = () => instance.getRendererDebugSnapshot();
    }

    setReadyApi({
      resetZoom() {
        instance.resetZoom();
      },
      fitToScreen() {
        instance.fitToScreen();
      },
      clearImage() {
        instance.clearImage();
      },
      hasImage() {
        return instance.hasImage();
      },
      cancelImageLoad() {
        loadVersion += 1;
        instance.cancelImageLoad();
      },
      restoreViewport(viewport) {
        instance.restoreViewport(viewport);
      },
      previewEditPatch(patch, reason) {
        instance.previewEditPatch(patch, reason);
      },
      previewCurveInput(input) {
        instance.previewCurveInput(input);
      },
      clearPreviewPatch(reason) {
        instance.clearPreviewPatch(reason);
      },
      setDebugMode(mode) {
        instance.setDebugMode(mode);
      },
      toggleSplit() {
        return instance.toggleSplit();
      },
      isSplitEnabled() {
        return instance.isSplitEnabled();
      },
      setLUTInterpolationMode(mode) {
        instance.setLUTInterpolationMode(mode);
      },
      exportImage(options) {
        return instance.exportImage(options);
      },
      renderExportImage(req) {
        return instance.renderExportImage(req);
      },
      isExportReady() {
        return instance.isExportReady();
      },
      getExportBaseSize() {
        return instance.getExportBaseSize();
      },
      setCropEditMode(active) {
        instance.setCropEditMode(active);
      },
      exportCube(options) {
        return instance.exportCurrentCube(options);
      },
      exportCLF(options) {
        return instance.exportCurrentCLF(options);
      },
      exportLUT(settings) {
        return instance.exportCurrentLUTFile(settings);
      },
      getCurrentGlobalLUTData3D(size) {
        return instance.getCurrentGlobalLUTData3D(size);
      },
      getSourceImageBlob(type, quality) {
        return instance.getSourceImageBlob(type, quality);
      },
      getSourceThumbnailBlob(maxSize) {
        return instance.getSourceThumbnailBlob(maxSize);
      },
      getSourceImageData() {
        return instance.getSourceImageData();
      },
      getSourceAnalysisImageData(maxDimension) {
        return instance.getSourceAnalysisImageData(maxDimension);
      },
      getTransformedSourceImageData() {
        return instance.getTransformedSourceImageData();
      },
      prewarmColorCombos(combos) {
        instance.prewarmColorCombos(combos);
      },
      lutReadbackIs8Bit() {
        return instance.lutReadbackIs8Bit;
      },
      getLUTStatus() {
        return instance.getLUTStatus();
      },
      getRendererDebugSnapshot() {
        return instance.getRendererDebugSnapshot();
      },
      generateColorMatch(reference, colorMix, lumaMix) {
        return instance.generateColorMatch(reference, colorMix, lumaMix);
      },
      setPresentationState(settings) {
        instance.setPresentationState(settings);
      },
      getVideoElement() {
        return instance.getVideoElement();
      },
      async exportVideo(options) {
        const video = instance.getVideoElement();
        if (!video) throw new Error("No video loaded");
        const { exportGradedVideo } = await import("../video/exportVideo");
        return exportGradedVideo({
          ...options,
          renderFrame: (source, sourceWidth, sourceHeight, canvas) =>
            instance.renderDecodedVideoFrame(source, sourceWidth, sourceHeight, canvas),
        });
      },
      getCanvasElement() {
        return canvasRef ?? null;
      },
      getCanvasClientRect() {
        return canvasRef ? canvasRef.getBoundingClientRect() : null;
      },
      clientPointToImageUV(clientX, clientY) {
        return instance.clientPointToImageUV(clientX, clientY);
      },
      clientPointToImageUVClamped(clientX, clientY) {
        return instance.clientPointToImageUVClamped(clientX, clientY);
      },
      clientPointToImageUVUnclamped(clientX, clientY) {
        return instance.clientPointToImageUVUnclamped(clientX, clientY);
      },
      imageUVToCanvasRelative(u, v) {
        return instance.imageUVToCanvasRelative(u, v);
      },
      setInteractionLock(locked) {
        instance.setPanEnabled(!locked);
      },
      setColorMaskPreview(preview) {
        instance.setColorMaskPreview(preview);
      },
      setRadialMaskPreview(preview) {
        instance.setRadialMaskPreview(preview);
      },
      setGradientMaskPreview(preview) {
        instance.setGradientMaskPreview(preview);
      },
      setLuminanceMaskPreview(preview) {
        instance.setLuminanceMaskPreview(preview);
      },
      setDepthMaskPreview(preview) {
        instance.setDepthMaskPreview(preview);
      },
      hasDepthTexture() {
        return instance.hasDepthTexture();
      },
      setBrushMaskPreview(preview) {
        instance.setBrushMaskPreview(preview);
      },
      readDisplayPixelAtClient(clientX, clientY, mode) {
        return instance.readDisplayPixelAtClient(clientX, clientY, mode);
      },
      readDepthPixelAtClient(clientX, clientY) {
        return instance.readDepthPixelAtClient(clientX, clientY);
      },
    });

    onCleanup(() => {
      instance.dispose();
      setReadyApi(undefined);
      setEngine(undefined);
    });
  });

  createEffect(() => {
    const state = committedEngineEditState();
    const instance = engine();

    if (!instance) {
      return;
    }

    instance.updateEditState(state);
  });

  let previewLookActive = false;
  let previewLookFrame = 0;
  let pendingPreviewLook: Partial<EditState> | null = null;

  function schedulePreviewLook(preview: Partial<EditState>) {
    pendingPreviewLook = preview;

    if (previewLookFrame) return;

    previewLookFrame = requestAnimationFrame(() => {
      previewLookFrame = 0;

      const next = pendingPreviewLook;
      pendingPreviewLook = null;

      const instance = engine();
      if (!instance || !next) return;

      // Legacy preset transmit data is already resolved into concrete managed
      // slices. Running it through the modern preset resolver again can replace
      // the generated cell with the currently selected modern preset.
      instance.previewEditPatch(next, "preset-transmit-preview");
      previewLookActive = true;
    });
  }

  function clearScheduledPreviewLook(instance: Engine, reason = "preset-hover-clear") {
    if (previewLookFrame) {
      cancelAnimationFrame(previewLookFrame);
      previewLookFrame = 0;
    }

    pendingPreviewLook = null;

    if (previewLookActive) {
      instance.clearPreviewPatch(reason);
      previewLookActive = false;
    }
  }

  onCleanup(() => {
    if (previewLookFrame) cancelAnimationFrame(previewLookFrame);
    previewLookFrame = 0;
    pendingPreviewLook = null;
  });

  createEffect(() => {
    const instance = engine();
    const preview = props.previewLook;

    if (!instance) {
      if (previewLookFrame) {
        cancelAnimationFrame(previewLookFrame);
        previewLookFrame = 0;
      }
      pendingPreviewLook = null;
      return;
    }

    if (preview) {
      schedulePreviewLook(preview);
      return;
    }

    clearScheduledPreviewLook(instance);
  });

  // Sync crop-edit mode with engine whenever the prop changes
  createEffect(() => {
    engine()?.setCropEditMode(props.cropEditMode);
  });

  createEffect(() => {
    const file = props.file;
    const currentEngine = engine();

    if (!file || !currentEngine || file === loadedFile) {
      return;
    }

    loadedFile = file;
    const version = ++loadVersion;
    const video = isVideoFile(file);
    // Drop the trim transport up front when switching to a still image so it
    // never lingers over the new photo while it decodes.
    if (!video) props.onVideoElementChange(undefined);
    currentEngine[video ? "loadVideo" : "loadImage"](file)
      .then((image) => {
        if (version === loadVersion) {
          const element = currentEngine.getVideoElement();
          untrack(() => props.onVideoElementChange(element));
          untrack(() => props.onImageLoaded(image));
        }
      })
      .catch((error: unknown) => {
        if (version === loadVersion) {
          untrack(() => props.onError(error instanceof Error ? error.message : "Unable to load image"));
        }
      });
  });

  // Cached raw-RGBA restore path (legacy image.data): uploads straight to a texture
  // with no decode. Shares loadVersion with the file path so loads can't race.
  createEffect(() => {
    const data = props.imageData;
    const currentEngine = engine();

    if (!data || !currentEngine || data.token === loadedImageDataToken) {
      return;
    }

    loadedImageDataToken = data.token;
    props.onVideoElementChange(undefined);
    loadedFile = undefined; // a file load after this must re-run
    const version = ++loadVersion;
    currentEngine
      .loadImageData({ buffer: data.buffer, width: data.width, height: data.height }, data.fileName)
      .then((image) => {
        if (version === loadVersion) {
          untrack(() => props.onImageLoaded(image));
        }
      })
      .catch((error: unknown) => {
        if (version === loadVersion) {
          untrack(() => props.onError(error instanceof Error ? error.message : "Unable to load image"));
        }
      });
  });

  const hasLoadedImage = () => !!props.file || !!props.imageData || !!props.imageWidth;
  const viewerStyle = `position: relative; --viewer-background-color: ${VIEWER_BACKGROUND_COLOR}; --viewer-empty-background-color: ${VIEWER_EMPTY_BACKGROUND_COLOR};`;

  return (
    <section class="viewer" aria-label="Image viewer" style={viewerStyle}>
      <canvas
        ref={canvasRef}
        class="viewer__canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={preventNativeDefault}
        onTouchStart={preventNativeDefault}
      />
      {!hasLoadedImage() && !props.suppressEmptyState && (
        <div class="viewer__empty">
          <div class="viewer__empty-panel">
            <div class="viewer__empty-title">No image loaded</div>
            <div class="viewer__empty-copy">Upload an image to start shader preview.</div>
          </div>
        </div>
      )}
      <Show when={scopesState.visible}>
        <Portal>
          <ScopesWindow
            readFrame={(sampleSize) => engine()?.readScopesFrame(sampleSize) ?? null}
            revision={processedRevision}
          />
        </Portal>
      </Show>
    </section>
  );
}
