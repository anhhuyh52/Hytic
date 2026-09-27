export type PresentationBorderAspectRatio =
  | "original"
  | "1:1"
  | "4:5"
  | "5:4"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "2.39:1"
  | `${number}:${number}`;

export type PresentationBorderBackgroundMode = "solid" | "blur" | "image";
export type PresentationFrameImageRotation = 0 | 90 | 180 | 270;

export type PresentationBorderPreset =
  | "none"
  | "white-gallery"
  | "black-matte"
  | "polaroid"
  | "cinematic"
  | "social-4x5"
  | "blur-background";

export type PresentationBorderFrameImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  rotationDegrees?: PresentationFrameImageRotation;
};

export type PresentationBorderSettings = {
  enabled: boolean;
  preset: PresentationBorderPreset;
  color: [number, number, number]; // 0..255 sRGB
  opacity: number; // 0..1 solid fill opacity, or tint opacity for blurred background
  backgroundMode: PresentationBorderBackgroundMode;
  frameImage?: PresentationBorderFrameImage;
  blurAmount: number; // pixels, used when backgroundMode is "blur"
  aspectRatio: PresentationBorderAspectRatio;
  imageScale: number; // 0.5..1; scales the sharp image inside the presentation frame
  imageRadius: number; // 0..1; rounds the inner picture corners (fraction of frame short edge)
  frameRadius: number; // 0..1; rounds the outer frame corners (fraction of frame short edge)
  imageShadow: number; // 0..1; soft drop shadow behind the image
  imageInnerShadow: number; // 0..1; soft inset shadow inside the image edge
  size: number; // linked side width as a fraction of the source short edge
  linked: boolean;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const DEFAULT_PRESENTATION_BORDER: PresentationBorderSettings = {
  enabled: false,
  preset: "none",
  color: [245, 242, 235],
  opacity: 1,
  backgroundMode: "solid",
  blurAmount: 28,
  aspectRatio: "original",
  imageScale: 1,
  imageRadius: 0,
  frameRadius: 0,
  imageShadow: 0,
  imageInnerShadow: 0,
  size: 0,
  linked: true,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export function clonePresentationBorder(
  border: PresentationBorderSettings,
): PresentationBorderSettings {
  return {
    ...border,
    color: [border.color[0], border.color[1], border.color[2]],
    frameImage: border.frameImage ? { ...border.frameImage } : undefined,
  };
}

export function isPresentationBorderVisible(border: PresentationBorderSettings): boolean {
  if (!border.enabled) return false;
  if ((border.backgroundMode ?? "solid") === "solid" && border.opacity <= 0) return false;
  if ((border.backgroundMode ?? "solid") === "image" && !border.frameImage?.dataUrl) return false;
  const sides = border.linked
    ? [border.size, border.size, border.size, border.size]
    : [border.top, border.right, border.bottom, border.left];
  return (
    border.aspectRatio !== "original" ||
    border.imageScale < 0.999 ||
    (border.imageRadius ?? 0) > 0.0001 ||
    (border.frameRadius ?? 0) > 0.0001 ||
    (border.imageShadow ?? 0) > 0.0001 ||
    (border.imageInnerShadow ?? 0) > 0.0001 ||
    ((border.backgroundMode ?? "solid") === "image" && !!border.frameImage?.dataUrl) ||
    sides.some((side) => side > 0.0001)
  );
}

export function normalizePresentationBorder(
  border: PresentationBorderSettings,
): PresentationBorderSettings {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  const clampSize = (v: number) => Math.max(0, Math.min(0.5, Number.isFinite(v) ? v : 0));
  const clampRadius = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  const next = clonePresentationBorder(border);
  next.opacity = clamp01(next.opacity);
  next.backgroundMode =
    next.backgroundMode === "blur" || next.backgroundMode === "image"
      ? next.backgroundMode
      : "solid";
  if (next.backgroundMode !== "image") {
    next.frameImage = undefined;
  } else if (next.frameImage) {
    const rawRotation = Math.round(Number(next.frameImage.rotationDegrees) || 0);
    const normalizedRotation = (((rawRotation % 360) + 360) % 360) as number;
    next.frameImage = {
      dataUrl: String(next.frameImage.dataUrl || ""),
      name: String(next.frameImage.name || "Frame image"),
      width: Math.max(1, Math.round(Number(next.frameImage.width) || 1)),
      height: Math.max(1, Math.round(Number(next.frameImage.height) || 1)),
      rotationDegrees:
        normalizedRotation === 90 ||
        normalizedRotation === 180 ||
        normalizedRotation === 270
          ? normalizedRotation
          : 0,
    };
    if (!next.frameImage.dataUrl) next.frameImage = undefined;
  }
  next.blurAmount = Math.max(0, Math.min(80, Number.isFinite(next.blurAmount) ? next.blurAmount : 28));
  next.imageScale = Math.max(0.5, Math.min(1, Number.isFinite(next.imageScale) ? next.imageScale : 1));
  next.imageRadius = clampRadius(next.imageRadius);
  next.frameRadius = clampRadius(next.frameRadius);
  next.imageShadow = clamp01(next.imageShadow);
  next.imageInnerShadow = clamp01(next.imageInnerShadow);
  next.size = clampSize(next.size);
  next.top = clampSize(next.top);
  next.right = clampSize(next.right);
  next.bottom = clampSize(next.bottom);
  next.left = clampSize(next.left);
  next.color = [
    Math.max(0, Math.min(255, Math.round(next.color[0]))),
    Math.max(0, Math.min(255, Math.round(next.color[1]))),
    Math.max(0, Math.min(255, Math.round(next.color[2]))),
  ];
  if (!isPresentationBorderVisible(next)) {
    next.enabled = false;
  }
  return next;
}

export function rgbToHex(color: [number, number, number]): string {
  return `#${color
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const safe = /^[0-9a-f]{6}$/i.test(raw) ? raw : "f5f2eb";
  return [
    parseInt(safe.slice(0, 2), 16),
    parseInt(safe.slice(2, 4), 16),
    parseInt(safe.slice(4, 6), 16),
  ];
}
