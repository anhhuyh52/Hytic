import { createStore, type SetStoreFunction } from "solid-js/store";
import type { EditState } from "../engine/state/EditState";
import { DEFAULT_EDIT_STATE } from "../engine/state/EditState";
import { cloneDistortState } from "../features/distort/distortStore";
import { cloneRetouchState } from "../features/retouch/retouchTypes";
import { clonePresentationBorder } from "../features/presentation/border/borderTypes";
import type { ScopesState } from "../engine/scopes/ScopeTypes";
import { DEFAULT_SCOPES_STATE } from "../engine/scopes/ScopeTypes";
import { recordStateCommit } from "./performanceCounters";

export type ImageInfo = {
  fileName: string;
  width: number;
  height: number;
  format?: string;
  mimeType?: string;
  metadataHasDepth?: boolean;
};

export type ViewportInfo = {
  zoom: number;
  panX: number;
  panY: number;
};

export type EditorState = {
  selectedFile?: File;
  image?: ImageInfo;
  viewport: ViewportInfo;
  isLoading: boolean;
  error?: string;
};

export function createEditorStore() {
  const [state, setState] = createStore<EditorState>({
    viewport: {
      zoom: 1,
      panX: 0,
      panY: 0,
    },
    isLoading: false,
  });

  const actions = {
    selectFile(file: File) {
      setState({
        selectedFile: file,
        isLoading: true,
        error: undefined,
      });
    },
    setImage(image: ImageInfo) {
      setState({
        image,
        isLoading: false,
        error: undefined,
      });
    },
    clearSelectedFile() {
      setState("selectedFile", undefined);
    },
    clearImage() {
      setState({
        selectedFile: undefined,
        image: undefined,
        isLoading: false,
        error: undefined,
      });
    },
    setViewport(viewport: ViewportInfo) {
      setState("viewport", viewport);
    },
    setError(error: string) {
      setState({
        isLoading: false,
        error,
      });
    },
    clearError() {
      setState("error", undefined);
    },
  };

  return [state, actions] as const;
}

const [editStateStore, rawSetEditState] = createStore<EditState>({
  curve: {
    ...DEFAULT_EDIT_STATE.curve,
    points: DEFAULT_EDIT_STATE.curve.points.map((point) => ({ ...point })),
  },
  contrast: {
    ...DEFAULT_EDIT_STATE.contrast,
    curve: {
      ...DEFAULT_EDIT_STATE.contrast.curve,
      points: DEFAULT_EDIT_STATE.contrast.curve.points.map((point) => ({ ...point })),
    },
  },
  balance: { ...DEFAULT_EDIT_STATE.balance },
  scattering: { ...DEFAULT_EDIT_STATE.scattering },
  refraction: {
    ...DEFAULT_EDIT_STATE.refraction,
    mapVectors: [...DEFAULT_EDIT_STATE.refraction.mapVectors],
  },
  saturation: { ...DEFAULT_EDIT_STATE.saturation },
  rgbMixer: {
    ...DEFAULT_EDIT_STATE.rgbMixer,
    red: { ...DEFAULT_EDIT_STATE.rgbMixer.red },
    green: { ...DEFAULT_EDIT_STATE.rgbMixer.green },
    blue: { ...DEFAULT_EDIT_STATE.rgbMixer.blue },
  },
  densityChroma: { ...DEFAULT_EDIT_STATE.densityChroma },
  radiance: { ...DEFAULT_EDIT_STATE.radiance },
  tone: { ...DEFAULT_EDIT_STATE.tone },
  shadowHighlight: {
    ...DEFAULT_EDIT_STATE.shadowHighlight,
    blackPoint: [...DEFAULT_EDIT_STATE.shadowHighlight.blackPoint],
    whitePoint: [...DEFAULT_EDIT_STATE.shadowHighlight.whitePoint],
  },
  exposure: { ...DEFAULT_EDIT_STATE.exposure },
  preset: { ...DEFAULT_EDIT_STATE.preset },
  match: {
    ...DEFAULT_EDIT_STATE.match,
    lut: DEFAULT_EDIT_STATE.match.lut,
  },
  grain: { ...DEFAULT_EDIT_STATE.grain },
  halation: { ...DEFAULT_EDIT_STATE.halation },
  diffusion: { ...DEFAULT_EDIT_STATE.diffusion },
  spotlight: { ...DEFAULT_EDIT_STATE.spotlight },
  transform: { ...DEFAULT_EDIT_STATE.transform },
  distort: cloneDistortState(DEFAULT_EDIT_STATE.distort),
  retouch: cloneRetouchState(DEFAULT_EDIT_STATE.retouch),
  presentationBorder: clonePresentationBorder(DEFAULT_EDIT_STATE.presentationBorder),
  colorManagement: {
    ...DEFAULT_EDIT_STATE.colorManagement,
    toneMapping: { ...DEFAULT_EDIT_STATE.colorManagement.toneMapping },
    ocio: { ...DEFAULT_EDIT_STATE.colorManagement.ocio },
    ocioRuntime: { ...DEFAULT_EDIT_STATE.colorManagement.ocioRuntime },
  },
  engineSettings: { ...DEFAULT_EDIT_STATE.engineSettings },
  localAdjustments: [],
  overlays: [],
});

export const editState = editStateStore;
export const setEditState = ((...args: unknown[]) => {
  recordStateCommit();
  // Solid's setStore is intentionally overloaded; keep the public type exact
  // while routing calls through the dev counter.
  return (rawSetEditState as (...innerArgs: unknown[]) => void)(...args);
}) as SetStoreFunction<EditState>;

// UI-only scopes state — deliberately separate from the color editState so it
// never flows into the engine snapshot / LUT generation.
export const [scopesState, setScopesState] = createStore<ScopesState>({
  ...DEFAULT_SCOPES_STATE,
});

// Dev-only: let the preview harness drive color-management selectors that have
// no file-picker-free path (e.g. set the IDT input space to verify RAW grading).
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoSetInput = (id: string) =>
    setEditState("colorManagement", "inputColorSpaceId", id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoSetOutput = (id: string) =>
    setEditState("colorManagement", "displayColorSpaceId", id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoSetEdit = setEditState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoEditState = editState;
}
