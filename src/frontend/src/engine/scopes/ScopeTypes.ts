export type ScopeMode =
  | "rgb"
  | "hue"
  | "sat"
  | "lum"
  | "vec"
  | "wvf"
  | "prd"
  | "ntg"
  | "skn"
  | "exz"
  | "clz"
  | "tmp"
  | "fcl";

export type ScopesState = {
  enabled: boolean;
  visible: boolean;
  mode: ScopeMode;
  sampleSize: number; // longest side, capped to READ_MAX_RES
  refreshRate: number; // fps cap for readback + analysis
  showGrid: boolean;
  showLabels: boolean;
  opacity: number;
};

export const DEFAULT_SCOPES_STATE: ScopesState = {
  enabled: true,
  visible: false,
  mode: "rgb",
  sampleSize: 256,
  refreshRate: 10,
  showGrid: true,
  showLabels: true,
  opacity: 1,
};

export const SCOPE_HISTOGRAM_BINS = 256;
export const READ_MAX_RES = 4096;

/** Raw processed pixels read back from the low-resolution analysis buffer. */
export type ScopeReadback = {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA, top-down
  colorManagement?: {
    inputColorSpaceId: string;
    workingColorSpaceId: string;
    displayColorSpaceId: string;
    viewTransformId: string;
    useAcesPipeline: boolean;
  };
};

export type WaveformData = {
  columns: number;
  valueBins: number;
  r: Uint32Array; // length columns * valueBins, index = column * valueBins + value
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  max: number;
};

export type VectorscopeData = {
  size: number;
  bins: Uint32Array; // size*size, index = y*size + x  (x=Cb, y=Cr)
  max: number;
};

export type ScopeFrameData = {
  width: number;
  height: number;
  histogram: {
    r: Uint32Array;
    g: Uint32Array;
    b: Uint32Array;
    luma: Uint32Array;
  };
  hue: Uint32Array; // 256 bins across 0..360
  saturation: Uint32Array; // 256 bins across 0..1
  waveform?: WaveformData;
  vectorscope?: VectorscopeData;
  mask?: Uint8ClampedArray; // RGBA overlay for neutral/skin mask modes
};
