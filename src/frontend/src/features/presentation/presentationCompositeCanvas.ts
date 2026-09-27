import { resolvePresentationGeometry } from "./presentationGeometry";
import type { BorderSettings } from "./presentationTypes";

type CanvasSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas;

function rgbToHex(color: [number, number, number]): string {
  return `#${color
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function sourceWidth(source: CanvasSource): number {
  if (source instanceof HTMLImageElement) return source.naturalWidth;
  return source.width;
}

function sourceHeight(source: CanvasSource): number {
  if (source instanceof HTMLImageElement) return source.naturalHeight;
  return source.height;
}

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Trace a rounded rectangle path (no fill/stroke). Falls back to arcTo when the
 *  native `roundRect` isn't available. */
function tracePathRoundedRect(
  ctx: AnyCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  const anyCtx = ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if (typeof anyCtx.roundRect === "function") {
    anyCtx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function resolveCoverRect(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(frameW / Math.max(1, srcW), frameH / Math.max(1, srcH));
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, width: w, height: h };
}

function normalizeQuarterRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotation || 0) % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

function drawRotatedCoverImage(
  ctx: AnyCtx,
  source: CanvasSource,
  rect: { x: number; y: number; width: number; height: number },
  rotationDegrees: 0 | 90 | 180 | 270,
): void {
  const rotated = rotationDegrees === 90 || rotationDegrees === 270;
  const drawW = rotated ? rect.height : rect.width;
  const drawH = rotated ? rect.width : rect.height;
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.drawImage(source as CanvasImageSource, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function drawInsetShadow(
  ctx: AnyCtx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strength: number,
  shortEdge: number,
): void {
  if (strength <= 0) return;
  const blur = shortEdge * (0.012 + strength * 0.045);
  const opacity = 0.12 + strength * 0.3;
  const edge = Math.max(1, Math.min(blur, width * 0.5, height * 0.5));

  ctx.save();
  tracePathRoundedRect(ctx, x, y, width, height, radius);
  ctx.clip();

  const top = ctx.createLinearGradient(0, y, 0, y + edge);
  top.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
  top.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(x, y, width, edge);

  const bottom = ctx.createLinearGradient(0, y + height, 0, y + height - edge);
  bottom.addColorStop(0, `rgba(0, 0, 0, ${opacity * 0.82})`);
  bottom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y + height - edge, width, edge);

  const left = ctx.createLinearGradient(x, 0, x + edge, 0);
  left.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
  left.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = left;
  ctx.fillRect(x, y, edge, height);

  const right = ctx.createLinearGradient(x + width, 0, x + width - edge, 0);
  right.addColorStop(0, `rgba(0, 0, 0, ${opacity * 0.82})`);
  right.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = right;
  ctx.fillRect(x + width - edge, y, edge, height);

  ctx.restore();
}

export function composePresentationCanvas(params: {
  source: CanvasSource;
  backgroundSource?: CanvasSource;
  settings: BorderSettings;
  outputCanvas?: HTMLCanvasElement | OffscreenCanvas;
  dpr?: number;
}): HTMLCanvasElement | OffscreenCanvas {
  const { source, backgroundSource, settings, dpr = 1 } = params;
  const srcW = sourceWidth(source);
  const srcH = sourceHeight(source);

  const geometry = resolvePresentationGeometry({
    sourceWidth: srcW,
    sourceHeight: srcH,
    settings,
  });

  const fw = Math.max(1, Math.round(geometry.frame.width * dpr));
  const fh = Math.max(1, Math.round(geometry.frame.height * dpr));

  const canvas =
    params.outputCanvas ??
    (typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(fw, fh)
      : document.createElement("canvas"));

  if (canvas.width !== fw) canvas.width = fw;
  if (canvas.height !== fh) canvas.height = fh;

  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Unable to create 2D context for presentation composite");

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, geometry.frame.width, geometry.frame.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const { frame, imageRect } = geometry;
  const shortEdge = Math.min(frame.width, frame.height);
  const frameRadiusPx = Math.max(0, settings.frameRadius || 0) * shortEdge;
  const imageRadiusPx = Math.max(0, settings.imageRadius || 0) * shortEdge;
  const imageShadow = Math.max(0, Math.min(1, settings.imageShadow || 0));
  const imageInnerShadow = Math.max(0, Math.min(1, settings.imageInnerShadow || 0));

  // Round the outer frame corners by clipping everything to a rounded frame rect,
  // leaving the corners transparent (matches the live shader fading to clear).
  const frameClipped = frameRadiusPx > 0;
  if (frameClipped) {
    ctx.save();
    tracePathRoundedRect(ctx, 0, 0, frame.width, frame.height, frameRadiusPx);
    ctx.clip();
  }

  if (settings.backgroundMode === "image" && backgroundSource) {
    const rotationDegrees = normalizeQuarterRotation(settings.backgroundImage?.rotationDegrees);
    const rotated = rotationDegrees === 90 || rotationDegrees === 270;
    const bgW = rotated ? sourceHeight(backgroundSource) : sourceWidth(backgroundSource);
    const bgH = rotated ? sourceWidth(backgroundSource) : sourceHeight(backgroundSource);
    const rect = resolveCoverRect(bgW, bgH, frame.width, frame.height);
    drawRotatedCoverImage(ctx, backgroundSource, rect, rotationDegrees);

    if (settings.backgroundOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = settings.backgroundOpacity;
      ctx.fillStyle = rgbToHex(settings.backgroundColor);
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.restore();
    }
  } else if (settings.backgroundMode === "blurred-image") {
    const rect = resolveCoverRect(srcW, srcH, frame.width, frame.height);
    const blur = Math.max(0, Math.min(80, settings.blurAmount || 0));
    const bleed = Math.ceil(blur * 2);
    ctx.save();
    ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
    ctx.drawImage(
      source as CanvasImageSource,
      rect.x - bleed,
      rect.y - bleed,
      rect.width + bleed * 2,
      rect.height + bleed * 2,
    );
    ctx.restore();

    if (settings.backgroundOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = settings.backgroundOpacity;
      ctx.fillStyle = rgbToHex(settings.backgroundColor);
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.globalAlpha = settings.backgroundOpacity;
    ctx.fillStyle = rgbToHex(settings.backgroundColor);
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.restore();
  }

  if (imageShadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.16 + imageShadow * 0.34})`;
    ctx.shadowBlur = shortEdge * (0.012 + imageShadow * 0.055);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = shortEdge * (0.004 + imageShadow * 0.018);
    ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    if (imageRadiusPx > 0) {
      tracePathRoundedRect(ctx, imageRect.x, imageRect.y, imageRect.width, imageRect.height, imageRadiusPx);
      ctx.fill();
    } else {
      ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    }
    ctx.restore();
  }

  if (imageRadiusPx > 0) {
    ctx.save();
    tracePathRoundedRect(ctx, imageRect.x, imageRect.y, imageRect.width, imageRect.height, imageRadiusPx);
    ctx.clip();
    ctx.drawImage(
      source as CanvasImageSource,
      imageRect.x,
      imageRect.y,
      imageRect.width,
      imageRect.height,
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      source as CanvasImageSource,
      imageRect.x,
      imageRect.y,
      imageRect.width,
      imageRect.height,
    );
  }

  drawInsetShadow(
    ctx,
    imageRect.x,
    imageRect.y,
    imageRect.width,
    imageRect.height,
    imageRadiusPx,
    imageInnerShadow,
    shortEdge,
  );

  if (frameClipped) ctx.restore();

  return canvas;
}
