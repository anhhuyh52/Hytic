// Editor-only stylesheets. Kept out of the eager app bundle so they ship with
// this lazy chunk and never block the application shell's first paint. Vite loads
// the emitted CSS before this module executes, so the editor still mounts styled.
import "../styles/editor-overlays.css";
import "../styles/poto-controls.css";
import "../styles/poto-preset-library.css";
import "../styles/poto-masking.css";
import "../styles/poto-overlays.css";
import { MaskingPanel } from "./masking/MaskingPanel";
import { ColorPickMaskOverlay } from "./masking/ColorPickMaskOverlay";
import { RadialMaskOverlay } from "./masking/RadialMaskOverlay";
import { GradientMaskOverlay } from "./masking/GradientMaskOverlay";
import { BrushMaskOverlay } from "./masking/BrushMaskOverlay";
import { overlayActive, setOverlayActive, selectedMaskId, setSelectedMaskId, overlayAlwaysOn, setOverlayAlwaysOn, selectedMaskComponentType } from "./masking/maskingStore";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import { Portal } from "solid-js/web";
import { reconcile } from "solid-js/store";
import toast from "solid-toast";
import {
  createEditorStore,
  editState,
  setEditState,
  setScopesState,
  type ImageInfo,
  type ViewportInfo,
} from "../app/editor-store";
import * as perf from "../app/performanceCounters";
import { Aside } from "./Aside";
import type { PanelKey } from "./panels";
import { ViewportOverlay } from "./ViewportOverlay";
import { FxCenterOverlay } from "./overlays/FxCenterOverlay";
import { SpotRetouchOverlay } from "../features/retouch/SpotRetouchOverlay";
import {
  setSelectedSpot as setSelectedRetouchSpot,
  setViewportMetrics as setRetouchViewportMetrics,
} from "../features/retouch/retouchStore";
import { cloneRetouchSpot } from "../features/retouch/retouchTypes";
import { FileLoadProgress, type FileLoadProgressStatus } from "./FileLoadProgress";
import {
  isSupportedImageFile,
  getUnsupportedImageMessage,
  detectImageFormat,
} from "../engine/io/CodecRegistry";
import { shouldUseImageDecodeWorker } from "../engine/io/ImageDecodeProtocol";
import {
  EditorOverlays,
  type EditorOverlayKind,
  type MediaGridOptions,
  type MediaMetadataView,
} from "./overlays/EditorOverlays";
import {
  buildMediaEditPatch,
  mergeMediaEditPatch,
  type MediaEditModuleKey,
  type MediaEditPatch,
} from "./mediaEditPatch";
import { resolvePostImportSelection } from "./importWorkflow";
import {
  executeBatchEdit,
  recoverBatchJournals,
  undoBatchEdit,
  type BatchEditPersistence,
} from "../project/batchEdit";
import { cloneJson, cloneSerializedState } from "./jsonState";
import type { CropSourceData } from "./cropSourceTypes";

import { previewLook } from "./presetPacksStore";
import type { ViewerApi } from "../ui/Viewer";
import {
  applyEditorOverlayLayerPatch,
  cloneEditorOverlayLayer,
  createEditorOverlayLayer,
  serializeEditorOverlayLayer,
  type EditorOverlayLayer,
  type EditorOverlayLayerPatch,
  type EditorOverlayMask,
  type GradientOverlayLayer,
} from "../features/overlays/editorOverlayTypes";
import {
  createEditorGradientDataUrl,
  createEditorGradientOverlayLayer,
  getGradientPresetFromSourceId,
} from "../features/overlays/editorGradientOverlays";
import { createOverlayId } from "../features/overlays/overlayIds";
import { updateOverlayMaskByOwner } from "../features/masking/maskOwner";
import { getDepthMaskCapability, getDepthUnavailableMessage } from "../features/masking/depthMaskCapability";
import { calculateAutoEnhance } from "../features/auto-enhance/autoEnhance";
import { readImageDimensions } from "../features/overlays/overlayImport";
import "../features/overlays/mathCopySign";
import { OverlayTransformOverlay } from "./overlays/OverlayTransformOverlay";
import { LinearGradientTransformOverlay } from "./overlays/LinearGradientTransformOverlay";
import { RadialTransformOverlay } from "./overlays/RadialTransformOverlay";
import { GradientPicker } from "./overlays/GradientPicker";
import { BorderEditorWindow } from "./overlays/BorderEditorWindow";
import { OverlayPanel } from "./overlays/OverlayPanel";
import { OverlayDepthMaskToolbar } from "./overlays/OverlayDepthMaskToolbar";
import { createOverlayMask, type OverlayMaskType } from "./overlays/overlayMaskFactory";
import { ContextMenu, openContextMenu, type ContextMenuState } from "./controls/ContextMenu";
import { InputSelector, OutputSelector } from "./controls/ColorSpaceSelectors";
// Lazy-loaded so three.js + the whole render engine (the bulk of the bundle) are
// split into their own chunk and don't block first paint (the shell + start
// screen render immediately; the viewer chunk streams in behind them).
type ViewerModule = typeof import("../ui/Viewer");
let viewerModulePromise: Promise<ViewerModule> | undefined;

function loadViewerModule(): Promise<ViewerModule> {
  if (!viewerModulePromise) {
    viewerModulePromise = import("../ui/Viewer").catch((error) => {
      viewerModulePromise = undefined;
      throw error;
    });
  }
  return viewerModulePromise;
}

export function preloadViewer(): Promise<void> {
  return loadViewerModule().then(() => undefined);
}

const Viewer = lazy(() => loadViewerModule().then((m) => ({ default: m.Viewer })));

// Viewport-action UI stays in the editor chunk so clicking a visible control is
// synchronous. Only heavyweight runtimes/codecs are deferred; suspending these
// components after changing overlay state causes a visible black frame.
import { PresetEditor } from "./overlays/PresetEditor";
import { PresetGenerator } from "./overlays/PresetGenerator";
import "./applyPreset"; // registers the legacy preset converter (+ dev hook)
import { exportState } from "./exportStore";
import {
  isPresentationBorderVisible,
  type PresentationBorderSettings,
} from "../features/presentation/border/borderTypes";
import { applyPresentationBorderToBlob } from "../features/presentation/export/applyPresentationBorder";
import { toBorderSettings } from "../features/presentation/presentationBridge";
import {
  batchDateStamp,
  openBatchExportWriter,
  sanitizeFileName,
  saveBlob,
  type SingleExportWriter,
  withSingleExtension,
} from "./exportFile";
import { fitLongEdge, legacyMaxSafeExportSize, sizeByLongEdge } from "./exportPresets";
import { copyJpegExif, readExif } from "../engine/io/ExifMetadata";
import type { ExportImageRequest } from "../engine/passes/ExportPass";
import type { RelayReceiveSession } from "../relay/receiveSession";
import {
  DEFAULT_EDIT_STATE,
  DEFAULT_TRANSFORM_STATE,
  type EditState,
  type TransformState,
  type CurvePreviewInput,
} from "../engine/state/EditState";
import {
  MAX_ANALYSIS_DIM,
  boundsAreFullFrame,
  contentBoundsToCropRect,
  detectContentBoundsForImage,
  detectContentBoundsForVideo,
  type ContentBounds,
} from "../engine/analysis/contentBounds";
import type { CropGuideMode } from "../ui/transform/CropOverlay";

import * as appSessionStore from "../project/appSessionStore";
import * as projectStore from "../project/projectStore";
import * as mediaStore from "../project/mediaStore";
import type { AddMediaParams } from "../project/mediaStore";
import type {
  BatchEditJournal,
  MediaRecord,
  MediaImageStorage,
  MediaSummary,
  MediaVersionSnapshot,
  SerializedEditState,
} from "../project/ProjectTypes";
import type { RestoreImageData } from "../ui/Viewer";
import {
  isBooting,
  setIsBooting,
  activeProjectId,
  setActiveProjectId,
  setActiveProjectName,
  activeAssetId,
  setActiveAssetId,
  mediaList,
  setMediaListProvider,
  refreshMediaList,
} from "./sessionController";
import { serializeEditState, toPlainSerializedEditState } from "../project/serializeEditState";
import { deserializeEditState } from "../project/deserializeEditState";
import { allPresets } from "../engine/presets/CustomPresetStore";
import { downloadBlob, slugify } from "../ui/util/downloadBlob";
import { HistoryTimeline } from "./HistoryTimeline";
import { createHistoryController } from "./historyController";
import { UndoRedo } from "./UndoRedo";
// import { SideMenu } from "./SideMenu";
import { Popover } from "./controls/Popover";
import { LOCAL_WORKSPACE_ID } from "../project/localWorkspace";
import type { EditorFeature } from "../features/editorCapabilities";
import { navigateToGallery } from "../domains";
import * as storageBridge from "../project/storage/storageBridge";
import type { MediaContext as StorageMediaContext } from "../project/storage/mediaStore";
import { saveMatchReferenceFile } from "../project/matchReferenceStore";
import { createProjectRepository } from "../project/projectRepository";
import { installAppContextMenuGuards } from "./contextMenuGuards";
import {
  clampVideoTrim,
  isVideoFile,
  type SerializedVideoState,
  type VideoTrimCommit,
} from "../video/types";
import { extractVideoFrameFile } from "../engine/io/videoFrame";
import {
  convertToMp4,
  needsMp4Normalization,
  UnconvertibleVideoError,
} from "../video/transcodeToMp4";
import { UNSUPPORTED_VIDEO_CODEC_MESSAGE } from "../video/probeVideo";
import { VideoTrimTimeline } from "../video/VideoTrimTimeline";
import {
  createImageDerivative,
  createImageDerivatives,
  GALLERY_PREVIEW_JPEG_QUALITY,
  GALLERY_PREVIEW_LONG_EDGE,
} from "../project/imageDerivatives";

type ImportedMediaRef = { assetId: string };



export type PotoStartupState = {
  shellReady: boolean;
  ready: boolean;
  hasImage: boolean;
  loadingImage: boolean;
};

type PreparedOpfsBoot = Awaited<ReturnType<typeof storageBridge.prepareOpfsBoot>>;

type PotoAppProps = {
  onStartupStateChange?: (state: PotoStartupState) => void;
};

export function PotoApp(props: PotoAppProps = {}) {
  let appRootRef!: HTMLElement;
  const projectRepository = createProjectRepository();
  const opfsPersistence = projectRepository.kind === "opfs";
  const useOpfsPersistence = () => opfsPersistence;
  const [state, actions] = createEditorStore();
  const historyController = createHistoryController({
    getProjectId: activeProjectId,
    getActiveAssetId: activeAssetId,
    applyState(serialized) {
      setEditState(reconcile(deserializeEditState(serialized)));
    },
    createId: generateRuntimeId,
  });
  const historyEntries = historyController.entries;
  const historyIndex = historyController.index;
  type StartupPhase = "shell" | "booting" | "ready" | "error";
  const [startupPhase, setStartupPhase] = createSignal<StartupPhase>("shell");
  const [shellReady, setShellReady] = createSignal(false);
  const [ready, setReady] = createSignal(false);
  const [booting, setBooting] = createSignal(true);
  const [hasImage, setHasImage] = createSignal(false);

  const [overlayUrls, setOverlayUrls] = createSignal<Record<string, string>>({});
  createEffect(() => {
    const overlays = editState.overlays;
    for (const layer of overlays) {
      if (layer.type !== "image") continue;
      const gradientPreset = getGradientPresetFromSourceId(layer.sourceId);
      if (gradientPreset) {
        const sourceDataUrl = createEditorGradientDataUrl(gradientPreset.id);
        if (sourceDataUrl && sourceDataUrl !== layer.sourceDataUrl) {
          setEditState("overlays", (layers) => layers.map((item) =>
            item.id === layer.id && item.type === "image" ? { ...item, sourceDataUrl } : item,
          ));
        }
      }
    }
    const activeMediaName = activeAssetId();
    if (!activeMediaName) return;
    const currentUrls = overlayUrls();
    const nextUrls = { ...currentUrls };
    let changed = false;

    const currentIds = new Set(overlays.map((l) => l.id));
    for (const [id, url] of Object.entries(currentUrls)) {
      if (!currentIds.has(id)) {
        if (url !== "loading") URL.revokeObjectURL(url);
        delete nextUrls[id];
        changed = true;
      }
    }

    for (const layer of overlays) {
      if (layer.type !== "image") continue;
      if (getGradientPresetFromSourceId(layer.sourceId)) continue;
      if (!layer.sourceDataUrl && !nextUrls[layer.id] && layer.sourceId && layer.sourceId !== "legacy") {
        nextUrls[layer.id] = "loading";
        changed = true;
        const loadImage = useOpfsPersistence()
          ? storageBridge.loadOverlayImageForMedia(activeMediaName, layer.sourceId)
          : mediaStore.getOverlayImage(activeMediaName, layer.sourceId);
        loadImage.then((blob) => {
          if (activeAssetId() !== activeMediaName) return;
          const currentLayer = editState.overlays.find((item) => item.id === layer.id);
          if (!currentLayer || currentLayer.type !== "image" || currentLayer.sourceId !== layer.sourceId) return;
          if (blob) {
            const url = URL.createObjectURL(blob);
            setOverlayUrls((urls) => ({ ...urls, [layer.id]: url }));
            setEditState("overlays", (layers) => layers.map((item) =>
              item.id === layer.id && item.type === "image" ? { ...item, sourceDataUrl: url } : item,
            ));
          } else {
            setOverlayUrls((urls) => {
              const next = { ...urls };
              delete next[layer.id];
              return next;
            });
          }
        });
      }
    }

    if (changed) setOverlayUrls(nextUrls);
  });
  const [loadingImage, setLoadingImage] = createSignal(false);
  const [autoEnhancing, setAutoEnhancing] = createSignal(false);
  const [activeOverlay, setActiveOverlay] = createSignal<EditorOverlayKind | null>(null);
  const [activeAdjustmentPanel, setActiveAdjustmentPanel] = createSignal<PanelKey | null>("match");
  createEffect(() => {
    setRetouchViewportMetrics({
      imageWidth: state.image?.width ?? 1,
      imageHeight: state.image?.height ?? 1,
      zoom: state.viewport.zoom,
      cropWidth: editState.transform.cropEnabled ? editState.transform.cropWidth : 1,
      cropHeight: editState.transform.cropEnabled ? editState.transform.cropHeight : 1,
    });
  });
  const [selectedOverlayLayerId, setSelectedOverlayLayerId] = createSignal<string | null>(null);
  const [gradientPickerLayerId, setGradientPickerLayerId] = createSignal<string | null>(null);
  const [viewerInteractionActive, setViewerInteractionActive] = createSignal(false);
  const [overlayContextMenu, setOverlayContextMenu] = createSignal<ContextMenuState | null>(null);
  const [overlayDraftActive, setOverlayDraftActive] = createSignal(false);
  const [overlayEditMode, setOverlayEditMode] = createSignal<"transform" | "mask">("transform");
  const [overlayDraftLayers, setOverlayDraftLayers] = createSignal<EditorOverlayLayer[] | null>(null);
  let overlayDraftSelectedLayerId: string | null = null;
  let overlayDraftHistorySnapshots: Array<{ state: SerializedEditState; label: string }> = [];
  const pendingOverlayFiles = new Map<string, { file: File | Blob; url: string }>();
  const [maskingMode, setMaskingMode] = createSignal(false);
  const [maskingDraftActive, setMaskingDraftActive] = createSignal(false);
  let maskingDraftSnapshot: SerializedEditState | null = null;

  function clearMaskingDraftUi() {
    batch(() => {
      setSelectedMaskId(null);
      setOverlayActive(false);
      setOverlayAlwaysOn(false);
    });
    window.setTimeout(() => clearScheduledPreviewRender("masking-draft-finished"), 0);
    clearMaskPreviews();
  }

  function beginMaskingDraft() {
    if (maskingDraftActive()) return;
    clearTimeout(autosaveTimer);
    historyController.cancelPending();
    maskingDraftSnapshot = cloneSerializedState(currentSerializedEditState());
    const assetId = activeAssetId();
    if (assetId) pushHistoryState(assetId, maskingDraftSnapshot);
    setMaskingDraftActive(true);
  }

  function applyMaskingDraft() {
    if (!maskingDraftActive()) return;
    const assetId = activeAssetId();
    const serialized = cloneSerializedState(currentSerializedEditState());
    maskingDraftSnapshot = null;
    setMaskingDraftActive(false);
    clearMaskingDraftUi();
    if (assetId) {
      pushHistoryState(assetId, serialized);
      void runAutosave();
    }
  }

  function cancelMaskingDraft() {
    if (!maskingDraftActive()) return;
    const snapshot = maskingDraftSnapshot;
    maskingDraftSnapshot = null;
    batch(() => {
      if (snapshot) setEditState(reconcile(deserializeEditState(snapshot)));
      setMaskingDraftActive(false);
    });
    clearMaskingDraftUi();
  }

const exitMaskingMode = () => {
  batch(() => {
    setMaskingMode(false);
    setSelectedMaskId(null);
    setOverlayActive(false);
    setOverlayAlwaysOn(false);
  });

  clearMaskPreviews();
};

const [relaySession, setRelaySession] = createSignal<RelayReceiveSession | null>(null);
  const [relayOverlayMode, setRelayOverlayMode] = createSignal<"receive" | "send">("receive");
  const [borderOverlayAnchor, setBorderOverlayAnchor] = createSignal<HTMLElement | null>(null);
  const [borderEditorVisible, setBorderEditorVisible] = createSignal(false);

  const shouldShowEditorOverlays = createMemo(() => {
    const overlay = activeOverlay();
    return (
      !!overlay && overlay !== "overlays" &&
      (overlay === "projects" || overlay === "relay" || !!state.image)
    );
  });
  const [cropEditMode, setCropEditMode] = createSignal(false);
  const [cropPreviewPainted, setCropPreviewPainted] = createSignal(false);
  const [cropGuideMode, setCropGuideMode] = createSignal<CropGuideMode>("thirds");
  const [cropSourceData, setCropSourceData] = createSignal<CropSourceData | undefined>();
  const [cropBusyLabel, setCropBusyLabel] = createSignal("Loading Original File...");
  // True while the rotation slider is dragged (legacy temporary grid overlay).
  const [cropRotateActive, setCropRotateActive] = createSignal(false);
  const [splitActive, setSplitActive] = createSignal(false);
  const [projectName, setProjectName] = createSignal("Hytic");
  const [currentProjectId, setCurrentProjectId] = createSignal<string | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [mediaSwitching, setMediaSwitching] = createSignal(false);
  const [cropApplying, setCropApplying] = createSignal(false);
  const [flatteningAssetId, setFlatteningAssetId] = createSignal<string | null>(null);
  const [lastBatchJournal, setLastBatchJournal] = createSignal<BatchEditJournal | null>(null);
  const [lutIs8Bit, setLutIs8Bit] = createSignal(false);
  const [versionSnapshots, setVersionSnapshots] = createSignal<MediaVersionSnapshot[]>([]);
  const [videoState, setVideoState] = createSignal<SerializedVideoState>();
  const [videoElement, setVideoElement] = createSignal<HTMLVideoElement>();
  const [videoHistory, setVideoHistory] = createSignal<SerializedVideoState[]>([]);
  const [videoHistoryIndex, setVideoHistoryIndex] = createSignal(-1);
  const [videoExportProgress, setVideoExportProgress] = createSignal<number | null>(null);
  let videoExportController: AbortController | undefined;
  // On video import we ask whether to edit the whole clip or grab a single frame.
  type VideoImportMode = "video" | "frame";
  const [videoImportPrompt, setVideoImportPrompt] = createSignal<{
    name: string;
    previewUrl: string;
  } | null>(null);
  let videoImportResolve: ((mode: VideoImportMode | null) => void) | null = null;
  // Shown when an imported clip uses a codec the browser can't decode (e.g. ProRes),
  // listing the formats Hytic does support instead of a terse error toast.
  const [unsupportedVideoPrompt, setUnsupportedVideoPrompt] = createSignal<{
    name: string;
  } | null>(null);
  const [editClipboard, setEditClipboard] = createSignal<MediaEditPatch | null>(null);
  const [importQueueSize, setImportQueueSize] = createSignal(0);
  const [importErrors, setImportErrors] = createSignal<string[]>([]);
  // Batch-import progress (legacy file-load-progress toast).
  const [progressTotal, setProgressTotal] = createSignal(0);
  const [progressIndex, setProgressIndex] = createSignal(0);
  const [progressStatus, setProgressStatus] = createSignal<FileLoadProgressStatus>("idle");
  const [progressInfo, setProgressInfo] = createSignal("");
  type ImageImportProgressStage =
    | "preparing"
    | "decoding"
    | "derivatives"
    | "writing"
    | "finalizing";
  const importStageLabel: Record<ImageImportProgressStage, string> = {
    preparing: "Preparing",
    decoding: "Decoding",
    derivatives: "Building previews for",
    writing: "Saving",
    finalizing: "Finishing",
  };
  const reportImportStage = (file: File, stage: ImageImportProgressStage) => {
    setProgressInfo(`${importStageLabel[stage]} ${file.name}…`);
  };
  let progressHideTimer = 0;
  const progressActive = createMemo(() => progressStatus() !== "idle");
  const progressTitle = createMemo(() => {
    switch (progressStatus()) {
      case "success":
        return "Import complete";
      case "error":
        return "Import failed";
      case "partial":
        return "Import with errors";
      default: {
        const total = progressTotal();
        return `Importing ${Math.min(progressIndex(), total)}/${total}`;
      }
    }
  });
  const [projectThumbUrl, setProjectThumbUrl] = createSignal<string | null>(null);


  onMount(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const ua = nav.userAgent.toLowerCase();
    const isIos =
      /iphone|ipad|ipod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    const isAndroid = /android/i.test(nav.userAgent);
    const isStandalone =
      typeof nav.standalone === "boolean"
        ? nav.standalone
        : window.matchMedia("(display-mode: standalone)").matches;
    appRootRef.toggleAttribute("data-ios", isIos);
    appRootRef.toggleAttribute("data-android", isAndroid);
    appRootRef.toggleAttribute("data-standalone", isStandalone);
    const cleanup = installAppContextMenuGuards(appRootRef);
    onCleanup(cleanup);
  });

  let viewerApi: ViewerApi | undefined;

  function clearMaskPreviews(): void {
    viewerApi?.setColorMaskPreview(null);
    viewerApi?.setRadialMaskPreview(null);
    viewerApi?.setGradientMaskPreview(null);
    viewerApi?.setBrushMaskPreview(null);
    viewerApi?.setLuminanceMaskPreview(null);
    viewerApi?.setDepthMaskPreview(null);
  }

  let resolveViewerReady: (() => void) | undefined;
  const viewerReadyPromise = new Promise<void>((resolve) => {
    resolveViewerReady = resolve;
  });

  createEffect(() => {
    const border = editState.presentationBorder;
    if (!viewerApi) return;
    if (isPresentationBorderVisible(border)) {
      viewerApi.setPresentationState(toBorderSettings(border));
    } else {
      viewerApi.setPresentationState(null);
    }
  });

  function getSelectedMaskPreviewComponent(expectedType: string) {
    const api = viewerApi;
    const isMaskingMode = maskingMode();
    const maskId = selectedMaskId();
    const isOverlayActive = overlayActive() || overlayAlwaysOn();
    const componentType = selectedMaskComponentType();

    if (!api || !isMaskingMode || !maskId || !isOverlayActive || componentType !== expectedType || !editState.localAdjustments) {
      return null;
    }

    const idx = editState.localAdjustments.findIndex((m) => m.id === maskId);
    if (idx === -1) return null;

    const draft = editState.localAdjustments[idx].components[0] as any;
    if (!draft || draft.type !== expectedType) return null;

    return { api, maskId, draft };
  }

  createEffect(() => {
    const preview = getSelectedMaskPreviewComponent("color-pick");

    if (!preview || !preview.draft.sampledColor) {
      viewerApi?.setColorMaskPreview(null);
      return;
    }

    const { api, draft } = preview;

    api.setColorMaskPreview({
      enabled: true,
      sampleX: draft.sampleX,
      sampleY: draft.sampleY,
      position: draft.position,
      size: draft.size,
      angle: draft.angle,
      useRadius: draft.useRadius,
      selectedColor: draft.selectedColor ?? draft.sampledColor,
      useSelectedColor: draft.useSelectedColor,
      threshold: draft.threshold,
      feather: draft.feather,
      invert: draft.invert,
      opacity: draft.opacity ?? 1,
      alpha: draft.alpha ?? 1,
      overlayColor: [1, 0, 0],
      overlayOpacity: 0.38,
    });
  });

  // Radial mask preview — drives RadialMaskPass + MaskOverlayPass in Engine.
  createEffect(() => {
    const preview = getSelectedMaskPreviewComponent("radial");

    if (!preview) {
      viewerApi?.setRadialMaskPreview(null);
      return;
    }

    const { api, draft } = preview;

    api.setRadialMaskPreview({
      enabled: true,
      position: draft.position,
      size: draft.size,
      angle: draft.angle,
      feather: draft.feather,
      invert: draft.invert,
      opacity: draft.opacity ?? 1,
      alpha: draft.alpha ?? 1,
      overlayColor: [1, 0, 0],
      overlayOpacity: 0.38,
    });
  });

  // Gradient mask preview
  createEffect(() => {
    const preview = getSelectedMaskPreviewComponent("gradient");

    if (!preview) {
      viewerApi?.setGradientMaskPreview(null);
      return;
    }

    const { api, draft } = preview;

    api.setGradientMaskPreview({
      enabled: true,
      startPoint: (draft as any).startPoint,
      endPoint: (draft as any).endPoint,
      reflect: (draft as any).reflect,
      invert: draft.invert,
      opacity: draft.opacity ?? 1,
      alpha: draft.alpha ?? 1,
      overlayColor: [1, 0, 0],
      overlayOpacity: 0.38,
    });
  });

  // Brush mask preview — drives BrushMaskTexturePass + BrushMaskPass + MaskOverlayPass in Engine.
  createEffect(() => {
    const preview = getSelectedMaskPreviewComponent("brush");

    if (!preview) {
      viewerApi?.setBrushMaskPreview(null);
      return;
    }

    const { api, maskId, draft } = preview;

    api.setBrushMaskPreview({
      enabled:        true,
      maskId,
      component:      draft as import("../engine/state/EditState").BrushMaskComponent,
      liveStroke:     null,
      overlayColor:   [1, 0, 0],
      overlayOpacity: 0.38,
    });
  });

  // Luminance mask preview — drives LuminanceMaskPass + MaskOverlayPass in Engine.
  createEffect(() => {
    const preview = getSelectedMaskPreviewComponent("luminance");

    if (!preview) {
      viewerApi?.setLuminanceMaskPreview(null);
      return;
    }

    const { api, draft } = preview;

    // Show overlay if explicitly set or during slider drag (showOverlay becomes true).
    const showOverlay = (draft as any).showOverlay ?? false;
    if (!showOverlay) {
      api.setLuminanceMaskPreview(null);
      return;
    }

    api.setLuminanceMaskPreview({
      enabled:        true,
      target:         (draft as any).target ?? 1,
      range:          (draft as any).range ?? 0.7,
      smoothness:     (draft as any).smoothness ?? 1,
      invert:         draft.invert ?? false,
      opacity:        draft.opacity ?? 1,
      alpha:          draft.alpha ?? 1,
      overlayColor:   [1, 0, 0],
      overlayOpacity: 0.38,
    });
  });

  // Depth mask preview — drives DepthMaskPass + MaskOverlayPass in Engine.
  createEffect(() => {
    const preview = getSelectedMaskPreviewComponent("depth");

    if (!preview) {
      viewerApi?.setDepthMaskPreview(null);
      return;
    }

    const { api, draft } = preview;

    const showOverlay = (draft as any).showOverlay ?? false;
    if (!showOverlay) {
      api.setDepthMaskPreview(null);
      return;
    }

    api.setDepthMaskPreview({
      enabled:        true,
      target:         (draft as any).target ?? 1,
      range:          (draft as any).range ?? 0.25,
      invert:         draft.invert ?? false,
      opacity:        draft.opacity ?? 1,
      alpha:          draft.alpha ?? 1,
      overlayColor:   [1, 0, 0],
      overlayOpacity: 0.38,
    });
  });

  // Overlay-owned masks use the same red preview passes, but never enter the
  // local-adjustment LUT pipeline. Cleanup is registered inside the effect so
  // changing layer, mask type, edit mode, Apply, Cancel, or closing the panel
  // cannot leave a stale red preview on the canvas.
  createEffect(() => {
    if (overlayEditMode() !== "mask") {
      clearMaskPreviews();
      return;
    }

    const mask = overlayDraftLayers()?.find(
      (layer) => layer.id === selectedOverlayLayerId(),
    )?.mask;
    const api = viewerApi;

    clearMaskPreviews();
    if (!api || !mask) return;

    if (mask.type === "radial") {
      api.setRadialMaskPreview({
        enabled: true,
        position: mask.position,
        size: mask.size,
        angle: mask.angle,
        feather: mask.feather,
        invert: mask.invert,
        opacity: mask.opacity,
        alpha: mask.alpha,
        overlayColor: [1, 0, 0],
        overlayOpacity: 0.38,
      });
    } else if (mask.type === "gradient") {
      api.setGradientMaskPreview({
        enabled: true,
        startPoint: mask.startPoint,
        endPoint: mask.endPoint,
        reflect: mask.reflect,
        invert: mask.invert,
        opacity: mask.opacity,
        alpha: mask.alpha,
        overlayColor: [1, 0, 0],
        overlayOpacity: 0.38,
      });
    } else if (mask.type === "brush") {
      api.setBrushMaskPreview({
        enabled: true,
        maskId: mask.id,
        component: mask,
        liveStroke: null,
        overlayColor: [1, 0, 0],
        overlayOpacity: 0.38,
      });
    } else if (mask.type === "luminance") {
      api.setLuminanceMaskPreview({
        enabled: true,
        target: mask.target,
        range: mask.range,
        smoothness: mask.smoothness,
        invert: mask.invert,
        opacity: mask.opacity,
        alpha: mask.alpha,
        overlayColor: [1, 0, 0],
        overlayOpacity: 0.38,
      });
    } else if (mask.type === "depth") {
      if (mask.showOverlay) {
        api.setDepthMaskPreview({
          enabled: true,
          target: mask.target,
          range: mask.range,
          invert: mask.invert,
          opacity: mask.opacity,
          alpha: mask.alpha,
          overlayColor: [1, 0, 0],
          overlayOpacity: 0.38,
        });
      }
    } else {
      api.setColorMaskPreview({
        enabled: true,
        sampleX: mask.sampleX,
        sampleY: mask.sampleY,
        position: mask.position,
        size: mask.size,
        angle: mask.angle,
        useRadius: mask.useRadius,
        selectedColor: mask.selectedColor,
        useSelectedColor: mask.useSelectedColor,
        threshold: mask.threshold,
        feather: mask.feather,
        invert: mask.invert,
        opacity: mask.opacity,
        alpha: mask.alpha,
        overlayColor: [1, 0, 0],
        overlayOpacity: 0.38,
      });
    }

    onCleanup(clearMaskPreviews);
  });

  // Set just before a NEW file import; finalizeImport persists it once the engine
  // has decoded it. Restores (boot/switch) leave this null so onImageLoaded does
  // not re-import.
  let awaitingImportFile: File | null = null;
  let pendingImportResolve:
    | ((media: Awaited<ReturnType<typeof mediaStore.addMedia>> | ImportedMediaRef | null) => void)
    | null = null;
  let pendingTransientAssetId: string | null = null;
  const importQueue: File[] = [];
  let importProcessing = false;
  let importProcessingPromise: Promise<void> | null = null;
  let importSession: {
    previousAssetId: string | null;
    firstImportedAssetId: string | null;
    selectionRevision: number;
  } | null = null;
  // Cached raw-RGBA the Viewer restores without decoding (legacy image.data).
  const [restoreImageData, setRestoreImageData] = createSignal<RestoreImageData | undefined>();
  // Thumbnail shown over the canvas while the texture loads (legacy thumbnail.jpeg).
  const [bootThumbUrl, setBootThumbUrl] = createSignal<string | null>(null);
  let restoreToken = 0;
  // Deferred edit state to apply after a new import image starts loading. This prevents
  // the old image from rendering with wrong IDT during the decode period.
  let pendingImportEditState: EditState | null = null;
  // The IndexedDB importer borrows the live Viewer to decode files. While it does,
  // keep the imported state detached from the current asset and cover the canvas
  // until the deterministically selected post-import asset has rendered.
  const [importTransitionActive, setImportTransitionActive] = createSignal(false);
  let pendingImportRevealAssetId: string | null = null;
  let importRevealToken = 0;
  // Bumped on every asset load; stale in-flight switches check it and abort so a
  // slow pending cache read can't clobber a newer selection (latest-wins).
  let mediaSwitchToken = 0;
  // JSON-only autosave bookkeeping.
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let pendingFlush = false;
  let restoringAssetId: string | null = null;
  let restoreFallbackAssetId: string | null = null;
  let lastRenderedMedia: { projectId: string; assetId: string } | null = null;
  let pendingRestoreEditState: SerializedEditState | null = null;
  let pendingRestoreSnapshots: MediaVersionSnapshot[] = [];
  let pendingViewportRestore: ViewportInfo | null = null;
  let queuedMediaAssetId: string | null = null;
  let queuedMediaSwitchToken = 0;
  let mediaSwitchDrain: Promise<void> | null = null;
  let temporaryMediaOperationDepth = 0;
  let userMediaSelectionRevision = 0;
  let cropInitialTransform: TransformState | null = null;
  let cropSourceToken = 0;
  let bootPromise: Promise<void> | null = null;
  let startupTransactionActive = false;
  let startupRestorePromise: Promise<boolean> | null = null;
  let resolveStartupRestore: ((loaded: boolean) => void) | null = null;
  let imageRevealToken = 0;

  function scheduleAfterFirstPaint(task: () => void): void {
    requestAnimationFrame(() => {
      setShellReady(true);
      window.setTimeout(task, 0);
    });
  }

  function scheduleIdleTask(task: () => void): void {
    const requestIdle = (
      window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      }
    ).requestIdleCallback;
    if (requestIdle) {
      requestIdle(task, { timeout: 5000 });
      return;
    }
    window.setTimeout(task, 1000);
  }

  function setBootThumb(blob: Blob | undefined) {
    setBootThumbUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blob ? URL.createObjectURL(blob) : null;
    });
  }

  // async function prepareImportTransitionCover(): Promise<void> {
  //   const session = importSession;
  //   setImportTransitionActive(true);
  //   if (!session?.previousAssetId) return;

  //   const summaryThumbnail = mediaList().find(
  //     (media) => media.assetId === session.previousAssetId,
  //   )?.thumbnail;
  //   const thumbnail =
  //     summaryThumbnail ?? (await mediaStore.getThumbnail(session.previousAssetId).catch(() => undefined));
  //   if (!importTransitionActive() || importSession !== session) return;
  //   setBootThumb(thumbnail);
  // }

  function cancelImportTransition(): void {
    importRevealToken += 1;
    pendingImportRevealAssetId = null;
    setBootThumb(undefined);
    setImportTransitionActive(false);
  }

  function revealImportTransitionAfterRender(assetId: string): void {
    if (!importTransitionActive() || pendingImportRevealAssetId !== assetId) return;
    const token = ++importRevealToken;
    void (async () => {
      // The first frame lets Solid transmit the atomically committed edit state;
      // the second lets Engine paint that state before the cover is removed.
      await nextFrame();
      await nextFrame();
      if (
        token !== importRevealToken ||
        pendingImportRevealAssetId !== assetId ||
        activeAssetId() !== assetId
      )
        return;
      pendingImportRevealAssetId = null;
      setBootThumb(undefined);
      setImportTransitionActive(false);
    })();
  }

  createEffect(() => {
    if (!state.image) {
      setHasImage(false);
      setSplitActive(false);
    }
  });

  createEffect(() => {
    props.onStartupStateChange?.({
      shellReady: shellReady(),
      ready: ready(),
      hasImage: hasImage(),
      loadingImage: loadingImage(),
    });
  });

  createEffect(() => {
    const overlay = activeOverlay();
    if (overlay && overlay !== "projects" && overlay !== "relay" && !state.image) closeOverlay();
    if (!state.image) {
      setBorderEditorVisible(false);
      setBorderOverlayAnchor(null);
    }
  });

  onCleanup(() => relaySession()?.dispose());

  function beginStartupTransaction(): void {
    startupTransactionActive = true;
    batch(() => {
      setBooting(true);
      setReady(false);
      setHasImage(false);
      setLoadingImage(false);
      setStartupPhase("booting");
    });
  }

  function markStartupImageRestorePending(): void {
    if (!startupTransactionActive || startupRestorePromise) return;
    setLoadingImage(true);
    startupRestorePromise = new Promise<boolean>((resolve) => {
      resolveStartupRestore = resolve;
    });
  }

  function finishStartupImageRestore(loaded: boolean): void {
    const resolve = resolveStartupRestore;
    if (!resolve) return;
    resolveStartupRestore = null;
    resolve(loaded);
  }

  async function waitForOptionalStartupImage(): Promise<boolean> {
    return startupRestorePromise ? startupRestorePromise : false;
  }

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function finishImageLoadAfterPaint(): void {
    const token = ++imageRevealToken;
    void (async () => {
      // Engine installs the texture synchronously but schedules the WebGL draw.
      // Keep the existing frame/thumbnail until that draw has reached the screen.
      await nextFrame();
      await nextFrame();
      if (token !== imageRevealToken) return;
      if (!importTransitionActive()) setBootThumb(undefined);
      finishStartupImageRestore(true);
    })();
  }

  function revealReady(): void {
    batch(() => {
      setStartupPhase("ready");
      setReady(true);
      setBooting(false);
    });
    setIsBooting(false);
  }

  // Direct pass-through: the input must reach the engine on the same pointermove.
  // The engine's requestRender already coalesces actual WebGL renders to one per
  // frame, so an extra outer RAF here only delays the edit by a frame.
  function schedulePreviewRender(patch: Partial<EditState>, reason = "preview-edit") {
    viewerApi?.previewEditPatch(patch, reason);
  }

  function clearScheduledPreviewRender(reason = "preview-clear") {
    viewerApi?.clearPreviewPatch(reason);
  }

  function previewCurveInput(input: CurvePreviewInput) {
    viewerApi?.previewCurveInput(input);
  }

  // Live border preview for the Border editor. Pushes the draft border straight to
  // the engine's presentation compositor without committing Solid state — the
  // engine only re-composites the frame around the cached graded picture (no
  // re-grade), so dragging border controls stays cheap. Commit happens on Apply via
  // setEditState("presentationBorder", ...), which the committed-border effect above
  // forwards through the same path.
  function previewPresentationBorder(border: PresentationBorderSettings) {
    viewerApi?.setPresentationState(
      isPresentationBorderVisible(border) ? toBorderSettings(border) : null,
    );
  }

  createEffect(() => {
    const active = activeAssetId();
    const blob = active
      ? mediaList().find((media) => media.assetId === active)?.thumbnail
      : undefined;
    if (!blob) {
      setProjectThumbUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setProjectThumbUrl(objectUrl);
    onCleanup(() => URL.revokeObjectURL(objectUrl));
  });

  function currentSerializedEditState(): SerializedEditState {
    return toPlainSerializedEditState(editState);
  }

  const overlayLayersForUi = createMemo(() => overlayDraftLayers() ?? editState.overlays);
  const selectedOverlayLayer = createMemo(() =>
    overlayLayersForUi().find((layer) => layer.id === selectedOverlayLayerId()),
  );

  function beginOverlayDraft(): EditorOverlayLayer[] {
    const current = overlayDraftLayers();
    if (overlayDraftActive() && current) return current;
    clearTimeout(autosaveTimer);
    historyController.cancelPending();
    overlayDraftSelectedLayerId = selectedOverlayLayerId();
    const snapshot = cloneSerializedState(currentSerializedEditState());
    const assetId = activeAssetId();
    if (assetId) pushHistoryState(assetId, snapshot);
    const layers = editState.overlays.map(cloneEditorOverlayLayer);
    overlayDraftHistorySnapshots = [];
    batch(() => {
      setOverlayDraftLayers(layers);
      setOverlayDraftActive(true);
    });
    return layers;
  }

  function publishOverlayDraft(layers: readonly EditorOverlayLayer[]) {
    const next = layers.map(cloneEditorOverlayLayer);
    setOverlayDraftLayers(next);
    schedulePreviewRender({ overlays: next }, "overlay-draft");
  }

  function recordOverlayDraftCommit(
    layers: readonly EditorOverlayLayer[] = overlayDraftLayers() ?? [],
    label = "Edit overlay",
  ) {
    if (!overlayDraftActive()) return;
    const state = cloneSerializedState(currentSerializedEditState());
    state.overlays = layers.map(serializeEditorOverlayLayer);
    const previous = overlayDraftHistorySnapshots[overlayDraftHistorySnapshots.length - 1];
    if (previous && JSON.stringify(previous.state.overlays) === JSON.stringify(state.overlays)) return;
    overlayDraftHistorySnapshots.push({ state, label });
  }

  async function applyOverlayDraft() {
    if (!overlayDraftActive()) return;
    const draft = overlayDraftLayers();
    if (!draft) return;
    const mediaName = activeAssetId();
    const liveSourceIds = new Set(
      draft.flatMap((layer) => layer.type === "image" ? [layer.sourceId] : []),
    );
    try {
      if (mediaName && true) {
        for (const [sourceId, pending] of pendingOverlayFiles) {
          if (liveSourceIds.has(sourceId)) {
            if (useOpfsPersistence()) {
              await storageBridge.saveOverlayImageForMedia(mediaName, sourceId, pending.file);
            } else {
              await mediaStore.saveOverlayImage(mediaName, sourceId, pending.file);
            }
          }
        }
      }
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to save overlay image");
      return;
    }

    for (const [sourceId, pending] of pendingOverlayFiles) {
      if (!liveSourceIds.has(sourceId)) URL.revokeObjectURL(pending.url);
    }
    setEditState("overlays", draft.map(cloneEditorOverlayLayer));
    const serialized = cloneSerializedState(currentSerializedEditState());
    const historySnapshots = overlayDraftHistorySnapshots;
    overlayDraftHistorySnapshots = [];
    pendingOverlayFiles.clear();
    overlayDraftSelectedLayerId = null;
    batch(() => {
      setOverlayDraftLayers(null);
      setOverlayDraftActive(false);
      setSelectedOverlayLayerId(null);
      setGradientPickerLayerId(null);
      setOverlayEditMode("transform");
    });
    clearMaskPreviews();
    window.setTimeout(() => clearScheduledPreviewRender("overlay-draft-applied"), 0);
    if (mediaName) {
      for (const entry of historySnapshots) {
        pushHistoryState(mediaName, entry.state, entry.label);
      }
      pushHistoryState(mediaName, serialized);
      void runAutosave();
    }
  }

  function cancelOverlayDraft() {
    if (!overlayDraftActive()) return;
    const selectedLayerId = overlayDraftSelectedLayerId;
    for (const pending of pendingOverlayFiles.values()) URL.revokeObjectURL(pending.url);
    pendingOverlayFiles.clear();
    overlayDraftSelectedLayerId = null;
    overlayDraftHistorySnapshots = [];
    batch(() => {
      setOverlayDraftLayers(null);
      setSelectedOverlayLayerId(selectedLayerId);
      setGradientPickerLayerId(null);
      setOverlayDraftActive(false);
      setOverlayEditMode("transform");
    });
    clearMaskPreviews();
    clearScheduledPreviewRender("overlay-draft-cancelled");
  }

  function selectOverlayLayer(id: string) {
    const layers = beginOverlayDraft();
    clearMaskPreviews();
    setSelectedOverlayLayerId(id);
    setGradientPickerLayerId(layers.find((layer) => layer.id === id)?.type === "gradient" ? id : null);
    setOverlayEditMode("transform");
  }

  function updateOverlayLayer(id: string, patch: EditorOverlayLayerPatch, commit = false) {
    const layers = beginOverlayDraft();
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    const next = layers.map((layer, layerIndex) =>
      layerIndex === index ? applyEditorOverlayLayerPatch(layer, patch) : layer,
    );
    publishOverlayDraft(next);
    if (commit) recordOverlayDraftCommit(next);
  }

  function deleteOverlayLayer(id: string) {
    const layers = beginOverlayDraft();
    const remaining = layers.filter((layer) => layer.id !== id);
    publishOverlayDraft(remaining);
    recordOverlayDraftCommit(remaining, "Delete overlay");
    if (selectedOverlayLayerId() === id) {
      setSelectedOverlayLayerId(remaining[remaining.length - 1]?.id ?? null);
      setGradientPickerLayerId(null);
      setOverlayEditMode("transform");
      confirmOverlayMask();
    }

    // With no layer left there is no editor state to keep open. Commit the empty
    // draft immediately so closing the panel cannot cancel and restore the layer.
    if (remaining.length === 0) void applyOverlayDraft();
  }

  function duplicateOverlayLayer(id: string) {
    const layers = beginOverlayDraft();
    const source = layers.find((layer) => layer.id === id);
    if (!source) return;
    const copy = cloneEditorOverlayLayer(source);
    copy.id = createOverlayId();
    copy.name = `${source.name} copy`;
    copy.position = [source.position[0] + 0.025, source.position[1] + 0.025];
    const next = insertOverlayAboveSelection(layers, copy);
    publishOverlayDraft(next);
    recordOverlayDraftCommit(next, "Duplicate overlay");
    setSelectedOverlayLayerId(copy.id);
    setGradientPickerLayerId(copy.type === "gradient" ? copy.id : null);
  }

  function insertOverlayAboveSelection(
    layers: readonly EditorOverlayLayer[],
    layer: EditorOverlayLayer,
  ): EditorOverlayLayer[] {
    const selectedIndex = layers.findIndex((item) => item.id === selectedOverlayLayerId());
    const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : layers.length;
    return [...layers.slice(0, insertionIndex), layer, ...layers.slice(insertionIndex)];
  }

  async function importOverlayFile(file: File, categoryId?: string) {
    if (!file.type.startsWith("image/")) {
      actions.setError("Choose an image file for the overlay");
      return;
    }

    let sourceDataUrl: string | undefined;

    try {
      const sourceId = createOverlayId();
      sourceDataUrl = URL.createObjectURL(file);
      const dimensions = await readImageDimensions(sourceDataUrl);
      const imageAspect = (state.image?.width ?? 1) / Math.max(1, state.image?.height ?? 1);
      const layer = createEditorOverlayLayer({
        name: file.name,
        sourceId,
        sourceDataUrl,
        width: dimensions.width,
        height: dimensions.height,
        imageAspect,
        categoryId,
      });
      const layers = beginOverlayDraft();
      pendingOverlayFiles.set(sourceId, { file, url: sourceDataUrl });
      const next = insertOverlayAboveSelection(layers, layer);
      publishOverlayDraft(next);
      recordOverlayDraftCommit(next, "Add image overlay");
      setSelectedOverlayLayerId(layer.id);
      setGradientPickerLayerId(null);
    } catch (error) {
      if (sourceDataUrl) URL.revokeObjectURL(sourceDataUrl);
      actions.setError(error instanceof Error ? error.message : "Unable to import overlay");
    }
  }

  function addGradientOverlay(presetId: string) {
    const layer = createEditorGradientOverlayLayer(presetId);
    if (!layer) {
      actions.setError("Unable to create gradient overlay");
      return;
    }
    const layers = beginOverlayDraft();
    const next = insertOverlayAboveSelection(layers, layer);
    publishOverlayDraft(next);
    recordOverlayDraftCommit(next, "Add gradient layer");
    setSelectedOverlayLayerId(layer.id);
    setGradientPickerLayerId(layer.id);
    setOverlayEditMode("transform");
  }

  function addOverlayMask(layerId: string, type: OverlayMaskType) {
    const layers = beginOverlayDraft();
    const mask = createOverlayMask(type, viewerApi);
    if (!mask) {
      actions.setError(type === "depth" ? "Depth data is not available for this image" : "Unable to create mask");
      return;
    }
    publishOverlayDraft(updateOverlayMaskByOwner(layers, { type: "overlay", ownerId: layerId }, () => mask));
    clearMaskPreviews();
    setSelectedOverlayLayerId(layerId);
    setOverlayEditMode("mask");
  }

  function updateSelectedOverlayMask(patch: Partial<EditorOverlayMask>) {
    const layerId = selectedOverlayLayerId();
    const layers = overlayDraftLayers();
    if (!layerId || !layers) return;
    publishOverlayDraft(updateOverlayMaskByOwner(
      layers,
      { type: "overlay", ownerId: layerId },
      (mask) => mask ? { ...mask, ...patch } as EditorOverlayMask : null,
    ));
  }

  function editOverlayMask(layerId: string) {
    beginOverlayDraft();
    clearMaskPreviews();
    setSelectedOverlayLayerId(layerId);
    setOverlayEditMode("mask");
  }

  function removeOverlayMask(layerId: string) {
    const layers = beginOverlayDraft();
    publishOverlayDraft(updateOverlayMaskByOwner(layers, { type: "overlay", ownerId: layerId }, () => null));
    setOverlayEditMode("transform");
    clearMaskPreviews();
  }

  function confirmOverlayMask() {
    setOverlayEditMode("transform");
    clearMaskPreviews();
  }

  function openSelectedOverlayContextMenu(event: MouseEvent) {
    const layer = selectedOverlayLayer();
    if (!layer) return;
    setOverlayContextMenu(
      openContextMenu(
        event,
        `<context-title>Overlay actions</context-title>
         <context-item data-action="duplicate">Duplicate</context-item>
         <context-item data-action="visibility">${layer.visible ? "Hide" : "Show"}</context-item>
         <context-item data-action="lock">${layer.locked ? "Unlock" : "Lock"}</context-item>
         <context-separator></context-separator>
         <context-item data-action="flip-x">Flip Horizontally</context-item>
         <context-item data-action="flip-y">Flip Vertically</context-item>
         <context-item data-action="rotate-left">Rotate Left</context-item>
         <context-item data-action="rotate-right">Rotate Right</context-item>
         <context-item data-action="reset">Reset Transform</context-item>
         <context-separator></context-separator>
         <context-item data-action="delete" class="danger">Delete</context-item>`,
        {
          duplicate: { action: () => duplicateOverlayLayer(layer.id) },
          visibility: { action: () => updateOverlayLayer(layer.id, { visible: !layer.visible }, true) },
          lock: { action: () => updateOverlayLayer(layer.id, { locked: !layer.locked }, true) },
          "flip-x": { action: () => updateOverlayLayer(layer.id, { scale: [-layer.scale[0], layer.scale[1]] }, true) },
          "flip-y": { action: () => updateOverlayLayer(layer.id, { scale: [layer.scale[0], -layer.scale[1]] }, true) },
          "rotate-left": { action: () => updateOverlayLayer(layer.id, { angle: layer.angle - 90 }, true) },
          "rotate-right": { action: () => updateOverlayLayer(layer.id, { angle: layer.angle + 90 }, true) },
          reset: { action: () => updateOverlayLayer(layer.id, { position: [0.5, 0.5], scale: layer.type === "gradient" ? [1, 1] : [0.5, 0.5], angle: 0 }, true) },
          delete: { action: () => deleteOverlayLayer(layer.id) },
        },
      ),
    );
  }

  const viewerEditState = createMemo(() => {
    if (cropEditMode()) return editState;
    const next = deserializeEditState(currentSerializedEditState());
    // Project serialization intentionally strips runtime-only blob/data URLs.
    // The Viewer still needs those URLs to upload overlay textures to WebGL, so
    // restore them after producing the proxy-free engine snapshot.
    const runtimeOverlaySources = new Map(
      editState.overlays.flatMap((layer) =>
        layer.type === "image" ? [[layer.id, layer.sourceDataUrl] as const] : [],
      ),
    );
    next.overlays = next.overlays.map((layer) =>
      layer.type === "image"
        ? { ...layer, sourceDataUrl: runtimeOverlaySources.get(layer.id) }
        : layer,
    );
    // Image crops get BAKED into the source pixels by applyCropOverlay, which then
    // persists the transform with `cropEnabled: false` (keeping orientation/flip
    // geometry only, for reopening the crop tool). Re-applying that to the already
    // baked pixels would double-transform them — hence the reset. A LIVE crop
    // (cropEnabled === true) is never baked: video crops are non-destructive, and
    // auto letterbox removal sets a live crop on import. Those must reach the
    // engine, so only reset the non-live (baked) case.
    if (!videoState() && !next.transform.cropEnabled) {
      next.transform = { ...DEFAULT_TRANSFORM_STATE };
    }
    return next;
  });

  function defaultEditStateForImport(file: File): EditState {
    const next = deserializeEditState(toPlainSerializedEditState(DEFAULT_EDIT_STATE));
    const format = detectImageFormat(file);
    if (format === "raw") {
      next.colorManagement.inputColorSpaceId = "VisionLog";
    } else if (format === "exr") {
      next.colorManagement.inputColorSpaceId = "EXR_IDT";
    }
    return next;
  }

  function resetHistoryForAsset(
    assetId: string | null,
    state: SerializedEditState | null,
    snapshots: MediaVersionSnapshot[] = [],
  ) {
    setVersionSnapshots(
      snapshots.map((snapshot) => ({
        ...snapshot,
        editState: cloneSerializedState(snapshot.editState),
      })),
    );
    historyController.reset(assetId, state);
  }

  function clearPendingRestore() {
    pendingRestoreEditState = null;
    pendingRestoreSnapshots = [];
    pendingViewportRestore = null;
    restoreFallbackAssetId = null;
  }

  function pushHistoryState(assetId: string, state: SerializedEditState, label?: string) {
    historyController.push(assetId, state, label);
  }

  function recordInactiveHistoryChange(
    assetId: string,
    previous: SerializedEditState,
    nextState: SerializedEditState,
  ): void {
    historyController.recordInactive(assetId, previous, nextState);
  }

  function applySerializedEditState(state: SerializedEditState) {
    historyController.apply(state);
  }

  async function readOpfsVersionSnapshots(
    media: StorageMediaContext,
  ): Promise<MediaVersionSnapshot[]> {
    const snapshots = await storageBridge.listSnapshotsForMedia(media);
    return snapshots.map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.date,
      editState: cloneSerializedState(snapshot.state),
      videoState: snapshot.videoState,
    }));
  }

  function goToHistory(index: number) {
    historyController.goTo(index);
  }

  function undoHistory() {
    historyController.undo();
  }

  function redoHistory() {
    historyController.redo();
  }

  async function saveVersionSnapshot() {
    const assetId = activeAssetId();
    if (!assetId || !state.image) return;
    const fallback = `Version ${versionSnapshots().length + 1}`;
    const name = window.prompt("Snapshot name", fallback)?.trim();
    if (!name) return;
    const snapshotState = cloneSerializedState(currentSerializedEditState());
    try {
      const snapshot = await projectRepository.saveVersionSnapshot(
        assetId,
        name,
        snapshotState,
        versionSnapshots(),
        videoState(),
      );
      if (!snapshot) {
        actions.setError("No active image to save snapshot of.");
        return;
      }
      setVersionSnapshots([
        {
          ...snapshot,
          editState: cloneSerializedState(snapshot.editState),
          videoState: snapshot.videoState,
        },
        ...versionSnapshots(),
      ]);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to save snapshot");
    }
  }

  async function deleteVersionSnapshot(id: string) {
    const assetId = activeAssetId();
    if (!assetId) return;
    const next = versionSnapshots().filter((snapshot) => snapshot.id !== id);

    try {
      await projectRepository.deleteVersionSnapshot(assetId, id, next);
      setVersionSnapshots(next);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to delete snapshot");
    }
  }

  async function renameVersionSnapshot(id: string, name: string) {
    const assetId = activeAssetId();
    if (!assetId) return;
    const next = versionSnapshots().map((snapshot) =>
      snapshot.id === id ? { ...snapshot, name } : snapshot,
    );

    try {
      await projectRepository.renameVersionSnapshot(assetId, id, name, next);
      setVersionSnapshots(next);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to rename snapshot");
    }
  }

  async function updateVersionSnapshot(id: string) {
    const assetId = activeAssetId();
    if (!assetId || !state.image) return;
    const snapshotState = cloneSerializedState(currentSerializedEditState());
    const next = versionSnapshots().map((snapshot) =>
      snapshot.id === id
        ? { ...snapshot, editState: snapshotState, videoState: videoState() }
        : snapshot,
    );

    try {
      await projectRepository.updateVersionSnapshot(assetId, id, snapshotState, next, videoState());
      setVersionSnapshots(next);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to update snapshot");
    }
  }

  async function deleteAllVersionSnapshots() {
    const assetId = activeAssetId();
    if (!assetId) return;

    try {
      await projectRepository.clearVersionSnapshots(assetId);
      setVersionSnapshots([]);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to delete snapshots");
    }
  }

  function applyVersionSnapshot(id: string) {
    const assetId = activeAssetId();
    const snapshot = versionSnapshots().find((item) => item.id === id);
    if (!assetId || !snapshot) return;
    applySerializedEditState(snapshot.editState);
    if (snapshot.videoState) {
      setVideoState(snapshot.videoState);
      if (useOpfsPersistence()) {
        void storageBridge.autosaveActiveVideoState(snapshot.videoState);
      }
    }
    pushHistoryState(assetId, snapshot.editState);
  }

  onMount(() => {
    setMediaListProvider(projectRepository.mediaListProvider);
    const cleanups: Array<() => void> = [];
    let handlersBound = false;
    const bindNonCriticalHandlers = () => {
      if (handlersBound) return;
      handlersBound = true;
      const onPaste = (event: ClipboardEvent) => {
        void handleClipboardPaste(event);
      };
      const flush = () => void flushAutosave();
      const onVisibility = () => {
        if (document.visibilityState === "hidden") flush();
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          activeOverlay() !== null ||
          (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
        ) {
          return;
        }
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        void selectAdjacentMedia(event.key === "ArrowRight" ? 1 : -1);
      };
      document.addEventListener("paste", onPaste);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => {
        document.removeEventListener("paste", onPaste);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("pagehide", flush);
        document.removeEventListener("visibilitychange", onVisibility);
      });
    };

    scheduleAfterFirstPaint(() => {
      beginStartupTransaction();
      const preparedOpfsBoot = opfsPersistence && true
        ? prepareBootViaOpfs()
        : undefined;
      bootPromise = (async () => {
        await viewerReadyPromise;
        await boot(preparedOpfsBoot);
        await waitForOptionalStartupImage();
        startupTransactionActive = false;
        revealReady();
        bindNonCriticalHandlers();
      })();
      void bootPromise
        .then(() => {
          scheduleIdleTask(() => {
                    if (useOpfsPersistence()) void storageBridge.runDeferredStorageMigrations();
            else void appSessionStore.ensureMigrated();
          });
        })
        .catch((error) => {
          startupTransactionActive = false;
          finishStartupImageRestore(false);
          batch(() => {
            setStartupPhase("error");
            setReady(true);
            setBooting(false);
            setLoadingImage(false);
          });
          setIsBooting(false);
          actions.setError(error instanceof Error ? error.message : "Failed to start editor");
        });
    });
    onCleanup(() => {
      cleanups.forEach((cleanup) => cleanup());
      historyController.dispose();
    });
  });

  // Fast boot auto-load (legacy a_()/Wh()/lu()): restore the last project + asset,
  // showing its cached thumbnail immediately and its pixels with zero decode.
  async function boot(preparedOpfsBoot?: Promise<PreparedOpfsBoot | null>) {
    if (useOpfsPersistence()) {
      await bootViaOpfs(preparedOpfsBoot);
      const projectId = activeProjectId();
      if (projectId) await recoverProjectBatchEdits(projectId);
      return;
    }
    try {
      const session = await appSessionStore.getSession();
      const project = await projectStore.resolveBootProject(session.activeProjectId);
      batch(() => {
        setActiveProjectId(project.id);
        setActiveProjectName(project.name);
        setProjectName(project.name);
        setCurrentProjectId(project.id);
      });

      // Legacy active media: projects/active.txt selects the project; project
      // state.json activeUserMedia selects the image. No separate app-session
      // image override is preferred over project state.
      const candidates = project.activeUserMedia
        ? [
            project.activeUserMedia,
            ...project.assetIds.filter((assetId) => assetId !== project.activeUserMedia),
          ]
        : project.assetIds;
      let loaded = false;
      for (const assetId of candidates) {
        // Mirrors legacy: try activeUserMedia first, then first media directory.
         
        loaded = await openAsset(assetId);
        if (loaded) break;
      }

      if (!loaded) {
        await appSessionStore.setActive(project.id, null);
        if (project.activeUserMedia) await projectStore.setActiveUserMedia(project.id, null);
      }
      await refreshMediaList();
      await recoverProjectBatchEdits(project.id);
    } catch {
      try {
        const project = await projectStore.createProject("Default Project");
        batch(() => {
          setActiveProjectId(project.id);
          setActiveProjectName(project.name);
          setProjectName(project.name);
          setCurrentProjectId(project.id);
        });
        await appSessionStore.setActive(project.id, null);
        await refreshMediaList();
      } catch {
        // Import finalization also attempts to recover a missing active project.
      }
      // Corrupt/absent session — start with an empty default project.
    }
  }

  // ── OPFS persistence path ─────────────────────────────────────────────
  // Routes the loaded OPFS media through the same Viewer signals + deferred-state
  // (pendingRestoreEditState → handleImageLoaded) the IndexedDB path uses, so the
  // grade is applied only after the texture uploads (req 9). The media directory
  // name is the asset id on this path.
  async function drawOpfsMedia(media: StorageMediaContext, token = ++mediaSwitchToken) {
    setBootThumb(media.thumbnail);
    const snapshots = await readOpfsVersionSnapshots(media);
    if (token !== mediaSwitchToken) return;
    restoreFallbackAssetId =
      lastRenderedMedia?.projectId === activeProjectId()
        ? lastRenderedMedia.assetId
        : activeAssetId();
    restoringAssetId = media.name;
    pendingViewportRestore = null;
    pendingRestoreEditState = cloneSerializedState(media.stateToApply);
    pendingRestoreSnapshots = snapshots;
    // One reactive update for the whole media-switch identity change (asset id +
    // video state/history) so subscribers and the viewerEditState memo recompute
    // once, not once per signal. Synchronous block — safe to batch (no await).
    batch(() => {
      setActiveAssetId(media.name);
      const videoMetadata = media.metadata.videoMetadata as { durationUs?: number } | undefined;
      if (media.metadata.mediaKind === "video" || media.metadata.format === "video") {
        const durationUs = Number(videoMetadata?.durationUs ?? 0);
        const restored = clampVideoTrim(
          (media.metadata.videoState as SerializedVideoState | undefined) ?? {
            trimStartUs: 0,
            trimEndUs: durationUs,
          },
          durationUs,
        );
        setVideoState(restored);
        setVideoHistory([restored]);
        setVideoHistoryIndex(0);
      } else {
        setVideoState(undefined);
        setVideoHistory([]);
        setVideoHistoryIndex(-1);
      }
    });
    const input = storageBridge.mediaToViewerInput(media);
    if ((window as { __DEBUG_PREVIEW_LOADING__?: boolean }).__DEBUG_PREVIEW_LOADING__) {
      console.table({
        step: "draw-opfs-media",
        mediaName: media.name,
        mainPreviewSourceName: media.mainPreviewSourceName,
        mainPreviewSourceType: media.image instanceof Blob ? "blob" : "image-data",
        originalWidth: media.image instanceof ImageData ? media.image.width : undefined,
        originalHeight: media.image instanceof ImageData ? media.image.height : undefined,
        metadataWidth: media.image instanceof ImageData ? media.image.width : undefined,
        metadataHeight: media.image instanceof ImageData ? media.image.height : undefined,
        thumbnailWidth: undefined,
        thumbnailHeight: undefined,
        isUsingThumbnailAsMainPreview: media.mainPreviewSourceName === "thumbnail.jpeg",
        isUsingReadbackAsMainPreview: false,
        zoom: state.viewport.zoom,
      });
    }
    if (input.imageData) {
      actions.clearSelectedFile();
      markStartupImageRestorePending();
      setRestoreImageData({
        buffer: input.imageData.buffer,
        width: input.imageData.width,
        height: input.imageData.height,
        fileName: input.imageData.fileName,
        token: ++restoreToken,
      });
    } else {
      setRestoreImageData(undefined);
      actions.clearSelectedFile();
      await Promise.resolve();
      markStartupImageRestorePending();
      actions.selectFile(
        new File([input.file], input.file.name, {
          type: input.file.type || "application/octet-stream",
          lastModified: Date.now(),
        }),
      );
    }
  }

  function detectedStoredFormat(
    input: Record<string, unknown>,
    fallbackName: string,
  ): ReturnType<typeof detectImageFormat> {
    const explicit = typeof input.format === "string" ? input.format : "";
    if (explicit) return explicit as ReturnType<typeof detectImageFormat>;
    const name =
      (typeof input.originalName === "string" && input.originalName) ||
      (typeof input.name === "string" && input.name) ||
      fallbackName;
    const type =
      (typeof input.mimeType === "string" && input.mimeType) ||
      (typeof input.type === "string" && input.type) ||
      "";
    return detectImageFormat({ name, type });
  }

  function storedMediaFormat(media: StorageMediaContext): ReturnType<typeof detectImageFormat> {
    return detectedStoredFormat(media.metadata, media.name);
  }

  async function prepareBootViaOpfs(): Promise<PreparedOpfsBoot | null> {
    try {
      const workspaceId = await resolveBootWorkspaceId();
      if (!workspaceId) throw new Error("The local workspace is not available.");
      const prepared = await storageBridge.prepareOpfsBoot(workspaceId);
      const { project, media } = prepared;
      batch(() => {
        setActiveProjectId(project.state.id);
        setActiveProjectName(project.state.name);
        setProjectName(project.state.name);
        setCurrentProjectId(project.state.id);
      });
      if (media) setBootThumb(media.thumbnail);
      return prepared;
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to open project (OPFS)");
      return null;
    }
  }

  async function bootViaOpfs(preparedOpfsBoot?: Promise<PreparedOpfsBoot | null>) {
    try {
      const prepared = await (preparedOpfsBoot ?? prepareBootViaOpfs());
      if (!prepared) return;

      const media = prepared.media
        ? await storageBridge.loadPreparedStartupMedia(prepared.media)
        : null;
      if (media) await drawOpfsMedia(media);
      else resetHistoryForAsset(null, null);
      await refreshMediaList();
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to open project (OPFS)");
    }
  }

  async function resolveBootWorkspaceId(): Promise<string> {
    return LOCAL_WORKSPACE_ID;
  }

  // Loads an asset as the live image: defers its saved edit state until texture upload succeeds,
  // paints the cached thumbnail first, then uploads the cached pixels (raw RGBA →
  // zero decode, or the native blob). Shared by boot and asset/project switching.
  //
  // A switch token guards every await: if a newer switch starts mid-load, the stale
  // one aborts before mutating state or kicking off a texture upload, so a slow
  // pending load can never overwrite the newer selected media (latest-wins). The
  // cached loader never runs a decoder / regenerates the thumbnail / rewrites
  // image.data — it's a pure cache read.
  async function openAsset(assetId: string, token = ++mediaSwitchToken): Promise<boolean> {
    const media = await mediaStore.getMedia(assetId);
    if (!media || token !== mediaSwitchToken) return false;
    const projectId = media.projectId;

    // Thumbnail-first: paint the cached JPEG over the canvas BEFORE changing the
    // edit state — the old texture stays beneath it (no black frame), and the
    // overlay masks the brief moment the engine re-grades the old texture with the
    // new look (so there's no wrong-preset flash before the new texture is ready).
    // const thumb = await mediaStore.getThumbnail(assetId);
    if (token !== mediaSwitchToken) return false;
    // setBootThumb(thumb);

    const cached = await mediaStore.loadCachedImageAsset(assetId);
    if (token !== mediaSwitchToken) return false;
    if (cached.kind === "missing") {
      // Keep the previous active media and texture when this asset is incomplete.
      setBootThumb(undefined);
      actions.setError("Image data for this asset is missing. Re-import it to continue.");
      return false;
    }
    if (
      cached.kind === "blob" &&
      media.format &&
      media.format !== "video" &&
      shouldUseImageDecodeWorker(media.format as Parameters<typeof shouldUseImageDecodeWorker>[0])
    ) {
      if (media.format === "raw") perf.recordRawDecodeDuringSwitch();
      perf.recordHeavyDecodeDuringSwitch();
      setBootThumb(undefined);
      actions.setError("Cached image.data is missing for this media. Re-import it to continue.");
      return false;
    }

    restoreFallbackAssetId =
      lastRenderedMedia?.projectId === activeProjectId()
        ? lastRenderedMedia.assetId
        : activeAssetId();
    restoringAssetId = assetId;
    pendingViewportRestore = media.viewport
      ? {
          zoom: media.viewport.zoom,
          panX: media.viewport.panX,
          panY: media.viewport.panY,
        }
      : null;
    pendingRestoreEditState = cloneSerializedState(media.editState);
    pendingRestoreSnapshots = (media.snapshots ?? []).map((snapshot) => ({
      ...snapshot,
      editState: cloneSerializedState(snapshot.editState),
    }));
    setActiveAssetId(assetId);

    if (cached.kind === "data") {
      awaitingImportFile = null;
      pendingImportEditState = null;
      actions.clearSelectedFile();
      markStartupImageRestorePending();
      setRestoreImageData({
        buffer: cached.imageData.data.buffer,
        width: cached.imageData.width,
        height: cached.imageData.height,
        fileName: cached.fileName,
        token: ++restoreToken,
      });
    } else if (cached.kind === "blob") {
      awaitingImportFile = null;
      pendingImportEditState = null;
      setRestoreImageData(undefined);
      actions.clearSelectedFile();
      await Promise.resolve();
      markStartupImageRestorePending();
      actions.selectFile(
        new File([cached.blob], cached.fileName, {
          type: cached.mimeType,
          lastModified: Date.now(),
        }),
      );
    }

    await appSessionStore.setActive(projectId, assetId);
    await projectStore.setActiveUserMedia(projectId, assetId);
    return true;
  }

  // Snapshot of the persisted slice (asset id + edit state). The autosave guard
  // compares against lastSavedSnapshot so a restore/switch never triggers a save.
  function mediaSnapshot(): string {
    return JSON.stringify({
      assetId: activeAssetId(),
      editState: serializeEditState(editState),
      viewport: state.viewport,
    });
  }

  function currentMatchSourceMetadata() {
    const image = state.image;
    const sourceId = activeAssetId() ?? "";
    const sourceIdt = editState.colorManagement.inputColorSpaceId;
    return {
      sourceId,
      sourceIdt,
      sourceSignature: [sourceId, image?.width ?? 0, image?.height ?? 0, sourceIdt].join("|"),
    };
  }

  // Writes the active asset's edit state JSON only — never the image/thumbnail
  // blobs (legacy state.json write). saving/pendingFlush coalesce overlapping runs.
  async function runAutosave() {
    const assetId = activeAssetId();
    if (
      !assetId ||
      restoringAssetId ||
      importTransitionActive() ||
      maskingDraftActive() ||
      overlayDraftActive() ||
      activeOverlay() === "crop"
    )
      return;
    if (saving) {
      pendingFlush = true;
      return;
    }
    saving = true;
    try {
      if (useOpfsPersistence()) {
        await storageBridge.autosaveActiveState(currentSerializedEditState());
      } else {
        await mediaStore.saveMediaState(assetId, {
          editState,
          viewport: state.viewport,
        });
      }
      setLastSavedSnapshot(mediaSnapshot());
    } catch {
      // Best-effort; the next edit retries.
    } finally {
      saving = false;
      if (pendingFlush) {
        pendingFlush = false;
        void runAutosave();
      }
    }
  }

  // Flush the latest JSON immediately (page hide / tab switch / before switching).
  async function flushAutosave() {
    clearTimeout(autosaveTimer);
    if (
      isBooting() ||
      restoringAssetId ||
      importTransitionActive() ||
      maskingDraftActive() ||
      overlayDraftActive() ||
      activeOverlay() === "crop"
    )
      return;
    const assetId = activeAssetId();
    if (!assetId || mediaSnapshot() === lastSavedSnapshot()) return;
    if (useOpfsPersistence()) {
      await storageBridge.autosaveActiveState(currentSerializedEditState());
    } else {
      await mediaStore.saveMediaState(assetId, {
        editState,
        viewport: state.viewport,
      });
    }
    setLastSavedSnapshot(mediaSnapshot());
  }

  // A media switch should not wait for storage latency. Capture the outgoing
  // asset explicitly and start its JSON-only save while the next image is read
  // and decoded. The explicit asset id prevents a late write from landing on
  // whichever media becomes active next.
  function saveOutgoingMediaInBackground(): void {
    if (maskingDraftActive()) cancelMaskingDraft();
    if (overlayDraftActive()) cancelOverlayDraft();
    clearTimeout(autosaveTimer);
    const assetId = activeAssetId();
    const snapshot = mediaSnapshot();
    if (!assetId || snapshot === lastSavedSnapshot()) return;

    const serialized = currentSerializedEditState();
    const viewport = { ...state.viewport };
    setLastSavedSnapshot(snapshot);

    const save = useOpfsPersistence()
      ? storageBridge.autosaveMediaState(assetId, serialized)
      : mediaStore.saveMediaState(assetId, {
          editState: deserializeEditState(serialized),
          viewport,
        });

    void save.catch(() => {
      // Restore the dirty marker only if the failed asset is still active.
      if (activeAssetId() === assetId) setLastSavedSnapshot(null);
    });
  }

  // body[has-image] hook
  createEffect(() => {
    if (hasImage()) document.body.setAttribute("has-image", "");
    else document.body.removeAttribute("has-image");
  });

  createEffect(() => {
    const match = editState.match;
    const source = currentMatchSourceMetadata();
    if (!match.lut || match.status === "analyzing") return;
    if (
      match.sourceId !== source.sourceId ||
      match.sourceIdt !== source.sourceIdt ||
      (match.sourceSignature && match.sourceSignature !== source.sourceSignature)
    ) {
      setEditState("match", {
        ...match,
        lut: null,
        generatedAt: 0,
        status: "idle",
        error: "Color Match needs regeneration for the current source.",
      });
    }
  });

  // Import loading state: large RAW / pro-format files take seconds to decode in
  // the worker. Show a spinner — but only after a short delay so fast JPEG/PNG
  // imports don't flash it. (state.isLoading is set by selectFile, cleared by
  // setImage/setError.)
  const [showLoading, setShowLoading] = createSignal(false);
  createEffect(() => {
    if (importTransitionActive()) {
      setShowLoading(true);
      return;
    }
    const hasVisiblePreview = !!state.image || !!bootThumbUrl();
    if (booting() && !hasVisiblePreview) {
      setShowLoading(true);
      return;
    }
    if (loadingImage() && !hasVisiblePreview) {
      setShowLoading(true);
      return;
    }
    if (!state.isLoading || hasVisiblePreview) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!state.image && !bootThumbUrl()) setShowLoading(true);
    }, 180);
    onCleanup(() => clearTimeout(timer));
  });

  // RAW develops take longest, so name the step; otherwise a generic label.
  const loadingLabel = createMemo(() => {
    if (booting()) return "Opening project...";
    const name = state.selectedFile?.name ?? "";
    const isRaw =
      /\.(dng|cr2|cr3|arw|nef|nrw|raf|orf|rw2|pef|srw|raw|3fr|gpr|x3f|mrw|dcr|kdc|mef|mos|iiq|erf)$/i.test(
        name,
      );
    const suffix = importQueueSize() > 1 ? ` (${importQueueSize()} remaining)` : "";
    return `${isRaw ? "Developing RAW..." : "Loading image..."}${suffix}`;
  });

  const isDirty = createMemo(() => {
    if (!activeAssetId()) return false;
    const last = lastSavedSnapshot();
    return last === null || last !== mediaSnapshot();
  });

  // Debounced JSON-only autosave (legacy state.json): re-runs whenever the active
  // asset or any edit changes, 400ms after the last change. Skipped while booting
  // (the boot apply is the initial-load baseline) and when nothing diverged.
  createEffect(() => {
    const snap = mediaSnapshot(); // track asset id + edits
    if (
            isBooting() ||
      restoringAssetId ||
      importTransitionActive() ||
      maskingDraftActive() ||
      overlayDraftActive()
    )
      return;
    if (!activeAssetId() || snap === lastSavedSnapshot()) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void runAutosave(), 400);
  });

  createEffect(() => {
    const assetId = activeAssetId();
    const serialized = currentSerializedEditState();
    const serializedKey = JSON.stringify(serialized);
    if (
      !assetId ||
      isBooting() ||
      restoringAssetId ||
      importTransitionActive() ||
      maskingDraftActive() ||
      overlayDraftActive() ||
      historyController.isApplying() ||
      activeOverlay() === "crop"
    )
      return;

    historyController.schedulePush(assetId, JSON.parse(serializedKey) as SerializedEditState);
  });

  const exportTitle = createMemo(() => {
    const selected = allPresets().find((preset) => preset.id === editState.preset.selectedPresetId);
    return selected?.name ?? projectName();
  });

  function cloneTransformState(state: TransformState): TransformState {
    return { ...state };
  }

  function isDefaultTransformShape(state: TransformState): boolean {
    return (
      state.enabled === DEFAULT_TRANSFORM_STATE.enabled &&
      state.cropX === DEFAULT_TRANSFORM_STATE.cropX &&
      state.cropY === DEFAULT_TRANSFORM_STATE.cropY &&
      state.cropWidth === DEFAULT_TRANSFORM_STATE.cropWidth &&
      state.cropHeight === DEFAULT_TRANSFORM_STATE.cropHeight &&
      state.aspectRatio === DEFAULT_TRANSFORM_STATE.aspectRatio &&
      state.orientation === DEFAULT_TRANSFORM_STATE.orientation &&
      state.straighten === DEFAULT_TRANSFORM_STATE.straighten &&
      state.flipX === DEFAULT_TRANSFORM_STATE.flipX &&
      state.flipY === DEFAULT_TRANSFORM_STATE.flipY
    );
  }

  type BakedCropImageData = {
    width: number;
    height: number;
    buffer: ArrayBuffer;
    /** Legacy hu.ke() output: OffscreenCanvas.convertToBlob() defaults to PNG. */
    blob?: Blob;
    thumbnail?: Blob;
    galleryPreview?: Blob;
  };

  type StorageCropBridge = typeof storageBridge & {
    replaceActiveMediaImageWithData?: (params: {
      width: number;
      height: number;
      buffer: ArrayBuffer;
      blob?: Blob;
      thumbnail?: Blob;
      galleryPreview?: Blob;
      editState: EditState;
      viewport?: { zoom: number; panX: number; panY: number };
    }) => Promise<StorageMediaContext | void>;
    restoreActiveOriginalMediaImage?: (params: {
      editState: EditState;
      viewport?: { zoom: number; panX: number; panY: number };
    }) => Promise<StorageMediaContext | void>;
  };

  type CropSourceBridge = {
    loadActiveOriginalCropSourceData?: () => Promise<CropSourceData | null> | CropSourceData | null;
  };

  type IndexedDbCropSourceStore = typeof mediaStore & {
    loadCropSourceData?: (assetId: string) => Promise<CropSourceData | null>;
  };

  const cropResetViewport = { zoom: 1, panX: 0, panY: 0 };

  function editStateAfterBakedCrop(
    appliedTransform: TransformState = editState.transform,
  ): EditState {
    const next = deserializeEditState(currentSerializedEditState());
    // Legacy keeps the committed transform state after Done. The baked image is
    // shown in the main viewer, while the next Crop & Rotate open reuses the
    // original backup + this saved transform. Disable live crop rendering outside
    // the transform window so the baked pixels are not transformed twice.
    next.transform = {
      ...appliedTransform,
      enabled: DEFAULT_TRANSFORM_STATE.enabled,
      cropEnabled: false,
    } as TransformState;
    return next;
  }

  function legacyCropDisplayDimensions(
    width: number,
    height: number,
    transform: TransformState,
  ): { width: number; height: number } {
    // Legacy hu.He(): display dimensions are swapped only by the 90-degree
    // orientation index. Free straightening rotation never changes the output
    // canvas size; hu.ye() covers that rotation with fillScale instead.
    const orientation = (((Math.round(Number(transform.orientation) || 0) % 360) + 360) % 360) as
      | 0
      | 90
      | 180
      | 270;
    return orientation === 90 || orientation === 270
      ? { width: height, height: width }
      : { width, height };
  }

  function orientationDegrees(orientation: 0 | 90 | 180 | 270): number {
    return orientation === 270 ? -90 : orientation;
  }

  function getCanvas2D(
    width: number,
    height: number,
  ): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Unable to create Crop & Rotate canvas");
    return ctx;
  }

  function canvasToPngBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
    if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to encode Crop & Rotate PNG"));
      }, "image/png");
    });
  }

  /**
   * Legacy hu.ke()/hu.ye() parity: bake from the same source + 2D transform math
   * used by the transform-window preview. Do not use the Viewer/WebGL readback
   * here; that path uses different viewport/shader crop semantics and causes the
   * applied image to disagree with the overlay preview.
   */
  async function bakeCropPreviewSource(
    source: CropSourceData,
    transform: TransformState,
  ): Promise<BakedCropImageData> {
    const display = legacyCropDisplayDimensions(source.width, source.height, transform);
    const cropX = Math.max(0, Math.min(1, transform.cropX)) * display.width;
    const cropY = Math.max(0, Math.min(1, transform.cropY)) * display.height;
    const cropWidth = Math.max(
      1,
      Math.round(Math.max(0, Math.min(1, transform.cropWidth)) * display.width),
    );
    const cropHeight = Math.max(
      1,
      Math.round(Math.max(0, Math.min(1, transform.cropHeight)) * display.height),
    );

    const sourceImage = new ImageData(
      new Uint8ClampedArray(source.buffer.slice(0)),
      source.width,
      source.height,
    );
    const bitmap = await createImageBitmap(sourceImage, {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });

    try {
      const ctx = getCanvas2D(cropWidth, cropHeight);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, cropWidth, cropHeight);
      ctx.save();
      ctx.translate(-cropX, -cropY);
      ctx.translate(display.width * 0.5, display.height * 0.5);
      ctx.rotate(
        ((orientationDegrees(transform.orientation) + transform.straighten) * Math.PI) / 180,
      );

      const fine = (Math.abs(transform.straighten) * Math.PI) / 180;
      const fs = Math.sin(fine);
      const fc = Math.cos(fine);
      const fillScale = Math.max(
        (display.width * fc + display.height * fs) / Math.max(1, display.width),
        (display.width * fs + display.height * fc) / Math.max(1, display.height),
      );

      ctx.scale(fillScale * (transform.flipX ? -1 : 1), fillScale * (transform.flipY ? -1 : 1));
      ctx.drawImage(bitmap, -source.width * 0.5, -source.height * 0.5, source.width, source.height);
      ctx.restore();

      const baked = ctx.getImageData(0, 0, cropWidth, cropHeight);
      const bytes = baked.data.slice();
      const blob = await canvasToPngBlob(ctx.canvas as OffscreenCanvas | HTMLCanvasElement);
      return {
        width: cropWidth,
        height: cropHeight,
        buffer: bytes.buffer,
        blob,
      };
    } finally {
      bitmap.close();
    }
  }

  async function persistBakedCropResult(
    assetId: string,
    params:
      | { restoreOriginal: true; editState: EditState }
      | ({ restoreOriginal: false; editState: EditState } & BakedCropImageData),
  ): Promise<void> {
    if (useOpfsPersistence()) {
      const bridge = storageBridge as StorageCropBridge;
      if (params.restoreOriginal === true) {
        if (!bridge.restoreActiveOriginalMediaImage) {
          throw new Error(
            "Crop & Rotate apply is not wired for OPFS persistence. Add storageBridge.restoreActiveOriginalMediaImage or disable OPFS for this build.",
          );
        }
        await bridge.restoreActiveOriginalMediaImage({
          editState: params.editState,
          viewport: cropResetViewport,
        });
      } else {
        if (!bridge.replaceActiveMediaImageWithData) {
          throw new Error(
            "Crop & Rotate apply is not wired for OPFS persistence. Add storageBridge.replaceActiveMediaImageWithData or disable OPFS for this build.",
          );
        }
        await bridge.replaceActiveMediaImageWithData({
          width: params.width,
          height: params.height,
          buffer: params.buffer,
          blob: params.blob,
          thumbnail: params.thumbnail,
          galleryPreview: params.galleryPreview,
          editState: params.editState,
          viewport: cropResetViewport,
        });
      }
      return;
    }

    if (params.restoreOriginal === true) {
      await mediaStore.restoreOriginalMediaImage(assetId, {
        editState: params.editState,
        viewport: cropResetViewport,
      });
      return;
    }

    await mediaStore.replaceMediaImageWithData(assetId, {
      width: params.width,
      height: params.height,
      buffer: params.buffer,
      thumbnail: params.thumbnail,
      galleryPreview: params.galleryPreview,
      editState: params.editState,
      viewport: cropResetViewport,
    });
  }

  async function reloadAssetAfterBakedCrop(assetId: string): Promise<void> {
    mediaSwitchToken += 1;
    if (useOpfsPersistence()) {
      const media = await storageBridge.switchMedia(assetId);
      if (!media) throw new Error("Unable to reload cropped image");
      await drawOpfsMedia(media);
    } else {
      await openAsset(assetId);
    }
  }

  function closeSplitPreview() {
    const isSplitEnabled = viewerApi?.isSplitEnabled?.() ?? splitActive();
    if (!isSplitEnabled) return;
    const result = viewerApi?.toggleSplit?.();
    setSplitActive(result ?? false);
  }

  async function loadStoredCropSourceData(assetId: string): Promise<CropSourceData | null> {
    if (useOpfsPersistence()) {
      const bridge = storageBridge as CropSourceBridge;
      return (await bridge.loadActiveOriginalCropSourceData?.()) ?? null;
    }

    const store = mediaStore as IndexedDbCropSourceStore;
    return (await store.loadCropSourceData?.(assetId)) ?? null;
  }

  function openCropOverlay() {
    setCropPreviewPainted(false);
    cropInitialTransform = cloneTransformState(editState.transform);
    setCropBusyLabel("Loading Original File...");
    setCropSourceData(undefined);
    clearTimeout(autosaveTimer);
    historyController.cancelPending();
    closeSplitPreview();
    setScopesState("visible", false);
    setActiveOverlay("crop");
    if (state.image) {
      void captureCropSourceData();
      setEditState("transform", "cropEnabled", true);
      enterCropEdit();
    }
  }

  async function captureCropSourceData(expected?: {
    assetId?: string;
    fileName?: string;
    width?: number;
    height?: number;
  }): Promise<boolean> {
    const assetId = activeAssetId();

    // Legacy opens Crop & Rotate from `original*` when a baked edit exists, then
    // reapplies the saved transform state inside the transform window. This is
    // why reopening the window keeps the rotation value instead of resetting to 0.
    if (assetId) {
      const stored = await loadStoredCropSourceData(assetId).catch(() => null);
      if (stored) {
        setCropSourceData({
          buffer: stored.buffer.slice(0),
          width: stored.width,
          height: stored.height,
          token: ++cropSourceToken,
        });
        return true;
      }
    }

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const image = state.image;
      const source = viewerApi?.getSourceImageData?.();
      const matchesExpected =
        !expected ||
        (expected.assetId
          ? activeAssetId() === expected.assetId
          : image?.fileName === expected.fileName &&
            source?.width === expected.width &&
            source?.height === expected.height);
      if (source && matchesExpected) {
        setCropSourceData({
          buffer: source.buffer.slice(0),
          width: source.width,
          height: source.height,
          token: ++cropSourceToken,
        });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    actions.setError("Unable to load original image for Crop & Rotate");
    return false;
  }

  async function makeThumbnailFromImageData(
    data: { buffer: ArrayBuffer; width: number; height: number },
    maxSize = 256,
  ): Promise<Blob | undefined> {
    const scale = Math.min(1, maxSize / Math.max(data.width, data.height, 1));
    const width = Math.max(1, Math.round(data.width * scale));
    const height = Math.max(1, Math.round(data.height * scale));
    const source = document.createElement("canvas");
    source.width = data.width;
    source.height = data.height;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return undefined;
    sourceCtx.putImageData(
      new ImageData(new Uint8ClampedArray(data.buffer.slice(0)), data.width, data.height),
      0,
      0,
    );

    const thumb = document.createElement("canvas");
    thumb.width = width;
    thumb.height = height;
    const thumbCtx = thumb.getContext("2d");
    if (!thumbCtx) return undefined;
    thumbCtx.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) => {
      thumb.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", 0.7);
    });
  }

  async function applyCropOverlay(
    options: {
      keepOpen?: boolean;
      keepBusy?: boolean;
      skipReload?: boolean;
    } = {},
  ): Promise<boolean> {
    if (cropApplying()) return false;
    const assetId = activeAssetId();
    if (!assetId || !viewerApi) {
      cropInitialTransform = null;
      if (!options.keepOpen) {
        exitCropEdit();
        setActiveOverlay(null);
      }
      return true;
    }

    setCropBusyLabel("Crunching Pixels...");
    setCropApplying(true);
    try {
      // Video crop is always non-destructive: retain transform geometry in EditState
      // and never replace the original clip with a baked still frame.
      if (videoState()) {
        const serialized = cloneSerializedState(currentSerializedEditState());
        pushHistoryState(assetId, serialized);
        if (useOpfsPersistence()) await storageBridge.autosaveActiveState(serialized);
        cropInitialTransform = null;
        if (!options.keepOpen) {
          exitCropEdit();
          setActiveOverlay(null);
        }
        setLastSavedSnapshot(mediaSnapshot());
        return true;
      }
      const appliedTransform = cloneTransformState(editState.transform);
      const persistedState = editStateAfterBakedCrop(appliedTransform);
      const shouldRestoreOriginal = isDefaultTransformShape(editState.transform);

      if (shouldRestoreOriginal) {
        setEditState("transform", persistedState.transform);
        await persistBakedCropResult(assetId, {
          restoreOriginal: true,
          editState: persistedState,
        });
      } else {
        let source = cropSourceData();
        if (!source) {
          const loaded = await captureCropSourceData();
          source = loaded ? cropSourceData() : undefined;
        }
        if (!source) {
          actions.setError("Unable to apply crop and rotate: preview source is missing");
          return false;
        }

        const baked = await bakeCropPreviewSource(source, appliedTransform);
        const [thumbnail, galleryPreview] = await Promise.all([
          makeThumbnailFromImageData(baked),
          createImageDerivative(
            new ImageData(
              new Uint8ClampedArray(baked.buffer.slice(0)),
              baked.width,
              baked.height,
            ),
            {
              maxLongEdge: GALLERY_PREVIEW_LONG_EDGE,
              mimeType: "image/jpeg",
              quality: GALLERY_PREVIEW_JPEG_QUALITY,
            },
          ),
        ]);

        setEditState("transform", persistedState.transform);
        await persistBakedCropResult(assetId, {
          restoreOriginal: false,
          width: baked.width,
          height: baked.height,
          buffer: baked.buffer,
          blob: baked.blob,
          thumbnail,
          galleryPreview,
          editState: persistedState,
        });
      }

      cropInitialTransform = null;
      if (!options.keepOpen) {
        exitCropEdit();
        setActiveOverlay(null);
      }
      if (!options.skipReload) {
        await reloadAssetAfterBakedCrop(assetId);
      }
      await refreshMediaList();
      setLastSavedSnapshot(mediaSnapshot());
      return true;
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to apply crop and rotate");
      return false;
    } finally {
      if (!options.keepBusy) setCropApplying(false);
    }
  }

  function cancelCropOverlay() {
    setCropBusyLabel("Cancelling...");
    if (cropInitialTransform) {
      setEditState("transform", cloneTransformState(cropInitialTransform));
    }
    cropInitialTransform = null;
    exitCropEdit();
    setActiveOverlay(null);
  }

  let cropAdjacentToken = 0;

  async function cropAdjacentAsset(delta: -1 | 1): Promise<void> {
    if (cropApplying() || mediaSwitching()) return;

    const items = mediaList();
    if (items.length < 2) return;

    const current = activeAssetId();
    const index = current ? items.findIndex((media) => media.assetId === current) : -1;
    if (index < 0) return;

    const next = items[(index + delta + items.length) % items.length];
    if (!next) return;

    const token = ++cropAdjacentToken;
    setCropBusyLabel(delta > 0 ? "Opening Next Image..." : "Opening Previous Image...");

    try {
      // Legacy behavior: Previous/Next is effectively Done → switch media → rebuild
      // the transform controller for the new active image. Do not close the overlay.
      // Also do not waste time reloading the just-applied current image because it
      // will immediately be replaced by the adjacent media.
      const applied = await applyCropOverlay({
        keepOpen: true,
        keepBusy: true,
        skipReload: true,
      });
      if (!applied || token !== cropAdjacentToken) return;

      setCropPreviewPainted(false);
      setCropSourceData(undefined);
      await loadActiveMedia(next.assetId);
      if (token !== cropAdjacentToken || activeAssetId() !== next.assetId) return;

      cropInitialTransform = cloneTransformState(editState.transform);
      setEditState("transform", "cropEnabled", true);
      setCropBusyLabel("Loading Original File...");
      const loaded = await captureCropSourceData({
        fileName: next.fileName,
        width: next.width,
        height: next.height,
      });
      if (loaded && token === cropAdjacentToken) enterCropEdit();
    } finally {
      if (token === cropAdjacentToken) setCropApplying(false);
    }
  }

  function openOverlay(kind: EditorOverlayKind) {
    if (kind === "projects" && !true) {
      toast.error("Sign in to load or save projects.", { id: "projects-auth-required" });
      return;
    }
    setBorderEditorVisible(false);
    if (kind === "relay") {
      setRelayOverlayMode("receive");
      void ensureRelaySession();
    }
    if (kind === "projects") {
      // Anchor the projects popover 10px above the trigger button. Capture its
      // position before the overlay opens; the popover's CSS reads these vars.
      const trigger = document.querySelector<HTMLElement>('[data-action="open-projects"]');
      if (trigger) {
        const r = trigger.getBoundingClientRect();
        const root = document.documentElement.style;
        root.setProperty("--pop-left", `${Math.round(r.left)}px`);
        root.setProperty("--pop-bottom", `${Math.round(window.innerHeight - r.top + 10)}px`);
      }
    }
    if (kind === "overlays") {
      closeSplitPreview();
      setScopesState("visible", false);
      setSelectedOverlayLayerId(null);
    }
    if (kind === "crop") {
      // Crop & Rotate is a still-image tool — never open it for a video clip.
      if (videoState()) return;
      openCropOverlay();
      return;
    }
    if (kind === "distort") {
      if (videoState()) return;
      // The Distort window previews the original pixels with the draft state,
      // so it needs the same source buffer the crop window uses.
      setCropBusyLabel("Loading Original File...");
      setCropSourceData(undefined);
      clearTimeout(autosaveTimer);
      historyController.cancelPending();
      closeSplitPreview();
      setScopesState("visible", false);
      setActiveOverlay("distort");
      if (state.image) void captureCropSourceData();
      return;
    }
    if (kind === "export") {
      closeSplitPreview();
      setScopesState("visible", false);
      setActiveOverlay(kind);
      return;
    }
    setActiveOverlay(kind);
    if (kind === "scopes" && state.image) {
      setScopesState("visible", true);
    }
  }

  async function ensureRelaySession(): Promise<RelayReceiveSession> {
    const existing = relaySession();
    if (existing) {
      void existing.start();
      return existing;
    }
    const { createRelayReceiveSession } = await import("../relay/receiveSession");
    const session = createRelayReceiveSession();
    setRelaySession(session);
    void session.start();
    return session;
  }

  function openBorderEditor(event: MouseEvent) {
    if (!state.image) return;
    closeSplitPreview();
    const trigger =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.querySelector<HTMLElement>('[data-action="open-border"]');
    setBorderOverlayAnchor(trigger ?? null);
    setActiveOverlay(null);
    setCropSourceData(undefined);
    void captureCropSourceData();
    setBorderEditorVisible(true);
  }

  function closeBorderEditor() {
    setBorderEditorVisible(false);
    setBorderOverlayAnchor(null);
    setCropSourceData(undefined);
  }

  function closeOverlay() {
    if (activeOverlay() === "crop") {
      cancelCropOverlay();
      return;
    }
    if (activeOverlay() === "overlays") {
      if (overlayDraftActive()) cancelOverlayDraft();
      clearMaskPreviews();
      setGradientPickerLayerId(null);
    }
    setActiveOverlay(null);
  }

  async function openImportFilePicker(): Promise<File[]> {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "*";
    input.style.display = "none";
    document.body.append(input);

    return new Promise((resolve) => {
      const finish = (files: File[]) => {
        input.remove();
        resolve(files);
      };
      input.onchange = () => finish(Array.from(input.files ?? []));
      input.oncancel = () => finish([]);
      input.click();
    });
  }

  async function triggerImport() {
    const files = await openImportFilePicker();
    await importFilesFromList(files);
  }

  async function importFilesToProject(projectId: string, files: File[]): Promise<void> {
    if (!files.length) return;
    if (projectId !== activeProjectId()) {
      await handleOpenProject(projectId);
    }
    await importFilesFromList(files);
  }

  async function importFilesFromList(files: File[]): Promise<void> {
    if (!files.length) return;

    enqueueFiles(files);
    await importProcessingPromise;
  }

  async function importRelayFile(file: File, mode: "open" | "add"): Promise<void> {
    const beforeActive = activeAssetId();
    const beforeIds = new Set(mediaList().map((media) => media.assetId));
    await importFilesFromList([file]);
    await refreshMediaList();
    const added =
      mediaList().find((media) => !beforeIds.has(media.assetId) && media.fileName === file.name) ??
      mediaList().find((media) => !beforeIds.has(media.assetId));
    if (!added) throw new Error("Hytic received the image but could not add it to the project.");
    if (mode === "open") {
      await openAssetByBackend(added.assetId);
      showNotice(`${file.name} is ready to edit.`);
    } else {
      if (beforeActive && activeAssetId() !== beforeActive) {
        await openAssetByBackend(beforeActive);
      }
      showNotice(`${file.name} was added to the project.`);
    }
    closeOverlay();
  }

  function clipboardFileName(type: string, index: number): string {
    const ext =
      type === "image/jpeg"
        ? "jpg"
        : type === "image/png"
          ? "png"
          : type === "image/webp"
            ? "webp"
            : type === "image/avif"
              ? "avif"
              : type === "image/gif"
                ? "gif"
                : type === "image/bmp"
                  ? "bmp"
                  : "png";
    return `clipboard-${Date.now().toString(36)}-${index + 1}.${ext}`;
  }

  function fileFromClipboardBlob(blob: File | Blob, index: number): File {
    if (blob instanceof File && blob.name) return blob;
    const type = blob.type || "image/png";
    return new File([blob], clipboardFileName(type, index), { type });
  }

  async function handleClipboardPaste(event: ClipboardEvent): Promise<void> {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files: File[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.type?.startsWith("image")) continue;
      const file = item.getAsFile();
      if (file) files.push(fileFromClipboardBlob(file, files.length));
    }
    if (!files.length) return;
    event.preventDefault();
    const label = `Import ${files.length} image${files.length === 1 ? "" : "s"} from clipboard?`;
    if (!window.confirm(label)) return;
    await importFilesFromList(files);
  }

  // A video whose codec the browser can't decode (ProRes, DNxHD, …). These all
  // funnel through here, so surfacing the supported-formats dialog in one place
  // covers the mediabunny remux, the single-frame grab, and the <video> probe.
  function isUnsupportedVideoError(error: unknown): boolean {
    if (error instanceof UnconvertibleVideoError) return true;
    return error instanceof Error && error.message === UNSUPPORTED_VIDEO_CODEC_MESSAGE;
  }

  function reportImportError(fileName: string, error: unknown) {
    if (isUnsupportedVideoError(error)) {
      setUnsupportedVideoPrompt({ name: fileName });
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    const message = `${fileName}: ${detail}`;
    setImportErrors((prev) => [message, ...prev].slice(0, 8));
    actions.setError(message);
  }

  function enqueueFiles(files: readonly File[]) {
    if (!files.length) return;

    if (!importSession) {
      setImportErrors([]);
      importSession = {
        previousAssetId: activeAssetId(),
        firstImportedAssetId: null,
        selectionRevision: userMediaSelectionRevision,
      };
      // Begin a fresh progress toast.
      clearTimeout(progressHideTimer);
      setProgressTotal(files.length);
      setProgressIndex(0);
      setProgressInfo("");
      setProgressStatus("loading");
    } else {
      // Files added while a session is already running grow the total.
      setProgressTotal((t) => t + files.length);
    }
    importQueue.push(...files);
    setImportQueueSize(importQueue.length + (importProcessing ? 1 : 0));
    if (!importProcessingPromise) {
      const promise = processImportQueue();
      importProcessingPromise = promise;
      void promise.finally(() => {
        if (importProcessingPromise === promise) importProcessingPromise = null;
      });
    }
  }

  // Final state for the import progress toast: pick success/partial/error, show a
  // summary, then auto-hide (longer when there were failures, like legacy).
  function finalizeImportProgress(total: number, failures: number) {
    if (!progressActive() || total === 0) {
      setProgressStatus("idle");
      return;
    }
    const ok = total - failures;
    if (failures === 0) {
      setProgressStatus("success");
      setProgressInfo(`${ok} file${ok === 1 ? "" : "s"} imported successfully.`);
    } else if (ok > 0) {
      setProgressStatus("partial");
      setProgressInfo(`${ok} of ${total} imported · ${failures} failed.`);
    } else {
      setProgressStatus("error");
      setProgressInfo(`${failures} file${failures === 1 ? "" : "s"} could not be imported.`);
    }
    clearTimeout(progressHideTimer);
    progressHideTimer = window.setTimeout(
      () => {
        setProgressStatus("idle");
        setProgressTotal(0);
        setProgressIndex(0);
        setProgressInfo("");
      },
      failures === 0 ? 1800 : 4500,
    );
  }

  // Resolves to the chosen import mode, or null if the user dismissed the dialog.
  function askVideoImportMode(file: File): Promise<VideoImportMode | null> {
    videoImportResolve?.(null); // settle any stale prompt before opening a new one
    return new Promise((resolve) => {
      const previewUrl = URL.createObjectURL(file);
      videoImportResolve = (mode) => {
        videoImportResolve = null;
        URL.revokeObjectURL(previewUrl);
        setVideoImportPrompt(null);
        resolve(mode);
      };
      setVideoImportPrompt({ name: file.name, previewUrl });
    });
  }

  async function processImportQueue() {
    if (importProcessing) return;
    importProcessing = true;
    let processed = 0;
    let failures = 0;
    try {
      while (importQueue.length > 0) {
        const file = importQueue.shift();
        if (!file) continue;
        setImportQueueSize(importQueue.length + 1);
        setProgressIndex(processed + 1);
        reportImportStage(file, "preparing");
        // Videos get a choice: edit the clip, or grab one frame as a still photo.
        let target: File = file;
        if (isVideoFile(file)) {
          const mode = await askVideoImportMode(file);
          if (!mode) {
            setProgressTotal((total) => Math.max(0, total - 1));
            setImportQueueSize(importQueue.length);
            continue; // dismissed → skip this file without counting it
          }
          if (mode === "frame") {
            try {
              target = await extractVideoFrameFile(file);
            } catch (error) {
              reportImportError(file.name, error);
              processed += 1;
              failures += 1;
              continue;
            }
          } else if (needsMp4Normalization(file)) {
            // Editing the clip needs a browser-playable file; re-wrap .mov/.avi/.mkv
            // as MP4 (fast lossless remux when the codec is already MP4-compatible).
            // Codecs WebCodecs can't decode (e.g. ProRes) throw and surface the
            // unsupported-format dialog via reportImportError.
            try {
              setProgressInfo(`Converting ${file.name}…`);
              target = await convertToMp4(file);
              setProgressInfo(file.name);
            } catch (error) {
              reportImportError(file.name, error);
              processed += 1;
              failures += 1;
              continue;
            }
          }
        }
        const media = await importOneFile(target);
        processed += 1;
        if (!media) failures += 1;
        if (media && !importSession?.firstImportedAssetId) {
          importSession!.firstImportedAssetId = media.assetId;
        }
      }
    } finally {
      const session = importSession;
      importProcessing = false;
      importSession = null;
      setImportQueueSize(0);
      setProgressInfo("Finishing import…");
      try {
        await refreshMediaList();
        const selection = true
          ? resolvePostImportSelection({
              previousAssetId: session?.previousAssetId ?? null,
              firstImportedAssetId: session?.firstImportedAssetId ?? null,
              activeAssetId: activeAssetId(),
              selectionRevision: session?.selectionRevision ?? -1,
              currentSelectionRevision: userMediaSelectionRevision,
            })
          : {
              targetAssetId: activeAssetId(),
              selectionIsCurrent: true,
              shouldSwitch: false,
            };
        if (importTransitionActive()) {
          pendingImportRevealAssetId = selection.selectionIsCurrent
            ? selection.targetAssetId
            : null;
        }

        let switchSucceeded = true;
        if (selection.shouldSwitch && selection.targetAssetId) {
          switchSucceeded = await openAssetByBackend(selection.targetAssetId);
          await refreshMediaList();
        }
        if (importTransitionActive()) {
          if (!selection.selectionIsCurrent || !selection.targetAssetId || !switchSucceeded) {
            cancelImportTransition();
          } else if (!selection.shouldSwitch) {
            revealImportTransitionAfterRender(selection.targetAssetId);
          }
        }
      } finally {
        finalizeImportProgress(processed, failures);
      }
    }
  }

  async function openAssetByBackend(assetId: string): Promise<boolean> {
    if (assetId === activeAssetId() && !restoringAssetId) return true;
    if (useOpfsPersistence()) {
      const media = await storageBridge.switchMedia(assetId, true);
      if (!media) return false;
      await drawOpfsMedia(media);
      return true;
    }
    return openAsset(assetId);
  }

  async function importOneFile(
    file: File,
  ): Promise<Awaited<ReturnType<typeof mediaStore.addMedia>> | ImportedMediaRef | null> {
    try {
      if (!isSupportedImageFile(file)) {
        throw new Error(getUnsupportedImageMessage(file));
      }
      reportImportStage(file, "preparing");
      await flushAutosave();
      if (useOpfsPersistence()) {
        if (isBooting() && bootPromise) await bootPromise;
        const mediaDir = await storageBridge.importToOpfs(file, {
          onStage: (stage) => reportImportStage(file, stage),
        });
        return { assetId: mediaDir.name };
      }
      return await importOneFileInBackground(file);
    } catch (error) {
      reportImportError(file.name, error);
      return null;
    }
  }

  async function importOneFileInBackground(
    file: File,
  ): Promise<Awaited<ReturnType<typeof mediaStore.addMedia>> | null> {
    if (isBooting() && bootPromise) await bootPromise;
    const projectId = await ensureActiveProjectForImport();
    const { decodeImportFile } = await import("../project/storage/mediaImportDecoders");
    reportImportStage(file, "decoding");
    const decoded = await decodeImportFile(file);
    const format = detectImageFormat(file);
    const storage: MediaImageStorage = decoded.kind === "image-data" ? "data" : "original";
    reportImportStage(file, "derivatives");
    const [thumbnail, galleryPreview] = await createImageDerivatives(
      decoded.thumbnailSource,
      [
        { maxLongEdge: 256, mimeType: "image/jpeg", quality: 0.7 },
        {
          maxLongEdge: GALLERY_PREVIEW_LONG_EDGE,
          mimeType: "image/jpeg",
          quality: GALLERY_PREVIEW_JPEG_QUALITY,
        },
      ],
    );
    const importEditState = defaultEditStateForImport(file);
    const width = Number(decoded.metadata.width) || decoded.imageData?.width || 0;
    const height = Number(decoded.metadata.height) || decoded.imageData?.height || 0;
    const params: AddMediaParams = {
      fileName: String(decoded.metadata.name ?? file.name),
      mimeType: String(decoded.metadata.mimeType ?? file.type ?? "image/png"),
      format: format ?? undefined,
      width,
      height,
      sourceSize: file.size,
      sourceLastModified: file.lastModified,
      catalogAccountId: LOCAL_WORKSPACE_ID,
      editState: importEditState,
      storage,
      metadata: decoded.metadata,
      blob: decoded.imageBlob,
      buffer: decoded.imageData?.data.buffer,
      thumbnail: thumbnail ?? undefined,
      galleryPreview: galleryPreview ?? undefined,
    };
    reportImportStage(file, "writing");
    return await mediaStore.addMedia(projectId, params, { activate: false });
  }

  function settlePendingTransientImport(
    media: ImportedMediaRef | null,
    expectedFile?: File | null,
    expectedResolve?: typeof pendingImportResolve,
  ): void {
    if (expectedFile !== undefined && awaitingImportFile !== expectedFile) return;
    if (expectedResolve !== undefined && pendingImportResolve !== expectedResolve) return;
    const resolve = pendingImportResolve;
    pendingImportResolve = null;
    awaitingImportFile = null;
    pendingImportEditState = null;
    pendingTransientAssetId = null;
    resolve?.(media);
  }

  function importTransientFile(file: File): Promise<ImportedMediaRef | null> {
    return new Promise((resolve) => {
      settlePendingTransientImport(null);
      reportImportStage(file, "decoding");
      pendingTransientAssetId = `guest-${crypto.randomUUID()}`;
      awaitingImportFile = file;
      pendingImportEditState = defaultEditStateForImport(file);
      pendingImportResolve = resolve;
      restoringAssetId = null;
      clearPendingRestore();
      setRestoreImageData(undefined);
      setLoadingImage(true);
      actions.selectFile(file);
    });
  }

  // A NEW file import (picker / drop / dev hook): decode it (via the engine), then
  // finalizeImport persists it as a new asset. Restores never go through here.
  function loadFile(file: File) {
    void importFilesFromList([file]);
  }

  // function startImportFile(file: File) {
  //   restoringAssetId = null;
  //   clearPendingRestore();
  //   awaitingImportFile = file;
  //   // Defer applying edit state until after the new image starts loading. This
  //   // prevents the old image from rendering with wrong IDT (e.g., VisionLog for
  //   // RAW) during the decode period.
  //   pendingImportEditState = defaultEditStateForImport(file);
  //   setRestoreImageData(undefined); // a fresh file load supersedes any cached restore
  //   actions.selectFile(file);
  // }

  function handleImageLoaded(image: ImageInfo) {
    actions.setImage(image);

    let stateAppliedAfterDraw = false;
    let renderedAssetId: string | null = null;
    if (restoringAssetId && activeAssetId() === restoringAssetId) {
      renderedAssetId = restoringAssetId;
      if (pendingRestoreEditState) {
        const stagedState = cloneSerializedState(pendingRestoreEditState);
        setEditState(reconcile(deserializeEditState(stagedState)));
        resetHistoryForAsset(restoringAssetId, stagedState, pendingRestoreSnapshots);
        stateAppliedAfterDraw = true;
      }
      if (pendingViewportRestore) {
        viewerApi?.restoreViewport?.(pendingViewportRestore);
      }
      clearPendingRestore();
      restoringAssetId = null;
      const projectId = activeProjectId();
      if (projectId) lastRenderedMedia = { projectId, assetId: renderedAssetId };
      setLastSavedSnapshot(mediaSnapshot());
    }
    batch(() => {
      setHasImage(viewerApi?.hasImage?.() ?? true);
      setSplitActive(false);
      setLoadingImage(false);
    });
    finishImageLoadAfterPaint();
    // Opt-in reload/preview audit (window.__DEBUG_PREVIEW_LOADING__ = true): the
    // app-level half of the trace. The engine logs the preview-resolution half.
    if ((window as { __DEBUG_PREVIEW_LOADING__?: boolean }).__DEBUG_PREVIEW_LOADING__) {
       
      console.table({
        activeProjectId: activeProjectId(),
        activeUserMedia: activeAssetId(),
        sourceType: image.format ?? "(unknown)",
        mimeType: image.mimeType ?? "(unknown)",
        originalWidth: image.width,
        originalHeight: image.height,
        finalOrientedWidth: image.width,
        finalOrientedHeight: image.height,
        viewerAspectRatio: Number((image.width / Math.max(1, image.height)).toFixed(6)),
        defaultIDT: editState.colorManagement.inputColorSpaceId,
        defaultODT: editState.colorManagement.displayColorSpaceId,
        wasRestore: stateAppliedAfterDraw,
        stateAppliedAfterDraw,
      });
    }
    const file = awaitingImportFile;
    const isImportLoad = !!file && file === state.selectedFile;
    if (isImportLoad) {
      // Keep this state detached until addMedia has committed the new asset id.
      const importEditState = pendingImportEditState ?? defaultEditStateForImport(file);
      const resolve = pendingImportResolve;
      void finalizeImport(image, file, importEditState)
        .then((media) => settlePendingTransientImport(media, file, resolve))
        .catch((error) => {
          reportImportError(file.name, error);
          settlePendingTransientImport(null, file, resolve);
        });
    }
    // Auto-detect letterbox/pillarbox bars and crop them out (so grading analysis
    // and effects ignore the bars — see crop-respected-everywhere). Gated on a
    // pristine transform, so reopened/edited assets reuse their persisted crop.
    if (!isImportLoad) scheduleContentBoundsAutoCrop(image);
    if (renderedAssetId) revealImportTransitionAfterRender(renderedAssetId);
    // Warm the other project assets' color shaders once this image is up, so a
    // later switch to any of them is instant (deferred to not compete with render).
    setTimeout(prewarmProjectColors, 0);
  }

  // Bumped on every media load so a slow detection from a previous asset never
  // applies its crop after the user has moved on to a different import (req:
  // cancellation/asset-token safety).
  let contentBoundsLoadToken = 0;

  function contentBoundsDebug(): boolean {
    return (window as { __DEBUG_CONTENT_BOUNDS__?: boolean }).__DEBUG_CONTENT_BOUNDS__ === true;
  }

  /**
   * Kicks off async letterbox/pillarbox detection for the freshly-loaded media
   * and, if confident, applies the content rect as the transform crop. Only runs
   * when the transform is still the import default — so a user crop or a restored
   * (already auto-cropped) asset is never disturbed, and the persisted crop acts
   * as the cached detection result on reopen.
   */
  function scheduleContentBoundsAutoCrop(image: ImageInfo): void {
    if (!isDefaultTransformShape(editState.transform)) {
      if (contentBoundsDebug())
        console.log("[content-bounds] skipped — transform not default", { ...editState.transform });
      return;
    }
    if (contentBoundsDebug())
      console.log("[content-bounds] scheduling", { format: image.format, file: image.fileName });
    const token = ++contentBoundsLoadToken;
    void runContentBoundsAutoCrop(image, token);
  }

  async function runContentBoundsAutoCrop(image: ImageInfo, token: number): Promise<void> {
    try {
      let width: number;
      let height: number;
      let boundsWidth: number;
      let boundsHeight: number;
      let bounds: ContentBounds;
      if (image.format === "video") {
        const video = viewerApi?.getVideoElement?.();
        if (!video || !video.videoWidth || !video.videoHeight) return;
        width = video.videoWidth;
        height = video.videoHeight;
        boundsWidth = width;
        boundsHeight = height;
        bounds = await detectContentBoundsForVideo(video);
      } else {
        const analysis = viewerApi?.getSourceAnalysisImageData(MAX_ANALYSIS_DIM);
        if (!analysis) return;
        width = analysis.sourceWidth;
        height = analysis.sourceHeight;
        boundsWidth = analysis.imageData.width;
        boundsHeight = analysis.imageData.height;
        bounds = await detectContentBoundsForImage(analysis.imageData);
      }
      if (contentBoundsDebug())
        console.log("[content-bounds] detected", {
          width,
          height,
          analysisWidth: boundsWidth,
          analysisHeight: boundsHeight,
          bounds,
        });
      // Stale-guard: a newer media load, or a user edit, supersedes this result.
      if (token !== contentBoundsLoadToken) return;
      if (!isDefaultTransformShape(editState.transform)) return;
      if (boundsAreFullFrame(bounds, boundsWidth, boundsHeight)) {
        if (contentBoundsDebug()) console.log("[content-bounds] no bars detected");
        return;
      }
      const crop = contentBoundsToCropRect(bounds, boundsWidth, boundsHeight);
      setEditState("transform", {
        ...editState.transform,
        cropEnabled: true,
        cropX: crop.x,
        cropY: crop.y,
        cropWidth: crop.width,
        cropHeight: crop.height,
      });
      if (contentBoundsDebug()) console.log("[content-bounds] applied crop", crop);
    } catch (error) {
      if (contentBoundsDebug()) console.warn("[content-bounds] detection failed", error);
    }
  }

  function previewVideoTrim(next: SerializedVideoState) {
    setVideoState(next);
  }

  function handleVideoElementChange(video: HTMLVideoElement | undefined) {
    setVideoElement(video);
    if (!video || videoState()) return;
    const durationUs = Math.round(video.duration * 1_000_000);
    const initial = clampVideoTrim({ trimStartUs: 0, trimEndUs: durationUs }, durationUs);
    setVideoState(initial);
    setVideoHistory([initial]);
    setVideoHistoryIndex(0);
  }

  function commitVideoTrim(next: VideoTrimCommit) {
    const value = { trimStartUs: next.trimStartUs, trimEndUs: next.trimEndUs };
    const entries = [...videoHistory().slice(0, videoHistoryIndex() + 1), value].slice(-100);
    setVideoState(value);
    setVideoHistory(entries);
    setVideoHistoryIndex(entries.length - 1);
    if (useOpfsPersistence()) {
      void storageBridge.autosaveActiveVideoState(value);
    }
  }

  function goToVideoHistory(index: number) {
    const nextIndex = Math.max(0, Math.min(videoHistory().length - 1, index));
    const value = videoHistory()[nextIndex];
    if (!value) return;
    setVideoHistoryIndex(nextIndex);
    setVideoState(value);
    const video = viewerApi?.getVideoElement();
    if (video) video.currentTime = value.trimStartUs / 1_000_000;
    if (useOpfsPersistence()) {
      void storageBridge.autosaveActiveVideoState(value);
    }
  }

  function handleViewerError(error: string) {
    imageRevealToken += 1;
    const file = awaitingImportFile;
    const resolve = pendingImportResolve;
    if (file && resolve) {
      reportImportError(file.name, error);
      settlePendingTransientImport(null, file, resolve);
      return;
    }
    const failedRestore = restoringAssetId;
    const fallbackAssetId = restoreFallbackAssetId;
    if (failedRestore) {
      restoringAssetId = null;
      clearPendingRestore();
      setBootThumb(undefined);
      batch(() => {
        setHasImage(viewerApi?.hasImage?.() ?? false);
        setLoadingImage(false);
      });
      finishStartupImageRestore(false);
      if (fallbackAssetId && fallbackAssetId !== failedRestore) {
        queuedMediaAssetId = fallbackAssetId;
        if (temporaryMediaOperationDepth === 0) void drainQueuedMediaSwitches();
      }
    }
    actions.setError(error);
  }

  async function ensureActiveProjectForImport(): Promise<string> {
    const current = activeProjectId();
    if (current) return current;
    const project = await projectStore.resolveBootProject(null);
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    setProjectName(project.name);
    setCurrentProjectId(project.id);
    await appSessionStore.setActive(project.id, null);
    await refreshMediaList();
    return project.id;
  }

  // Persists a freshly-imported file as a new asset, writing its pixels ONCE.
  // Heavy formats (RAW/TIFF/EXR/DPX/HEIC) are cached as decoded raw RGBA
  // (kind:"data") so reload skips decode entirely; light formats keep the native
  // file (kind:"original"). The thumbnail is generated once here, never again.
  async function finalizeImport(
    image: ImageInfo,
    file: File,
    importEditState: EditState,
  ): Promise<Awaited<ReturnType<typeof mediaStore.addMedia>> | ImportedMediaRef | null> {
    if (isBooting() && bootPromise) {
      await bootPromise;
    }
    if (state.selectedFile !== file) return null; // superseded by a newer import
    reportImportStage(file, "finalizing");

    const projectId = await ensureActiveProjectForImport();
    const format = detectImageFormat(file);
    const heavy = !!format && format !== "video" && shouldUseImageDecodeWorker(format);
    const [thumbnail, galleryPreview] = await Promise.all([
      viewerApi?.getSourceThumbnailBlob?.(256),
      viewerApi?.getSourceThumbnailBlob?.(GALLERY_PREVIEW_LONG_EDGE),
    ]);

    let storage: MediaImageStorage = "original";
    let blob: Blob | undefined = file;
    let buffer: ArrayBuffer | undefined;
    if (heavy) {
      const raw = viewerApi?.getSourceImageData?.();
      if (!raw) {
        throw new Error("Unable to cache decoded image.data for this media. Re-import it to continue.");
      }
      storage = "data";
      buffer = raw.buffer;
      blob = undefined;
    }
    const extension = (() => {
      const dot = file.name.lastIndexOf(".");
      return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
    })();

    const params: AddMediaParams = {
      fileName: image.fileName,
      mimeType: file.type || "image/png",
      format: format ?? undefined,
      width: image.width,
      height: image.height,
      editState: importEditState,
      storage,
      metadata: {
        ...(await readExif(file)),
        width: image.width,
        height: image.height,
        originalName: file.name,
        name: file.name,
        type: file.type,
        mimeType: file.type || (format ? `image/${format}` : undefined),
        extension,
        format: format ?? undefined,
        storage,
      },
      blob,
      buffer,
      thumbnail: thumbnail ?? undefined,
      galleryPreview: galleryPreview ?? undefined,
      viewport: state.viewport,
    };
    const media = await mediaStore.addMedia(projectId, params);
    const importedSerializedState = toPlainSerializedEditState(importEditState);
    // Set the autosave baseline synchronously (before any await) so the import
    // itself doesn't schedule a redundant save. Asset ownership and its edit state
    // become live together, never while the previous asset is still active.
    batch(() => {
      setActiveAssetId(media.assetId);
      setEditState(reconcile(importEditState));
      lastRenderedMedia = { projectId, assetId: media.assetId };
      resetHistoryForAsset(media.assetId, importedSerializedState, media.snapshots ?? []);
      setLastSavedSnapshot(mediaSnapshot());
    });
    if (
      !importSession?.previousAssetId &&
      !importSession?.firstImportedAssetId &&
      importQueue.length === 0
    ) {
      scheduleContentBoundsAutoCrop(image);
    }
    await appSessionStore.setActive(projectId, media.assetId);
    await refreshMediaList();
    return media;
  }

  async function performMediaSwitch(assetId: string, token = mediaSwitchToken): Promise<boolean> {
    if (assetId === activeAssetId() && !restoringAssetId) return true;
    setMediaSwitching(true);
    const start = performance.now();
    try {
      saveOutgoingMediaInBackground();
      if (token !== mediaSwitchToken) return false;
      if (useOpfsPersistence()) {
        const media = await storageBridge.switchMedia(assetId);
        if (!media || media.name !== assetId || token !== mediaSwitchToken) return false;
        const format = storedMediaFormat(media);
        if (
          media.image instanceof Blob &&
          format &&
          format !== "video" &&
          shouldUseImageDecodeWorker(format)
        ) {
          if (format === "raw") perf.recordRawDecodeDuringSwitch();
          perf.recordHeavyDecodeDuringSwitch();
          setBootThumb(undefined);
          actions.setError("Cached image.data is missing for this media. Re-import it to continue.");
          return false;
        }
        await drawOpfsMedia(media, token);
        return activeAssetId() === assetId;
      }
      return await openAsset(assetId, token);
    } finally {
      perf.recordMediaSwitch(performance.now() - start);
      setMediaSwitching(false);
    }
  }

  async function drainQueuedMediaSwitches(): Promise<void> {
    if (mediaSwitchDrain) return mediaSwitchDrain;
    const drain = (async () => {
      while (temporaryMediaOperationDepth === 0 && queuedMediaAssetId) {
        const nextAssetId = queuedMediaAssetId;
        const nextToken = queuedMediaSwitchToken;
        queuedMediaAssetId = null;
        await performMediaSwitch(nextAssetId, nextToken);
      }
    })().finally(() => {
      mediaSwitchDrain = null;
      if (temporaryMediaOperationDepth === 0 && queuedMediaAssetId) {
        void drainQueuedMediaSwitches();
      }
    });
    mediaSwitchDrain = drain;
    return drain;
  }

  // Media-strip/keyboard selection is latest-wins. A slow cache read or browser
  // decode may finish, but any newer requested asset is immediately loaded next;
  // the Viewer's request id prevents the stale decode from becoming visible.
  async function loadActiveMedia(assetId: string): Promise<boolean> {
    if (assetId === activeAssetId() && !restoringAssetId && !queuedMediaAssetId) {
      return true;
    }
    userMediaSelectionRevision += 1;
    queuedMediaSwitchToken = ++mediaSwitchToken;
    queuedMediaAssetId = assetId;
    viewerApi?.cancelImageLoad?.();
    if (temporaryMediaOperationDepth > 0) return false;
    await drainQueuedMediaSwitches();
    return activeAssetId() === assetId;
  }

  async function createVirtualCopy(assetId: string): Promise<void> {
    await flushAutosave();
    const name = `${mediaDisplayName(assetId).replace(/\s+Copy(?: \d+)?$/, "")} Copy`;
    if (useOpfsPersistence()) await storageBridge.createVirtualCopyByName(assetId, name);
    else await mediaStore.createVirtualCopy(assetId, name);
    await refreshMediaList();
    showNotice(`Virtual copy created from “${mediaDisplayName(assetId)}”.`);
  }

  async function renameMediaVariant(assetId: string, name: string): Promise<void> {
    if (useOpfsPersistence()) await storageBridge.renameMediaVariantByName(assetId, name);
    else await mediaStore.renameMediaVariant(assetId, name);
    await refreshMediaList();
  }

  async function setPrimaryMediaVariant(assetId: string): Promise<void> {
    if (useOpfsPersistence()) await storageBridge.setPrimaryMediaVariantByName(assetId);
    else await mediaStore.setPrimaryMediaVariant(assetId);
    await refreshMediaList();
  }

  async function compareMediaBeforeAfter(assetId: string): Promise<void> {
    if (assetId !== activeAssetId()) {
      const previousTextureVersion = viewerApi?.getRendererDebugSnapshot().source.textureVersion ?? -1;
      if (!(await openAssetByBackend(assetId))) return;
      if (!(await waitForExportReady(assetId, previousTextureVersion))) return;
    }
    closeOverlay();
    const result = viewerApi?.toggleSplit?.();
    if (result !== undefined) setSplitActive(result);
  }

  async function selectAdjacentMedia(delta: -1 | 1): Promise<boolean> {
    const items = mediaList();
    if (items.length < 2) return false;
    const current = activeAssetId();
    const index = current ? items.findIndex((media) => media.assetId === current) : -1;
    if (index < 0) return false;
    const next = items[(index + delta + items.length) % items.length];
    return next ? loadActiveMedia(next.assetId) : false;
  }

  async function withTemporaryMediaOperation<T>(
    operation: (switchMedia: (assetId: string) => Promise<boolean>) => Promise<T>,
  ): Promise<T> {
    const originalAssetId = activeAssetId();
    temporaryMediaOperationDepth += 1;
    try {
      if (mediaSwitchDrain) await mediaSwitchDrain;
      return await operation(performMediaSwitch);
    } finally {
      if (originalAssetId && originalAssetId !== activeAssetId()) {
        await performMediaSwitch(originalAssetId);
      }
      temporaryMediaOperationDepth = Math.max(0, temporaryMediaOperationDepth - 1);
      if (temporaryMediaOperationDepth === 0 && queuedMediaAssetId) {
        await drainQueuedMediaSwitches();
      }
    }
  }

  async function deleteMediaAssets(assetIds: string[]) {
    const projectId = activeProjectId();
    if (!projectId || assetIds.length === 0 || mediaSwitching()) return;
    setMediaSwitching(true);
    try {
      await flushAutosave();
      if (useOpfsPersistence()) {
        const deletingActiveOpfs = !!activeAssetId() && assetIds.includes(activeAssetId()!);
        await storageBridge.deleteMediaVariantsByName(
          assetIds.filter((name) => name !== activeAssetId()),
        );
        if (deletingActiveOpfs) {
          const next = await storageBridge.deleteActiveMedia();
          if (next) {
            await drawOpfsMedia(next);
          } else {
            mediaSwitchToken += 1;
            restoringAssetId = null;
            clearPendingRestore();
            setActiveAssetId(null);
            setRestoreImageData(undefined);
            resetHistoryForAsset(null, null);
            setBootThumb(undefined);
            setCropEditMode(false);
            actions.clearImage();
            viewerApi?.clearImage?.();
          }
        }
        const workspaceId = LOCAL_WORKSPACE_ID;
        if (workspaceId) {
          await storageBridge.cleanupCollectionReferences(
            "opfs",
            workspaceId,
            assetIds.map((assetId) => ({ projectId, assetId })),
          );
        }
        await refreshMediaList();
        return;
      }
      const deletingActive = !!activeAssetId() && assetIds.includes(activeAssetId()!);
      const nextActive = await projectStore.deleteMediaAssets(projectId, assetIds);
      const workspaceId = LOCAL_WORKSPACE_ID;
      if (workspaceId) {
        await storageBridge.cleanupCollectionReferences(
          "indexeddb",
          workspaceId,
          assetIds.map((assetId) => ({ projectId, assetId })),
        );
      }
      await refreshMediaList();

      if (deletingActive) {
        if (nextActive) {
          await openAsset(nextActive);
        } else {
          mediaSwitchToken += 1;
          restoringAssetId = null;
          clearPendingRestore();
          awaitingImportFile = null;
          pendingImportEditState = null;
          setActiveAssetId(null);
          setRestoreImageData(undefined);
          resetHistoryForAsset(null, null);
          setBootThumb(undefined);
          setCropEditMode(false);
          actions.clearImage();
          viewerApi?.clearImage?.();
          await appSessionStore.setActive(projectId, null);
        }
      } else {
        await appSessionStore.setActive(projectId, activeAssetId());
      }

      await refreshMediaList();
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to delete media");
      throw error;
    } finally {
      setMediaSwitching(false);
    }
  }

  // Background-compiles the IDT/ODT color shaders for EVERY asset in the active
  // project, so switching between assets (notably between RAWs, whose camera-log
  // IDT is otherwise compiled lazily ~800ms on first use) is always a cache hit =
  // instant, matching legacy's lag-free switching. Deferred so it never competes
  // with the just-loaded image's first render; cached combos are skipped.
  function prewarmProjectColors() {
    const pid = activeProjectId();
    if (!viewerApi || !pid) return;
    if (useOpfsPersistence()) return;
    void mediaStore.listColorCombos(pid).then((combos) => {
      if (combos.length > 0) viewerApi?.prewarmColorCombos?.(combos);
    });
  }

  // Dev-only hook so the preview harness (which can't drive a file picker) can
  // load an image to verify grading: window.__potoLoadFile(File).
  if (import.meta.env.DEV) {
     
    (window as any).__potoLoadFile = loadFile;
     
    (window as any).__potoImportFiles = importFilesFromList;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    void importFilesFromList(Array.from(files));
  }

  function enterCropEdit() {
    setCropEditMode(true);
    viewerApi?.setCropEditMode?.(true);
  }

  function exitCropEdit() {
    setCropEditMode(false);
    setCropPreviewPainted(false);
    setCropSourceData(undefined);
    viewerApi?.setCropEditMode?.(false);
  }

  // Switches to a project's active media (boot-equivalent for an explicit open).
  async function loadProject(projectId: string) {
    if (useOpfsPersistence()) {
      const { project, media } = await storageBridge.openProject(projectId);
      setActiveProjectId(project.state.id);
      setActiveProjectName(project.state.name);
      setProjectName(project.state.name);
      setCurrentProjectId(project.state.id);
      if (media) {
        await drawOpfsMedia(media);
      }
      await refreshMediaList();
      return;
    }
    const project = await projectStore.getProject(projectId);
    if (!project) return;
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    setProjectName(project.name);
    setCurrentProjectId(project.id);
    const candidates = project.activeUserMedia
      ? [
          project.activeUserMedia,
          ...project.assetIds.filter((assetId) => assetId !== project.activeUserMedia),
        ]
      : project.assetIds;
    let loaded = false;
    for (const assetId of candidates) {
       
      loaded = await openAsset(assetId);
      if (loaded) break;
    }
    await refreshMediaList();
  }

  // "Save" in the always-autosaved model = name the active project; "Save as new"
  // (forceNew) creates a fresh project to import into. Pixels/edits persist
  // continuously, so there is no destructive write here.
  async function handleSaveProject(forceNew: boolean) {
    setIsSaving(true);
    try {
      if (forceNew) {
        await flushAutosave();
        if (useOpfsPersistence()) {
          const project = await storageBridge.createAndActivateProject(projectName() || "Hytic");
          setActiveProjectId(project.state.id);
          setActiveProjectName(project.state.name);
          setCurrentProjectId(project.state.id);
          setActiveAssetId(null);
          clearPendingRestore();
          setRestoreImageData(undefined);
          resetHistoryForAsset(null, null);
          await refreshMediaList();
          return;
        }
        const project = await projectStore.createProject(projectName() || "Hytic");
        setActiveProjectId(project.id);
        setActiveProjectName(project.name);
        setCurrentProjectId(project.id);
        setActiveAssetId(null);
        clearPendingRestore();
        setRestoreImageData(undefined);
        resetHistoryForAsset(null, null);
        await appSessionStore.setActive(project.id, null);
        await refreshMediaList();
      } else {
        const pid = activeProjectId();
        if (pid) {
          if (useOpfsPersistence()) {
            await storageBridge.renameProjectById(pid, projectName());
          } else {
            await projectStore.renameProject(pid, projectName());
          }
          setActiveProjectName(projectName());
        }
      }
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to save project");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateProject(name: string) {
    setIsSaving(true);
    try {
      await flushAutosave();
      if (useOpfsPersistence()) {
        const project = await storageBridge.createAndActivateProject(
          name.trim() || "Default Project",
        );
        setActiveProjectId(project.state.id);
        setActiveProjectName(project.state.name);
        setProjectName(project.state.name);
        setCurrentProjectId(project.state.id);
        setActiveAssetId(null);
        clearPendingRestore();
        setRestoreImageData(undefined);
        resetHistoryForAsset(null, null);
        setBootThumb(undefined);
        actions.clearImage();
        viewerApi?.clearImage?.();
        await refreshMediaList();
        return;
      }
      const project = await projectStore.createProject(name.trim() || "Default Project");
      setActiveProjectId(project.id);
      setActiveProjectName(project.name);
      setProjectName(project.name);
      setCurrentProjectId(project.id);
      setActiveAssetId(null);
      clearPendingRestore();
      setRestoreImageData(undefined);
      resetHistoryForAsset(null, null);
      setBootThumb(undefined);
      actions.clearImage();
      viewerApi?.clearImage?.();
      await appSessionStore.setActive(project.id, null);
      await refreshMediaList();
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to create project");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRenameProject(projectId: string, name: string) {
    const nextName = name;
    if (!nextName.trim()) return;
    try {
      if (useOpfsPersistence()) {
        await storageBridge.renameProjectById(projectId, nextName);
      } else {
        await projectStore.renameProject(projectId, nextName);
      }
      if (projectId === activeProjectId()) {
        setActiveProjectName(nextName);
        setProjectName(nextName);
      }
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to rename project");
      throw error;
    }
  }

  let projectOpenQueue: Promise<void> = Promise.resolve();

  async function handleOpenProject(projectId: string) {
    const open = async () => {
      try {
        if (projectId === activeProjectId()) return;
        queuedMediaAssetId = null;
        if (mediaSwitchDrain) await mediaSwitchDrain;
        await flushAutosave();
        await loadProject(projectId);
        exitCropEdit();
      } catch (error) {
        actions.setError(error instanceof Error ? error.message : "Failed to open project");
      }
    };
    const queuedOpen = projectOpenQueue.then(open, open);
    projectOpenQueue = queuedOpen.then(
      () => undefined,
      () => undefined,
    );
    await queuedOpen;
  }

  async function handleDeleteProject(projectId: string) {
    try {
      await projectOpenQueue;
      const workspaceId = LOCAL_WORKSPACE_ID;
      const catalogKind = useOpfsPersistence() ? "opfs" : "indexeddb";
      const removedCatalogRefs = workspaceId
        ? (await storageBridge.listCatalogDocuments(catalogKind, workspaceId))
            .filter((document) => document.projectId === projectId)
            .map((document) => ({ projectId, assetId: document.assetId }))
        : [];
      if (useOpfsPersistence()) {
        const deletingActive = activeProjectId() === projectId;
        const { project, media } = await storageBridge.deleteProjectById(projectId);
        if (deletingActive) {
          setActiveProjectId(project.state.id);
          setActiveProjectName(project.state.name);
          setProjectName(project.state.name);
          setCurrentProjectId(project.state.id);
          if (media) {
            await drawOpfsMedia(media);
          } else {
            setActiveAssetId(null);
            clearPendingRestore();
            setRestoreImageData(undefined);
            resetHistoryForAsset(null, null);
            setBootThumb(undefined);
            actions.clearImage();
            viewerApi?.clearImage?.();
          }
        }
        if (workspaceId) {
          await storageBridge.cleanupCollectionReferences(
            "opfs",
            workspaceId,
            removedCatalogRefs,
          );
        }
        await refreshMediaList();
        return;
      }
      await projectStore.deleteProject(projectId);
      if (workspaceId) {
        await storageBridge.cleanupCollectionReferences(
          "indexeddb",
          workspaceId,
          removedCatalogRefs,
        );
      }
      if (activeProjectId() === projectId) {
        // Active project gone — fall back to the most-recent project (or a fresh one).
        const next = await projectStore.resolveBootProject(null);
        await loadProject(next.id);
      } else {
        await refreshMediaList();
      }
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Failed to delete project");
      throw error;
    }
  }

  function baseExportName() {
    return slugify((state.image?.fileName ?? projectName()).replace(/\.[^/.]+$/, ""), "image");
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
  }

  function throwIfExportAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }
  }

  function waitForBrowserPaint(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
  }

  async function handleExportPng(bitDepth: 8 | 16 = 8) {
    if (!state.image || !viewerApi) return;
    try {
      let blob: Blob;
      const borderVisible = isPresentationBorderVisible(editState.presentationBorder);
      if (borderVisible) {
        const base = viewerApi.getExportBaseSize();
        const size = base;
        blob = await renderPresentationImageExport({
          width: size.width,
          height: size.height,
          format: bitDepth === 16 ? "png-16" : "png-8",
          quality: 1,
          dpi: 72,
          colorSpace: "preview",
          gammaCurve: "kalar",
        });
      } else {
        blob = await viewerApi.exportImage({
          mimeType: "image/png",
          bitDepth,
        });
      }
      const suffix = bitDepth === 16 ? "-graded-16bit.png" : "-graded.png";
      downloadBlob(blob, `${baseExportName()}${suffix}`);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to export PNG");
    }
  }

  async function renderPresentationImageExport(req: ExportImageRequest): Promise<Blob> {
    if (!viewerApi) throw new Error("Viewer is not ready");
    const border = editState.presentationBorder;
    if (!isPresentationBorderVisible(border)) {
      return viewerApi.renderExportImage(req);
    }
    const sourceBlob = await viewerApi.renderExportImage({
      ...req,
      format: "png-8",
      metadata: undefined,
    });
    return applyPresentationBorderToBlob({
      sourceBlob,
      border,
      format: req.format,
      quality: req.quality,
      dpi: req.dpi,
      metadata: req.metadata,
    });
  }

  async function handleExportVideo() {
    const file = state.selectedFile;
    const trim = videoState();
    if (!file || !trim || !viewerApi) return;
    videoExportController?.abort();
    const controller = new AbortController();
    videoExportController = controller;
    setVideoExportProgress(0);
    try {
      let container: "mp4" | "webm" = "mp4";
      let artifact: Awaited<ReturnType<NonNullable<ViewerApi["exportVideo"]>>>;
      try {
        artifact = await viewerApi.exportVideo({
          file,
          trim,
          container,
          signal: controller.signal,
          onProgress: setVideoExportProgress,
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        container = "webm";
        artifact = await viewerApi.exportVideo({
          file,
          trim,
          container,
          signal: controller.signal,
          onProgress: setVideoExportProgress,
        });
      }
      downloadBlob(artifact.blob, `${baseExportName()}-graded.${container}`);
      window.setTimeout(() => void artifact.dispose(), 5_000);
      showNotice("Video export complete");
    } catch (error) {
      if (!isAbortError(error)) {
        actions.setError(error instanceof Error ? error.message : "Unable to export video");
      }
    } finally {
      if (videoExportController === controller) videoExportController = undefined;
      setVideoExportProgress(null);
    }
  }

  // Legacy-style image export: builds the request from the persistent exportStore, renders the
  // full edited image (full-res, separate from preview), and writes it with a sanitized name.
  async function handleExportImage(writer?: SingleExportWriter) {
    if (!viewerApi || !viewerApi.isExportReady()) return;
    const s = exportState;
    const outputSize = { width: s.imageWidth, height: s.imageHeight };
    const metadata =
      s.metadata === "preserve" && s.imageFormat === "tif" && state.selectedFile
        ? await readExif(state.selectedFile)
        : undefined;
    const req: ExportImageRequest = {
      width: outputSize.width,
      height: outputSize.height,
      format: s.imageFormat,
      quality: s.imageQualityEnabled ? s.imageQuality : undefined,
      dpi: pro ? s.imageDPI : 72,
      colorSpace: s.colorSpace,
      gammaCurve: s.gammaCurve,
      metadata,
    };
    try {
      let blob = await renderPresentationImageExport(req);
      // Preserve source EXIF (JPEG→JPEG only) when requested; otherwise the re-encode is clean.
      if (
        s.metadata === "preserve" &&
        s.imageFormat === "jpg" &&
        state.selectedFile
      ) {
        blob = await copyJpegExif(blob, state.selectedFile);
      }
      const name = s.fileName || baseExportName();
      const saved = writer
        ? await writer.write(blob)
        : await saveBlob(blob, name, s.imageExtension);
      if (saved)
        showNotice(
          writer?.successMessage ??
            `${writer?.name ?? withSingleExtension(name, s.imageExtension)} saved successfully.`,
        );
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to export image");
    }
  }

  async function handleSendImageToPhone() {
    const session = await ensureRelaySession();
    if (!session.canSendToPhone()) {
      if (
        session.status() === "expired" ||
        session.status() === "error" ||
        session.status() === "done"
      ) {
        session.restart();
      }
      setRelayOverlayMode("send");
      setActiveOverlay("relay");
      throw new Error(
        "Scan the QR code with your phone. Once it shows connected, return to Export and send again.",
      );
    }
    const name = withSingleExtension(
      exportState.fileName || baseExportName(),
      exportState.imageExtension,
    );
    await handleExportImage({
      name,
      successMessage: `${name} sent to phone.`,
      async write(blob) {
        await session.sendBlobToPhone(blob, name, blob.type || exportState.imageMimeType);
        return true;
      },
    });
  }

  // Wait until a freshly-switched media is rendered and export-ready (legacy waits on the
  // media-change event + a 250ms settle). Polls the session's active-asset signal + the engine's
  // export readiness, then lets one processed render settle.
  async function waitForExportReady(
    targetId: string,
    previousTextureVersion: number,
    timeoutMs = 4000,
  ): Promise<boolean> {
    const start = Date.now();
    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    while (Date.now() - start < timeoutMs) {
      const snapshot = viewerApi?.getRendererDebugSnapshot();
      const restoreSettled =
        restoringAssetId === null &&
        (!lastRenderedMedia || lastRenderedMedia.assetId === targetId);
      if (
        activeAssetId() === targetId &&
        restoreSettled &&
        viewerApi?.isExportReady() &&
        snapshot &&
        (previousTextureVersion < 0 || snapshot.source.textureVersion !== previousTextureVersion)
      ) {
        await delay(150);
        return true;
      }
      await delay(60);
    }
    return false;
  }

  function mediaSummaryById(assetId: string) {
    return mediaList().find((media) => media.assetId === assetId);
  }

  function mediaDisplayName(assetId: string): string {
    return mediaSummaryById(assetId)?.fileName ?? assetId;
  }

  function formatFromName(fileName: string): ReturnType<typeof detectImageFormat> {
    return detectImageFormat({ name: fileName, type: "" });
  }

  function isRawFormat(format: unknown): boolean {
    return format === "raw";
  }

  async function flattenSourceFormat(assetId: string, summary: MediaSummary) {
    if (useOpfsPersistence()) {
      const metadata = await storageBridge.readMediaMetadataByName(assetId).catch(() => ({}));
      return detectedStoredFormat(metadata, summary.fileName);
    }
    const media = await mediaStore.getMedia(assetId);
    return media?.format ?? formatFromName(summary.fileName);
  }

  async function assertRawFlattenUsesDecodedPayload(
    assetId: string,
    summary: MediaSummary,
  ): Promise<void> {
    const format = await flattenSourceFormat(assetId, summary);
    if (!isRawFormat(format)) return;

    if (useOpfsPersistence()) {
      const imageName = await storageBridge.readMediaMainImageName(assetId);
      if (imageName !== "image.data") {
        throw new Error("Cached image.data is missing for this RAW media. Re-import it to flatten.");
      }
      return;
    }

    const media = await mediaStore.getMedia(assetId);
    if (!media || media.storage !== "data") {
      throw new Error("Cached image.data is missing for this RAW media. Re-import it to flatten.");
    }
  }

  function defaultEditStateForMediaRecord(media: MediaRecord): EditState {
    const next = deserializeEditState(toPlainSerializedEditState(DEFAULT_EDIT_STATE));
    const ext = media.fileName.split(".").pop()?.toLowerCase() ?? "";
    if (media.format === "raw") next.colorManagement.inputColorSpaceId = "VisionLog";
    else if (media.format === "exr" || ext === "exr")
      next.colorManagement.inputColorSpaceId = "EXR_IDT";
    return next;
  }

  async function readMediaSerializedState(assetId: string): Promise<SerializedEditState | null> {
    if (assetId === activeAssetId()) return cloneSerializedState(currentSerializedEditState());
    if (useOpfsPersistence()) {
      return cloneSerializedState(await storageBridge.readMediaStateByName(assetId));
    }
    const media = await mediaStore.getMedia(assetId);
    return media ? cloneSerializedState(media.editState) : null;
  }

  function savedSnapshotFor(
    assetId: string,
    serialized: SerializedEditState,
    viewport = state.viewport,
  ): string {
    return JSON.stringify({ assetId, editState: serialized, viewport });
  }

  function applyLiveSerializedState(assetId: string, serialized: SerializedEditState): void {
    const hydrated = deserializeEditState(cloneSerializedState(serialized));
    setEditState(reconcile(hydrated));
    setLastSavedSnapshot(savedSnapshotFor(assetId, serialized));
    pushHistoryState(assetId, serialized);
  }

  async function writeMediaSerializedState(
    assetId: string,
    serialized: SerializedEditState,
  ): Promise<void> {
    const hydrated = deserializeEditState(cloneSerializedState(serialized));
    if (useOpfsPersistence()) {
      await storageBridge.applyStateToMediaByName(assetId, serialized);
    } else {
      const media = await mediaStore.getMedia(assetId);
      if (!media) throw new Error(`Media not found: ${assetId}`);
      await mediaStore.saveMediaState(assetId, {
        editState: hydrated,
        viewport: assetId === activeAssetId() ? state.viewport : media.viewport,
      });
    }
    if (assetId === activeAssetId()) applyLiveSerializedState(assetId, serialized);
  }

  async function writeBatchMediaSerializedState(
    assetId: string,
    serialized: SerializedEditState,
  ): Promise<void> {
    if (useOpfsPersistence()) {
      await storageBridge.applyStateToMediaByName(assetId, serialized);
    } else {
      const media = await mediaStore.getMedia(assetId);
      if (!media) throw new Error(`Media not found: ${assetId}`);
      await mediaStore.saveMediaState(assetId, {
        editState: deserializeEditState(cloneSerializedState(serialized)),
        viewport: media.viewport,
      });
    }
    if (assetId === activeAssetId()) {
      setEditState(reconcile(deserializeEditState(cloneSerializedState(serialized))));
      setLastSavedSnapshot(savedSnapshotFor(assetId, serialized));
    }
  }

  function batchPersistence(projectId: string): BatchEditPersistence {
    const kind = useOpfsPersistence() ? "opfs" : "indexeddb";
    return {
      read: async (assetId) => (await readMediaSerializedState(assetId)) ?? undefined,
      write: writeBatchMediaSerializedState,
      saveJournal: (journal) => storageBridge.saveBatchEditJournal(kind, journal),
      deleteJournal: (journalId) =>
        storageBridge.deleteBatchEditJournal(kind, projectId, journalId),
    };
  }

  async function applyBatchEditing(
    primaryAssetId: string,
    targetAssetIds: string[],
    modules: MediaEditModuleKey[],
    signal?: AbortSignal,
  ): Promise<void> {
    const projectId = activeProjectId();
    if (!projectId) throw new Error("No active project.");
    await flushAutosave();
    const primary = await readMediaSerializedState(primaryAssetId);
    if (!primary) throw new Error(`Media not found: ${primaryAssetId}`);
    const patch = buildMediaEditPatch(primary, modules);
    const result = await executeBatchEdit({
      projectId,
      primaryAssetId,
      targetAssetIds,
      moduleKeys: modules,
      buildAfter: (before) => mergeMediaEditPatch(before, patch),
      persistence: batchPersistence(projectId),
      signal,
    });
    if (result.committed) {
      const previousJournal = lastBatchJournal();
      if (previousJournal && previousJournal.id !== result.journal.id) {
        await batchPersistence(previousJournal.projectId).deleteJournal(previousJournal.id);
      }
      setLastBatchJournal(result.journal);
      const applied = result.targets.filter((target) => target.status === "applied").length;
      const skippedTargets = result.targets.filter((target) => target.status === "skipped");
      showNotice(`Batch edit applied to ${applied} file${applied === 1 ? "" : "s"}${skippedTargets.length ? ` · ${skippedTargets.length} skipped` : ""}.`);
      if (skippedTargets.length) {
        actions.setError(
          skippedTargets
            .map((target) => `${mediaDisplayName(target.assetId)}: ${target.error ?? "Skipped"}`)
            .join(" · "),
        );
      }
    } else {
      const failures = result.targets.filter((target) => target.status === "failed");
      actions.setError(
        failures.length
          ? failures
              .map((target) => `${mediaDisplayName(target.assetId)}: ${target.error ?? "Failed"}`)
              .join(" · ")
          : "Batch edit failed and was rolled back.",
      );
    }
    await refreshMediaList();
  }

  async function undoLastBatchEditing(): Promise<void> {
    const journal = lastBatchJournal();
    if (!journal) return;
    const results = await undoBatchEdit(journal, batchPersistence(journal.projectId));
    const failures = results.filter((result) => result.status === "failed");
    if (failures.length) {
      actions.setError(`Batch undo failed for ${failures.length} target${failures.length === 1 ? "" : "s"}.`);
      return;
    }
    setLastBatchJournal(null);
    showNotice(`Batch edit undone for ${results.length} files.`);
  }

  async function recoverProjectBatchEdits(projectId: string): Promise<void> {
    const kind = useOpfsPersistence() ? "opfs" : "indexeddb";
    const journals = await storageBridge.listBatchEditJournals(kind, projectId);
    const committed = journals
      .filter((journal) => journal.status === "committed")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (committed) setLastBatchJournal(committed);
    await recoverBatchJournals(journals, batchPersistence(projectId));
  }

  async function writeMediaEditPatch(assetId: string, patch: MediaEditPatch): Promise<void> {
    const current = await readMediaSerializedState(assetId);
    if (!current) throw new Error(`Media not found: ${assetId}`);
    const next = mergeMediaEditPatch(current, patch);
    await writeMediaSerializedState(assetId, next);
    recordInactiveHistoryChange(assetId, current, next);
  }

  async function copyMediaEdits(assetId: string, modules: MediaEditModuleKey[]): Promise<void> {
    const serialized = await readMediaSerializedState(assetId);
    if (!serialized) {
      actions.setError(`Unable to copy edits from "${mediaDisplayName(assetId)}".`);
      return;
    }
    setEditClipboard(cloneJson(buildMediaEditPatch(serialized, modules)));
    perf.recordCopiedEditState();
    showNotice(`Edits copied from "${mediaDisplayName(assetId)}".`);
  }

  async function pasteMediaEdits(assetId: string): Promise<void> {
    const copied = editClipboard();
    if (!copied) {
      actions.setError("No copied edits to paste.");
      return;
    }
    await writeMediaEditPatch(assetId, cloneJson(copied));
    perf.recordPastedEditState();
    showNotice(`Edits applied to "${mediaDisplayName(assetId)}"`);
  }

  async function pasteMediaEditsToSelected(assetIds: string[]): Promise<void> {
    const copied = editClipboard();
    if (!copied) {
      actions.setError("No copied edits to paste.");
      return;
    }
    const targets = assetIds.filter((assetId) => !!mediaSummaryById(assetId));
    for (const assetId of targets) {
       
      await writeMediaEditPatch(assetId, cloneJson(copied));
    }
    perf.recordPastedEditState(targets.length);
    showNotice(`Edits applied to ${targets.length} selected file${targets.length === 1 ? "" : "s"}`);
  }

  async function applyMediaEditsToProject(
    assetId: string,
    modules: MediaEditModuleKey[],
  ): Promise<void> {
    await applyBatchEditing(
      assetId,
      mediaList().map((media) => media.assetId),
      modules,
    );
  }

  async function resetMediaEdits(assetId: string): Promise<void> {
    const previous = await readMediaSerializedState(assetId);
    let serialized: SerializedEditState;
    if (useOpfsPersistence()) {
      serialized = await storageBridge.resetMediaStateByName(assetId);
      if (assetId === activeAssetId()) applyLiveSerializedState(assetId, serialized);
    } else {
      const media = await mediaStore.getMedia(assetId);
      if (!media) throw new Error(`Media not found: ${assetId}`);
      serialized = toPlainSerializedEditState(defaultEditStateForMediaRecord(media));
      await writeMediaSerializedState(assetId, serialized);
    }
    if (previous) recordInactiveHistoryChange(assetId, previous, serialized);
    showNotice(`Edits of "${mediaDisplayName(assetId)}" reset`);
  }

  async function resetSelectedMediaEdits(assetIds: string[]): Promise<void> {
    const targets = assetIds.filter((assetId) => !!mediaSummaryById(assetId));
    for (const assetId of targets) {
       
      await resetMediaEdits(assetId);
    }
    if (targets.length > 1) {
      showNotice(`Edits reset for ${targets.length} selected files`);
    }
  }

  async function renderMediaPng(assetId: string, maxSide?: number): Promise<Blob> {
    if (!viewerApi) throw new Error("Viewer is not ready");
    perf.recordContextMenuFullImageLoad();
    return withTemporaryMediaOperation(async (switchMedia) => {
      const needsSwitch = assetId !== activeAssetId();
      const previousTextureVersion = needsSwitch
        ? viewerApi!.getRendererDebugSnapshot().source.textureVersion
        : -1;
      if (needsSwitch) {
        if (!(await switchMedia(assetId))) {
          throw new Error(`Unable to load ${mediaDisplayName(assetId)} for rendering.`);
        }
        if (!(await waitForExportReady(assetId, previousTextureVersion))) {
          throw new Error(`Unable to load ${mediaDisplayName(assetId)} for rendering.`);
        }
      } else if (!viewerApi!.isExportReady()) {
        throw new Error("Viewer is not ready");
      }
      const base = viewerApi!.getExportBaseSize();
      const size = maxSide ? fitLongEdge(base.width, base.height, maxSide) : base;
      return renderPresentationImageExport({
        width: size.width,
        height: size.height,
        format: "png-8",
        quality: 1,
        dpi: 72,
        colorSpace: "preview",
        gammaCurve: "kalar",
      });
    });
  }

  async function flattenMedia(assetId: string): Promise<void> {
    const media = mediaSummaryById(assetId);
    if (!media) throw new Error(`Media not found: ${assetId}`);
    if (flatteningAssetId()) return;
    const restoreAssetId = assetId !== activeAssetId() ? activeAssetId() : null;

    setFlatteningAssetId(assetId);
    toast.loading(`Flattening "${media.fileName}"...`, {
      id: "flatten-media",
      ariaProps: { role: "status", "aria-live": "polite" },
    });

    let completed = false;
    try {
      await assertRawFlattenUsesDecodedPayload(assetId, media);
      await waitForBrowserPaint();
      const blob = await renderMediaPng(assetId);
      const stem = sanitizeFileName(media.fileName.replace(/\.[^/.]+$/, "") || assetId);
      const file = new File([blob], `${stem}__FLATTENED.png`, { type: "image/png" });
      await importFilesToProject(media.projectId, [file]);
      if (restoreAssetId && activeAssetId() !== restoreAssetId) {
        await loadActiveMedia(restoreAssetId);
      }
      perf.recordFlattenedImage();
      completed = true;
      toast.success(
        `"${file.name}" added to the project.`,
        {
          id: "flatten-media",
          duration: 3500,
          ariaProps: { role: "status", "aria-live": "polite" },
          iconTheme: { primary: "#38c172", secondary: "#171717" },
        },
      );
    } finally {
      setFlatteningAssetId(null);
      if (!completed) toast.dismiss("flatten-media");
    }
  }

  async function useMediaAsMatchReference(assetId: string): Promise<void> {
    const blob = await renderMediaPng(assetId, 756);
    const name = `${sanitizeFileName(mediaDisplayName(assetId).replace(/\.[^/.]+$/, "") || assetId)}.png`;
    await saveMatchReferenceFile(new File([blob], name, { type: "image/png" }));
    perf.recordMatchReferenceFromMedia();
    showNotice(`"${mediaDisplayName(assetId)}" added to custom color match references`);
  }

  async function rawImageForGrid(assetId: string): Promise<Blob | ImageData> {
    if (useOpfsPersistence()) {
      return (await storageBridge.getMediaImageSource(assetId)).image;
    }

    const cached = await mediaStore.loadCachedImageAsset(assetId);
    if (cached.kind === "blob") return cached.blob;
    if (cached.kind === "data") return cached.imageData;
    throw new Error(`Source image is unavailable for ${mediaDisplayName(assetId)}`);
  }

  function hexToCanvasColor(hex: string): string {
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#111111";
  }

  function mediaGridOutputSize(): { width: number; height: number } {
    const base = viewerApi?.getExportBaseSize();
    const width = Math.round((base?.width ?? 2048) * 1.5);
    const height = Math.round((base?.height ?? 2048) * 1.5);
    const maxSize = legacyMaxSafeExportSize();
    const scale = Math.min(1, maxSize / width, maxSize / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  function mediaGridRects(bitmaps: ImageBitmap[], width: number, height: number) {
    let best: Array<{ x: number; y: number; width: number; height: number }> = [];
    let bestScore = Number.POSITIVE_INFINITY;

    for (let rows = 1; rows <= bitmaps.length; rows += 1) {
      const smallRowSize = Math.floor(bitmaps.length / rows);
      const largerRowCount = bitmaps.length % rows;
      const rowHeight = height / rows;
      const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
      let imageIndex = 0;
      let score = 0;

      for (let row = 0; row < rows; row += 1) {
        const count = smallRowSize + (row < largerRowCount ? 1 : 0);
        const tileWidth = width / count;
        for (let column = 0; column < count; column += 1) {
          const bitmap = bitmaps[imageIndex];
          const tileRatio = tileWidth / rowHeight;
          const imageRatio = bitmap.width / bitmap.height;
          score += Math.abs(Math.log(tileRatio / imageRatio));
          rects.push({ x: column * tileWidth, y: row * rowHeight, width: tileWidth, height: rowHeight });
          imageIndex += 1;
        }
      }

      if (score < bestScore) {
        bestScore = score;
        best = rects;
      }
    }

    return best;
  }

  async function composeMediaGrid(
    items: Array<Blob | ImageData>,
    options: MediaGridOptions,
  ): Promise<Blob> {
    const bitmaps: ImageBitmap[] = [];
    try {
      for (const item of items) {
        const bitmap = await createImageBitmap(item, {
          imageOrientation: "none",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        perf.recordContextMenuDecode();
        bitmaps.push(bitmap);
      }
      if (bitmaps.length === 0) throw new Error("No images available for grid generation");
      const output = mediaGridOutputSize();
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Unable to create grid canvas");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (options.layout === "contain") {
        ctx.fillStyle = hexToCanvasColor(options.backgroundColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const rects = mediaGridRects(bitmaps, canvas.width, canvas.height);
      bitmaps.forEach((bitmap, index) => {
        const rect = rects[index]!;
        const scale =
          options.layout === "cover"
            ? Math.max(rect.width / bitmap.width, rect.height / bitmap.height)
            : Math.min(rect.width / bitmap.width, rect.height / bitmap.height);
        const w = Math.max(1, bitmap.width * scale);
        const h = Math.max(1, bitmap.height * scale);
        const dx = rect.x + (rect.width - w) / 2;
        const dy = rect.y + (rect.height - h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();
        ctx.drawImage(bitmap, dx, dy, w, h);
        ctx.restore();
      });

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Unable to encode grid image"))),
          "image/png",
        );
      });
    } finally {
      for (const bitmap of bitmaps) bitmap.close();
    }
  }

  async function generateMediaGrid(assetIds: string[], options: MediaGridOptions): Promise<void> {
    const items = assetIds
      .map((assetId) => mediaSummaryById(assetId))
      .filter((media): media is MediaSummary => !!media);
    if (items.length === 0) return;
    const projectId = items[0].projectId;
    const sources: Array<Blob | ImageData> = [];
    toast.loading(`Generating grid from ${items.length} files...`, {
      id: "media-grid",
      ariaProps: { role: "status", "aria-live": "polite" },
    });
    let completed = false;
    try {
      for (const item of items) {
        const source =
          options.mode === "edited"
            ? await renderMediaPng(item.assetId, 2048)
            : await rawImageForGrid(item.assetId);
        sources.push(source);
      }
      const gridBlob = await composeMediaGrid(sources, options);
      const file = new File([gridBlob], "Grid View Generated by Color.io.png", {
        type: "image/png",
      });
      await importFilesToProject(projectId, [file]);
      completed = true;
      toast.success(`"${file.name}" added to the project.`, {
        id: "media-grid",
        duration: 3000,
        ariaProps: { role: "status", "aria-live": "polite" },
        iconTheme: { primary: "#38c172", secondary: "#171717" },
      });
    } finally {
      if (!completed) toast.dismiss("media-grid");
    }
  }

  function metadataDescription(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      const descriptions = value.map(metadataDescription).filter((item): item is string => !!item);
      return descriptions.length ? descriptions.join(", ") : null;
    }
    if (typeof value === "object" && "description" in value) {
      return metadataDescription((value as { description?: unknown }).description);
    }
    return null;
  }

  async function viewMediaMetadata(assetId: string): Promise<MediaMetadataView> {
    const summary = mediaSummaryById(assetId);
    perf.recordMetadataJsonRead();
    const raw = useOpfsPersistence()
      ? await storageBridge.readMediaMetadataByName(assetId).catch(() => ({}))
      : await mediaStore.getMedia(assetId).then((media) =>
          media
            ? {
                name: media.fileName,
                type: media.mimeType,
                format: media.format,
                width: media.width,
                height: media.height,
                storage: media.storage,
                ...media.metadata,
              }
            : {},
        );
    const thumbnail = useOpfsPersistence()
      ? await storageBridge.getMediaThumbnail(assetId).catch(() => undefined)
      : await mediaStore.getThumbnail(assetId).catch(() => undefined);
    const entries = Object.entries(raw)
      .map(([key, value]) => ({ key, description: metadataDescription(value) }))
      .filter((entry): entry is { key: string; description: string } => !!entry.description);
    return {
      title: summary?.fileName ?? assetId,
      thumbnail,
      entries,
    };
  }

  function runMediaAction(action: () => Promise<void>, fallback: string): void {
    void action().catch((error) => {
      actions.setError(error instanceof Error ? error.message : fallback);
    });
  }

  // Legacy batch export (Ro): render each SELECTED project media at the batch settings, switching
  // the active media in turn and restoring the original afterward. Saves into a chosen directory
  // (auto-renaming duplicates) when supported, else one ZIP named from the project and date.
  // Sequential; preview color management is never mutated (renderExportImage passes it by value).
  async function handleBatchExport(assetIds: string[], signal?: AbortSignal) {
    const api = viewerApi;
    if (!api || !isExportReady()) return;
    const ids = assetIds.filter((id) => mediaList().some((media) => media.assetId === id));
    if (ids.length === 0) {
      actions.setError("Select at least one image to batch export.");
      return;
    }
    const s = exportState;
    const suffix = s.batchSuffix || "";
    const writer = await openBatchExportWriter(
      `${projectName()} - Hytic Edits - ${batchDateStamp()}`,
      "kalar-export-image",
    );
    if (!writer) return;
    try {
      await withTemporaryMediaOperation(async (switchMedia) => {
        throwIfExportAborted(signal);
        for (const id of ids) {
          throwIfExportAborted(signal);
          const previousTextureVersion =
            id === activeAssetId() ? -1 : api.getRendererDebugSnapshot().source.textureVersion;
          if (!(await switchMedia(id))) {
            throw new Error(
              `Unable to load ${mediaList().find((media) => media.assetId === id)?.fileName ?? id} for export.`,
            );
          }
          throwIfExportAborted(signal);
          if (!(await waitForExportReady(id, previousTextureVersion))) {
            throw new Error(
              `Unable to load ${mediaList().find((media) => media.assetId === id)?.fileName ?? id} for export.`,
            );
          }
          throwIfExportAborted(signal);
          const base = api.getExportBaseSize();
          // batchMaxSize 0 = "original" (legacy): cap to the rendered long edge.
          const cap =
            s.batchMaxSize > 0
              ? Math.min(s.batchMaxSize, legacyMaxSafeExportSize())
              : Math.max(base.width, base.height);
          const dims =
            s.batchMaxSize > 0
              ? sizeByLongEdge(base.width, base.height, cap)
              : fitLongEdge(base.width, base.height, cap);
          const metadata =
            s.metadata === "preserve" && s.imageFormat === "tif" && state.selectedFile
              ? await readExif(state.selectedFile)
              : undefined;
          let blob = await renderPresentationImageExport({
            width: dims.width,
            height: dims.height,
            format: s.imageFormat,
            quality: s.imageQualityEnabled ? s.imageQuality : undefined,
            dpi: s.imageDPI,
            colorSpace: s.colorSpace,
            gammaCurve: s.gammaCurve,
            metadata,
          });
          if (s.metadata === "preserve" && s.imageFormat === "jpg" && state.selectedFile) {
            blob = await copyJpegExif(blob, state.selectedFile);
          }
          throwIfExportAborted(signal);
          const summary = mediaList().find((media) => media.assetId === id);
          const stem = (summary?.fileName ?? id).replace(/\.[^/.]+$/, "");
          await writer.write({
            name: withSingleExtension(`${stem}${suffix}`, s.imageExtension),
            input: blob,
          });
        }
      });
    } catch (error) {
      if (isAbortError(error)) return;
      actions.setError(error instanceof Error ? error.message : "Unable to export batch");
      return;
    }
    if (signal?.aborted) return;
    try {
      const ok = await writer.finalize();
      if (ok) showNotice("Batch export complete");
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to save batch export");
    }
  }

  function isExportReady(): boolean {
    return !!state.image && !!viewerApi && viewerApi.isExportReady();
  }

  function getExportBaseSize(): { width: number; height: number } {
    return viewerApi ? viewerApi.getExportBaseSize() : { width: 0, height: 0 };
  }

  async function handleExportCube(options: { title: string; size: 17 | 33 | 64 }) {
    if (!viewerApi) return;
    try {
      const blob = await viewerApi.exportCube(options);
      downloadBlob(blob, `${slugify(options.title, "look")}.cube`);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to export .cube");
    }
  }

  async function handleExportCLF(options: { title: string; size: 17 | 33 | 64 }) {
    if (!viewerApi) return;
    try {
      const blob = await viewerApi.exportCLF(options);
      downloadBlob(blob, `${slugify(options.title, "look")}.clf`);
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to export .clf");
    }
  }

  // Legacy-style LUT export (Go): bakes the global look at the selected size and writes it in the
  // chosen destination format (.cube/.cms/.clut/.spi3d/.txt/.vlt/.dctl/.png). Name + embedded
  // title come from the export file name, mirroring legacy `No`.
  async function handleExportLUT(writer?: SingleExportWriter) {
    if (!viewerApi || !isExportReady()) return;
    const s = exportState;
    const baseName = sanitizeFileName(s.fileName || baseExportName());
    try {
      const { blob } = await viewerApi.exportLUT({
        extension: s.lutExtension,
        layout: s.lutLayout,
        size: s.lutSize,
        title: baseName,
        colorSpace: s.colorSpace,
        gammaCurve: s.gammaCurve,
      });
      const saved = writer
        ? await writer.write(blob)
        : await saveBlob(blob, baseName, s.lutExtension);
      if (saved)
        showNotice(
          writer?.successMessage ??
            `${writer?.name ?? withSingleExtension(baseName, s.lutExtension)} saved successfully.`,
        );
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to export LUT");
      // Let the export overlay surface its local warning and reset loading state.
      throw error;
    }
  }

  async function handleBatchExportLUT(assetIds: string[], signal?: AbortSignal) {
    const lutFeature: EditorFeature =
      exportState.lutExtension === ".dctl" ? "dctl_export" : "lut_export";
    const api = viewerApi;
    if (!api || !isExportReady()) return;
    const ids = assetIds.filter((id) => mediaList().some((media) => media.assetId === id));
    if (ids.length === 0) {
      actions.setError("Select at least one image to batch export.");
      return;
    }
    const s = exportState;
    const suffix = s.batchSuffix || "";
    const writer = await openBatchExportWriter(
      `${projectName()} - Hytic LUTs - ${batchDateStamp()}`,
      "kalar-export-lut",
    );
    if (!writer) return;
    try {
      await withTemporaryMediaOperation(async (switchMedia) => {
        throwIfExportAborted(signal);
        for (const id of ids) {
          throwIfExportAborted(signal);
          const previousTextureVersion =
            id === activeAssetId() ? -1 : api.getRendererDebugSnapshot().source.textureVersion;
          if (!(await switchMedia(id))) {
            throw new Error(
              `Unable to load ${mediaList().find((media) => media.assetId === id)?.fileName ?? id} for export.`,
            );
          }
          throwIfExportAborted(signal);
          if (!(await waitForExportReady(id, previousTextureVersion))) {
            throw new Error(
              `Unable to load ${mediaList().find((media) => media.assetId === id)?.fileName ?? id} for export.`,
            );
          }
          throwIfExportAborted(signal);
          const summary = mediaList().find((media) => media.assetId === id);
          const stem = (summary?.fileName ?? id).replace(/\.[^/.]+$/, "");
          const title = sanitizeFileName(`${stem}${suffix}`);
          const { blob } = await api.exportLUT({
            extension: s.lutExtension,
            layout: s.lutLayout,
            size: s.lutSize,
            title,
            colorSpace: s.colorSpace,
            gammaCurve: s.gammaCurve,
          });
          throwIfExportAborted(signal);
          await writer.write({
            name: withSingleExtension(title, s.lutExtension),
            input: blob,
          });
        }
      });
    } catch (error) {
      if (isAbortError(error)) return;
      actions.setError(error instanceof Error ? error.message : "Unable to export LUT batch");
      return;
    }
    if (signal?.aborted) return;
    try {
      const ok = await writer.finalize();
      if (ok) showNotice("Batch LUT export complete");
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to save batch LUT export");
    }
  }

  const [historyAnchor, setHistoryAnchor] = createSignal<HTMLElement | null>(null);
  const canUndo = createMemo(() => hasImage() && historyIndex() > 0);
  const canRedo = createMemo(() => hasImage() && historyIndex() < historyEntries().length - 1);

  const historyProps = () => ({
    hasImage: hasImage(),
    entries: historyEntries().map(({ id, createdAt, label }) => ({ id, createdAt, label })),
    index: historyIndex(),
    snapshots: versionSnapshots(),
    onGoTo: goToHistory,
    onUndo: undoHistory,
    onRedo: redoHistory,
    onSaveSnapshot: () => void saveVersionSnapshot(),
    onApplySnapshot: applyVersionSnapshot,
    onDeleteSnapshot: (id: string) => void deleteVersionSnapshot(id),
    onRenameSnapshot: (id: string, name: string) => void renameVersionSnapshot(id, name),
    onUpdateSnapshot: (id: string) => void updateVersionSnapshot(id),
    onDeleteAllSnapshots: () => void deleteAllVersionSnapshots(),
  });

  async function handleAutoEnhance(): Promise<void> {
    if (autoEnhancing() || !state.image) return;

    const api = viewerApi;
    if (!api) {
      showNotice("Auto Enhance is available after the image finishes loading.");
      return;
    }

    setAutoEnhancing(true);
    // Let the pressed/loading state paint before preparing the analysis preview.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      // Analyze a bounded preview rather than reading the full-resolution source;
      // this keeps very large RAW images fast and avoids a second full-size buffer.
      const previewBlob = await api.getSourceThumbnailBlob(1024);
      if (!previewBlob) throw new Error("Unable to read this image for enhancement.");
      const bitmap = await createImageBitmap(previewBlob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        throw new Error("Unable to analyze this image.");
      }
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();

      const result = calculateAutoEnhance(pixels);
      if (!result) {
        actions.setError("Unable to analyze this image.");
        return;
      }

      historyController.cancelPending();
      batch(() => {
        setEditState("tone", result.tone);
        setEditState("exposure", result.exposure);
        setEditState("saturation", result.saturation);
      });

      const assetId = activeAssetId();
      if (assetId) {
        pushHistoryState(assetId, cloneSerializedState(currentSerializedEditState()), "Auto Enhance");
        void runAutosave();
      }
      showNotice("Auto Enhance applied");
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : "Unable to enhance this image");
    } finally {
      setAutoEnhancing(false);
    }
  }

  function showNotice(message: string): void {
    toast.success(message, {
      id: "editor-notice",
      duration: 3500,
      ariaProps: { role: "status", "aria-live": "polite" },
      iconTheme: { primary: "#38c172", secondary: "#171717" },
    });
  }

  // setError also ends loading, so errors remain in the editor store and are
  // consumed once by the root Toaster here.
  createEffect(() => {
    const message = state.error;
    if (!message) return;

    const collectedImportErrors = importErrors();
    const details = collectedImportErrors.includes(message)
      ? collectedImportErrors.filter((detail) => detail !== message).slice(0, 3)
      : [];
    toast.error(
      details.length ? (
        <div class="poto-toast-message">
          <span>{message}</span>
          <ul class="poto-toast-message__details">
            <For each={details}>{(detail) => <li>{detail}</li>}</For>
          </ul>
        </div>
      ) : (
        message
      ),
      {
        id: "editor-error",
        duration: 6000,
        ariaProps: { role: "alert", "aria-live": "assertive" },
        iconTheme: { primary: "#ff6b6b", secondary: "#171717" },
      },
    );
    actions.clearError();
  });

  const showStartScreen = createMemo(
    () => !booting() && !hasImage() && !loadingImage() && !state.isLoading && !bootThumbUrl(),
  );

  return (
    <poto-app
      ref={appRootRef}
      attr:ready={ready() ? "" : undefined}
      attr:shell-ready={shellReady() ? "" : undefined}
      attr:data-startup-phase={startupPhase()}
      attr:booting={booting() ? "" : undefined}
      attr:loading-image={loadingImage() ? "" : undefined}
      attr:has-image={hasImage() ? "" : undefined}
    >
      {/* ── top-bar (legacy Gg): [menu] [undo-redo] [spacer] [Export] ──── */}
      <top-bar>
        <UndoRedo
          canUndo={canUndo()}
          canRedo={canRedo()}
          onUndo={undoHistory}
          onRedo={redoHistory}
          onOpenHistory={(anchor) => setHistoryAnchor((prev) => (prev ? null : anchor))}
          onOpenFeedback={() => showNotice("Feedback collection is not included in this local-first build.")}
        />

        <InputSelector />
        <OutputSelector />

        <button
          data-action="open-export"
          class="action-button primary rounded-full flex-row y-center gap-050 nowrap text-s text-semibold"
          title="Export"
          tabindex={-1}
          onClick={() => {
            if (!state.image) {
              showNotice("Nothing to export. Import at least one image before exporting.");
              return;
            }
            if (videoState()) {
              void handleExportVideo();
            } else {
              openOverlay("export");
            }
          }}
        >
          <span>Export</span>
          <img src="/assets/icons/download_icon_inverted.svg" alt="" draggable={false} />
        </button>
      </top-bar>

      {/* Side-menu popup (legacy Ug) anchored under the hamburger. */}
      {/* <Show when={sideMenuAnchor()}>
        <Popover anchor={sideMenuAnchor()!} onClose={() => setSideMenuAnchor(null)}>
          <SideMenu />
        </Popover>
      </Show> */}

      {/* History timeline & versions popup (legacy di) anchored under the arrow. */}
      <Show when={historyAnchor()}>
        <Popover
          anchor={historyAnchor()!}
          onClose={() => setHistoryAnchor(null)}
          class="poto-popover--history"
        >
          <HistoryTimeline {...historyProps()} />
        </Popover>
      </Show>

      {/* ── main viewport ───────────────────────────────────────────── */}
      <main onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div
          class="viewer-host"
          classList={{
            "viewer-host--crop-deactivated": activeOverlay() === "crop" && cropPreviewPainted(),
          }}
          aria-hidden={activeOverlay() === "crop" && cropPreviewPainted() ? "true" : "false"}
          style={{
            // Keep the last rendered frame visible while the crop source is being
            // prepared. Hide it atomically only when the replacement crop stage
            // has pixels, avoiding a black frame between the click and capture.
            visibility: activeOverlay() === "crop" && cropPreviewPainted() ? "hidden" : undefined,
          }}
        >
          <Suspense fallback={null}>
            <Viewer
              file={state.selectedFile}
              imageData={restoreImageData()}
              editState={viewerEditState()}
              previewLook={previewLook()}
              suppressEmptyState
              cropEditMode={cropEditMode()}
              imageWidth={state.image?.width}
              onVideoElementChange={handleVideoElementChange}
              onImageLoaded={handleImageLoaded}
              onViewportChange={actions.setViewport}
              onViewportInteractionChange={setViewerInteractionActive}
              onError={handleViewerError}
              onReady={(api) => {
                viewerApi = api;
                resolveViewerReady?.();
                resolveViewerReady = undefined;
                if (import.meta.env.DEV) {
                  // Runtime parity harness only; never emitted by the production build.
                   
                  (window as any).__potoViewerApi = () => api;
                }
                setLutIs8Bit(api.lutReadbackIs8Bit?.() ?? false);
                const border = editState.presentationBorder;
                if (isPresentationBorderVisible(border)) {
                  api.setPresentationState(toBorderSettings(border));
                }
              }}
              onLUTStatusChange={() => {}}
            />
          </Suspense>
        </div>

        <ViewportOverlay
          hidden={(!!activeOverlay() && activeOverlay() !== "projects") || showStartScreen()}
          hasImage={hasImage()}
          zoom={state.viewport.zoom}
          splitActive={splitActive()}
          projectThumb={projectThumbUrl() ?? undefined}
          showProjects={true}
          onOpenProjects={() => openOverlay("projects")}
          onOpenOverlays={() => {
            openOverlay("overlays");
          }}
          onImport={triggerImport}
          onFitZoom={() => viewerApi?.fitToScreen?.()}
          onToggleSplit={() => {
            if (!state.image) {
              setSplitActive(false);
              return;
            }
            const result = viewerApi?.toggleSplit?.();
            if (result !== undefined) setSplitActive(result);
          }}
          allowCrop={!videoState()}
          onCropRotate={() => openOverlay("crop")}
          onOpenDistort={() => {
            openOverlay("distort");
          }}
          distortActive={editState.distort.enabled}
          allowDistort={!videoState()}
          onOpenBorder={openBorderEditor}
          onToggleScopes={() => setScopesState("visible", (visible) => !visible)}
          onSelectMask={() => {
            setMaskingMode(true);
          }}
        >
          {/* keyed: remount when the engine swaps the video so playback listeners rebind. */}
          <Show when={videoElement()} keyed>
            {(video) => (
              <VideoTrimTimeline
                video={video}
                trim={videoState() ?? { trimStartUs: 0, trimEndUs: 0 }}
                canUndo={videoHistoryIndex() > 0}
                canRedo={
                  videoHistoryIndex() >= 0 && videoHistoryIndex() < videoHistory().length - 1
                }
                onPreview={previewVideoTrim}
                onCommit={commitVideoTrim}
                onUndo={() => goToVideoHistory(videoHistoryIndex() - 1)}
                onRedo={() => goToVideoHistory(videoHistoryIndex() + 1)}
              />
            )}
          </Show>
        </ViewportOverlay>

        <Show
          when={
            hasImage() &&
            !maskingMode() &&
            !activeOverlay() &&
            activeAdjustmentPanel() === "retouch" &&
            editState.retouch.spots.length > 0
          }
        >
          <SpotRetouchOverlay
            spots={editState.retouch.spots}
            viewerApi={() => viewerApi}
            viewportKey={`${state.viewport.zoom}:${state.viewport.panX}:${state.viewport.panY}:${editState.transform.orientation}:${editState.transform.cropX}:${editState.transform.cropY}:${editState.transform.cropWidth}:${editState.transform.cropHeight}:${editState.distort.distortionAmount}:${editState.distort.distortionHorizontal}:${editState.distort.distortionVertical}`}
            imageWidth={state.image?.width ?? 1}
            imageHeight={state.image?.height ?? 1}
            onInput={(spots) =>
              schedulePreviewRender(
                {
                  retouch: {
                    ...editState.retouch,
                    enabled: true,
                    bypass: false,
                    spots: spots.map(cloneRetouchSpot),
                  },
                },
                "spot-removal-drag",
              )
            }
            onChange={(spots, historyKey) => {
              setEditState("retouch", {
                ...editState.retouch,
                enabled: true,
                bypass: false,
                spots: spots.map(cloneRetouchSpot),
              });
              clearScheduledPreviewRender("spot-removal-commit");
              const assetId = activeAssetId();
              if (assetId) pushHistoryState(assetId, serializeEditState(editState), historyKey);
            }}
            onDelete={(index) => {
              const spots = editState.retouch.spots
                .filter((_, spotIndex) => spotIndex !== index)
                .map(cloneRetouchSpot);
              setEditState("retouch", {
                ...editState.retouch,
                enabled: true,
                bypass: false,
                spots,
              });
              setSelectedRetouchSpot(spots.length ? Math.min(index, spots.length - 1) : null);
              const assetId = activeAssetId();
              if (assetId) {
                pushHistoryState(assetId, serializeEditState(editState), "remove_spot_removal");
              }
            }}
          />
        </Show>

        <Show
          when={
            hasImage() &&
            !maskingMode() &&
            !activeOverlay() &&
            activeAdjustmentPanel() === "spotlight"
          }
        >
          <FxCenterOverlay
            label="Spotlight"
            viewerApi={() => viewerApi}
            viewportKey={`${state.viewport.zoom}:${state.viewport.panX}:${state.viewport.panY}:${editState.transform.orientation}:${editState.transform.cropX}:${editState.transform.cropY}:${editState.transform.cropWidth}:${editState.transform.cropHeight}`}
            centerX={editState.spotlight.centerX}
            centerY={editState.spotlight.centerY}
            onInput={(x, y) =>
              schedulePreviewRender(
                {
                  spotlight: {
                    ...editState.spotlight,
                    bypass: false,
                    centerX: x,
                    centerY: y,
                  },
                },
                "spotlight-center-viewport-drag",
              )
            }
            onChange={(x, y) => {
              setEditState("spotlight", {
                ...editState.spotlight,
                bypass: false,
                centerX: x,
                centerY: y,
              });
              clearScheduledPreviewRender("spotlight-center-viewport-commit");
            }}
          />
        </Show>

        <Show
          when={
            hasImage() &&
            !maskingMode() &&
            !activeOverlay() &&
            activeAdjustmentPanel() === "diffusion"
          }
        >
          <FxCenterOverlay
            label="Diffusion"
            viewerApi={() => viewerApi}
            viewportKey={`${state.viewport.zoom}:${state.viewport.panX}:${state.viewport.panY}:${editState.transform.orientation}:${editState.transform.cropX}:${editState.transform.cropY}:${editState.transform.cropWidth}:${editState.transform.cropHeight}`}
            centerX={editState.diffusion.centerX}
            centerY={editState.diffusion.centerY}
            onInput={(x, y) =>
              schedulePreviewRender(
                {
                  diffusion: {
                    ...editState.diffusion,
                    bypass: false,
                    centerX: x,
                    centerY: y,
                  },
                },
                "diffusion-center-viewport-drag",
              )
            }
            onChange={(x, y) => {
              setEditState("diffusion", {
                ...editState.diffusion,
                bypass: false,
                centerX: x,
                centerY: y,
              });
              clearScheduledPreviewRender("diffusion-center-viewport-commit");
            }}
          />
        </Show>

        <Show when={activeOverlay() === "overlays" && overlayEditMode() === "transform" && !viewerInteractionActive() && !splitActive() && selectedOverlayLayer()?.visible && !selectedOverlayLayer()?.locked && selectedOverlayLayer()}>
          {(layer) => (
            <>
              <Show when={layer().type === "image"}>
                <OverlayTransformOverlay
                  layer={layer()}
                  viewerApi={viewerApi}
                  viewportKey={`${state.viewport.zoom}:${state.viewport.panX}:${state.viewport.panY}`}
                  onUpdate={(patch) => updateOverlayLayer(layer().id, patch)}
                  onCommit={() => recordOverlayDraftCommit()}
                  onContextMenu={openSelectedOverlayContextMenu}
                />
              </Show>
              <Show when={layer().type === "gradient" && (layer() as GradientOverlayLayer).gradientConfig.kind === "linear"}>
                <LinearGradientTransformOverlay
                  layer={layer() as GradientOverlayLayer}
                  viewerApi={viewerApi}
                  viewportKey={`${state.viewport.zoom}:${state.viewport.panX}:${state.viewport.panY}`}
                  onUpdate={(patch) => updateOverlayLayer(layer().id, patch)}
                  onCommit={() => recordOverlayDraftCommit()}
                  onContextMenu={openSelectedOverlayContextMenu}
                />
              </Show>
              <Show when={layer().type === "gradient" && (layer() as GradientOverlayLayer).gradientConfig.kind === "radial"}>
                <RadialTransformOverlay
                  layer={layer() as GradientOverlayLayer}
                  viewerApi={viewerApi}
                  viewportKey={`${state.viewport.zoom}:${state.viewport.panX}:${state.viewport.panY}`}
                  onUpdate={(patch) => updateOverlayLayer(layer().id, patch)}
                  onCommit={() => recordOverlayDraftCommit()}
                  onContextMenu={openSelectedOverlayContextMenu}
                />
              </Show>
            </>
          )}
        </Show>

        <Show when={activeOverlay() === "overlays" && gradientPickerLayerId() !== null && selectedOverlayLayer()?.locked === false && selectedOverlayLayer()}>
          {(layer) => (
            <Show when={layer().type === "gradient" && gradientPickerLayerId() === layer().id}>
              <GradientPicker
                layer={layer() as GradientOverlayLayer}
                onUpdate={(patch) => updateOverlayLayer(layer().id, patch)}
                onCommit={() => recordOverlayDraftCommit()}
                onClose={() => setGradientPickerLayerId(null)}
              />
            </Show>
          )}
        </Show>

        <Show when={overlayContextMenu()}>
          {(menu) => (
            <Portal>
              <ContextMenu state={menu()} onClose={() => setOverlayContextMenu(null)} />
            </Portal>
          )}
        </Show>

        <Show when={borderEditorVisible() && state.image}>
            <Portal>
              <BorderEditorWindow
              anchor={borderOverlayAnchor()}
              image={state.image}
              imageName={
                mediaList().find((media) => media.assetId === activeAssetId())?.fileName ??
                activeAssetId() ??
                state.image?.fileName ??
                ""
              }
              cropSourceData={cropSourceData()}
              previewPresentationBorder={previewPresentationBorder}
                onClose={closeBorderEditor}
              />
            </Portal>
        </Show>



        {/* Thumbnail-first paint (legacy thumbnail.jpeg): show the cached thumbnail
            over the canvas while the texture loads, so reload feels instant and no
            black frame appears. Dropped in handleImageLoaded once the texture is up. */}
        <Show when={bootThumbUrl()}>
          <img
            class="poto-boot-thumb"
            src={bootThumbUrl() ?? undefined}
            alt=""
            aria-hidden="true"
          />
        </Show>

        <Show when={startupPhase() === "shell" || startupPhase() === "booting"}>
          <div class="app-splash"><main class="logo" aria-label="HYTIC">HYTIC</main></div>
        </Show>

        <Show when={showStartScreen()}>
          <StartScreen
            onCreate={() => openOverlay("projects")}
            onImport={triggerImport}
            onReceive={() => openOverlay("relay")}
          />
        </Show>

        <Show when={showLoading()}>
          <div
            class="poto-import-loading"
            classList={{ "poto-import-loading--blocking": importTransitionActive() }}
            role="status"
            aria-live="polite"
          />
        </Show>

        <FileLoadProgress
          active={progressActive}
          total={progressTotal}
          index={progressIndex}
          status={progressStatus}
          title={progressTitle}
          info={progressInfo}
        />
        <Show when={videoExportProgress() !== null}>
          <div class="video-export-progress" role="status" aria-live="polite">
            <span>Encoding video… {Math.round((videoExportProgress() ?? 0) * 100)}%</span>
            <progress max="1" value={videoExportProgress() ?? 0} />
            <button type="button" onClick={() => videoExportController?.abort()}>
              Cancel
            </button>
          </div>
        </Show>
        <Show when={videoImportPrompt()}>
          {(prompt) => (
            <div
              class="video-import-backdrop"
              onPointerDown={() => videoImportResolve?.(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") videoImportResolve?.(null);
              }}
            >
              <section
                class="video-import-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="video-import-title"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div class="video-import-modal__preview">
                  <video src={prompt().previewUrl} muted playsinline preload="metadata" />
                </div>
                <h2 id="video-import-title" class="video-import-modal__title">
                  Import video
                </h2>
                <p class="video-import-modal__name" title={prompt().name}>
                  {prompt().name}
                </p>
                <p class="video-import-modal__desc">
                  How do you want to bring this clip into Hytic?
                </p>
                <div class="video-import-modal__choices">
                  <button
                    type="button"
                    class="video-import-choice video-import-choice--primary"
                    autofocus
                    onClick={() => videoImportResolve?.("video")}
                  >
                    <span class="video-import-choice__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <rect
                          x="3"
                          y="5"
                          width="18"
                          height="14"
                          rx="2.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.7"
                        />
                        <path d="M10 9.2 15 12l-5 2.8z" fill="currentColor" />
                      </svg>
                    </span>
                    <span class="video-import-choice__title">Edit video</span>
                    <span class="video-import-choice__hint">
                      Trim, grade, and export the whole clip.
                    </span>
                  </button>
                  <button
                    type="button"
                    class="video-import-choice"
                    onClick={() => videoImportResolve?.("frame")}
                  >
                    <span class="video-import-choice__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <rect
                          x="3.5"
                          y="5"
                          width="17"
                          height="14"
                          rx="2.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.7"
                        />
                        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
                        <path
                          d="m5 17 4.5-4 3 2.5L16 12l3 3.2"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.7"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                    <span class="video-import-choice__title">Use a frame</span>
                    <span class="video-import-choice__hint">
                      Grab the first frame to edit as a photo.
                    </span>
                  </button>
                </div>
                <footer class="video-import-modal__footer">
                  <button
                    type="button"
                    class="editor-btn editor-btn--secondary"
                    onClick={() => videoImportResolve?.(null)}
                  >
                    Cancel
                  </button>
                </footer>
              </section>
            </div>
          )}
        </Show>
        <Show when={unsupportedVideoPrompt()}>
          {(prompt) => (
            <div
              class="video-import-backdrop"
              onPointerDown={() => setUnsupportedVideoPrompt(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setUnsupportedVideoPrompt(null);
              }}
            >
              <section
                class="video-import-modal video-unsupported-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="video-unsupported-title"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h2 id="video-unsupported-title" class="video-import-modal__title">
                  Unsupported video
                </h2>
                <p class="video-import-modal__name" title={prompt().name}>
                  {prompt().name}
                </p>
                <p class="video-import-modal__desc">
                  Hytic can't open this clip. Professional codecs such as Apple ProRes
                  aren't supported. Re-export it with one of these video codecs and try
                  again:
                </p>
                <ul class="video-formats">
                  <li>
                    <strong>H.264</strong> (AVC) — most compatible
                  </li>
                  <li>
                    <strong>H.265</strong> (HEVC)
                  </li>
                  <li>
                    <strong>AV1</strong>
                  </li>
                  <li>
                    <strong>VP9 / VP8</strong> (WebM)
                  </li>
                </ul>
                <p class="video-formats__note">
                  In an .mp4, .mov, .webm, .mkv, or .avi container.
                </p>
                <footer class="video-import-modal__footer">
                  <button
                    type="button"
                    class="editor-btn editor-btn--primary"
                    autofocus
                    onClick={() => setUnsupportedVideoPrompt(null)}
                  >
                    Got it
                  </button>
                </footer>
              </section>
            </div>
          )}
        </Show>
        <Show when={activeOverlay() === "overlays" && overlayEditMode() === "mask" && selectedOverlayLayer()?.mask}>
            <Switch>
            <Match when={selectedOverlayLayer()?.mask?.type === "radial"}>
              <RadialMaskOverlay
                viewerApi={viewerApi}
                mask={selectedOverlayLayer()?.mask as import("../engine/state/EditState").RadialMaskComponent}
                onUpdate={updateSelectedOverlayMask}
              />
            </Match>
            <Match when={selectedOverlayLayer()?.mask?.type === "gradient"}>
              <GradientMaskOverlay
                viewerApi={viewerApi}
                mask={selectedOverlayLayer()?.mask as import("../engine/state/EditState").GradientMaskComponent}
                onUpdate={updateSelectedOverlayMask}
              />
            </Match>
            <Match when={selectedOverlayLayer()?.mask?.type === "color-pick"}>
              <ColorPickMaskOverlay
                viewerApi={viewerApi}
                mask={selectedOverlayLayer()?.mask as import("../engine/state/EditState").ColorPickMaskComponent}
                onUpdate={updateSelectedOverlayMask}
              />
            </Match>
            <Match when={selectedOverlayLayer()?.mask?.type === "depth"}>
              <OverlayDepthMaskToolbar
                viewerApi={viewerApi}
                mask={selectedOverlayLayer()?.mask as import("../engine/state/EditState").DepthMaskComponent}
                onUpdate={updateSelectedOverlayMask}
                onCommit={() => {}}
                available={getDepthMaskCapability().available}
                unavailableReason={getDepthUnavailableMessage(getDepthMaskCapability().reason)}
              />
            </Match>
            <Match when={selectedOverlayLayer()?.mask?.type === "brush"}>
              <BrushMaskOverlay
                viewerApi={viewerApi}
                mask={selectedOverlayLayer()?.mask as import("../engine/state/EditState").BrushMaskComponent}
                onUpdate={updateSelectedOverlayMask}
              />
            </Match>
            </Switch>
          </Show>
          <Show when={maskingMode() && selectedMaskId()}>
            <Switch>
            <Match when={selectedMaskComponentType() === "color-pick"}>
              <ColorPickMaskOverlay viewerApi={viewerApi} />
            </Match>
            <Match when={selectedMaskComponentType() === "radial"}>
              <RadialMaskOverlay viewerApi={viewerApi} />
            </Match>
            <Match when={selectedMaskComponentType() === "gradient"}>
              <GradientMaskOverlay viewerApi={viewerApi} />
            </Match>
            <Match when={selectedMaskComponentType() === "brush"}>
              <BrushMaskOverlay viewerApi={viewerApi} />
            </Match>
            </Switch>
        </Show>
      </main>

      {/* ── aside: 16 control panels ────────────────────────────────── */}
      <Show when={maskingMode()}>
        <MaskingPanel
          onBack={exitMaskingMode}
          onBeginEdit={beginMaskingDraft}
          onApplyEdit={applyMaskingDraft}
          onCancelEdit={cancelMaskingDraft}
          viewerApi={viewerApi}
          previewEditPatch={schedulePreviewRender}
          clearPreviewPatch={clearScheduledPreviewRender}
        />
      </Show>
      <Show when={!maskingMode() && activeOverlay() === "overlays"}>
        <OverlayPanel
          layers={overlayLayersForUi()}
          selectedLayerId={selectedOverlayLayerId()}
          draftActive={overlayDraftActive()}
          onSelect={selectOverlayLayer}
          onImport={(file, categoryId) => void importOverlayFile(file, categoryId)}
          onUpdate={updateOverlayLayer}
          onDelete={deleteOverlayLayer}
          onDuplicate={duplicateOverlayLayer}
          onAddGradient={addGradientOverlay}
          onAddMask={addOverlayMask}
          onEditMask={editOverlayMask}
          onRemoveMask={removeOverlayMask}
          maskEditing={overlayEditMode() === "mask"}
          onConfirmMask={confirmOverlayMask}
          onApply={() => void applyOverlayDraft()}
          onCancel={cancelOverlayDraft}
          onBack={closeOverlay}
        />
      </Show>
      <Show when={!maskingMode() && activeOverlay() !== "overlays"}>
        <Aside
          hasImage={hasImage()}
          openPanel={activeAdjustmentPanel()}
          onOpenPanelChange={setActiveAdjustmentPanel}
          previewEditPatch={schedulePreviewRender}
          previewCurveInput={previewCurveInput}
          clearPreviewPatch={clearScheduledPreviewRender}
          commitEditHistory={(label) => {
            const assetId = activeAssetId();
            if (assetId) pushHistoryState(assetId, serializeEditState(editState), label);
          }}
          matchApi={{
            hasImage,
            generate: (reference, colorMix, lumaMix) =>
              viewerApi
                ? viewerApi.generateColorMatch(reference, colorMix, lumaMix)
                : Promise.reject(new Error("Viewer is not ready")),
            getSourceMetadata: currentMatchSourceMetadata,
            onError: (message: string) => actions.setError(message),
          }}
        />
      </Show>

      <overlay-view
        attr:open={shouldShowEditorOverlays() ? "" : undefined}
        attr:data-overlay={activeOverlay() ?? undefined}
      >
        <Show when={shouldShowEditorOverlays()}>
          <EditorOverlays
              active={activeOverlay()}
              image={state.image}
              projectName={projectName()}
              currentProjectId={currentProjectId()}
              isDirty={isDirty()}
              isSaving={isSaving()}
              isCropEditing={cropEditMode()}
              isCropApplying={cropApplying()}
              imageName={
                mediaList().find((media) => media.assetId === activeAssetId())?.fileName ??
                activeAssetId() ??
                state.image?.fileName ??
                ""
              }
              canSelectPrevious={mediaList().length > 1}
              canSelectNext={mediaList().length > 1}
              cropSourceData={cropSourceData()}
              cropBusyLabel={cropBusyLabel()}
              exportTitle={exportTitle()}
              lutIs8Bit={lutIs8Bit()}
              previewEditPatch={schedulePreviewRender}
              clearPreviewPatch={clearScheduledPreviewRender}
              previewPresentationBorder={previewPresentationBorder}
              onClose={closeOverlay}
              onProjectNameChange={setProjectName}
              onCreateProject={handleCreateProject}
              onRenameProject={handleRenameProject}
              onSaveProject={handleSaveProject}
              onOpenProject={handleOpenProject}
              onDeleteProject={handleDeleteProject}
              onImportFiles={triggerImport}
              onImportFilesToProject={(projectId, files) =>
                void importFilesToProject(projectId, files)
              }
              onRelayOpenNow={(file) => importRelayFile(file, "open")}
              onRelayAddToProject={(file) => importRelayFile(file, "add")}
              relaySession={relaySession()}
              relayOverlayMode={relayOverlayMode()}
              onSelectMedia={loadActiveMedia}
              onDeleteMedia={(assetIds) => deleteMediaAssets(assetIds)}
              onCreateVirtualCopy={(assetId) => createVirtualCopy(assetId)}
              onRenameMediaVariant={(assetId, name) => renameMediaVariant(assetId, name)}
              onSetPrimaryMediaVariant={(assetId) => setPrimaryMediaVariant(assetId)}
              onRenderMediaPreview={(assetId) => renderMediaPng(assetId, 2048)}
              onCompareBeforeAfter={(assetId) => compareMediaBeforeAfter(assetId)}
              onBatchEdit={(primaryAssetId, targetAssetIds, modules, signal) =>
                applyBatchEditing(primaryAssetId, targetAssetIds, modules, signal)
              }
              onUndoBatchEdit={undoLastBatchEditing}
              canUndoBatchEdit={!!lastBatchJournal()}
              hasEditClipboard={!!editClipboard()}
              onCopyMediaEdits={(assetId, modules) =>
                runMediaAction(() => copyMediaEdits(assetId, modules), "Unable to copy edits")
              }
              onPasteMediaEdits={(assetId) =>
                runMediaAction(() => pasteMediaEdits(assetId), "Unable to paste edits")
              }
              onPasteMediaEditsToSelected={(assetIds) =>
                runMediaAction(
                  () => pasteMediaEditsToSelected(assetIds),
                  "Unable to paste edits",
                )
              }
              onApplyMediaEditsToProject={(assetId, modules) =>
                runMediaAction(
                  () => applyMediaEditsToProject(assetId, modules),
                  "Unable to apply edits to project",
                )
              }
              onGenerateMediaGrid={(assetIds, options) =>
                runMediaAction(() => generateMediaGrid(assetIds, options), "Unable to generate grid")
              }
              onFlattenMedia={(assetId) =>
                runMediaAction(() => flattenMedia(assetId), "Unable to flatten image")
              }
              isFlatteningMedia={() => flatteningAssetId() !== null}
              onUseMediaAsMatchReference={(assetId) =>
                runMediaAction(
                  () => useMediaAsMatchReference(assetId),
                  "Unable to create Color Match reference",
                )
              }
              onViewMediaMetadata={viewMediaMetadata}
              onResetMediaEdits={(assetId) =>
                runMediaAction(() => resetMediaEdits(assetId), "Unable to reset edits")
              }
              onResetSelectedMediaEdits={(assetIds) =>
                runMediaAction(
                  () => resetSelectedMediaEdits(assetIds),
                  "Unable to reset selected edits",
                )
              }
              canRenderMedia={() => !!viewerApi}
              listProjects={projectRepository.listProjectSummaries}
              hydrateProjectSummary={projectRepository.hydrateProjectSummary}
              hydrateMediaThumbnail={projectRepository.hydrateMediaThumbnail}
              onEnterCropEdit={enterCropEdit}
              onExitCropEdit={exitCropEdit}
              cropGuideMode={cropGuideMode()}
              cropRotateActive={cropRotateActive()}
              onCropGuideModeChange={setCropGuideMode}
              onApplyCropEdit={applyCropOverlay}
              onCancelCropEdit={cancelCropOverlay}
              onApplyDistortEdit={() => {
                const assetId = activeAssetId();
                if (assetId) {
                  pushHistoryState(assetId, serializeEditState(editState), "distort-apply");
                }
                closeOverlay();
              }}
              onSelectPreviousCropImage={() => cropAdjacentAsset(-1)}
              onSelectNextCropImage={() => cropAdjacentAsset(1)}
              onCropStageRectChange={() => {}}
              onCropPreviewPainted={() => setCropPreviewPainted(true)}
              onCropRotateDragChange={setCropRotateActive}
              onExportPng={handleExportPng}
              onExportImage={handleExportImage}
              onSendImageToPhone={handleSendImageToPhone}
              canSendImageToPhone={() => !!relaySession()?.canSendToPhone()}
              onBatchExport={handleBatchExport}
              isExportReady={isExportReady}
              getExportBaseSize={getExportBaseSize}
              onExportCube={handleExportCube}
              onExportCLF={handleExportCLF}
              onExportLUT={handleExportLUT}
              onBatchExportLUT={handleBatchExportLUT}
          />
        </Show>
      </overlay-view>

      <PresetEditor />
      <PresetGenerator
        previewEditPatch={schedulePreviewRender}
        clearPreviewPatch={clearScheduledPreviewRender}
      />
    </poto-app>
  );
}

/** StartScreen card shown when no image is loaded. */
function StartScreen(props: { onCreate: () => void; onImport: () => void; onReceive: () => void }) {
  return (
    <start-screen
      class="start-screen--card"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("button")) {
          props.onImport();
        }
      }}
    >
      <div class="start-screen__hero">
        <div class="start-screen__mockup">
            <img src="/assets/img/start_hero_cloud.png" alt="Preview" class="mockup__image" />
        </div>
      </div>

      <div class="start-screen__action-card">
        <button
          type="button"
          class="start-screen__open-btn"
          onClick={(e) => {
            e.stopPropagation();
            props.onImport();
          }}
        >
          <span class="open-btn__title">Open image(s)</span>
          <span class="open-btn__subtitle">RAW, DPX, TIFF, JPEG, PNG & MORE</span>
        </button>

        <p class="start-screen__drag-note">
          <strong>Drag & Drop</strong> or click here to load images into the current scene.
        </p>

        <p class="start-screen__privacy-note">
          Images are processed <strong>privately on your device</strong> and <strong>never uploaded</strong>.
        </p>

        <div class="start-screen__secondary-actions">
          <button
            type="button"
            class="start-screen__sec-link"
            onClick={(e) => {
              e.stopPropagation();
              props.onCreate();
            }}
          >
            Open Projects
          </button>
        </div>
      </div>
    </start-screen>
  );
}

function generateRuntimeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
