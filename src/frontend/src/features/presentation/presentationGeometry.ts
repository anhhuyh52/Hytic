import type {
  BorderSettings,
  PresentationGeometry,
  PresentationRatioId,
} from "./presentationTypes";

function ratioValue(
  ratio: PresentationRatioId,
  originalWidth: number,
  originalHeight: number,
): number {
  if (ratio === "original") return originalWidth / Math.max(1, originalHeight);
  const [w, h] = ratio.split(":");
  const left = Number(w);
  const right = Number(h);
  return Number.isFinite(left) && Number.isFinite(right) && right > 0
    ? left / right
    : originalWidth / Math.max(1, originalHeight);
}

export function resolvePresentationGeometry(params: {
  sourceWidth: number;
  sourceHeight: number;
  settings: BorderSettings;
}): PresentationGeometry {
  const { settings } = params;
  const width = Math.max(1, Math.round(params.sourceWidth));
  const height = Math.max(1, Math.round(params.sourceHeight));

  if (!settings.enabled) {
    return {
      frame: { width, height },
      imageRect: { x: 0, y: 0, width, height },
      backgroundRect: { x: 0, y: 0, width, height },
    };
  }

  const shortEdge = Math.max(1, Math.min(width, height));
  const side = (value: number) => Math.max(0, Math.round(value * shortEdge));

  let top = side(settings.linked ? settings.borderSize : settings.top);
  let right = side(settings.linked ? settings.borderSize : settings.right);
  let bottom = side(settings.linked ? settings.borderSize : settings.bottom);
  let left = side(settings.linked ? settings.borderSize : settings.left);

  let frameWidth = width + left + right;
  let frameHeight = height + top + bottom;

  const wantedAspect = ratioValue(settings.ratio, width, height);
  const currentAspect = frameWidth / Math.max(1, frameHeight);
  if (
    Number.isFinite(wantedAspect) &&
    wantedAspect > 0 &&
    Math.abs(currentAspect - wantedAspect) > 0.0005
  ) {
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

  const imageScale = Math.max(
    0.5,
    Math.min(1, Number.isFinite(settings.imageScale) ? settings.imageScale : 1),
  );
  const imageWidth = Math.max(1, Math.round(width * imageScale));
  const imageHeight = Math.max(1, Math.round(height * imageScale));
  const imageX = left + Math.round((width - imageWidth) / 2);
  const imageY = top + Math.round((height - imageHeight) / 2);

  return {
    frame: { width: frameWidth, height: frameHeight },
    imageRect: { x: imageX, y: imageY, width: imageWidth, height: imageHeight },
    backgroundRect: { x: 0, y: 0, width: frameWidth, height: frameHeight },
  };
}
