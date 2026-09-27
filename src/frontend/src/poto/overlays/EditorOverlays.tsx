import {
  type JSX,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import {
  editState,
  scopesState,
  setEditState,
  setScopesState,
  type ImageInfo,
} from "../../app/editor-store";
import * as perf from "../../app/performanceCounters";
import { allPresets } from "../../engine/presets/CustomPresetStore";
import {
  DEFAULT_PRESET_STATE,
  DEFAULT_TRANSFORM_STATE,
  type AspectRatioPreset,
  type EditState,
  type CurvePreviewInput,
} from "../../engine/state/EditState";
import type { ScopeMode } from "../../engine/scopes/ScopeTypes";
import type { MediaSummary, SavedProjectSummary } from "../../project/ProjectTypes";
import type { RelayReceiveSession } from "../../relay/receiveSession";
import { activeAssetId, mediaList } from "../sessionController";
import {
  exportState,
  updateExportState,
  type ExportColorSpace,
  type ExportImageFormat,
  type ExportMetadataMode,
  type ExportPreset,
} from "../exportStore";
import {
  applyExportPreset,
  applyFormatChange,
  clampToMax,
  DPI_STEPS,
  estimateExportBytes,
  FORMAT_META,
  formatEstimatedBytes,
  isLosslessFormat,
  legacyMaxSafeExportSize,
  PRESET_LABELS,
  QUALITY_STEPS,
  resizeKeepingAspect,
} from "../exportPresets";
import { openSaveBlobWriter, sanitizeFileName, type SingleExportWriter } from "../exportFile";
import {
  DEFAULT_LUT_OPTION,
  deriveLutSettings,
  LUT_FORMAT_GROUPS,
  LUT_FORMAT_OPTIONS,
} from "../lutFormatCatalog";
import type { CropGuideMode } from "../../ui/transform/CropOverlay";
import { applyAspectPresetToTransform } from "../../engine/transform/transformGeometry";
import { ContextMenu, openContextMenu, type ContextMenuState } from "../controls/ContextMenu";
import { Slider } from "../controls/Slider";
import { PRESENTATION_BORDER_PRESETS, getPresentationBorderPreset } from "../../features/presentation/border/borderPresets";
import { resolveBorderGeometry } from "../../features/presentation/border/borderGeometry";
import {
  clonePresentationBorder,
  DEFAULT_PRESENTATION_BORDER,
  hexToRgb,
  normalizePresentationBorder,
  rgbToHex,
  type PresentationBorderAspectRatio,
  type PresentationBorderPreset,
  type PresentationBorderSettings,
} from "../../features/presentation/border/borderTypes";
import { readPresentationFrameImage } from "../../features/presentation/border/frameImage";
import type { CropSourceData } from "../cropSourceTypes";
import { RelayReceiveOverlay } from "./RelayReceiveOverlay";
import { DistortOverlayPanel } from "./DistortOverlayPanel";
import type { MediaEditModuleKey } from "../mediaEditPatch";

export type { MediaEditModuleKey } from "../mediaEditPatch";

export type EditorOverlayKind =
  | "projects"
  | "presets"
  | "crop"
  | "scopes"
  | "export"
  | "relay"
  | "distort"
  | "overlays";
export type Phase8OverlayKind = EditorOverlayKind;

type ExportSize = 17 | 33 | 64;

export type MediaMetadataView = {
  title: string;
  thumbnail?: Blob;
  entries: Array<{ key: string; description: string }>;
};

export type MediaGridOptions = {
  mode: "raw" | "edited";
  layout: "cover" | "contain";
  backgroundColor: string;
};

type MediaEditModuleDescriptor = {
  key: MediaEditModuleKey;
  label: string;
  selected: boolean;
};

const MEDIA_EDIT_MODULES: MediaEditModuleDescriptor[] = [
  { key: "idt", label: "Input Color Space", selected: false },
  { key: "odt", label: "Output Color Space", selected: true },
  { key: "match", label: "Color Match AI", selected: true },
  { key: "retouch", label: "Spot Removal", selected: true },
  { key: "balance", label: "Balance", selected: true },
  { key: "exposure", label: "Exposure Curve", selected: true },
  { key: "contrast", label: "Contrast Curve", selected: true },
  { key: "scatter", label: "Scattering", selected: true },
  { key: "refract", label: "Refraction", selected: true },
  { key: "density", label: "Density Curve", selected: true },
  { key: "chroma", label: "Chroma Curve", selected: true },
  { key: "radiance", label: "Radiance Curve", selected: true },
  { key: "sat", label: "Saturation Curve", selected: true },
  { key: "rgb", label: "Shadow Highlight", selected: true },
  { key: "spotlight", label: "Spotlight FX", selected: true },

  { key: "halation", label: "Halation FX", selected: true },
  { key: "diffusion", label: "Diffusion FX", selected: true },
  { key: "texture", label: "Texture FX", selected: true },
  { key: "transform", label: "Crop & Rotate", selected: true },
];

type EditorOverlaysProps = {
  active: EditorOverlayKind | null;
  image?: ImageInfo;
  projectName: string;
  currentProjectId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  isCropEditing: boolean;
  isCropApplying: boolean;
  imageName: string;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  cropSourceData?: CropSourceData;
  borderAnchor?: HTMLElement | null;
  cropBusyLabel: string;
  exportTitle: string;
  lutIs8Bit: boolean;
  previewEditPatch(patch: Partial<EditState>, reason?: string): void;
  previewCurveInput?(input: CurvePreviewInput): void;
  clearPreviewPatch(reason?: string): void;
  previewPresentationBorder(border: PresentationBorderSettings): void;
  onClose(): void;
  onProjectNameChange(name: string): void;
  onCreateProject(name: string): Promise<void>;
  onRenameProject(projectId: string, name: string): Promise<void>;
  onSaveProject(forceNew: boolean): Promise<void>;
  onOpenProject(projectId: string): Promise<void>;
  onDeleteProject(projectId: string): Promise<void>;
  onImportFiles(): void;
  onImportFilesToProject(projectId: string, files: File[]): void;
  onRelayOpenNow(file: File): Promise<void>;
  onRelayAddToProject(file: File): Promise<void>;
  relaySession: RelayReceiveSession | null;
  relayOverlayMode: "receive" | "send";
  onSelectMedia(assetId: string): void;
  onDeleteMedia(assetIds: string[]): Promise<void>;
  onCreateVirtualCopy(assetId: string): Promise<void>;
  onRenameMediaVariant(assetId: string, name: string): Promise<void>;
  onSetPrimaryMediaVariant(assetId: string): Promise<void>;
  onRenderMediaPreview(assetId: string): Promise<Blob>;
  onCompareBeforeAfter(assetId: string): Promise<void>;
  onBatchEdit(
    primaryAssetId: string,
    targetAssetIds: string[],
    modules: MediaEditModuleKey[],
    signal?: AbortSignal,
  ): Promise<void>;
  onUndoBatchEdit(): Promise<void>;
  canUndoBatchEdit: boolean;
  hasEditClipboard: boolean;
  onCopyMediaEdits(assetId: string, modules: MediaEditModuleKey[]): void;
  onPasteMediaEdits(assetId: string): void;
  onPasteMediaEditsToSelected(assetIds: string[]): void;
  onApplyMediaEditsToProject(assetId: string, modules: MediaEditModuleKey[]): void;
  onGenerateMediaGrid(assetIds: string[], options: MediaGridOptions): void;
  onFlattenMedia(assetId: string): void;
  isFlatteningMedia(assetId: string): boolean;
  onUseMediaAsMatchReference(assetId: string): void;
  onViewMediaMetadata(assetId: string): Promise<MediaMetadataView>;
  onResetMediaEdits(assetId: string): void;
  onResetSelectedMediaEdits(assetIds: string[]): void;
  canRenderMedia(): boolean;
  listProjects(): Promise<SavedProjectSummary[]>;
  hydrateProjectSummary(projectId: string): Promise<SavedProjectSummary | undefined>;
  hydrateMediaThumbnail(assetId: string): Promise<Blob | undefined>;
  onEnterCropEdit(): void;
  onExitCropEdit(): void;
  cropGuideMode: CropGuideMode;
  cropRotateActive: boolean;
  onCropGuideModeChange(mode: CropGuideMode): void;
  onApplyCropEdit(): void;
  onCancelCropEdit(): void;
  onApplyDistortEdit(): void;
  onSelectPreviousCropImage(): void;
  onSelectNextCropImage(): void;
  /** Reports the live-px rect of the modal crop stage. */
  onCropStageRectChange(
    rect: { top: number; left: number; width: number; height: number } | null,
  ): void;
  /** Fired after the replacement crop canvas has completed its first draw. */
  onCropPreviewPainted(): void;
  /** Fired with true on rotation-slider pointer down, false on release. */
  onCropRotateDragChange(active: boolean): void;
  onExportPng(bitDepth: 8 | 16): Promise<void>;
  onExportImage(writer?: SingleExportWriter): Promise<void>;
  onSendImageToPhone(): Promise<void>;
  canSendImageToPhone(): boolean;
  onBatchExport(assetIds: string[], signal?: AbortSignal): Promise<void>;
  isExportReady(): boolean;
  getExportBaseSize(): { width: number; height: number };
  onExportCube(options: { title: string; size: ExportSize }): Promise<void>;
  onExportCLF(options: { title: string; size: ExportSize }): Promise<void>;
  onExportLUT(writer?: SingleExportWriter): Promise<void>;
  onBatchExportLUT(assetIds: string[], signal?: AbortSignal): Promise<void>;
};

const CROP_GUIDES: Array<{ value: CropGuideMode; label: string }> = [
  { value: "thirds", label: "1 Rule of Thirds" },
  { value: "center", label: "2 Center" },
  { value: "grid", label: "5 Grid" },
  { value: "triangle", label: "7 Triangle" },
  { value: "golden", label: "3 Golden Ratio" },
  { value: "fifth", label: "4 Fifth" },
  { value: "diagonal", label: "6 Diagonal" },
];

function isTransformDefaultForReset(): boolean {
  const t = editState.transform;
  return (
    t.cropX === DEFAULT_TRANSFORM_STATE.cropX &&
    t.cropY === DEFAULT_TRANSFORM_STATE.cropY &&
    t.cropWidth === DEFAULT_TRANSFORM_STATE.cropWidth &&
    t.cropHeight === DEFAULT_TRANSFORM_STATE.cropHeight &&
    t.aspectRatio === DEFAULT_TRANSFORM_STATE.aspectRatio &&
    t.orientation === DEFAULT_TRANSFORM_STATE.orientation &&
    t.straighten === DEFAULT_TRANSFORM_STATE.straighten &&
    t.flipX === DEFAULT_TRANSFORM_STATE.flipX &&
    t.flipY === DEFAULT_TRANSFORM_STATE.flipY
  );
}

function CropAspectOptions() {
  return (
    <>
      <option value="free">Free</option>
      <option value="original">Original</option>
      <option value="1:1">Square</option>
      <optgroup label="Landscape">
        <option value="5:4">5:4</option>
        <option value="5:3">5:3</option>
        <option value="4:3">4:3</option>
        <option value="3:2">3:2</option>
        <option value="16:9">16:9</option>
        <option value="16:10">16:10</option>
        <option value="21:9">21:9</option>
        <option value="65:24">65:24</option>
      </optgroup>
      <optgroup label="Portrait">
        <option value="4:5">4:5</option>
        <option value="3:5">3:5</option>
        <option value="3:4">3:4</option>
        <option value="2:3">2:3</option>
        <option value="9:16">9:16</option>
        <option value="10:16">10:16</option>
        <option value="9:21">9:21</option>
        <option value="24:65">24:65</option>
      </optgroup>
      <optgroup label="Cinema">
        <option value="1.85:1">1.85:1</option>
        <option value="2.00:1">2.00:1</option>
        <option value="2.35:1">2.35:1</option>
        <option value="2.39:1">2.39:1</option>
        <option value="2.40:1">2.40:1</option>
      </optgroup>
    </>
  );
}

function CropGuideOptions() {
  return (
    <>
      <optgroup label="Standard Crop Overlays">
        <For each={CROP_GUIDES.slice(0, 3)}>
          {(guide) => <option value={guide.value}>{guide.label}</option>}
        </For>
      </optgroup>
      <optgroup label="Crop Overlays">
        <For each={CROP_GUIDES.slice(3)}>
          {(guide) => <option value={guide.value}>{guide.label}</option>}
        </For>
      </optgroup>
    </>
  );
}

function legacyCropDisplayDimensions(
  width: number,
  height: number,
  orientation: 0 | 90 | 180 | 270,
): { width: number; height: number } {
  // Legacy hu.He(): display dims are source dims swapped only by the quarter-turn
  // orientation. Straighten rotation is covered by fillScale, not by resizing the
  // crop canvas.
  return orientation === 90 || orientation === 270
    ? { width: height, height: width }
    : { width, height };
}

function CropTransformPreview(props: {
  sourceData?: CropSourceData;
  guideMode: CropGuideMode;
  rotateActive?: boolean;
  disabled?: boolean;
  /** Live straighten override (deg) used while the rotation slider is dragged. */
  straighten?: number;
  onCropChange(x: number, y: number, w: number, h: number): void;
  onFirstPaint(): void;
}) {
  let hostRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;
  let cropToolRef!: HTMLElement;
  const [stageSize, setStageSize] = createSignal({ width: 1, height: 1 });
  const [bitmap, setBitmap] = createSignal<ImageBitmap | null>(null);
  const [revision, setRevision] = createSignal(0);
  const [draggingCrop, setDraggingCrop] = createSignal(false);
  let firstPaintReported = false;
  let firstPaintFrame = 0;

  onMount(() => {
    const report = () => {
      const rect = hostRef.getBoundingClientRect();
      setStageSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(hostRef);
    window.addEventListener("resize", report);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    });
  });

  createEffect(() => {
    const source = props.sourceData;
    firstPaintReported = false;
    if (firstPaintFrame) {
      cancelAnimationFrame(firstPaintFrame);
      firstPaintFrame = 0;
    }
    let disposed = false;
    setBitmap((previous) => {
      previous?.close();
      return null;
    });
    if (!source) return;

    const imageData = new ImageData(
      new Uint8ClampedArray(source.buffer.slice(0)),
      source.width,
      source.height,
    );
    void createImageBitmap(imageData, {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    }).then((next) => {
      if (disposed) {
        next.close();
        return;
      }
      setBitmap(next);
      setRevision((value) => value + 1);
    });
    onCleanup(() => {
      disposed = true;
    });
  });

  onCleanup(() => {
    bitmap()?.close();
    if (firstPaintFrame) cancelAnimationFrame(firstPaintFrame);
  });

  const displaySize = createMemo(() => {
    const source = props.sourceData;
    if (!source) return { width: 1, height: 1 };
    return legacyCropDisplayDimensions(
      source.width,
      source.height,
      editState.transform.orientation,
    );
  });

  const previewSize = createMemo(() => {
    const stage = stageSize();
    const display = displaySize();
    const scale = Math.min(
      1,
      (stage.width * 0.98) / Math.max(1, display.width),
      (stage.height * 0.98) / Math.max(1, display.height),
    );
    return {
      width: Math.max(1, display.width * scale),
      height: Math.max(1, display.height * scale),
      scale,
    };
  });

  const cropCssRect = createMemo(() => {
    const preview = previewSize();
    const t = editState.transform;
    return {
      x: t.cropX * preview.width,
      y: t.cropY * preview.height,
      width: t.cropWidth * preview.width,
      height: t.cropHeight * preview.height,
    };
  });

  function orientationDegrees(orientation: 0 | 90 | 180 | 270) {
    return orientation === 270 ? -90 : orientation;
  }

  function guideModeNumber(mode: CropGuideMode): number {
    switch (mode) {
      case "thirds":
        return 1;
      case "center":
        return 2;
      case "golden":
        return 3;
      case "fifth":
        return 4;
      case "grid":
        return 5;
      case "diagonal":
        return 6;
      case "triangle":
        return 7;
      default:
        return 0;
    }
  }

  function numericAspectRatio(
    value: AspectRatioPreset,
    display: { width: number; height: number },
  ): number | null {
    if (!value || value === "free") return null;
    if (value === "original") return display.width / Math.max(1, display.height);
    const [rawA, rawB = "1"] = String(value).split(":");
    const a = Number(rawA);
    const b = Number(rawB);
    return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? a / b : null;
  }

  function clampCropLikeLegacy(x: number, y: number, width: number, height: number) {
    const current = editState.transform;
    let nx = x;
    let ny = y;
    let nw = width;
    let nh = height;
    if (Math.abs(nw - current.cropWidth) < 0.001 && Math.abs(nh - current.cropHeight) < 0.001) {
      if (nx < 0) nx = 0;
      if (ny < 0) ny = 0;
      if (nx + nw > 1) nx = 1 - nw;
      if (ny + nh > 1) ny = 1 - nh;
    } else {
      if (nx < 0) {
        nw += nx;
        nx = 0;
      }
      if (ny < 0) {
        nh += ny;
        ny = 0;
      }
      if (nx + nw > 1) nw = 1 - nx;
      if (ny + nh > 1) nh = 1 - ny;
    }
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    nw = Math.max(0.001, Math.min(1 - nx, nw));
    nh = Math.max(0.001, Math.min(1 - ny, nh));
    return { x: nx, y: ny, width: nw, height: nh };
  }

  function drawGuide(
    ctx: CanvasRenderingContext2D,
    crop: { x: number; y: number; width: number; height: number },
    mode: number,
    lineWidth: number,
  ) {
    if (mode <= 0) return;
    const left = crop.x;
    const top = crop.y;
    const right = crop.x + crop.width;
    const bottom = crop.y + crop.height;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();

    if (mode === 1 || mode === 4 || mode === 5) {
      const divisions = mode === 1 ? 3 : mode === 4 ? 5 : 12;
      ctx.globalAlpha = Math.max(0.35, Math.min(0.65, 1 / (divisions / 2)));
      for (let index = 1; index < divisions; index += 1) {
        const ratio = index / divisions;
        const x = left + crop.width * ratio;
        const y = top + crop.height * ratio;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
    } else if (mode === 2) {
      ctx.moveTo(left, top + crop.height * 0.5);
      ctx.lineTo(right, top + crop.height * 0.5);
      ctx.moveTo(left + crop.width * 0.5, top);
      ctx.lineTo(left + crop.width * 0.5, bottom);
    } else if (mode === 3) {
      const golden = (1 + Math.sqrt(5)) / 2;
      const y = crop.height / (golden + 1);
      const x = crop.width / (golden + 1);
      ctx.moveTo(left, top + y);
      ctx.lineTo(right, top + y);
      ctx.moveTo(left, bottom - y);
      ctx.lineTo(right, bottom - y);
      ctx.moveTo(left + x, top);
      ctx.lineTo(left + x, bottom);
      ctx.moveTo(right - x, top);
      ctx.lineTo(right - x, bottom);
    } else if (mode === 6) {
      const offset = crop.height * 0.25;
      ctx.moveTo(left, top);
      ctx.lineTo(right, bottom - offset);
      ctx.moveTo(left, top + offset);
      ctx.lineTo(right, bottom);
      ctx.moveTo(right, top);
      ctx.lineTo(left, bottom - offset);
      ctx.moveTo(right, top + offset);
      ctx.lineTo(left, bottom);
    } else if (mode === 7) {
      const w2 = crop.width * crop.width;
      const h2 = crop.height * crop.height;
      const sum = w2 + h2;
      const hRatio = h2 / sum;
      const wRatio = w2 / sum;
      const xA = left + hRatio * crop.width;
      const yA = top + hRatio * crop.height;
      const xB = left + wRatio * crop.width;
      const yB = top + wRatio * crop.height;
      ctx.moveTo(left, top);
      ctx.lineTo(right, bottom);
      ctx.moveTo(left, bottom);
      ctx.lineTo(xA, yA);
      ctx.moveTo(right, top);
      ctx.lineTo(xB, yB);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawCropMaskAndGuide(
    ctx: CanvasRenderingContext2D,
    display: { width: number; height: number },
    scaleToPixels: number,
  ) {
    const t = editState.transform;
    const crop = {
      x: t.cropX * display.width,
      y: t.cropY * display.height,
      width: t.cropWidth * display.width,
      height: t.cropHeight * display.height,
    };
    const borderWidth = 4 / scaleToPixels;
    const guideWidth = 3 / scaleToPixels;

    ctx.beginPath();
    ctx.rect(0, 0, display.width, display.height);
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = 0.7;
    ctx.fill("evenodd");

    ctx.beginPath();
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 1;
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    if (draggingCrop() || props.rotateActive) {
      drawGuide(ctx, crop, guideModeNumber(props.guideMode), guideWidth);
    }
    ctx.globalAlpha = 1;
  }

  createEffect(() => {
    const source = props.sourceData;
    const bmp = bitmap();
    const preview = previewSize();
    const display = displaySize();
    const t = editState.transform;
    // While the rotation slider is dragged the store isn't written until release,
    // so honour the live override here to keep the canvas in sync with the slider.
    const straighten = props.straighten ?? t.straighten;
    const drag = draggingCrop();
    void drag;
    if (!source || !bmp || !canvasRef) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(preview.width * dpr));
    const pixelHeight = Math.max(1, Math.round(preview.height * dpr));
    if (canvasRef.width !== pixelWidth) canvasRef.width = pixelWidth;
    if (canvasRef.height !== pixelHeight) canvasRef.height = pixelHeight;
    canvasRef.style.width = `${preview.width}px`;
    canvasRef.style.height = `${preview.height}px`;

    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    const scaleToPixels = preview.scale * dpr;
    ctx.setTransform(scaleToPixels, 0, 0, scaleToPixels, 0, 0);

    ctx.save();
    ctx.translate(display.width * 0.5, display.height * 0.5);
    ctx.rotate(((orientationDegrees(t.orientation) + straighten) * Math.PI) / 180);
    const fine = (Math.abs(straighten) * Math.PI) / 180;
    const fs = Math.sin(fine);
    const fc = Math.cos(fine);
    const fillScale = Math.max(
      (display.width * fc + display.height * fs) / Math.max(1, display.width),
      (display.width * fs + display.height * fc) / Math.max(1, display.height),
    );
    ctx.scale(fillScale * (t.flipX ? -1 : 1), fillScale * (t.flipY ? -1 : 1));
    ctx.drawImage(bmp, -source.width * 0.5, -source.height * 0.5, source.width, source.height);
    ctx.restore();

    drawCropMaskAndGuide(ctx, display, scaleToPixels);
    setRevision((value) => value + 1);
    if (!firstPaintReported) {
      firstPaintReported = true;
      firstPaintFrame = requestAnimationFrame(() => {
        firstPaintFrame = 0;
        props.onFirstPaint();
      });
    }
  });

  function startCropPointer(event: PointerEvent) {
    if (props.disabled || !cropToolRef) return;
    const target = event.target as Element;
    const children = Array.from(cropToolRef.children);
    const handle = children.indexOf(target);
    const rect = cropToolRef.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const t = editState.transform;
    const start = {
      x: t.cropX * width,
      y: t.cropY * height,
      width: t.cropWidth * width,
      height: t.cropHeight * height,
    };
    const pointerStart = { x: event.clientX, y: event.clientY };
    const minSize = 100;
    const aspect = numericAspectRatio(t.aspectRatio, displaySize());
    const scratch = { x: t.cropX, y: t.cropY, width: t.cropWidth, height: t.cropHeight };

    const commitPixels = (x: number, y: number, cropWidth: number, cropHeight: number) => {
      scratch.x = x / width;
      scratch.y = y / height;
      scratch.width = cropWidth / width;
      scratch.height = cropHeight / height;
      const clamped = clampCropLikeLegacy(scratch.x, scratch.y, scratch.width, scratch.height);
      props.onCropChange(clamped.x, clamped.y, clamped.width, clamped.height);
    };

    const resize = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - pointerStart.x;
      const dy = moveEvent.clientY - pointerStart.y;
      let x = start.x;
      let y = start.y;
      let cropWidth = start.width;
      let cropHeight = start.height;

      switch (handle) {
        case 0:
          x = start.x + dx;
          y = start.y + dy;
          cropWidth = start.width - dx;
          cropHeight = start.height - dy;
          break;
        case 1:
          y = start.y + dy;
          cropHeight = start.height - dy;
          break;
        case 2:
          y = start.y + dy;
          cropWidth = start.width + dx;
          cropHeight = start.height - dy;
          break;
        case 3:
          cropWidth = start.width + dx;
          break;
        case 4:
          cropWidth = start.width + dx;
          cropHeight = start.height + dy;
          break;
        case 5:
          cropHeight = start.height + dy;
          break;
        case 6:
          x = start.x + dx;
          cropWidth = start.width - dx;
          cropHeight = start.height + dy;
          break;
        case 7:
          x = start.x + dx;
          cropWidth = start.width - dx;
          break;
        default: {
          const movedX = start.x + dx;
          const movedY = start.y + dy;
          commitPixels(movedX, movedY, start.width, start.height);
          return;
        }
      }

      if (aspect !== null) {
        if (handle === 3 || handle === 7) {
          cropHeight = cropWidth / aspect;
          if (handle === 7) y = start.y + start.height - cropHeight;
        } else if (handle === 1 || handle === 5) {
          cropWidth = cropHeight * aspect;
          x = start.x + (start.width - cropWidth) / 2;
        } else if (handle === 2 || handle === 4) {
          cropHeight = cropWidth / aspect;
          if (handle === 2) y = start.y + start.height - cropHeight;
        } else if (handle === 0 || handle === 6) {
          cropHeight = cropWidth / aspect;
          x = start.x + start.width - cropWidth;
          if (handle === 0) y = start.y + start.height - cropHeight;
        }
        if (
          x < 0 ||
          y < 0 ||
          x + cropWidth > width ||
          y + cropHeight > height ||
          cropWidth < minSize ||
          cropHeight < minSize
        ) {
          return;
        }
      }

      if (cropWidth < minSize) {
        if (handle === 0 || handle === 6 || handle === 7) x = start.x + start.width - minSize;
        cropWidth = minSize;
        if (x < 0 || x + cropWidth > width) return;
      }
      if (cropHeight < minSize) {
        if (handle === 0 || handle === 1 || handle === 2) y = start.y + start.height - minSize;
        cropHeight = minSize;
        if (y < 0 || y + cropHeight > height) return;
      }

      if (moveEvent.altKey) {
        x = start.x + start.width / 2 - cropWidth / 2;
        y = start.y + start.height / 2 - cropHeight / 2;
        if (x < 0 || y < 0 || x + cropWidth > width || y + cropHeight > height) return;
      }

      commitPixels(x, y, cropWidth, cropHeight);
    };

    const finish = () => {
      document.removeEventListener("pointermove", resize);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("pointerleave", leave);
      setDraggingCrop(false);
    };
    const leave = (leaveEvent: PointerEvent) => {
      if (leaveEvent.target === leaveEvent.currentTarget) finish();
    };

    event.preventDefault();
    target.setPointerCapture?.(event.pointerId);
    setDraggingCrop(true);
    document.addEventListener("pointermove", resize);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    document.addEventListener("pointerleave", leave);
  }

  const cropToolStyle = createMemo(() => {
    const preview = previewSize();
    const rect = cropCssRect();
    return [
      `width:${Math.round(preview.width)}px`,
      `height:${Math.round(preview.height)}px`,
      `--x:${Math.round(rect.x)}px`,
      `--y:${Math.round(rect.y)}px`,
      `--w:${Math.round(rect.width)}px`,
      `--h:${Math.round(rect.height)}px`,
    ].join(";");
  });

  return (
    <div ref={hostRef} class="editor-transform-preview-host">
      <div
        class="editor-transform-preview"
        style={{
          width: `${previewSize().width}px`,
          height: `${previewSize().height}px`,
        }}
      >
        <canvas ref={canvasRef} class="editor-transform-preview__canvas" />
        <Show when={bitmap()}>
          <crop-tool
            ref={cropToolRef}
            style={cropToolStyle()}
            data-revision={revision()}
            onPointerDown={startCropPointer}
          >
            <crop-edge />
            <crop-side />
            <crop-edge />
            <crop-side />
            <crop-edge />
            <crop-side />
            <crop-edge />
            <crop-side />
          </crop-tool>
        </Show>
      </div>
      <Show when={!bitmap()}>
        <div class="editor-transform-window__busy editor-transform-window__busy--stage">
          <div class="spinner" />
          <span>Loading Original File...</span>
        </div>
      </Show>
    </div>
  );
}

const SCOPE_GROUPS: Array<{ label: string; modes: Array<{ id: ScopeMode; label: string }> }> = [
  {
    label: "Histograms",
    modes: [
      { id: "rgb", label: "RGB" },
      { id: "hue", label: "Hue" },
      { id: "sat", label: "Sat" },
      { id: "lum", label: "Luma" },
    ],
  },
  {
    label: "Scopes",
    modes: [
      { id: "vec", label: "Vector" },
      { id: "wvf", label: "Waveform" },
      { id: "prd", label: "Parade" },
    ],
  },
  {
    label: "Analysis",
    modes: [
      { id: "ntg", label: "Grey" },
      { id: "skn", label: "Skin" },
      { id: "exz", label: "Zones" },
      { id: "clz", label: "Clip" },
      { id: "tmp", label: "Temp" },
      { id: "fcl", label: "False" },
    ],
  },
];

// Apps a Hytic 3D LUT can be loaded into — shown as a muted logo strip under the
// "Export 3D LUT" heading (ported from the legacy export-window header).
const LUT_COMPATIBLE_APPS: ReadonlyArray<{ name: string; icon: string }> = [
  { name: "Adobe Lightroom", icon: "lightroom_icon.svg" },
  { name: "DaVinci Resolve", icon: "resolve_icon.svg" },
  { name: "Adobe Premiere Pro", icon: "premiere_icon.svg" },
  { name: "Adobe Photoshop", icon: "photoshop_icon.svg" },
  { name: "Final Cut Pro", icon: "final_cut_pro_icon.svg" },
  { name: "Affinity Photo", icon: "affinity_photo_icon.svg" },
  { name: "Adobe After Effects", icon: "after_effects_icon.svg" },
  { name: "MAGIX Vegas Pro", icon: "magix_vegas_icon.svg" },
  { name: "Unity", icon: "unity_icon.svg" },
  { name: "Unreal Engine", icon: "unreal_engine_icon.svg" },
];

export function EditorOverlays(props: EditorOverlaysProps) {
  return (
    <Switch>
      <Match when={props.active === "projects"}>
        <ProjectsPopover {...props} />
      </Match>
      <Match when={props.active === "presets"}>
        <div class="editor-overlay" data-overlay="presets">
          <OverlayBackdrop onClose={props.onClose} />
          <OverlayDialog title="Preset Library" onClose={props.onClose}>
            <PresetLibraryOverlay
              previewEditPatch={props.previewEditPatch}
              clearPreviewPatch={props.clearPreviewPatch}
            />
          </OverlayDialog>
        </div>
      </Match>
      <Match when={props.active === "crop"}>
        <div class="editor-overlay editor-overlay--crop" data-overlay="crop">
          <CropOverlayPanel {...props} />
        </div>
      </Match>
      <Match when={props.active === "distort"}>
        <div class="editor-overlay editor-overlay--crop editor-overlay--distort" data-overlay="distort">
          <DistortOverlayPanel
            image={props.image}
            imageName={props.imageName}
            cropSourceData={props.cropSourceData}
            onApply={() => {
              props.onApplyDistortEdit();
            }}
            onCancel={props.onClose}
            canSelectPrevious={false}
            canSelectNext={false}
          />
        </div>
      </Match>
      <Match when={props.active === "scopes"}>
        <div class="editor-overlay editor-overlay--tools" data-overlay="scopes">
          <OverlayDialog title="Scopes" onClose={props.onClose} compact>
            <ScopesOverlay hasImage={!!props.image} />
          </OverlayDialog>
        </div>
      </Match>
      <Match when={props.active === "export"}>
        <div class="editor-overlay" data-overlay="export">
          <OverlayBackdrop onClose={props.onClose} />
          <OverlayDialog title="Export" onClose={props.onClose}>
            <ExportOverlay {...props} />
          </OverlayDialog>
        </div>
      </Match>
    </Switch>
  );
}

// Projects manager rendered as a popover anchored to the floating
// `data-action="open-projects"` button (bottom-left of the viewport toolbar).
// The anchor position (--pop-left/--pop-bottom) is captured on the trigger
// click and read from CSS here; the toolbar remains visible beside the popover.
function ProjectsPopover(props: EditorOverlaysProps) {
  return (
    <div class="editor-overlay editor-overlay--popover" data-overlay="projects">
      <OverlayBackdrop onClose={props.onClose} />
      <OverlayDialog title="Projects" onClose={props.onClose}>
        <ProjectOverlay {...props} />
      </OverlayDialog>
    </div>
  );
}

function OverlayBackdrop(props: { onClose(): void }) {
  return (
    <button
      class="editor-backdrop"
      type="button"
      aria-label="Close overlay"
      onClick={() => props.onClose()}
    />
  );
}

function OverlayDialog(props: {
  title: string;
  compact?: boolean;
  onClose(): void;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <section
      classList={{
        "editor-dialog": true,
        "editor-dialog--compact": !!props.compact,
      }}
      role="dialog"
      aria-modal={props.compact ? "false" : "true"}
      aria-label={props.title}
    >
      <div class="editor-dialog__body">{props.children}</div>
    </section>
  );
}

function ProjectOverlay(props: EditorOverlaysProps) {
  const [projects, setProjects] = createSignal<SavedProjectSummary[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [deleteCandidate, setDeleteCandidate] = createSignal<Pick<
    SavedProjectSummary,
    "id" | "name"
  > | null>(null);
  const [deletingProject, setDeletingProject] = createSignal(false);
  const [mediaDeleteCandidate, setMediaDeleteCandidate] = createSignal<{
    ids: string[];
    names: string[];
  } | null>(null);
  const [deletingMedia, setDeletingMedia] = createSignal(false);
  const [view, setView] = createSignal<"project" | "gallery">("project");
  const [newProjectOpen, setNewProjectOpen] = createSignal(false);
  const [newProjectName, setNewProjectName] = createSignal("");
  const [editingProjectId, setEditingProjectId] = createSignal<string | null>(null);
  const [editingName, setEditingName] = createSignal("");
  const [selectedMediaIds, setSelectedMediaIds] = createSignal<Set<string>>(new Set());
  const [anchorMediaIndex, setAnchorMediaIndex] = createSignal(0);
  const activeId = createMemo(() => activeAssetId());
  const selectedSet = createMemo(() => selectedMediaIds());
  const [dragProjectId, setDragProjectId] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null);
  const [metadataView, setMetadataView] = createSignal<MediaMetadataView | null>(null);
  const [gridDialog, setGridDialog] = createSignal<{ ids: string[] } | null>(null);
  const [compareDialog, setCompareDialog] = createSignal<{ ids: [string, string] } | null>(null);
  const [batchDialog, setBatchDialog] = createSignal<{ ids: string[] } | null>(null);
  let refreshToken = 0;
  let renameInFlight = false;
  let metadataRequestToken = 0;
  const hydratedProjectIds = new Set<string>();
  const hydratingProjectIds = new Set<string>();

  async function refresh() {
    const token = ++refreshToken;
    setLoading(true);
    try {
      const nextProjects = await props.listProjects();
      if (token === refreshToken) {
        hydratedProjectIds.clear();
        hydratingProjectIds.clear();
        setProjects(nextProjects);
      }
    } finally {
      if (token === refreshToken) setLoading(false);
    }
  }

  async function hydrateProject(projectId: string): Promise<void> {
    if (hydratedProjectIds.has(projectId) || hydratingProjectIds.has(projectId)) return;
    hydratingProjectIds.add(projectId);
    try {
      const summary = await props.hydrateProjectSummary(projectId);
      if (!summary) return;
      hydratedProjectIds.add(projectId);
      setProjects((items) =>
        items.map((item) => (item.id === projectId ? { ...item, ...summary } : item)),
      );
    } finally {
      hydratingProjectIds.delete(projectId);
    }
  }

  createEffect(() => {
    void refresh();
  });

  async function open(projectId: string) {
    await props.onOpenProject(projectId);
    setView("project");
    await refresh();
  }

  async function remove(project: Pick<SavedProjectSummary, "id" | "name">) {
    if (deletingProject()) return;
    setDeletingProject(true);
    try {
      await props.onDeleteProject(project.id);
      setDeleteCandidate(null);
      await refresh();
    } catch {
      // The app-level handler reports the storage error; keep the confirmation open for retry.
    } finally {
      setDeletingProject(false);
    }
  }

  async function createProject() {
    const name = newProjectName().trim();
    if (!name) return;
    await props.onCreateProject(name);
    setNewProjectName("");
    setNewProjectOpen(false);
    setView("project");
    await refresh();
  }

  function startRename(projectId: string, name: string) {
    setEditingProjectId(projectId);
    setEditingName(name);
  }

  async function commitRename() {
    if (renameInFlight) return;
    const projectId = editingProjectId();
    const name = editingName();
    if (!projectId || !name.trim()) {
      setEditingProjectId(null);
      return;
    }
    renameInFlight = true;
    try {
      await props.onRenameProject(projectId, name);
      setEditingProjectId(null);
      await refresh();
    } catch {
      // The app-level handler reports the storage error; preserve the user's edit for retry.
    } finally {
      renameInFlight = false;
    }
  }

  function replaceMediaSelection(assetId: string, index: number) {
    setSelectedMediaIds(new Set([assetId]));
    setAnchorMediaIndex(index);
  }

  function toggleMediaSelection(assetId: string, index: number) {
    const next = new Set(selectedMediaIds());
    if (next.has(assetId)) {
      if (next.size > 1) next.delete(assetId);
    } else {
      next.add(assetId);
    }
    setSelectedMediaIds(next);
    setAnchorMediaIndex(index);
  }

  function selectMediaRange(index: number) {
    const items = mediaList();
    const start = Math.min(anchorMediaIndex(), index);
    const end = Math.max(anchorMediaIndex(), index);
    setSelectedMediaIds(new Set(items.slice(start, end + 1).map((media) => media.assetId)));
  }

  function selectMedia(media: MediaSummary, index: number, event: MouseEvent) {
    if (event.metaKey || event.ctrlKey) {
      toggleMediaSelection(media.assetId, index);
      return;
    }
    if (event.shiftKey) {
      selectMediaRange(index);
      return;
    }
    if (media.assetId === activeAssetId()) {
      replaceMediaSelection(media.assetId, index);
      return;
    }
    setSelectedMediaIds(new Set<string>());
    setAnchorMediaIndex(index);
    props.onSelectMedia(media.assetId);
  }

  function contextMedia(media: MediaSummary, index: number, event: MouseEvent) {
    perf.recordContextMenuOpen();
    const selected = selectedMediaIds();
    const isMulti = selected.size > 1;
    if (!isMulti && !selected.has(media.assetId) && selected.size > 0) {
      setSelectedMediaIds(new Set<string>());
      setAnchorMediaIndex(index);
    }
    setMenu(null);
    setMenu(
      openContextMenu(
        event,
        isMulti ? multiMediaMenuHtml(selected.size) : singleMediaMenuHtml(media.fileName),
        isMulti ? multiMediaActions() : singleMediaActions(media),
      ),
    );
  }

  function closeMetadataView(): void {
    metadataRequestToken += 1;
    setMetadataView(null);
    setMenu(null);
  }

  function openMetadataView(media: MediaSummary): void {
    const token = ++metadataRequestToken;
    void props
      .onViewMediaMetadata(media.assetId)
      .then((view) => {
        if (token === metadataRequestToken) setMetadataView(view);
      })
      .catch(() => {
        if (token !== metadataRequestToken) return;
        setMetadataView({
          title: media.fileName,
          thumbnail: media.thumbnail,
          entries: [],
        });
      });
  }

  function contextProject(project: Pick<SavedProjectSummary, "id" | "name">, event: MouseEvent) {
    setMenu(
      openContextMenu(
        event,
        [
          `<context-item data-action="rename">Rename Project <img src="/assets/icons/pen_icon.svg" alt=""></context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="delete" class="text-red">Delete Project <img src="/assets/icons/delete_icon.svg" alt=""></context-item>`,
        ].join(""),
        {
          rename: { action: () => startRename(project.id, project.name) },
          delete: { action: () => setDeleteCandidate(project) },
        },
      ),
    );
  }

  function selectRenameInput(input: HTMLInputElement): void {
    queueMicrotask(() => input.select());
  }

  function cancelRename(event: KeyboardEvent): void {
    event.preventDefault();
    setEditingProjectId(null);
    (event.currentTarget as HTMLInputElement).blur();
  }

  async function confirmMediaDelete() {
    const candidate = mediaDeleteCandidate();
    if (!candidate || deletingMedia()) return;
    setDeletingMedia(true);
    try {
      await props.onDeleteMedia(candidate.ids);
      const deleted = new Set(candidate.ids);
      setSelectedMediaIds(
        new Set(Array.from(selectedMediaIds()).filter((assetId) => !deleted.has(assetId))),
      );
      setMediaDeleteCandidate(null);
    } catch {
      // The app-level handler reports the storage error; keep the confirmation open for retry.
    } finally {
      setDeletingMedia(false);
    }
  }

  function selectAllMedia(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedMediaIds(new Set(mediaList().map((media) => media.assetId)));
    }
  }

  function droppedFiles(event: DragEvent): File[] {
    const files = event.dataTransfer?.files;
    return files?.length ? Array.from(files) : [];
  }

  function dragProject(projectId: string, event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setDragProjectId(projectId);
  }

  function leaveProject(projectId: string, event: DragEvent) {
    const target = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    if (dragProjectId() === projectId) setDragProjectId(null);
  }

  function dropOnProject(projectId: string, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragProjectId(null);
    const files = droppedFiles(event);
    if (files.length) props.onImportFilesToProject(projectId, files);
  }

  createEffect(() => {
    const valid = new Set(mediaList().map((media) => media.assetId));
    const next = new Set(Array.from(selectedMediaIds()).filter((assetId) => valid.has(assetId)));
    if (next.size !== selectedMediaIds().size) setSelectedMediaIds(next);
  });

  const projectCountLabel = (project: SavedProjectSummary) => {
    const count = project.assetCount ?? (project.fileName ? 1 : 0);
    return count > 0 ? `${count} file${count > 1 ? "s" : ""}` : "Nothing here yet";
  };

  const singleMediaActions = (media: MediaSummary) => ({
    virtualCopy: { action: () => void props.onCreateVirtualCopy(media.assetId) },
    renameVariant: {
      action: () => {
        const name = window.prompt("Variant name", media.variantName ?? media.fileName)?.trim();
        if (name) void props.onRenameMediaVariant(media.assetId, name);
      },
    },
    setPrimary: {
      disabled: () => !media.sourceId || media.isPrimary === true,
      action: () => void props.onSetPrimaryMediaVariant(media.assetId),
    },
    beforeAfter: {
      disabled: () => !props.canRenderMedia(),
      action: () => void props.onCompareBeforeAfter(media.assetId),
    },
    copy: { action: () => props.onCopyMediaEdits(media.assetId, allMediaEditModules()) },
    paste: {
      disabled: () => !props.hasEditClipboard,
      action: () => props.onPasteMediaEdits(media.assetId),
    },
    applyToProject: {
      action: () => props.onApplyMediaEditsToProject(media.assetId, allMediaEditModules()),
    },
    flatten: {
      disabled: () => !props.canRenderMedia() || props.isFlatteningMedia(media.assetId),
      render: () => (props.isFlatteningMedia(media.assetId) ? "Flattening..." : undefined),
      action: () => props.onFlattenMedia(media.assetId),
    },
    useAsMatchRef: {
      disabled: () => !props.canRenderMedia(),
      action: () => props.onUseMediaAsMatchReference(media.assetId),
    },
    metadata: {
      action: () => openMetadataView(media),
    },
    reset: { action: () => props.onResetMediaEdits(media.assetId) },
    delete: { action: () => { void props.onDeleteMedia([media.assetId]); } },
  });
  const multiMediaActions = () => ({
    batchEdit: {
      action: () => setBatchDialog({ ids: Array.from(selectedMediaIds()) }),
    },
    undoBatch: {
      disabled: () => !props.canUndoBatchEdit,
      action: () => void props.onUndoBatchEdit(),
    },
    compare: {
      disabled: () => selectedMediaIds().size !== 2,
      action: () => {
        const ids = Array.from(selectedMediaIds());
        if (ids.length === 2) setCompareDialog({ ids: [ids[0], ids[1]] });
      },
    },
    paste: {
      disabled: () => !props.hasEditClipboard,
      action: () => props.onPasteMediaEditsToSelected(Array.from(selectedMediaIds())),
    },
    grid: {
      disabled: () => !props.canRenderMedia(),
      action: () => setGridDialog({ ids: Array.from(selectedMediaIds()) }),
    },
    reset: { action: () => props.onResetSelectedMediaEdits(Array.from(selectedMediaIds())) },
    delete: { action: () => { void props.onDeleteMedia(Array.from(selectedMediaIds())); } },
  });

  return (
    <div class="editor-project-window">
      <Show
        when={view() === "project"}
        fallback={
          <div class="editor-project-gallery">
            <header class="editor-project-header">
              <Show when={loading()}>
                <span class="editor-status">Loading...</span>
              </Show>
              <button
                class="editor-btn editor-btn--small editor-project-header-action"
                type="button"
                aria-expanded={newProjectOpen()}
                onClick={() => setNewProjectOpen((isOpen) => !isOpen)}
              >
                {newProjectOpen() ? "Cancel" : "New Project"}
              </button>
            </header>

            <Show when={newProjectOpen()}>
              <div class="editor-project-create">
                <input
                  class="editor-input"
                  value={newProjectName()}
                  placeholder="E.g. Frames from New York"
                  aria-label="Project name"
                  spellcheck={false}
                  onInput={(event) => setNewProjectName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createProject();
                    if (event.key === "Escape") setNewProjectOpen(false);
                  }}
                />
                <button
                  class="editor-btn editor-btn--primary"
                  type="button"
                  disabled={!newProjectName().trim()}
                  onClick={() => void createProject()}
                >
                  Create Project
                </button>
              </div>
            </Show>

            <div class="editor-project-list">
              <Show
                when={projects().length > 0}
                fallback={<p class="editor-empty">No saved projects yet.</p>}
              >
                <For each={projects()}>
                  {(project) => (
                    <article
                      project-dropzone={project.id}
                      data-project-id={project.id}
                      classList={{
                        "editor-project-item": true,
                        "is-active": project.id === props.currentProjectId,
                        dragover: dragProjectId() === project.id,
                      }}
                      tabIndex={0}
                      aria-current={project.id === props.currentProjectId ? "true" : undefined}
                      onDragEnter={(event) => dragProject(project.id, event)}
                      onDragOver={(event) => dragProject(project.id, event)}
                      onDragLeave={(event) => leaveProject(project.id, event)}
                      onDrop={(event) => dropOnProject(project.id, event)}
                      onClick={(event) => {
                        if (event.button === 0) void open(project.id);
                      }}
                      onContextMenu={(event) => contextProject(project, event)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void open(project.id);
                        }
                      }}
                    >
                      <ProjectThumb
                        blob={project.thumbnail}
                        onVisible={() => void hydrateProject(project.id)}
                      />
                      <div class="editor-list-text">
                        <Show
                          when={editingProjectId() === project.id}
                          fallback={
                            <strong
                              class="project-name"
                              onDblClick={(event) => {
                                event.stopPropagation();
                                startRename(project.id, project.name);
                              }}
                            >
                              {project.name}
                            </strong>
                          }
                        >
                          <input
                            class="editor-inline-input editor-project-rename-input"
                            value={editingName()}
                            aria-label={`Rename ${project.name}`}
                            autocomplete="off"
                            autofocus
                            ref={selectRenameInput}
                            spellcheck={false}
                            onClick={(event) => event.stopPropagation()}
                            onInput={(event) => setEditingName(event.currentTarget.value)}
                            onBlur={() => void commitRename()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void commitRename();
                              }
                              if (event.key === "Escape" || event.key === "Tab") {
                                cancelRename(event);
                              }
                            }}
                          />
                        </Show>
                        <span>{projectCountLabel(project)}</span>
                      </div>
                    </article>
                  )}
                </For>
              </Show>
            </div>
          </div>
        }
      >
        <div
          class="editor-project-single"
          project-dropzone={props.currentProjectId ?? ""}
          classList={{
            dragover: !!props.currentProjectId && dragProjectId() === props.currentProjectId,
          }}
          onDragEnter={(event) =>
            props.currentProjectId && dragProject(props.currentProjectId, event)
          }
          onDragOver={(event) =>
            props.currentProjectId && dragProject(props.currentProjectId, event)
          }
          onDragLeave={(event) =>
            props.currentProjectId && leaveProject(props.currentProjectId, event)
          }
          onDrop={(event) => props.currentProjectId && dropOnProject(props.currentProjectId, event)}
        >
          <header class="editor-project-header">
            <button class="editor-project-back" type="button" onClick={() => setView("gallery")}>
              <img src="/assets/icons/chevron_back_icon.svg" alt="" />
              <span>Projects</span>
            </button>
            <Show
              when={props.currentProjectId && editingProjectId() === props.currentProjectId}
              fallback={
                <button
                  class="editor-project-name"
                  type="button"
                  data-project-id={props.currentProjectId ?? undefined}
                  onDblClick={() =>
                    props.currentProjectId && startRename(props.currentProjectId, props.projectName)
                  }
                  onContextMenu={(event) =>
                    props.currentProjectId &&
                    contextProject(
                      projects().find((project) => project.id === props.currentProjectId) ?? {
                        id: props.currentProjectId,
                        name: props.projectName,
                      },
                      event,
                    )
                  }
                >
                  {props.projectName}
                </button>
              }
            >
              <input
                class="editor-inline-input editor-inline-input--title editor-project-rename-input editor-project-rename-input--title"
                value={editingName()}
                aria-label="Rename project"
                autocomplete="off"
                autofocus
                ref={selectRenameInput}
                spellcheck={false}
                onInput={(event) => setEditingName(event.currentTarget.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitRename();
                  }
                  if (event.key === "Escape" || event.key === "Tab") cancelRename(event);
                }}
              />
            </Show>
            <button
              class="editor-btn editor-btn--small editor-btn--secondary"
              type="button"
              onClick={() => props.onImportFiles()}
            >
              Import File(s)
            </button>
          </header>

          <Show
            when={mediaList().length > 0}
            fallback={
              <button class="editor-empty-project" type="button" onClick={() => props.onImportFiles()}>
                <img src="/assets/icons/empty_project_icon.svg" alt="" />
                <span>Empty Project</span>
                <small>
                  Import some files to start editing.
                  <br />
                  Your files remain privately on your device and are never uploaded to a server.
                </small>
                <strong>Import File(s)</strong>
              </button>
            }
          >
            <div class="editor-project-media" tabIndex={0} onKeyDown={selectAllMedia}>
              <For each={mediaList()}>
                {(media, index) => (
                  <button
                    data-media-item={media.assetId}
                    classList={{
                      "editor-media-item": true,
                      active: media.assetId === activeId(),
                      selected: selectedSet().has(media.assetId),
                    }}
                    type="button"
                    title={media.fileName}
                    onClick={(event) => selectMedia(media, index(), event)}
                    onContextMenu={(event) => contextMedia(media, index(), event)}
                  >
                    <ProjectThumb
                      blob={media.thumbnail}
                      loadThumbnail={() => props.hydrateMediaThumbnail(media.assetId)}
                    />
                    <Show when={media.variantKind === "virtual-copy"}>
                      <span class="editor-media-item__copy-badge">Copy</span>
                    </Show>
                    <Show when={media.isPrimary && media.sourceId}>
                      <span class="editor-media-item__primary-badge">Primary</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>

          {/* <Show when={props.isDirty && props.image}>
            <div class="editor-project-foot">
              <span class="editor-status editor-status--warn">Saving changes...</span>
            </div>
          </Show> */}
        </div>
      </Show>
      <Show when={metadataView()}>
        {(view) => <MediaMetadataPopup view={view()} onClose={closeMetadataView} />}
      </Show>
      <Show when={batchDialog()}>
        {(dialog) => (
          <BatchEditDialog
            ids={dialog().ids}
            media={mediaList().filter((item) => dialog().ids.includes(item.assetId))}
            onCancel={() => setBatchDialog(null)}
            onApply={(primaryAssetId, modules, signal) =>
              props
                .onBatchEdit(primaryAssetId, dialog().ids, modules, signal)
                .then(() => {
                  setBatchDialog(null);
                })
            }
          />
        )}
      </Show>
      <Show when={compareDialog()}>
        {(dialog) => (
          <MediaCompareDialog
            ids={dialog().ids}
            names={dialog().ids.map((id) => mediaList().find((media) => media.assetId === id)?.fileName ?? id) as [string, string]}
            renderPreview={props.onRenderMediaPreview}
            onClose={() => setCompareDialog(null)}
          />
        )}
      </Show>
      <Show when={gridDialog()}>
        {(dialog) => (
          <MediaGridDialog
            count={dialog().ids.length}
            onCancel={() => setGridDialog(null)}
            onConfirm={(options) => {
              props.onGenerateMediaGrid(dialog().ids, options);
              setGridDialog(null);
            }}
          />
        )}
      </Show>
      <Show when={menu()}>
        {(state) => <ContextMenu state={state()} onClose={() => setMenu(null)} />}
      </Show>
      <Show when={deleteCandidate()}>
        {(project) => (
          <ProjectDeleteConfirmation
            project={project()}
            busy={deletingProject()}
            onCancel={() => setDeleteCandidate(null)}
            onConfirm={() => void remove(project())}
          />
        )}
      </Show>
      <Show when={mediaDeleteCandidate()}>
        {(candidate) => (
          <MediaDeleteConfirmation
            candidate={candidate()}
            busy={deletingMedia()}
            onCancel={() => setMediaDeleteCandidate(null)}
            onConfirm={() => void confirmMediaDelete()}
          />
        )}
      </Show>
    </div>
  );
}

function ProjectDeleteConfirmation(props: {
  project: Pick<SavedProjectSummary, "id" | "name">;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  let cancelButton!: HTMLButtonElement;

  onMount(() => cancelButton.focus());
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || props.busy) return;
      event.preventDefault();
      props.onCancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  return (
    <div
      class="editor-project-delete-backdrop"
      onPointerDown={() => !props.busy && props.onCancel()}
    >
      <section
        class="editor-project-delete-confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="project-delete-title"
        aria-describedby="project-delete-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div class="editor-delete-confirmation__heading" id="project-delete-title">
          <HeroIcon name="exclamation-triangle" />
          <span>
            <strong>Delete</strong> {props.project.name}?
          </span>
        </div>
        <p id="project-delete-description">
          This project and all its imported files and edits will be deleted. This action cannot be
          undone.
        </p>
        <footer>
          <button
            ref={(element) => (cancelButton = element)}
            class="editor-btn editor-btn--secondary"
            type="button"
            disabled={props.busy}
            onClick={() => props.onCancel()}
          >
            Cancel
          </button>
          <button
            class="editor-btn editor-btn--danger"
            type="button"
            disabled={props.busy}
            onClick={() => props.onConfirm()}
          >
            <HeroIcon name="trash" />
            {props.busy ? "Deleting..." : "Delete Project"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MediaDeleteConfirmation(props: {
  candidate: { ids: string[]; names: string[] };
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  let cancelButton!: HTMLButtonElement;
  const count = () => props.candidate.ids.length;
  const title = () =>
    count() === 1 ? `Delete ${props.candidate.names[0]}?` : `Delete ${count()} files?`;

  onMount(() => cancelButton.focus());
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || props.busy) return;
      event.preventDefault();
      props.onCancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  return (
    <div
      class="editor-project-delete-backdrop"
      onPointerDown={() => !props.busy && props.onCancel()}
    >
      <section
        class="editor-project-delete-confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="media-delete-title"
        aria-describedby="media-delete-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div class="editor-delete-confirmation__heading" id="media-delete-title">
          <HeroIcon name="exclamation-triangle" />
          <strong>{title()}</strong>
        </div>
        <p id="media-delete-description">
          {count() === 1
            ? "This file, its imported source, and all edits"
            : "These files, their imported sources, and all edits"} will be permanently deleted.
          This action cannot be undone.
        </p>
        <footer>
          <button
            ref={(element) => (cancelButton = element)}
            class="editor-btn editor-btn--secondary"
            type="button"
            disabled={props.busy}
            onClick={() => props.onCancel()}
          >
            Cancel
          </button>
          <button
            class="editor-btn editor-btn--danger"
            type="button"
            disabled={props.busy}
            onClick={() => props.onConfirm()}
          >
            <HeroIcon name="trash" />
            {props.busy ? "Deleting..." : count() === 1 ? "Delete File" : `Delete ${count()} Files`}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Heroicons v2, 24px outline set (MIT). Labels remain visible for accessibility. */
function HeroIcon(props: { name: "trash" | "x-mark" | "exclamation-triangle" }) {
  return (
    <svg
      class="editor-hero-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <Switch>
        <Match when={props.name === "trash"}>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165-1.068 13.882a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
          />
        </Match>
        <Match when={props.name === "x-mark"}>
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </Match>
        <Match when={props.name === "exclamation-triangle"}>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.052 3.374c.866-1.5 3.032-1.5 3.898 0l7.353 12.752ZM12 16.5h.008v.008H12V16.5Z"
          />
        </Match>
      </Switch>
    </svg>
  );
}

function singleMediaMenuHtml(fileName: string): string {
  return [
    `<context-title>${escapeHtml(fileName)}</context-title>`,
    `<context-item data-action="virtualCopy">Create Virtual Copy</context-item>`,
    `<context-item data-action="renameVariant">Rename Variant</context-item>`,
    `<context-item data-action="setPrimary">Set as Primary</context-item>`,
    `<context-item data-action="beforeAfter">Before / After Split</context-item>`,
    `<context-separator></context-separator>`,
    `<context-item data-action="copy">Copy Edits</context-item>`,
    `<context-item data-action="paste">Paste Edits</context-item>`,
    `<context-item data-action="applyToProject">Apply Edits to Project</context-item>`,
    `<context-separator></context-separator>`,
    `<context-item data-action="flatten">Flatten Image</context-item>`,
    `<context-item data-action="useAsMatchRef">Use as Match Reference</context-item>`,
    `<context-item data-action="metadata">View Metadata</context-item>`,
    `<context-separator></context-separator>`,
    `<context-item data-action="reset">Reset Edits</context-item>`,
    `<context-item data-action="delete" class="text-red">Delete File</context-item>`,
  ].join("");
}

function multiMediaMenuHtml(count: number): string {
  return [
    `<context-title>${count} Files Selected</context-title>`,
    `<context-item data-action="batchEdit">Batch Edit Selected</context-item>`,
    `<context-item data-action="undoBatch">Undo Last Batch Edit</context-item>`,
    `<context-item data-action="compare">Compare Two Images</context-item>`,
    `<context-separator></context-separator>`,
    `<context-item data-action="paste">Paste Edits to Selected</context-item>`,
    `<context-item data-action="grid">Generate Grid</context-item>`,
    `<context-separator></context-separator>`,
    `<context-item data-action="reset">Reset Selected</context-item>`,
    `<context-item data-action="delete" class="text-red">Delete Selected</context-item>`,
  ].join("");
}

function allMediaEditModules(): MediaEditModuleKey[] {
  return MEDIA_EDIT_MODULES.map((module) => module.key);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function MediaMetadataPopup(props: { view: MediaMetadataView; onClose(): void }) {
  let rootRef!: HTMLDivElement;

  onMount(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.contains(target)) return;
      props.onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    queueMicrotask(() => rootRef?.focus({ preventScroll: true }));

    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (rootRef?.contains(document.activeElement) && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    });
  });

  return (
    <div
      ref={(el) => (rootRef = el)}
      class="editor-metadata-viewer"
      role="dialog"
      aria-modal="false"
      aria-label="Media metadata"
      tabIndex={-1}
    >
      <header class="editor-metadata-viewer__header">
        <strong title={props.view.title}>{props.view.title}</strong>
        <button
          class="editor-btn editor-btn--small"
          type="button"
          data-action="close"
          onClick={() => props.onClose()}
        >
          Done
        </button>
      </header>
      <ProjectThumb blob={props.view.thumbnail} />
      <Show
        when={props.view.entries.length > 0}
        fallback={<p class="editor-metadata-viewer__empty">No metadata available</p>}
      >
        <div class="editor-metadata-viewer__list">
          <For each={props.view.entries}>
            {(entry) => (
              <div class="editor-metadata-viewer__row">
                <span>{entry.key}:</span>
                <p>{entry.description}</p>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function BatchEditDialog(props: {
  ids: string[];
  media: MediaSummary[];
  onCancel(): void;
  onApply(
    primaryAssetId: string,
    modules: MediaEditModuleKey[],
    signal: AbortSignal,
  ): Promise<void>;
}) {
  const [primary, setPrimary] = createSignal(untrack(() => props.ids[0] ?? ""));
  const [selected, setSelected] = createSignal(
    new Set(MEDIA_EDIT_MODULES.filter((module) => module.selected).map((module) => module.key)),
  );
  const [applying, setApplying] = createSignal(false);
  const [error, setError] = createSignal("");
  let controller: AbortController | undefined;

  function toggle(key: MediaEditModuleKey) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function apply() {
    if (!primary() || !selected().size || applying()) return;
    controller = new AbortController();
    setApplying(true);
    setError("");
    try {
      await props.onApply(primary(), Array.from(selected()), controller.signal);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Batch edit failed");
    } finally {
      setApplying(false);
      controller = undefined;
    }
  }

  return (
    <div class="editor-confirm-backdrop" role="presentation">
      <section class="editor-edit-picker" role="dialog" aria-modal="true" aria-label="Batch edit">
        <header>
          <strong>Batch Edit</strong>
          <small>{props.ids.length} selected variants</small>
        </header>
        <label class="editor-field">
          <span>Primary image</span>
          <select value={primary()} onChange={(event) => setPrimary(event.currentTarget.value)}>
            <For each={props.media}>
              {(media) => <option value={media.assetId}>{media.variantName ?? media.fileName}</option>}
            </For>
          </select>
        </label>
        <div class="editor-edit-picker__list">
          <For each={MEDIA_EDIT_MODULES}>
            {(module) => (
              <label>
                <input
                  type="checkbox"
                  checked={selected().has(module.key)}
                  onChange={() => toggle(module.key)}
                />
                <span>{module.label}</span>
              </label>
            )}
          </For>
        </div>
        <div class="batch-edit-targets" aria-label="Batch targets">
          <For each={props.media}>
            {(media) => (
              <span classList={{ "batch-edit-target--primary": media.assetId === primary() }}>
                <ProjectThumb blob={media.thumbnail} loadThumbnail={() => Promise.resolve(media.thumbnail)} />
                <small>{media.variantName ?? media.fileName}</small>
              </span>
            )}
          </For>
        </div>
        <Show when={error()}><p class="editor-error">{error()}</p></Show>
        <footer>
          <button
            type="button"
            class="editor-btn editor-btn--secondary"
            onClick={() => {
              if (applying()) controller?.abort();
              else props.onCancel();
            }}
          >
            {applying() ? "Cancel operation" : "Cancel"}
          </button>
          <button
            type="button"
            class="editor-btn"
            disabled={applying() || !selected().size}
            onClick={() => void apply()}
          >
            {applying() ? "Applying…" : "Apply transaction"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MediaCompareDialog(props: {
  ids: [string, string];
  names: [string, string];
  renderPreview(assetId: string): Promise<Blob>;
  onClose(): void;
}) {
  const [order, setOrder] = createSignal<[0 | 1, 0 | 1]>([0, 1]);
  const [urls, setUrls] = createSignal<[string, string] | null>(null);
  const [error, setError] = createSignal("");
  const [linked, setLinked] = createSignal(true);
  const [naturalSizes, setNaturalSizes] = createSignal([
    { width: 0, height: 0 },
    { width: 0, height: 0 },
  ]);
  const paneElements: Array<HTMLElement | undefined> = [];
  const [transforms, setTransforms] = createSignal([
    { zoom: 1, x: 0, y: 0 },
    { zoom: 1, x: 0, y: 0 },
  ]);
  let requestId = 0;

  onMount(() => {
    const id = ++requestId;
    void (async () => {
      const left = await props.renderPreview(props.ids[0]);
      const right = await props.renderPreview(props.ids[1]);
      return [left, right] as const;
    })()
      .then(([left, right]) => {
        if (id !== requestId) return;
        setUrls([URL.createObjectURL(left), URL.createObjectURL(right)]);
      })
      .catch((reason) => {
        if (id === requestId) setError(reason instanceof Error ? reason.message : "Compare failed");
      });
  });

  onCleanup(() => {
    requestId += 1;
    for (const url of urls() ?? []) URL.revokeObjectURL(url);
  });

  function updateTransform(index: number, next: { zoom: number; x: number; y: number }) {
    setTransforms((current) => {
      const value = current.map((transform) => ({ ...transform }));
      value[index] = next;
      if (linked()) value[index === 0 ? 1 : 0] = { ...next };
      return value;
    });
  }

  function wheel(index: number, event: WheelEvent) {
    event.preventDefault();
    const current = transforms()[index];
    const zoom = Math.max(1, Math.min(8, current.zoom * Math.exp(-event.deltaY * 0.0015)));
    updateTransform(index, { ...current, zoom });
  }

  function pan(index: number, event: PointerEvent) {
    if (event.button !== 0 || transforms()[index].zoom <= 1) return;
    const start = transforms()[index];
    const pointerX = event.clientX;
    const pointerY = event.clientY;
    const move = (nextEvent: PointerEvent) => {
      updateTransform(index, {
        zoom: start.zoom,
        x: start.x + nextEvent.clientX - pointerX,
        y: start.y + nextEvent.clientY - pointerY,
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function reset(zoom = 1) {
    setTransforms([
      { zoom, x: 0, y: 0 },
      { zoom, x: 0, y: 0 },
    ]);
  }

  function inspectAtOneToOne() {
    const currentOrder = order();
    const sizes = naturalSizes();
    setTransforms([0, 1].map((paneIndex) => {
      const pane = paneElements[paneIndex];
      const size = sizes[currentOrder[paneIndex]];
      if (!pane || !size.width || !size.height) return { zoom: 1, x: 0, y: 0 };
      const rect = pane.getBoundingClientRect();
      const fitWidth = Math.min(rect.width, rect.height * (size.width / size.height));
      return { zoom: Math.max(1, size.width / Math.max(1, fitWidth)), x: 0, y: 0 };
    }));
  }

  return (
    <div class="media-compare" role="dialog" aria-modal="true" aria-label="Compare images">
      <header class="media-compare__toolbar">
        <strong>Compare</strong>
        <button type="button" onClick={() => reset(1)}>Fit</button>
        <button type="button" onClick={inspectAtOneToOne}>100%</button>
        <button type="button" onClick={() => setLinked((value) => !value)}>
          {linked() ? "Linked" : "Unlinked"}
        </button>
        <button type="button" onClick={() => setOrder(([left, right]) => [right, left])}>Swap</button>
        <button type="button" onClick={() => props.onClose()}>Close</button>
      </header>
      <Show when={!error()} fallback={<p class="media-compare__status">{error()}</p>}>
        <Show when={urls()} fallback={<p class="media-compare__status">Rendering both variants…</p>}>
          {(loaded) => (
            <div class="media-compare__panes">
              <For each={order()}>
                {(sourceIndex, paneIndex) => {
                  const transform = () => transforms()[paneIndex()];
                  return (
                    <section
                      ref={(element) => { paneElements[paneIndex()] = element; }}
                      class="media-compare__pane"
                      onWheel={(event) => wheel(paneIndex(), event)}
                      onPointerDown={(event) => pan(paneIndex(), event)}
                    >
                      <img
                        src={loaded()[sourceIndex]}
                        alt={props.names[sourceIndex]}
                        draggable={false}
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          setNaturalSizes((current) => {
                            const next = current.map((size) => ({ ...size }));
                            next[sourceIndex] = {
                              width: image.naturalWidth,
                              height: image.naturalHeight,
                            };
                            return next;
                          });
                        }}
                        style={{
                          transform: `translate(${transform().x}px, ${transform().y}px) scale(${transform().zoom})`,
                        }}
                      />
                      <span>{props.names[sourceIndex]}</span>
                    </section>
                  );
                }}
              </For>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

function MediaGridDialog(props: {
  count: number;
  onCancel(): void;
  onConfirm(options: MediaGridOptions): void;
}) {
  const [mode, setMode] = createSignal<MediaGridOptions["mode"]>("edited");
  const [layout, setLayout] = createSignal<MediaGridOptions["layout"]>("contain");
  const [backgroundColor, setBackgroundColor] = createSignal("#111111");
  const confirm = () =>
    props.onConfirm({
      mode: mode(),
      layout: layout(),
      backgroundColor: backgroundColor(),
    });

  return (
    <div class="editor-edit-picker" role="dialog" aria-modal="true" aria-label="Generate grid">
      <header class="editor-edit-picker__header">
        <strong>Generate Grid</strong>
        <button class="editor-btn editor-btn--small" type="button" onClick={() => props.onCancel()}>
          Cancel
        </button>
      </header>
      <p class="editor-edit-picker__copy">{props.count} selected images</p>
      <section class="editor-edit-picker__list" aria-label="Grid options">
        <label class="editor-edit-picker__item">
          <span>Mode</span>
          <select
            value={mode()}
            onChange={(event) => setMode(event.currentTarget.value as MediaGridOptions["mode"])}
          >
            <option value="raw">Raw images</option>
            <option value="edited">Edited images</option>
          </select>
        </label>
        <label class="editor-edit-picker__item">
          <span>Layout</span>
          <select
            value={layout()}
            onChange={(event) =>
              setLayout(event.currentTarget.value as MediaGridOptions["layout"])
            }
          >
            <option value="cover">Fill Blank Space</option>
            <option value="contain">Keep Aspect Ratio</option>
          </select>
        </label>
        <label class="editor-edit-picker__item">
          <span>Background</span>
          <input
            type="color"
            value={backgroundColor()}
            disabled={layout() !== "contain"}
            onInput={(event) => setBackgroundColor(event.currentTarget.value)}
          />
        </label>
      </section>
      <footer class="editor-edit-picker__actions">
        <button class="editor-btn editor-btn--small" type="button" onClick={() => props.onCancel()}>
          Cancel
        </button>
        <button
          class="editor-btn editor-btn--small editor-btn--primary"
          type="button"
          onClick={confirm}
        >
          Generate
        </button>
      </footer>
    </div>
  );
}

/** Project/media thumbnail. Lazily creates an object URL while visible and revokes
 * it on scroll-out / cleanup so hidden rows do not retain image memory. */
function ProjectThumb(props: {
  blob?: Blob;
  loadThumbnail?: () => Promise<Blob | undefined>;
  onVisible?: () => void;
}) {
  let ref: HTMLDivElement | undefined;
  const [url, setUrl] = createSignal<string | null>(null);
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    if (!ref || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const root = ref.closest(".editor-project-list, .editor-project-media");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { root, rootMargin: "120px" },
    );
    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    if (!visible()) {
      setUrl(null);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    const fallbackBlob = props.blob?.size ? props.blob : undefined;
    props.onVisible?.();

    const applyBlob = (b?: Blob) => {
      if (disposed || !b || !b.size) return;
      objectUrl = URL.createObjectURL(b);
      perf.recordThumbnailObjectUrlCreated();
      setUrl(objectUrl);
    };

    if (fallbackBlob) {
      applyBlob(fallbackBlob);
    } else if (props.loadThumbnail) {
      void props.loadThumbnail().then(applyBlob);
    }

    onCleanup(() => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        perf.recordThumbnailObjectUrlRevoked();
      }
      setUrl(null);
    });
  });
  return (
    <div ref={ref} class="editor-list-thumb" aria-hidden="true">
      <Show when={url()}>{(u) => <img src={u()} alt="" />}</Show>
    </div>
  );
}

function PresetLibraryOverlay(props: {
  previewEditPatch(patch: Partial<EditState>, reason?: string): void;
  clearPreviewPatch(reason?: string): void;
}) {
  const [liveStrength, setLiveStrength] = createSignal<number | null>(null);
  const strength = () => liveStrength() ?? editState.preset.strength;

  function previewStrength(value: number) {
    setLiveStrength(value);
    props.previewEditPatch(
      { preset: { ...editState.preset, strength: value } },
      "preset-strength-preview",
    );
  }

  function commitStrength(value: number) {
    setEditState("preset", "strength", value);
    setLiveStrength(null);
    queueMicrotask(() => untrack(() => props.clearPreviewPatch("preset-strength-commit")));
  }

  const selectedId = () => editState.preset.selectedPresetId;

  function applyPreset(id: string) {
    setEditState("preset", "enabled", true);
    setEditState("preset", "bypass", false);
    setEditState("preset", "selectedPresetId", id);
  }

  return (
    <div class="editor-stack">
      <div class="editor-actions">
        <button
          classList={{ "editor-btn": true, "is-active": editState.preset.preserveUserAdjustments }}
          type="button"
          onClick={() =>
            setEditState(
              "preset",
              "preserveUserAdjustments",
              !editState.preset.preserveUserAdjustments,
            )
          }
        >
          Preserve User Adjustments
        </button>
        <button
          classList={{ "editor-btn": true, "is-active": editState.preset.bypass }}
          type="button"
          onClick={() => setEditState("preset", "bypass", !editState.preset.bypass)}
        >
          Bypass
        </button>
        <button
          class="editor-btn editor-btn--danger"
          type="button"
          onClick={() => setEditState("preset", { ...DEFAULT_PRESET_STATE })}
        >
          Reset
        </button>
      </div>

      <label class="editor-range">
        <span>Strength</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={strength()}
          onInput={(event) => previewStrength(Number(event.currentTarget.value))}
          onChange={(event) => commitStrength(Number(event.currentTarget.value))}
        />
        <strong>{Math.round(strength() * 100)}%</strong>
      </label>

      <div class="editor-grid">
        <For each={allPresets()}>
          {(preset) => (
            <button
              classList={{
                "editor-preset-card": true,
                "is-active": selectedId() === preset.id,
              }}
              type="button"
              onClick={() => applyPreset(preset.id)}
            >
              <span>{preset.name}</span>
              <small>{preset.category ?? "Custom"}</small>
              <p>{preset.description ?? "Custom preset look."}</p>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

/**
 * Legacy `rolling-slider` (rotation-control): a horizontal ruler — static tick
 * lines plus a 3px indicator at the value position. Dragging is RELATIVE
 * (pressing never jumps the value); the full strip width spans 90° (-45..45).
 * Two quick taps without movement reset to 0°.
 */
function RotationSlider(props: {
  /** Degrees, -45..45. */
  value: number;
  disabled?: boolean;
  onInput(deg: number): void;
  onChange(deg: number): void;
  onDragChange(active: boolean): void;
  onReset(): void;
}) {
  let ref!: HTMLDivElement;
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const currentValue = () => liveValue() ?? props.value;
  const norm = () => (clampDeg(currentValue()) + 45) / 90;
  let lastTap = 0;

  function clampDeg(deg: number) {
    return Math.min(45, Math.max(-45, deg));
  }

  function onPointerDown(e: PointerEvent) {
    if (props.disabled) return;
    e.preventDefault();
    const width = ref.getBoundingClientRect().width || 1;
    const startX = e.clientX;
    const startNorm = norm();
    let moved = false;
    setLiveValue(props.value);
    props.onDragChange(true);
    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      const next = Math.max(0, Math.min(1, startNorm + (ev.clientX - startX) / width));
      if (ev.clientX !== startX) moved = true;
      const value = next * 90 - 45;
      setLiveValue(value);
      props.onInput(value);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!moved) {
        // Legacy double-tap (two stationary taps within 500ms) resets to 0°.
        const now = Date.now();
        if (now - lastTap < 500) {
          props.onReset();
          lastTap = 0;
        } else {
          lastTap = now;
        }
      } else {
        props.onChange(currentValue());
      }
      setLiveValue(null);
      props.onDragChange(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div
      ref={ref}
      class="editor-rolling-slider"
      classList={{ "is-disabled": !!props.disabled }}
      title="Drag to rotate"
      role="slider"
      aria-label="Rotation"
      aria-valuemin={-45}
      aria-valuemax={45}
      aria-valuenow={clampDeg(currentValue())}
      style={{ "--norm": `${norm()}` }}
      onPointerDown={onPointerDown}
    >
      <div class="editor-rolling-slider__lines" />
      <div class="editor-rolling-slider__indicator" />
    </div>
  );
}

function CropOverlayPanel(props: EditorOverlaysProps) {
  const t = () => editState.transform;
  const [liveStraighten, setLiveStraighten] = createSignal<number | null>(null);
  const straighten = () => liveStraighten() ?? t().straighten;
  const fmt = (value: number) => `${value.toFixed(2)}°`;

  function cropSourceDimensions() {
    const source = props.cropSourceData;
    const image = props.image;
    if (!source && !image) return null;
    return { width: source?.width ?? image!.width, height: source?.height ?? image!.height };
  }

  function cropBaseDimensions() {
    const source = cropSourceDimensions();
    return source
      ? legacyCropDisplayDimensions(source.width, source.height, t().orientation)
      : null;
  }

  function setAspectRatio(preset: AspectRatioPreset) {
    const base = cropBaseDimensions();
    if (!base) {
      setEditState("transform", "aspectRatio", preset);
      return;
    }
    setEditState("transform", applyAspectPresetToTransform(t(), preset, base.width, base.height));
  }

  let stageRef: HTMLDivElement | undefined;

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (props.isCropApplying) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void props.onApplyCropEdit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        props.onCancelCropEdit();
      } else if (event.key === "ArrowLeft" && props.canSelectPrevious) {
        event.preventDefault();
        props.onSelectPreviousCropImage();
      } else if (event.key === "ArrowRight" && props.canSelectNext) {
        event.preventDefault();
        props.onSelectNextCropImage();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  // Re-measure the dedicated crop stage on resize / toolbar wrapping.
  onMount(() => {
    const report = () => {
      if (!stageRef) return;
      const r = stageRef.getBoundingClientRect();
      props.onCropStageRectChange({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    report();
    const observer = new ResizeObserver(report);
    if (stageRef) observer.observe(stageRef);
    window.addEventListener("resize", report);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      props.onCropStageRectChange(null);
    });
  });

  function rotate(delta: -90 | 90) {
    const next = ((t().orientation + delta + 360) % 360) as 0 | 90 | 180 | 270;
    const transform = { ...t(), orientation: next };
    const source = cropSourceDimensions();
    const display = source ? legacyCropDisplayDimensions(source.width, source.height, next) : null;
    setEditState(
      "transform",
      display
        ? applyAspectPresetToTransform(
          transform,
          transform.aspectRatio,
          display.width,
          display.height,
        )
        : transform,
    );
  }

  function reset() {
    setEditState("transform", { ...DEFAULT_TRANSFORM_STATE, cropEnabled: true });
    props.onEnterCropEdit();
  }

  return (
    <section
      class="editor-transform-window"
      role="dialog"
      aria-modal="false"
      aria-label="Crop & Rotate"
    >
      <Show
        when={props.image}
        fallback={<p class="editor-empty">Load an image to crop and rotate.</p>}
      >
        <header class="editor-transform-window__header">
          <button
            class="editor-btn editor-btn--small editor-transform-window__cancel"
            type="button"
            disabled={props.isCropApplying}
            onClick={() => props.onCancelCropEdit()}
          >
            Cancel
          </button>
          <button
            class="editor-btn editor-btn--small"
            type="button"
            disabled={props.isCropApplying || isTransformDefaultForReset()}
            onClick={reset}
          >
            Reset
          </button>
          <button
            class="editor-transform-window__done"
            type="button"
            title="Done"
            disabled={props.isCropApplying}
            onClick={() => void props.onApplyCropEdit()}
          >
            <img src="/assets/icons/check_icon_inverted.svg" alt="Done" />
          </button>
        </header>

        <div class="editor-transform-window__select-bar" data-legacy-element="select-bar">
          <button
            class="editor-transform-window__icon-button"
            type="button"
            title="Select previous image in project"
            disabled={props.isCropApplying || !props.canSelectPrevious}
            onClick={() => props.onSelectPreviousCropImage()}
          >
            <img src="/assets/icons/chevron_back_icon.svg" alt="Previous" />
          </button>
          <span class="editor-transform-window__image-name" translate="no">
            {props.imageName || "......"}
          </span>
          <button
            class="editor-transform-window__icon-button editor-transform-window__icon-button--next"
            type="button"
            title="Select next image in project"
            disabled={props.isCropApplying || !props.canSelectNext}
            onClick={() => props.onSelectNextCropImage()}
          >
            <img src="/assets/icons/chevron_back_icon.svg" alt="Next" />
          </button>
        </div>

        <div ref={stageRef} class="editor-transform-window__stage" data-legacy-element="crop-stage">
          <CropTransformPreview
            sourceData={props.cropSourceData}
            guideMode={props.cropGuideMode}
            rotateActive={props.cropRotateActive}
            straighten={straighten()}
            disabled={props.isCropApplying}
            onFirstPaint={props.onCropPreviewPainted}
            onCropChange={(x, y, w, h) => {
              setEditState("transform", "cropX", x);
              setEditState("transform", "cropY", y);
              setEditState("transform", "cropWidth", w);
              setEditState("transform", "cropHeight", h);
            }}
          />
        </div>

        <div class="editor-transform-window__toolbar" data-legacy-element="tool-bar">
          <button
            classList={{ "editor-transform-window__icon-button": true, "is-active": t().flipX }}
            type="button"
            title="Flip Horizontally"
            disabled={props.isCropApplying}
            onClick={() => setEditState("transform", "flipX", !t().flipX)}
          >
            <img src="/assets/icons/flip_x_icon.svg" alt="Flip Horizontally" />
          </button>
          <button
            classList={{ "editor-transform-window__icon-button": true, "is-active": t().flipY }}
            type="button"
            title="Flip Vertically"
            disabled={props.isCropApplying}
            onClick={() => setEditState("transform", "flipY", !t().flipY)}
          >
            <img src="/assets/icons/flip_x_icon.svg" alt="Flip Vertically" style={{ rotate: "270deg" }} />
          </button>
          <button
            classList={{
              "editor-transform-window__icon-button": true,
              "is-active": t().orientation !== 0,
            }}
            type="button"
            title="Rotate 90° Counter Clockwise"
            disabled={props.isCropApplying}
            onClick={() => rotate(-90)}
          >
            <img src="/assets/icons/turn_left_icon.svg" alt="Rotate 90° Counter Clockwise" />
          </button>
          <select
            title="Select Crop Aspect Ratio"
            data-action="aspect-ratios"
            class="editor-transform-window__select"
            disabled={props.isCropApplying}
            value={t().aspectRatio}
            onChange={(event) => setAspectRatio(event.currentTarget.value as AspectRatioPreset)}
          >
            <CropAspectOptions />
          </select>
          <select
            title="Select Crop Overlay"
            data-action="crop-overlay"
            class="editor-transform-window__select"
            disabled={props.isCropApplying}
            value={props.cropGuideMode}
            onInput={(event) =>
              props.onCropGuideModeChange(event.currentTarget.value as CropGuideMode)
            }
          >
            <CropGuideOptions />
          </select>
        </div>

        <div class="editor-transform-window__rotation" data-legacy-element="rotation-control">
          <label classList={{ "is-edited": straighten() !== 0 }}>{fmt(straighten())}</label>
          <RotationSlider
            value={straighten()}
            disabled={props.isCropApplying}
            onInput={(deg) => {
              setLiveStraighten(deg);
              props.previewEditPatch(
                { transform: { ...editState.transform, straighten: deg } },
                "crop-straighten-preview",
              );
            }}
            onChange={(deg) => {
              setEditState("transform", "straighten", deg);
              setLiveStraighten(null);
              queueMicrotask(() => untrack(() => props.clearPreviewPatch("crop-straighten-commit")));
            }}
            onDragChange={props.onCropRotateDragChange}
            onReset={() => {
              setEditState("transform", "straighten", 0);
              setLiveStraighten(null);
              props.clearPreviewPatch("crop-straighten-reset");
            }}
          />
        </div>
        <Show when={props.isCropApplying}>
          <div class="editor-transform-window__busy">
            <div class="spinner" />
            <span>{props.cropBusyLabel}</span>
          </div>
        </Show>
      </Show>
    </section>
  );
}


const BORDER_RATIO_CHIPS: Array<{ value: PresentationBorderAspectRatio; label: string }> = [
  { value: "original", label: "Original" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "2.39:1", label: "2.39" },
];

type BorderEditorTab = "frame" | "ratio" | "corners" | "depth";

const BORDER_EDITOR_TABS: Array<{ id: BorderEditorTab; label: string }> = [
  { id: "frame", label: "Frame" },
  { id: "ratio", label: "Ratio" },
  { id: "corners", label: "Corners" },
  { id: "depth", label: "Depth" },
];

const FRAME_IMAGE_SELECT_VALUE = "__frame-image__";

const pct1 = (value: number) => `${Math.round(value * 1000) / 10}%`;

/**
 * Builds a small representative color palette from the RGBA source pixels of the
 * image currently being edited. Pixels are subsampled and bucketed into a coarse
 * 4-bit-per-channel grid; the most frequent buckets are averaged and returned as
 * hex strings, ordered by perceptual luminance so the swatches read as a ramp.
 */
function extractImagePalette(source: CropSourceData | undefined, count = 8): string[] {
  if (!source) return [];
  const pixels = new Uint8ClampedArray(source.buffer);
  const total = Math.floor(pixels.length / 4);
  if (total <= 0) return [];
  const step = Math.max(1, Math.floor(total / 5000));
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (pixels[o + 3] < 24) continue;
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(key);
    if (entry) {
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number])
    .sort((a, b) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]))
    .map((rgb) => rgbToHex(rgb));
}

function tracePresentationRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function resolveCanvasCoverRect(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(frameW / Math.max(1, srcW), frameH / Math.max(1, srcH));
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (frameW - width) / 2, y: (frameH - height) / 2, width, height };
}

function drawBorderInnerShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strength: number,
  shortEdge: number,
): void {
  if (strength <= 0) return;
  const edge = Math.max(1, Math.min(shortEdge * (0.012 + strength * 0.045), width * 0.5, height * 0.5));
  const opacity = 0.12 + strength * 0.3;

  ctx.save();
  tracePresentationRoundedRect(ctx, x, y, width, height, radius);
  ctx.clip();

  const top = ctx.createLinearGradient(0, y, 0, y + edge);
  top.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
  top.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(x, y, width, edge);

  const bottom = ctx.createLinearGradient(0, y + height, 0, y + height - edge);
  bottom.addColorStop(0, `rgba(0, 0, 0, ${opacity * 0.82})`);
  bottom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y + height - edge, width, edge);

  const left = ctx.createLinearGradient(x, 0, x + edge, 0);
  left.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
  left.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = left;
  ctx.fillRect(x, y, edge, height);

  const right = ctx.createLinearGradient(x + width, 0, x + width - edge, 0);
  right.addColorStop(0, `rgba(0, 0, 0, ${opacity * 0.82})`);
  right.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = right;
  ctx.fillRect(x + width - edge, y, edge, height);

  ctx.restore();
}

function drawBorderLayoutThumbnail(
  ctx: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  border: PresentationBorderSettings,
  frameImage?: HTMLImageElement | null,
): void {
  const geometry = resolveBorderGeometry(sourceWidth, sourceHeight, border);
  const [r, g, b] = border.color;
  const borderAlpha = border.backgroundMode === "solid" ? border.opacity : 1;
  const shortEdge = Math.min(geometry.frameWidth, geometry.frameHeight);
  const frameRadiusPx = Math.max(0, border.frameRadius || 0) * shortEdge;
  const imageRadiusPx = Math.max(0, border.imageRadius || 0) * shortEdge;
  const imageShadow = Math.max(0, Math.min(1, border.imageShadow || 0));
  const imageInnerShadow = Math.max(0, Math.min(1, border.imageInnerShadow || 0));

  ctx.save();
  if (frameRadiusPx > 0) {
    tracePresentationRoundedRect(ctx, 0, 0, geometry.frameWidth, geometry.frameHeight, frameRadiusPx);
    ctx.clip();
  }
  if (border.backgroundMode === "image" && frameImage) {
    const rect = resolveCanvasCoverRect(
      frameImage.naturalWidth || frameImage.width,
      frameImage.naturalHeight || frameImage.height,
      geometry.frameWidth,
      geometry.frameHeight,
    );
    ctx.drawImage(frameImage, rect.x, rect.y, rect.width, rect.height);
    if (border.opacity > 0) {
      ctx.save();
      ctx.globalAlpha = border.opacity;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, geometry.frameWidth, geometry.frameHeight);
      ctx.restore();
    }
  } else {
    ctx.fillStyle =
      border.backgroundMode === "blur"
        ? `rgba(${r}, ${g}, ${b}, ${Math.max(0.18, border.opacity)})`
        : `rgba(${r}, ${g}, ${b}, ${borderAlpha})`;
    ctx.fillRect(0, 0, geometry.frameWidth, geometry.frameHeight);
  }

  if (border.backgroundMode === "blur") {
    const stripe = Math.max(18, Math.min(80, border.blurAmount * 1.35));
    const blurGradient = ctx.createLinearGradient(0, 0, geometry.frameWidth, geometry.frameHeight);
    blurGradient.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    blurGradient.addColorStop(0.45, "rgba(255, 255, 255, 0.03)");
    blurGradient.addColorStop(1, "rgba(0, 0, 0, 0.22)");
    ctx.fillStyle = blurGradient;
    ctx.fillRect(0, 0, geometry.frameWidth, geometry.frameHeight);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#ffffff";
    for (let x = -geometry.frameHeight; x < geometry.frameWidth; x += stripe) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + stripe * 0.44, 0);
      ctx.lineTo(x + geometry.frameHeight + stripe * 0.44, geometry.frameHeight);
      ctx.lineTo(x + geometry.frameHeight, geometry.frameHeight);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (imageShadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.16 + imageShadow * 0.34})`;
    ctx.shadowBlur = shortEdge * (0.012 + imageShadow * 0.055);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = shortEdge * (0.004 + imageShadow * 0.018);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    if (imageRadiusPx > 0) {
      tracePresentationRoundedRect(
        ctx,
        geometry.imageX,
        geometry.imageY,
        geometry.imageWidth,
        geometry.imageHeight,
        imageRadiusPx,
      );
      ctx.fill();
    } else {
      ctx.fillRect(geometry.imageX, geometry.imageY, geometry.imageWidth, geometry.imageHeight);
    }
    ctx.restore();
  }

  const imageGradient = ctx.createLinearGradient(
    geometry.imageX,
    geometry.imageY,
    geometry.imageX + geometry.imageWidth,
    geometry.imageY + geometry.imageHeight,
  );
  imageGradient.addColorStop(0, "#303238");
  imageGradient.addColorStop(0.5, "#575a62");
  imageGradient.addColorStop(1, "#1b1c20");
  ctx.fillStyle = imageGradient;
  ctx.lineWidth = Math.max(1, Math.min(sourceWidth, sourceHeight) * 0.003);
  if (imageRadiusPx > 0) {
    tracePresentationRoundedRect(
      ctx,
      geometry.imageX,
      geometry.imageY,
      geometry.imageWidth,
      geometry.imageHeight,
      imageRadiusPx,
    );
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    tracePresentationRoundedRect(
      ctx,
      geometry.imageX + ctx.lineWidth * 0.5,
      geometry.imageY + ctx.lineWidth * 0.5,
      Math.max(1, geometry.imageWidth - ctx.lineWidth),
      Math.max(1, geometry.imageHeight - ctx.lineWidth),
      Math.max(0, imageRadiusPx - ctx.lineWidth * 0.5),
    );
    ctx.stroke();
  } else {
    ctx.fillRect(geometry.imageX, geometry.imageY, geometry.imageWidth, geometry.imageHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.strokeRect(
      geometry.imageX + ctx.lineWidth * 0.5,
      geometry.imageY + ctx.lineWidth * 0.5,
      Math.max(1, geometry.imageWidth - ctx.lineWidth),
      Math.max(1, geometry.imageHeight - ctx.lineWidth),
    );
  }

  drawBorderInnerShadow(
    ctx,
    geometry.imageX,
    geometry.imageY,
    geometry.imageWidth,
    geometry.imageHeight,
    imageRadiusPx,
    imageInnerShadow,
    shortEdge,
  );
  ctx.restore();
}

function BorderEditorCanvasPreview(props: {
  sourceSize: { width: number; height: number };
  border: PresentationBorderSettings;
  style: JSX.CSSProperties;
}) {
  let canvasRef!: HTMLCanvasElement;
  const [layoutRevision, setLayoutRevision] = createSignal(0);
  const [frameImage, setFrameImage] = createSignal<HTMLImageElement | null>(null);

  onMount(() => {
    const observer = new ResizeObserver(() => setLayoutRevision((value) => value + 1));
    observer.observe(canvasRef);
    const redraw = () => setLayoutRevision((value) => value + 1);
    window.addEventListener("resize", redraw);
    requestAnimationFrame(redraw);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", redraw);
    });
  });

  createEffect(() => {
    const border = props.border;
    const dataUrl = border.backgroundMode === "image" ? border.frameImage?.dataUrl : undefined;
    if (!dataUrl) {
      setFrameImage(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      setFrameImage(image);
      setLayoutRevision((value) => value + 1);
    };
    image.onerror = () => setFrameImage(null);
    image.src = dataUrl;
  });

  createEffect(() => {
    const border = props.border;
    const source = props.sourceSize;
    const revision = layoutRevision();
    const bgImage = frameImage();
    void revision;
    const canvas = canvasRef;
    if (!canvas) return;

    const sourceWidth = Math.max(1, source.width);
    const sourceHeight = Math.max(1, source.height);
    const geometry = resolveBorderGeometry(sourceWidth, sourceHeight, border);
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || geometry.frameWidth));
    const cssHeight = Math.max(1, Math.round(rect.height || geometry.frameHeight));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const scaleToPixels = Math.min(
      pixelWidth / Math.max(1, geometry.frameWidth),
      pixelHeight / Math.max(1, geometry.frameHeight),
    );
    const offsetX = (pixelWidth - geometry.frameWidth * scaleToPixels) / 2;
    const offsetY = (pixelHeight - geometry.frameHeight * scaleToPixels) / 2;
    ctx.setTransform(scaleToPixels, 0, 0, scaleToPixels, offsetX, offsetY);

    drawBorderLayoutThumbnail(ctx, sourceWidth, sourceHeight, border, bgImage);
  });

  return <canvas ref={canvasRef} class="border-editor-window__canvas" style={props.style} />;
}

export function BorderOverlayPanel(props: EditorOverlaysProps) {
  const original = normalizePresentationBorder(clonePresentationBorder(editState.presentationBorder));
  const [draft, setDraft] = createSignal<PresentationBorderSettings>(
    normalizePresentationBorder(clonePresentationBorder(editState.presentationBorder)),
  );
  const [compareActive, setCompareActive] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<BorderEditorTab>("frame");
  const [menuStyle, setMenuStyle] = createSignal<JSX.CSSProperties>({});
  let panelRef!: HTMLElement;
  let frameImageInputRef: HTMLInputElement | undefined;
  let applyingBorder = false;

  createEffect(() => {
    props.previewPresentationBorder(
      compareActive() ? DEFAULT_PRESENTATION_BORDER : draft(),
    );
  });

  onCleanup(() => {
    props.previewPresentationBorder(applyingBorder ? editState.presentationBorder : original);
  });

  const sourceSize = createMemo(() => ({
    width: Math.max(1, props.cropSourceData?.width ?? props.image?.width ?? 1200),
    height: Math.max(1, props.cropSourceData?.height ?? props.image?.height ?? 800),
  }));

  const geometry = createMemo(() => {
    const source = sourceSize();
    return resolveBorderGeometry(source.width, source.height, draft());
  });

  const frameStyle = createMemo(() => {
    const g = geometry();
    const maxW = 246;
    const maxH = 150;
    const scale = Math.min(maxW / g.frameWidth, maxH / g.frameHeight, 1);
    const [r, gColor, b] = draft().color;
    const shortEdge = Math.min(g.frameWidth, g.frameHeight);
    const frameRadiusPx = Math.max(0, draft().frameRadius || 0) * shortEdge * scale;
    return {
      width: `${Math.max(1, Math.round(g.frameWidth * scale))}px`,
      height: `${Math.max(1, Math.round(g.frameHeight * scale))}px`,
      "background-color": `rgba(${r}, ${gColor}, ${b}, ${draft().backgroundMode === "solid" ? draft().opacity : 1})`,
      "border-radius": `${frameRadiusPx}px`,
    };
  });

  // Palette sampled from the image currently being edited; recomputed whenever the
  // source pixels change (keyed by the crop-source token).
  const imagePalette = createMemo(() => {
    const source = props.cropSourceData;
    void source?.token;
    return extractImagePalette(source);
  });

  const activeColorHex = createMemo(() => rgbToHex(draft().color).toLowerCase());
  const frameSelectValue = createMemo(() =>
    draft().backgroundMode === "image" && draft().frameImage?.dataUrl
      ? FRAME_IMAGE_SELECT_VALUE
      : draft().preset,
  );

  function updateDraft(patch: Partial<PresentationBorderSettings>) {
    setDraft((prev) => {
      const next = { ...clonePresentationBorder(prev), ...patch };
      next.color = patch.color ? [patch.color[0], patch.color[1], patch.color[2]] : next.color;
      if (patch.size !== undefined && next.linked) {
        next.top = patch.size;
        next.right = patch.size;
        next.bottom = patch.size;
        next.left = patch.size;
      }
      if (patch.top !== undefined || patch.right !== undefined || patch.bottom !== undefined || patch.left !== undefined) {
        next.size = Math.max(next.top, next.right, next.bottom, next.left);
      }
      next.enabled =
        next.enabled ||
        next.aspectRatio !== "original" ||
        next.imageScale < 0.999 ||
        next.imageRadius > 0 ||
        next.frameRadius > 0 ||
        next.imageShadow > 0 ||
        next.imageInnerShadow > 0 ||
        next.size > 0 ||
        next.top > 0 ||
        next.right > 0 ||
        next.bottom > 0 ||
        next.left > 0;
      return normalizePresentationBorder(next);
    });
  }

  function choosePreset(id: PresentationBorderPreset) {
    const preset = getPresentationBorderPreset(id);
    setDraft(clonePresentationBorder(preset.settings));
  }

  function openFrameImagePicker() {
    if (!frameImageInputRef) return;
    frameImageInputRef.value = "";
    frameImageInputRef.click();
  }

  async function chooseFrameImage(file: File | null | undefined) {
    if (!file) return;
    try {
      const frameImage = await readPresentationFrameImage(file);
      const current = draft();
      updateDraft({
        backgroundMode: "image",
        frameImage,
        opacity: 0,
        enabled: true,
        imageScale: current.imageScale < 0.999 ? current.imageScale : 0.94,
        size: current.size > 0 ? current.size : 0.08,
      });
    } catch (error) {
      console.warn("[Border] Unable to use frame image", error);
    }
  }

  function clearFrameImage() {
    updateDraft({ backgroundMode: "solid", frameImage: undefined, opacity: 1 });
  }

  function beginCompare() {
    setCompareActive(true);
  }

  function endCompare() {
    setCompareActive(false);
  }

  function resetDraft() {
    const next = clonePresentationBorder(DEFAULT_PRESENTATION_BORDER);
    setDraft(next);
  }

  function cancel() {
    setDraft(clonePresentationBorder(original));
    props.onClose();
  }

  function apply() {
    const next = normalizePresentationBorder(clonePresentationBorder(draft()));
    applyingBorder = true;
    setEditState("presentationBorder", next);
    props.onClose();
  }

  function positionMenu() {
    const anchor = props.borderAnchor;
    if (!anchor || !panelRef) {
      setMenuStyle({});
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(408, window.innerWidth - 16);
    const measuredHeight = panelRef.offsetHeight || Math.min(680, window.innerHeight - 16);
    const height = Math.min(measuredHeight, window.innerHeight - 16);
    const gap = 10;
    const pad = 8;
    const left = Math.max(pad, Math.min(rect.right - width, window.innerWidth - width - pad));
    const preferredTop = rect.top - height - gap;
    const belowTop = rect.bottom + gap;
    const top = Math.max(
      pad,
      Math.min(preferredTop >= pad ? preferredTop : belowTop, window.innerHeight - height - pad),
    );

    setMenuStyle({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      right: "auto",
      bottom: "auto",
      width: `${Math.round(width)}px`,
      height: "auto",
      "max-height": `calc(100dvh - ${pad * 2}px)`,
    });
  }

  createEffect(() => {
    activeTab();
    void props.borderAnchor;
    queueMicrotask(() => requestAnimationFrame(positionMenu));
  });

  onMount(() => {
    positionMenu();
    requestAnimationFrame(positionMenu);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.contains(target) || props.borderAnchor?.contains(target)) return;
      cancel();
    };
    const onViewportChange = () => positionMenu();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange, true);
    window.addEventListener("scroll", onViewportChange, true);
    const outsideTimer = window.setTimeout(
      () => document.addEventListener("pointerdown", onPointerDown, true),
      0,
    );
    onCleanup(() => {
      window.clearTimeout(outsideTimer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange, true);
      window.removeEventListener("scroll", onViewportChange, true);
    });
  });

  return (
    <section
      ref={(el) => (panelRef = el)}
      class="editor-transform-window border-editor-window border-editor-window--gallery"
      role="dialog"
      aria-modal="false"
      aria-label="Borders"
      style={menuStyle()}
    >
      <Show when={props.image} fallback={<p class="editor-empty">Load an image to edit borders.</p>}>
        <header class="border-gallery__header">
          <button class="border-gallery__ghost-button" type="button" onClick={cancel}>
            Cancel
          </button>

          <div class="border-gallery__header-center">
            <span class="border-gallery__eyebrow">Frame</span>
            <strong class="border-gallery__filename" translate="no">
              {props.imageName || props.image?.fileName || "Borders"}
            </strong>
          </div>

          <div class="border-gallery__header-actions">
            <button class="border-gallery__ghost-button" type="button" onClick={resetDraft}>
              Reset
            </button>

            <button class="border-gallery__done-button" type="button" title="Apply Border" onClick={apply}>
              ✓
            </button>
          </div>
        </header>

        <div class="border-gallery__body">
          <section class="border-gallery__preview">
            <BorderEditorCanvasPreview
              sourceSize={sourceSize()}
              border={draft()}
              style={frameStyle()}
            />
          </section>

          <nav class="border-gallery__tabs" role="tablist" aria-label="Border controls">
            <For each={BORDER_EDITOR_TABS}>
              {(tab) => (
                <button
                  classList={{
                    "border-gallery__tab": true,
                    "is-active": activeTab() === tab.id,
                  }}
                  id={`border-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab() === tab.id ? "true" : "false"}
                  aria-controls={`border-panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </nav>

          <div class="border-gallery__tab-panel">
            <Show when={activeTab() === "frame"}>
              <section
                id="border-panel-frame"
                class="border-gallery__section"
                role="tabpanel"
                aria-labelledby="border-tab-frame"
              >
                <input
                  ref={(el) => (frameImageInputRef = el)}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => void chooseFrameImage(event.currentTarget.files?.[0])}
                />

                <label class="border-gallery__select-row">
                  <span>Frame Type</span>
                  <select
                    class="border-gallery__select"
                    value={frameSelectValue()}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (value === FRAME_IMAGE_SELECT_VALUE) {
                        openFrameImagePicker();
                        return;
                      }
                      choosePreset(value as PresentationBorderPreset);
                    }}
                  >
                    <For each={PRESENTATION_BORDER_PRESETS}>
                      {(preset) => <option value={preset.id}>{preset.label}</option>}
                    </For>
                    <option value={FRAME_IMAGE_SELECT_VALUE}>Use another image...</option>
                  </select>
                </label>

                <Show when={draft().backgroundMode === "image" && draft().frameImage}>
                  {(frameImage) => (
                    <div class="border-gallery__frame-image">
                      <span class="border-gallery__frame-image-name" title={frameImage().name}>
                        {frameImage().name}
                      </span>
                      <button type="button" onClick={openFrameImagePicker}>
                        Change
                      </button>
                      <button type="button" onClick={clearFrameImage}>
                        Clear
                      </button>
                    </div>
                  )}
                </Show>

                <div class="border-gallery__section-head">
                  <span>Frame Preset</span>
                </div>

                <div class="border-gallery__preset-grid" role="list">
                  <For each={PRESENTATION_BORDER_PRESETS}>
                    {(preset) => (
                      <button
                        classList={{
                          "border-gallery__preset": true,
                          "is-active": draft().preset === preset.id,
                          "is-blur": preset.settings.backgroundMode === "blur",
                        }}
                        type="button"
                        role="listitem"
                        title={preset.label}
                        onClick={() => choosePreset(preset.id)}
                      >
                        <span
                          classList={{
                            "border-gallery__preset-thumb": true,
                            "border-gallery__preset-thumb--none": preset.id === "none",
                          }}
                          style={
                            preset.id === "none"
                              ? {}
                              : { "background-color": rgbToHex(preset.settings.color) }
                          }
                        >
                          <span
                            classList={{
                              "border-gallery__preset-image": true,
                              "border-gallery__preset-image--none": preset.id === "none",
                            }}
                          />
                        </span>

                        <span class="border-gallery__preset-text">{preset.label}</span>
                      </button>
                    )}
                  </For>
                </div>

                <div class="border-gallery__section-head border-gallery__section-head--spaced">
                  <span>Look</span>
                </div>

                <Show when={draft().backgroundMode === "blur"}>
                  <div class="border-gallery__control">
                    <div class="border-gallery__control-head">
                      <span>Blur</span>
                      <strong>{Math.round(draft().blurAmount)}px</strong>
                    </div>

                    <Slider
                      label=""
                      value={draft().blurAmount}
                      min={0}
                      max={80}
                      step={1}
                      default={28}
                      format={(value) => `${Math.round(value)}px`}
                      onInput={(value) => updateDraft({ blurAmount: value, enabled: true })}
                    />
                  </div>
                </Show>

                <label class="border-gallery__color-row">
                  <span>Color</span>

                  <span class="border-gallery__color-control">
                    <input
                      type="color"
                      value={rgbToHex(draft().color)}
                      onInput={(event) =>
                        updateDraft({
                          color: hexToRgb(event.currentTarget.value),
                          enabled: true,
                        })
                      }
                    />

                    <span
                      class="border-gallery__color-swatch"
                      style={{ "background-color": rgbToHex(draft().color) }}
                    />

                    <strong>{rgbToHex(draft().color)}</strong>
                  </span>
                </label>

                <Show when={imagePalette().length > 0}>
                  <div
                    class="border-gallery__palette"
                    role="group"
                    aria-label="Colors from this image"
                  >
                    <For each={imagePalette()}>
                      {(hex) => (
                        <button
                          classList={{
                            "border-gallery__palette-swatch": true,
                            "is-active": hex.toLowerCase() === activeColorHex(),
                          }}
                          type="button"
                          title={hex}
                          aria-label={`Use ${hex}`}
                          style={{ "background-color": hex }}
                          onClick={() => updateDraft({ color: hexToRgb(hex), enabled: true })}
                        />
                      )}
                    </For>
                  </div>
                </Show>

                <div class="border-gallery__control">
                  <div class="border-gallery__control-head">
                    <span>Size</span>
                    <strong>{pct1(draft().size)}</strong>
                  </div>

                  <Slider
                    label=""
                    value={draft().size}
                    min={0}
                    max={0.5}
                    step={0.005}
                    default={0}
                    format={pct1}
                    onInput={(value) => updateDraft({ size: value, enabled: value > 0 })}
                  />
                </div>

                <label class="border-gallery__toggle-row">
                  <span>Link sides</span>

                  <input
                    class="border-gallery__toggle"
                    type="checkbox"
                    checked={draft().linked}
                    onChange={(event) => updateDraft({ linked: event.currentTarget.checked })}
                  />
                </label>

                <Show when={!draft().linked}>
                  <div class="border-gallery__side-controls">
                    <Slider label="Top" value={draft().top} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ top: value, enabled: value > 0 })} />
                    <Slider label="Right" value={draft().right} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ right: value, enabled: value > 0 })} />
                    <Slider label="Bottom" value={draft().bottom} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ bottom: value, enabled: value > 0 })} />
                    <Slider label="Left" value={draft().left} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ left: value, enabled: value > 0 })} />
                  </div>
                </Show>
              </section>
            </Show>

            <Show when={activeTab() === "ratio"}>
              <section
                id="border-panel-ratio"
                class="border-gallery__section"
                role="tabpanel"
                aria-labelledby="border-tab-ratio"
              >
                <div class="border-gallery__section-head">
                  <span>Ratio</span>
                  <small>{draft().aspectRatio}</small>
                </div>

                <div class="border-gallery__ratio-grid" role="group" aria-label="Ratio">
                  <For each={BORDER_RATIO_CHIPS}>
                    {(option) => (
                      <button
                        classList={{
                          "border-gallery__chip": true,
                          "is-active": draft().aspectRatio === option.value,
                        }}
                        type="button"
                        onClick={() => updateDraft({ aspectRatio: option.value })}
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={activeTab() === "corners"}>
              <section
                id="border-panel-corners"
                class="border-gallery__section"
                role="tabpanel"
                aria-labelledby="border-tab-corners"
              >
                <div class="border-gallery__section-head">
                  <span>Corners</span>
                </div>

                <div class="border-gallery__control">
                  <div class="border-gallery__control-head">
                    <span>Image</span>
                    <strong>{pct1(draft().imageRadius)}</strong>
                  </div>

                  <Slider
                    label=""
                    value={draft().imageRadius}
                    min={0}
                    max={1}
                    step={0.005}
                    default={0}
                    format={pct1}
                    onInput={(value) => updateDraft({ imageRadius: value, enabled: value > 0 })}
                  />
                </div>

                <div class="border-gallery__control">
                  <div class="border-gallery__control-head">
                    <span>Frame</span>
                    <strong>{pct1(draft().frameRadius)}</strong>
                  </div>

                  <Slider
                    label=""
                    value={draft().frameRadius}
                    min={0}
                    max={1}
                    step={0.005}
                    default={0}
                    format={pct1}
                    onInput={(value) => updateDraft({ frameRadius: value, enabled: value > 0 })}
                  />
                </div>
              </section>
            </Show>

            <Show when={activeTab() === "depth"}>
              <section
                id="border-panel-depth"
                class="border-gallery__section"
                role="tabpanel"
                aria-labelledby="border-tab-depth"
              >
                <div class="border-gallery__section-head">
                  <span>Image Depth</span>
                </div>

                <div class="border-gallery__control">
                  <div class="border-gallery__control-head">
                    <span>Shadow</span>
                    <strong>{pct1(draft().imageShadow)}</strong>
                  </div>

                  <Slider
                    label=""
                    value={draft().imageShadow}
                    min={0}
                    max={1}
                    step={0.01}
                    default={0}
                    format={pct1}
                    onInput={(value) => updateDraft({ imageShadow: value, enabled: value > 0 })}
                  />
                </div>

                <div class="border-gallery__control">
                  <div class="border-gallery__control-head">
                    <span>Inner Shadow</span>
                    <strong>{pct1(draft().imageInnerShadow)}</strong>
                  </div>

                  <Slider
                    label=""
                    value={draft().imageInnerShadow}
                    min={0}
                    max={1}
                    step={0.01}
                    default={0}
                    format={pct1}
                    onInput={(value) =>
                      updateDraft({ imageInnerShadow: value, enabled: value > 0 })
                    }
                  />
                </div>
              </section>
            </Show>
          </div>
        </div>

        <footer class="border-gallery__footer">
          <button
            class="border-gallery__bypass-button"
            type="button"
            onPointerDown={beginCompare}
            onPointerUp={endCompare}
            onPointerCancel={endCompare}
            onPointerLeave={endCompare}
            onBlur={endCompare}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") beginCompare();
            }}
            onKeyUp={endCompare}
          >
            Bypass
          </button>

          <button class="border-gallery__apply-button" type="button" onClick={apply}>
            Apply Frame
          </button>
        </footer>
      </Show>
    </section>
  );
}

function ScopesOverlay(props: { hasImage: boolean }) {
  return (
    <div class="editor-stack">
      <Show
        when={props.hasImage}
        fallback={<p class="editor-empty">Load an image to enable scopes.</p>}
      >
        <div class="editor-actions">
          <button
            classList={{
              "editor-btn": true,
              "editor-btn--primary": true,
              "is-active": scopesState.visible,
            }}
            type="button"
            onClick={() => setScopesState("visible", !scopesState.visible)}
          >
            {scopesState.visible ? "Hide Live Scopes" : "Show Live Scopes"}
          </button>
          <button
            classList={{ "editor-btn": true, "is-active": scopesState.enabled }}
            type="button"
            onClick={() => setScopesState("enabled", !scopesState.enabled)}
          >
            {scopesState.enabled ? "Live" : "Paused"}
          </button>
          <button
            classList={{ "editor-btn": true, "is-active": scopesState.showGrid }}
            type="button"
            onClick={() => setScopesState("showGrid", !scopesState.showGrid)}
          >
            Grid
          </button>
        </div>

        <For each={SCOPE_GROUPS}>
          {(group) => (
            <div class="editor-scope-group">
              <span>{group.label}</span>
              <div class="editor-actions">
                <For each={group.modes}>
                  {(mode) => (
                    <button
                      classList={{ "editor-btn": true, "is-active": scopesState.mode === mode.id }}
                      type="button"
                      onClick={() => setScopesState("mode", mode.id)}
                    >
                      {mode.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>

        <label class="editor-range">
          <span>Opacity</span>
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={scopesState.opacity}
            onInput={(event) => setScopesState("opacity", Number(event.currentTarget.value))}
          />
          <strong>{Math.round(scopesState.opacity * 100)}%</strong>
        </label>

        <div class="editor-actions">
          <button
            classList={{ "editor-btn": true, "is-active": scopesState.sampleSize === 128 }}
            type="button"
            onClick={() => setScopesState("sampleSize", 128)}
          >
            128 sample
          </button>
          <button
            classList={{ "editor-btn": true, "is-active": scopesState.sampleSize === 256 }}
            type="button"
            onClick={() => setScopesState("sampleSize", 256)}
          >
            256 sample
          </button>
        </div>
      </Show>
    </div>
  );
}

const PRESET_OPTIONS: ExportPreset[] = [
  "jpg-s",
  "jpg-o",
  "png-s",
  "png-o",
  "png-x",
  "tif-o",
  "tif-x",
  "custom",
];
const FORMAT_OPTIONS: ExportImageFormat[] = ["jpg", "webp", "png-8", "png-16", "tif"];
const COLOR_SPACES: Array<{ id: ExportColorSpace; label: string }> = [
  { id: "preview", label: "Preview (current)" },
  { id: "display-p3", label: "Display P3" },
  { id: "p3-d65", label: "P3 (D65)" },
  { id: "aces-cct", label: "ACEScct" },
  { id: "dwg", label: "DaVinci Wide Gamut" },
  { id: "log-c-3", label: "Log-C 3" },
  { id: "log-c-4", label: "Log-C 4" },
  { id: "ipp2", label: "RED IPP2" },
];

/** preview + both P3 modes force the kalar gamma curve and hide the gamma control (§10). */
const forcesHyticGamma = (cs: ExportColorSpace) =>
  cs === "preview" || cs === "display-p3" || cs === "p3-d65";

type FileSystemAccessWindow = Window & {
  showSaveFilePicker?: unknown;
  showDirectoryPicker?: unknown;
};

function canUseFileSystemAccess(): boolean {
  const candidate = window as FileSystemAccessWindow;
  if (
    typeof candidate.showSaveFilePicker !== "function" ||
    typeof candidate.showDirectoryPicker !== "function"
  ) {
    return false;
  }
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

function isPickerAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function ExportOverlay(props: EditorOverlaysProps) {
  // LUT-export selection (legacy lut-format / lut-size). The full destination matrix replaces
  // the old PNG/cube/CLF buttons; the persisted selection lives in exportStore.
  const currentLutOption = createMemo(
    () => LUT_FORMAT_OPTIONS.find((o) => o.label === exportState.lutFormat) ?? DEFAULT_LUT_OPTION,
  );
  const [lutExporting, setLutExporting] = createSignal(false);

  function chooseLutFormat(label: string) {
    const option = LUT_FORMAT_OPTIONS.find((o) => o.label === label);
    if (option && !option.unsupported)
      updateExportState(deriveLutSettings(option, exportState.lutSize));
  }

  // Image-export state.
  const [baseSize, setBaseSize] = createSignal({ width: 0, height: 0 });
  const [imgExporting, setImgExporting] = createSignal(false);
  const [batchImageAbort, setBatchImageAbort] = createSignal<AbortController | null>(null);
  const [batchLutAbort, setBatchLutAbort] = createSignal<AbortController | null>(null);
  const [warning, setWarning] = createSignal<string | null>(null);

  // Batch media selection (legacy batch-items multi-select). Defaults to the whole project the
  // first time Batch mode is entered.
  const [batchSelected, setBatchSelected] = createSignal<Set<string>>(new Set());
  createEffect(() => {
    if (exportState.mode === "batch" && batchSelected().size === 0) {
      setBatchSelected(new Set(mediaList().map((media) => media.assetId)));
    }
  });
  const toggleBatchItem = (id: string, on: boolean) =>
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const baseAspect = () => {
    const b = baseSize();
    return b.height > 0 ? b.width / b.height : 1;
  };
  const maxSafeExportSize = () => legacyMaxSafeExportSize();

  // §5: read the active image's (crop/rotate-resolved) dimensions once when the window opens,
  // seed the file name + apply the current preset. Slider/curve edits afterwards never touch this.
  onMount(() => {
    if (!props.isExportReady()) return;
    const base = props.getExportBaseSize();
    setBaseSize(base);
    const rawName = props.image
      ? props.image.fileName.replace(/\.[^/.]+$/, "")
      : exportState.fileName;
    const name = sanitizeFileName(rawName);
    const patch = applyExportPreset(
      exportState.preset,
      base.width,
      base.height,
      maxSafeExportSize(),
      "single",
      exportState.batchMaxSize,
    );
    if (exportState.preset === "custom" && (!exportState.imageWidth || !exportState.imageHeight)) {
      const sized = clampToMax(base.width, base.height, maxSafeExportSize());
      patch.imageWidth = sized.width;
      patch.imageHeight = sized.height;
    }
    // Legacy initialize() always resets mode to "single" when the export window opens.
    updateExportState({ mode: "single", fileName: name, ...patch });
  });

  function choosePreset(preset: ExportPreset) {
    const b = baseSize();
    updateExportState(
      applyExportPreset(
        preset,
        b.width,
        b.height,
        maxSafeExportSize(),
        exportState.mode,
        exportState.batchMaxSize,
      ),
    );
  }

  function chooseFormat(format: ExportImageFormat) {
    updateExportState(applyFormatChange(format, exportState.imageQuality, exportState.imageDPI));
  }

  function setWidth(value: number) {
    if (!Number.isFinite(value) || value < 1) return;
    const next = resizeKeepingAspect("width", value, baseAspect());
    updateExportState(clampPatch(next));
  }
  function setHeight(value: number) {
    if (!Number.isFinite(value) || value < 1) return;
    const next = resizeKeepingAspect("height", value, baseAspect());
    updateExportState(clampPatch(next));
  }
  function clampPatch(p: { imageWidth: number; imageHeight: number }) {
    const c = clampToMax(p.imageWidth, p.imageHeight, maxSafeExportSize());
    return { imageWidth: c.width, imageHeight: c.height };
  }

  // function setBatchMaxSize(value: number) {
  //   if (!Number.isFinite(value)) return;
  //   updateExportState({
  //     batchMaxSize: Math.max(1, Math.min(maxSafeExportSize(), Math.round(value))),
  //   });
  // }

  function chooseColorSpace(cs: ExportColorSpace) {
    updateExportState(
      forcesHyticGamma(cs) ? { colorSpace: cs, gammaCurve: "kalar" } : { colorSpace: cs },
    );
  }

  async function runImageExport() {
    if (imgExporting() || !props.isExportReady()) return;
    setWarning(null);
    setImgExporting(true);
    try {
      const writer = await openSaveBlobWriter(
        exportState.fileName || props.imageName || "image",
        exportState.imageExtension,
        exportState.imageMimeType,
      );
      if (!writer) return;
      await props.onExportImage(writer);
    } catch (err) {
      if (isPickerAbort(err)) return;
      setWarning(err instanceof Error ? err.message : "Export failed");
    } finally {
      setImgExporting(false);
    }
  }

  async function runPhoneExport() {
    if (imgExporting() || !props.isExportReady()) return;
    setWarning(null);
    setImgExporting(true);
    try {
      await props.onSendImageToPhone();
    } catch (err) {
      setWarning(err instanceof Error ? err.message : "Unable to send image to phone");
    } finally {
      setImgExporting(false);
    }
  }

  async function runBatchExport() {
    if (imgExporting() || !props.isExportReady()) return;
    const controller = new AbortController();
    setWarning(null);
    setImgExporting(true);
    setBatchImageAbort(controller);
    try {
      await props.onBatchExport([...batchSelected()], controller.signal);
    } catch (err) {
      if (isPickerAbort(err)) return;
      setWarning(err instanceof Error ? err.message : "Batch export failed");
    } finally {
      setBatchImageAbort(null);
      setImgExporting(false);
    }
  }

  async function runLutExport() {
    if (lutExporting() || !props.isExportReady()) return;
    setWarning(null);
    setLutExporting(true);
    try {
      const writer = await openSaveBlobWriter(
        exportState.fileName || props.imageName || "look",
        exportState.lutExtension,
        exportState.lutMimeType,
      );
      if (!writer) return;
      await props.onExportLUT(writer);
    } catch (err) {
      if (isPickerAbort(err)) return;
      setWarning(err instanceof Error ? err.message : "LUT export failed");
    } finally {
      setLutExporting(false);
    }
  }

  async function runBatchLutExport() {
    if (lutExporting() || !props.isExportReady()) return;
    const controller = new AbortController();
    setWarning(null);
    setLutExporting(true);
    setBatchLutAbort(controller);
    try {
      await props.onBatchExportLUT([...batchSelected()], controller.signal);
    } catch (err) {
      if (isPickerAbort(err)) return;
      setWarning(err instanceof Error ? err.message : "Batch LUT export failed");
    } finally {
      setBatchLutAbort(null);
      setLutExporting(false);
    }
  }

  const isCustom = () => exportState.preset === "custom";
  const isBatch = () => exportState.mode === "batch";
  const estimatedImageBytes = () =>
    estimateExportBytes(
      exportState.imageWidth,
      exportState.imageHeight,
      exportState.imageFormat,
      exportState.imageQualityEnabled ? exportState.imageQuality : undefined,
    );
  const estimatedImageSize = () => {
    // Read the export store directly rather than caching this calculation: every
    // quality selection must immediately invalidate the displayed estimate.
    const bytes = estimatedImageBytes();
    const perImage = formatEstimatedBytes(bytes);
    if (!isBatch()) return `~${perImage}`;
    const count = batchSelected().size;
    return count > 0
      ? `~${formatEstimatedBytes(bytes * count)} total (${count} × ~${perImage})`
      : `~${perImage} per image`;
  };
  const imageExportButtonLabel = () => {
    if (imgExporting()) return "Exporting...";
    if (isBatch()) {
      return canUseFileSystemAccess() ? "Select Image Folder" : "Export Images";
    }
    return canUseFileSystemAccess() ? "Save Image As" : "Export Image";
  };
  const lutExportButtonLabel = () => {
    if (lutExporting()) return "Exporting...";
    if (isBatch()) {
      return canUseFileSystemAccess() ? "Select LUTs Folder" : "Export LUTs";
    }
    return canUseFileSystemAccess() ? "Save LUT As" : "Export LUT";
  };
  return (
    <div class="editor-stack export-window">
      {/* Top tabs (§9) */}
      <div class="export-tabs">
        <button
          classList={{ "editor-btn": true, "is-active": !isBatch() }}
          type="button"
          onClick={() => updateExportState({ mode: "single" })}
        >
          Export
        </button>
        <button
          classList={{
            "editor-btn": true,
            "export-tabs__pro-action": true,
            "is-active": isBatch(),
          }}
          type="button"
          title="Batch Export"
          aria-label="Batch Export"
          onClick={() => {
            updateExportState({ mode: "batch" });
          }}
        >
          Batch Export

        </button>

        <button
          class="editor-btn editor-btn--primary"
          type="button"
          style={{ "margin-left": "auto" }}
          onClick={() => props.onClose()}
        >
          Done
        </button>

      </div>

      <Show
        when={props.isExportReady()}
        fallback={<p class="editor-empty">Nothing to export — load an image first.</p>}
      >
        {/* ── Image section ─────────────────────────────────────────── */}
        <section class="export-section">
          <h3 class="export-section__title">Export Settings</h3>

          <Show
            when={!isBatch()}
            fallback={
              <label class="editor-form-row">
                <span>Files Suffix</span>
                <input
                  class="editor-input"
                  value={exportState.batchSuffix}
                  onClick={(e) => e.currentTarget.select()}
                  onInput={(e) => updateExportState({ batchSuffix: e.currentTarget.value })}
                />
              </label>
            }
          >
            <label class="editor-form-row">
              <span>File Name</span>
              <input
                class="editor-input"
                value={exportState.fileName}
                onClick={(e) => e.currentTarget.select()}
                onInput={(e) => updateExportState({ fileName: e.currentTarget.value })}
              />
            </label>
          </Show>

          <label class="editor-form-row">
            <span>Settings</span>
            <select
              class="editor-input"
              value={exportState.preset}
              onChange={(e) => choosePreset(e.currentTarget.value as ExportPreset)}
            >
              <For each={PRESET_OPTIONS}>
                {(p) => (
                  <option value={p}>
                    {PRESET_LABELS[p]}

                  </option>
                )}
              </For>
            </select>
          </label>

          {/* Advanced controls — only for the custom preset (§9) */}
          <Show when={isCustom()}>
            <div data-image-settings-row class="w-full flex-row y-bottom gap-050">
              <label class="editor-form-row flex-col gap-025">
                <span>Width</span>
                <input
                  data-setting="image-width"
                  class="editor-input input"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  min="1"
                  value={exportState.imageWidth}
                  onChange={(event) => setWidth(Number(event.currentTarget.value))}
                />
              </label>
              <label class="editor-form-row flex-col gap-025">
                <span>Height</span>
                <input
                  data-setting="image-height"
                  class="editor-input input"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  min="1"
                  value={exportState.imageHeight}
                  onChange={(event) => setHeight(Number(event.currentTarget.value))}
                />
              </label>
              <label class="editor-form-row flex-grow flex-col gap-025">
                <span>DPI</span>
                <select
                  data-setting="image-dpi"
                  class="editor-input"
                  value={exportState.imageDPI}
                  onChange={(e) => {
                    const dpi = Number(e.currentTarget.value) as typeof exportState.imageDPI;
                    updateExportState({ imageDPI: dpi });
                  }}
                >
                  <For each={DPI_STEPS}>
                    {(d) => (
                      <option value={d} disabled={d !== 72 && exportState.imageFormat === "webp"}>
                        {d}dpi
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </div>
            <label class="editor-form-row">
              <span>Format</span>
              <select
                class="editor-input"
                value={exportState.imageFormat}
                onChange={(e) => chooseFormat(e.currentTarget.value as ExportImageFormat)}
              >
                <For each={FORMAT_OPTIONS}>
                  {(f) => (
                    <option value={f}>
                      {FORMAT_META[f].label}

                    </option>
                  )}
                </For>
              </select>
            </label>
            <Show when={!isLosslessFormat(exportState.imageFormat)}>
              <label class="editor-form-row">
                <span>Quality</span>
                <select
                  class="editor-input"
                  value={exportState.imageQualityEnabled ? String(exportState.imageQuality) : "auto"}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    updateExportState(
                      value === "auto"
                        ? { imageQualityEnabled: false }
                        : { imageQualityEnabled: true, imageQuality: Number(value) },
                    );
                  }}
                >
                  <option value="auto">Auto (encoder default)</option>
                  <For each={QUALITY_STEPS}>
                    {(q) => <option value={q}>{Math.round(q * 100)}%</option>}
                  </For>
                </select>
              </label>
            </Show>
          </Show>

          <p class="editor-hint" role="status" aria-live="polite">
            Estimated file size: {estimatedImageSize()}
            {!isLosslessFormat(exportState.imageFormat) && (
              <>{` at ${exportState.imageQualityEnabled
                  ? `${Math.round(exportState.imageQuality * 100)}% quality`
                  : "automatic quality"
                }`}</>
            )}
            . Actual size varies with image detail.
          </p>

          <Show when={isBatch()}>
            <div class="export-batch-items">
              <div class="export-batch-items__head">
                <span>
                  Images ({batchSelected().size}/{mediaList().length})
                </span>
                <button
                  class="editor-btn"
                  type="button"
                  onClick={() => setBatchSelected(new Set(mediaList().map((m) => m.assetId)))}
                >
                  All
                </button>
                <button
                  class="editor-btn"
                  type="button"
                  onClick={() => setBatchSelected(new Set())}
                >
                  None
                </button>
              </div>
              <div class="export-batch-items__list">
                <For each={mediaList()}>
                  {(media) => (
                    <label class="editor-checkbox">
                      <input
                        type="checkbox"
                        checked={batchSelected().has(media.assetId)}
                        onChange={(e) => toggleBatchItem(media.assetId, e.currentTarget.checked)}
                      />
                      <span>{media.fileName}</span>
                    </label>
                  )}
                </For>
              </div>
              <p class="editor-hint">
                Exports each selected image at the settings above; saved to a chosen folder, or a
                ZIP when folder export isn't available.
              </p>
            </div>
          </Show>

          <div class="export-actions">
            <button
              class="editor-btn editor-btn--primary export-go"
              classList={{ loading: imgExporting() }}
              type="button"
              disabled={imgExporting() || (isBatch() && batchSelected().size === 0)}
              onClick={() => void (isBatch() ? runBatchExport() : runImageExport())}
            >
              {imageExportButtonLabel()}
            </button>
          </div>
          <Show when={batchImageAbort()}>
            <button class="editor-btn" type="button" onClick={() => batchImageAbort()?.abort()}>
              Cancel Export
            </button>
          </Show>
          <Show when={warning()}>
            <p class="editor-hint export-warning">{warning()}</p>
          </Show>
        </section>

        {/* ── Color section (§10) ───────────────────────────────────── */}
        <section class="export-section">
          <h3 class="export-section__title">Color</h3>
          <label class="editor-form-row">
            <span>Color Management</span>
            <select
              class="editor-input"
              value={exportState.colorSpace}
              onChange={(e) => chooseColorSpace(e.currentTarget.value as ExportColorSpace)}
            >
              <For each={COLOR_SPACES}>{(c) => <option value={c.id}>{c.label}</option>}</For>
            </select>
          </label>
          <Show when={!forcesHyticGamma(exportState.colorSpace)}>
            <label class="editor-form-row">
              <span>Gamma Curve</span>
              <select
                class="editor-input"
                value={exportState.gammaCurve}
                onChange={(e) =>
                  updateExportState({ gammaCurve: e.currentTarget.value as "kalar" | "native" })
                }
              >
                <option value="kalar">Hytic</option>
                <option value="native">native</option>
              </select>
            </label>
          </Show>
          <label class="editor-form-row">
            <span>Metadata</span>
            <select
              class="editor-input"
              value={exportState.metadata}
              onChange={(e) => {
                const metadata = e.currentTarget.value as ExportMetadataMode;
                updateExportState({ metadata });
              }}
            >
              <option value="clean">Clean (strip)</option>
              <option value="preserve">Preserve metadata</option>
            </select>
          </label>
        </section>

        {/* ── LUT export — full legacy destination matrix (§12) ─────── */}
        <section class="export-section">
          <h3 class="export-section__title">Export 3D LUT</h3>
          <div class="export-section__apps" aria-label="Compatible applications">
            <For each={LUT_COMPATIBLE_APPS}>
              {(app) => (
                <img
                  class="export-section__app-icon"
                  src={`/assets/icons/${app.icon}`}
                  alt={app.name}
                  title={app.name}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </For>
          </div>
          <p class="editor-hint">
            LUTs encode the global color transform you've created — but not effects like Grain or
            Halation, nor masks, local layers, crop, scopes, or project state.
          </p>
<label class="editor-form-row">
            <span>Destination</span>
            <select
              class="editor-input"
              value={exportState.lutFormat}
              onChange={(e) => chooseLutFormat(e.currentTarget.value)}
            >
              <For each={LUT_FORMAT_GROUPS}>
                {(group) => (
                  <optgroup label={group.label}>
                    <For each={group.options}>
                      {(opt) => (
                        <option value={opt.label} disabled={opt.unsupported}>
                          {opt.label}
                          {opt.unsupported ? " (needs desktop)" : ""}
                        </option>
                      )}
                    </For>
                  </optgroup>
                )}
              </For>
            </select>
          </label>
          <label class="editor-form-row">
            <span>Size</span>
            <select
              class="editor-input"
              value={String(exportState.lutSize)}
              onChange={(e) => updateExportState({ lutSize: Number(e.currentTarget.value) })}
            >
              <For each={currentLutOption().sizes}>
                {(sz) => <option value={String(sz)}>{sz}³</option>}
              </For>
            </select>
          </label>
          <div
            class="export-pro-action"

          >
            <button
              class="editor-btn editor-btn--primary export-go"
              classList={{ loading: lutExporting() }}
              type="button"
              aria-label={`${lutExportButtonLabel()}`}
              disabled={
                lutExporting() ||
                (isBatch() && batchSelected().size === 0)
              }
              onClick={() => void (isBatch() ? runBatchLutExport() : runLutExport())}
            >
              {lutExportButtonLabel()}
            </button>
          </div>
          <Show when={batchLutAbort()}>
            <button class="editor-btn" type="button" onClick={() => batchLutAbort()?.abort()}>
              Cancel Export
            </button>
          </Show>
          <Show when={props.lutIs8Bit}>
            <p class="editor-hint">
              This GPU reports 8-bit LUT readback, so LUT values may be quantized.
            </p>
          </Show>
        </section>


      </Show>
    </div>
  );
}

// Backward-compatible alias for existing lazy imports.
export const Phase8Overlays = EditorOverlays;
