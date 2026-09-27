// Minimal types for libheif-js (the package ships emscripten WasmModule types,
// not the HeifDecoder JS wrapper). wasm-bundle has the WASM embedded (no sidecar),
// and sync WASM init is allowed inside a worker.
declare module "libheif-js/wasm-bundle" {
  export interface HeifDisplayData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(image: HeifDisplayData, callback: (out: HeifDisplayData | null) => void): void;
  }
  export interface HeifDecoderInstance {
    decode(data: Uint8Array): HeifImage[];
  }
  const libheif: { HeifDecoder: new () => HeifDecoderInstance };
  export default libheif;
}
