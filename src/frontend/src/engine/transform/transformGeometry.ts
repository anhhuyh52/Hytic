import type { AspectRatioPreset, TransformState } from "../state/EditState";

export type ImageDimensions = {
  width: number;
  height: number;
};

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getTransformDisplayDimensions(
  sourceWidth: number,
  sourceHeight: number,
  transform: Pick<TransformState, "enabled" | "orientation">,
): ImageDimensions {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  if (!transform.enabled || (transform.orientation !== 90 && transform.orientation !== 270)) {
    return { width, height };
  }
  return { width: height, height: width };
}

export function getTransformOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  transform: Pick<
    TransformState,
    "enabled" | "cropEnabled" | "cropWidth" | "cropHeight" | "orientation"
  >,
  options: { includeCrop?: boolean } = {},
): ImageDimensions {
  const display = getTransformDisplayDimensions(sourceWidth, sourceHeight, transform);
  const includeCrop = options.includeCrop ?? true;
  if (!transform.enabled || !includeCrop || !transform.cropEnabled) {
    return display;
  }
  return {
    width: Math.max(1, transform.cropWidth * display.width),
    height: Math.max(1, transform.cropHeight * display.height),
  };
}

export function aspectPresetToRatio(
  preset: AspectRatioPreset,
  displayWidth: number,
  displayHeight: number,
): number | null {
  if (preset === "free") return null;
  if (preset === "original") {
    return displayWidth / Math.max(1, displayHeight);
  }

  const [w, h] = preset.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) {
    return null;
  }
  return w / h;
}

export function cropRectFromTransform(transform: TransformState): CropRect {
  return {
    x: transform.cropX,
    y: transform.cropY,
    width: transform.cropWidth,
    height: transform.cropHeight,
  };
}

export function normalizeCropRect(rect: CropRect, minSize = 0.001): CropRect {
  const width = Math.min(1, Math.max(minSize, rect.width));
  const height = Math.min(1, Math.max(minSize, rect.height));
  const x = Math.min(1 - width, Math.max(0, rect.x));
  const y = Math.min(1 - height, Math.max(0, rect.y));
  return { x, y, width, height };
}

export function refitCropRectToAspect(
  rect: CropRect,
  preset: AspectRatioPreset,
  displayWidth: number,
  displayHeight: number,
): CropRect {
  if (preset === "free") {
    return normalizeCropRect(rect);
  }

  if (preset === "original") {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const targetAspect = aspectPresetToRatio(preset, displayWidth, displayHeight);
  if (!targetAspect || targetAspect <= 0) {
    return normalizeCropRect(rect);
  }

  const sourceArea = rect.width * displayWidth * rect.height * displayHeight;
  const centerX = rect.x + rect.width * 0.5;
  const centerY = rect.y + rect.height * 0.5;
  let pixelWidth = Math.sqrt(sourceArea * targetAspect);
  let pixelHeight = pixelWidth / targetAspect;

  let width = pixelWidth / Math.max(1, displayWidth);
  let height = pixelHeight / Math.max(1, displayHeight);
  const maxWidthFromCenter = Math.min(centerX * 2, (1 - centerX) * 2);
  const maxHeightFromCenter = Math.min(centerY * 2, (1 - centerY) * 2);

  if (width > maxWidthFromCenter) {
    width = maxWidthFromCenter;
    pixelWidth = width * displayWidth;
    pixelHeight = pixelWidth / targetAspect;
    height = pixelHeight / Math.max(1, displayHeight);
  }

  if (height > maxHeightFromCenter) {
    height = maxHeightFromCenter;
    pixelHeight = height * displayHeight;
    pixelWidth = pixelHeight * targetAspect;
    width = pixelWidth / Math.max(1, displayWidth);
  }

  return normalizeCropRect({
    x: centerX - width * 0.5,
    y: centerY - height * 0.5,
    width,
    height,
  });
}

export function applyAspectPresetToTransform(
  transform: TransformState,
  preset: AspectRatioPreset,
  sourceWidth: number,
  sourceHeight: number,
): TransformState {
  const display = getTransformDisplayDimensions(sourceWidth, sourceHeight, transform);
  const crop = refitCropRectToAspect(
    cropRectFromTransform(transform),
    preset,
    display.width,
    display.height,
  );

  return {
    ...transform,
    aspectRatio: preset,
    cropX: crop.x,
    cropY: crop.y,
    cropWidth: crop.width,
    cropHeight: crop.height,
  };
}
