// Types for the vendored legacy LibRaw build (wlbr.js — single-file Emscripten
// module with the wasm embedded as base64). Sibling declaration for the .js, so
// `import wlbr from "./wlbr.js"` is typed. The factory resolves an instantiated
// module exposing the heap, malloc/free, and the embind `process`/`freeBuffer`.

export interface WlbrMetadata {
  width: number;
  height: number;
  make?: string;
  model?: string;
  software?: string;
  datetime?: number | string;
  artist?: string;
  copyright?: string;
  exposureTime?: number;
  fNumber?: number;
  isoSpeed?: number;
  flash?: number;
  focalLength?: number;
  lensMake?: string;
  lensModel?: string;
  gpsLat?: number;
  gpsLong?: number;
  [key: string]: unknown;
}

export interface WlbrProcessResult {
  ptr: number; // offset into HEAP8 of the developed pixel buffer
  size: number; // byte length of the buffer (width * height * channels)
  metadata: WlbrMetadata;
}

export interface WlbrModule {
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  // Develop the RAW bytes already copied into the heap at `ptr` (length `size`).
  // The trailing numeric args are LibRaw decode parameters (matched to legacy).
  process(ptr: number, size: number, ...params: number[]): WlbrProcessResult;
  // Frees a buffer returned by process().
  freeBuffer(ptr: number): void;
}

declare const wlbr: () => Promise<WlbrModule>;
export default wlbr;
