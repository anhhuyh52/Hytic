import type { PresentationBorderSettings } from "./border/borderTypes";
import { isPresentationBorderVisible } from "./border/borderTypes";
import type { BorderSettings, PresentationBackgroundMode, PresentationRatioId } from "./presentationTypes";

export function toBorderSettings(legacy: PresentationBorderSettings): BorderSettings {
  const bgMode: PresentationBackgroundMode =
    legacy.backgroundMode === "blur"
      ? "blurred-image"
      : legacy.backgroundMode === "image" && legacy.frameImage?.dataUrl
        ? "image"
        : "solid";

  return {
    enabled: legacy.enabled,
    ratio: legacy.aspectRatio as PresentationRatioId,
    backgroundMode: bgMode,
    backgroundImage:
      bgMode === "image" && legacy.frameImage
        ? {
            dataUrl: legacy.frameImage.dataUrl,
            name: legacy.frameImage.name,
            width: legacy.frameImage.width,
            height: legacy.frameImage.height,
            rotationDegrees: legacy.frameImage.rotationDegrees ?? 0,
          }
        : undefined,
    backgroundColor: [legacy.color[0], legacy.color[1], legacy.color[2]],
    backgroundOpacity: legacy.opacity,
    blurAmount: legacy.blurAmount,
    imageScale: legacy.imageScale,
    imageRadius: legacy.imageRadius,
    frameRadius: legacy.frameRadius,
    imageShadow: legacy.imageShadow ?? 0,
    imageInnerShadow: legacy.imageInnerShadow ?? 0,
    borderSize: legacy.size,
    linked: legacy.linked,
    top: legacy.top,
    right: legacy.right,
    bottom: legacy.bottom,
    left: legacy.left,
  };
}

export function isBorderVisible(border: PresentationBorderSettings): boolean {
  return isPresentationBorderVisible(border);
}
