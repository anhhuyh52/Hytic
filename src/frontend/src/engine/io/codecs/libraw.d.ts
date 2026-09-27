// Minimal types for libraw-wasm (ships no type declarations). The library decodes
// camera RAW (CR2/NEF/ARW/DNG/…) and manages its own internal Web Worker, so it
// is called from the main thread.
declare module "libraw-wasm" {
  export interface LibRawSettings {
    useCameraWb?: boolean;
    useAutoWb?: boolean;
    outputColor?: number; // 1 = sRGB
    outputBps?: number; // 8 or 16
    halfSize?: boolean;
    userQual?: number;
    noAutoBright?: boolean; // -W : when false, apply auto brightness (avoids black output)
    [key: string]: unknown;
  }
  export interface LibRawMetadata {
    width?: number;
    height?: number;
    [key: string]: unknown;
  }
  // imageData() returns a descriptor wrapping the processed pixel buffer, with the
  // true (active-area) dimensions and channel count — not a bare pixel array.
  export interface LibRawImageData {
    width: number;
    height: number;
    colors: number; // channels (3 = RGB, 4 = RGBA)
    bits: number; // bits per channel (8 when outputBps: 8)
    dataSize: number; // data.length
    data: Uint8Array;
  }
  export default class LibRaw {
    open(data: Uint8Array, settings?: LibRawSettings): Promise<void>;
    metadata(fullOutput?: boolean): Promise<LibRawMetadata>;
    imageData(): Promise<LibRawImageData>;
  }
}
