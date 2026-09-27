import type { PresentationBorderSettings, PresentationBorderAspectRatio } from "./borderTypes";

export type PresentationBorderGeometry = {
  frameWidth: number;
  frameHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
};

export function aspectRatioValue(
  preset: PresentationBorderAspectRatio,
  originalWidth: number,
  originalHeight: number,
): number {
  if (preset === "original") return originalWidth / Math.max(1, originalHeight);
  const [w, h] = preset.split(":");
  const left = Number(w);
  const right = Number(h);
  return Number.isFinite(left) && Number.isFinite(right) && right > 0
    ? left / right
    : originalWidth / Math.max(1, originalHeight);
}

export function resolveBorderGeometry(
  sourceWidth: number,
  sourceHeight: number,
  border: PresentationBorderSettings,
): PresentationBorderGeometry {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  if (!border.enabled) {
    return {
      frameWidth: width,
      frameHeight: height,
      imageX: 0,
      imageY: 0,
      imageWidth: width,
      imageHeight: height,
      borderTop: 0,
      borderRight: 0,
      borderBottom: 0,
      borderLeft: 0,
    };
  }

  const shortEdge = Math.max(1, Math.min(width, height));
  const side = (value: number) => Math.max(0, Math.round(value * shortEdge));

  let top = side(border.linked ? border.size : border.top);
  let right = side(border.linked ? border.size : border.right);
  let bottom = side(border.linked ? border.size : border.bottom);
  let left = side(border.linked ? border.size : border.left);

  let frameWidth = width + left + right;
  let frameHeight = height + top + bottom;

  const wantedAspect = aspectRatioValue(border.aspectRatio, width, height);
  const currentAspect = frameWidth / Math.max(1, frameHeight);
  if (Number.isFinite(wantedAspect) && wantedAspect > 0 && Math.abs(currentAspect - wantedAspect) > 0.0005) {
    if (currentAspect < wantedAspect) {
      const nextFrameWidth = Math.max(frameWidth, Math.round(frameHeight * wantedAspect));
      const extra = nextFrameWidth - frameWidth;
      const extraLeft = Math.floor(extra / 2);
      left += extraLeft;
      right += extra - extraLeft;
      frameWidth = nextFrameWidth;
    } else {
      const nextFrameHeight = Math.max(frameHeight, Math.round(frameWidth / wantedAspect));
      const extra = nextFrameHeight - frameHeight;
      const extraTop = Math.floor(extra / 2);
      top += extraTop;
      bottom += extra - extraTop;
      frameHeight = nextFrameHeight;
    }
  }

  const imageScale = Math.max(0.5, Math.min(1, Number.isFinite(border.imageScale) ? border.imageScale : 1));
  const imageWidth = Math.max(1, Math.round(width * imageScale));
  const imageHeight = Math.max(1, Math.round(height * imageScale));
  const imageX = left + Math.round((width - imageWidth) / 2);
  const imageY = top + Math.round((height - imageHeight) / 2);

  return {
    frameWidth,
    frameHeight,
    imageX,
    imageY,
    imageWidth,
    imageHeight,
    borderTop: top,
    borderRight: right,
    borderBottom: bottom,
    borderLeft: left,
  };
}
