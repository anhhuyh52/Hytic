// Minimal ambient typings for the vendored codec npm packages that ship no types.

declare module "utif" {
  export interface UTIF_IFD {
    width: number;
    height: number;
    data: Uint8Array;
    // EXIF/TIFF tags are exposed as `t<id>` arrays, e.g. t271 (Make), t272 (Model),
    // t274 (Orientation), t306 (DateTime).
    [tag: string]: unknown;
  }
  interface UTIF_Module {
    decode(buffer: ArrayBuffer | Uint8Array): UTIF_IFD[];
    decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: UTIF_IFD, ifds?: UTIF_IFD[]): void;
    toRGBA8(ifd: UTIF_IFD): Uint8Array;
    encodeImage(
      rgba: ArrayBuffer | Uint8Array,
      width: number,
      height: number,
      metadata?: unknown,
    ): ArrayBuffer;
  }
  const UTIF: UTIF_Module;
  export default UTIF;
}

declare module "upng-js" {
  interface UPNG_Image {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: unknown[];
    tabs: Record<string, unknown>;
    data: Uint8Array;
  }
  interface UPNG_Module {
    decode(buffer: ArrayBuffer | Uint8Array): UPNG_Image;
    /** Returns one ArrayBuffer of top-down RGBA8 per frame. */
    toRGBA8(img: UPNG_Image): ArrayBuffer[];
    /** Lossy/auto encode. cnum = colour count (0 = lossless 32-bit RGBA). */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
    /** Lossless encode with explicit channels + bit depth (8 or 16). */
    encodeLL(
      imgs: ArrayBuffer[],
      w: number,
      h: number,
      cc: number,
      ac: number,
      depth: number,
      dels?: number[],
    ): ArrayBuffer;
  }
  const UPNG: UPNG_Module;
  export default UPNG;
}
