/**
 * Browser imports keep a decoded RGBA buffer, an ImageBitmap, and codec-specific
 * scratch memory alive at the same time. Cap the persistent RGBA allocation at
 * 256 MiB so common 60 MP cameras still fit while pathological dimensions fail
 * before they can exhaust the tab.
 */
export const MAX_DECODED_RGBA_BYTES = 256 * 1024 * 1024;
export const MAX_DECODED_PIXELS = Math.floor(MAX_DECODED_RGBA_BYTES / 4);
export const MAX_DECODED_DIMENSION = 65_535;

export function isDecodedImageWithinBudget(width: number, height: number): boolean {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return (
    width <= MAX_DECODED_DIMENSION &&
    height <= MAX_DECODED_DIMENSION &&
    width * height <= MAX_DECODED_PIXELS
  );
}

export function assertDecodedImageWithinBudget(
  width: number,
  height: number,
  label = "Image",
): void {
  if (isDecodedImageWithinBudget(width, height)) return;
  const megapixels = Number.isFinite(width * height)
    ? Math.max(0, (width * height) / 1_000_000).toFixed(1)
    : "unknown";
  const limitMegapixels = (MAX_DECODED_PIXELS / 1_000_000).toFixed(1);
  throw new Error(
    label +
      " dimensions " +
      width +
      "x" +
      height +
      " (" +
      megapixels +
      " MP) exceed the safe browser decode limit of " +
      limitMegapixels +
      " MP.",
  );
}
