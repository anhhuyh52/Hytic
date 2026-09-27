// Type surface for the vendored legacy Color Match algorithm (srpStatic.js).
// `vt` is a deterministic statistical color-transfer: given a source image and a
// reference image (both RGBA8), plus a Color (colorMix) and Tone (lumaMix) amount
// in 0..1, it returns a 16³ RGB LUT. With halfFloat=true the LUT is a packed
// Uint16Array of IEEE-754 binary16 values, entries ordered (r + g*16 + b*256)*3.
type SrpImageData = {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
};

declare function vt(
  source: SrpImageData,
  reference: SrpImageData,
  colorMix: number,
  lumaMix: number,
  halfFloat?: boolean,
): Uint16Array;

export default vt;
