import {
  encodeExportPixels,
  type ExportEncodeFormat,
} from "../../../engine/export/exportImage";
import { composePresentationCanvas } from "../presentationCompositeCanvas";
import { toBorderSettings, isBorderVisible } from "../presentationBridge";
import type { PresentationBorderSettings } from "../border/borderTypes";

export type PresentationExportMetadata = {
  make?: string;
  model?: string;
  lens?: string;
  capturedAt?: string;
  software?: string;
};

export async function applyPresentationBorderToBlob(params: {
  sourceBlob: Blob;
  border: PresentationBorderSettings;
  format: ExportEncodeFormat;
  quality?: number;
  dpi?: number;
  metadata?: PresentationExportMetadata;
}): Promise<Blob> {
  const { sourceBlob, border, format, quality, dpi, metadata } = params;
  if (!isBorderVisible(border)) return sourceBlob;

  const bitmap = await createImageBitmap(sourceBlob);
  let frameBitmap: ImageBitmap | null = null;
  try {
    const settings = toBorderSettings(border);
    if (settings.backgroundMode === "image" && settings.backgroundImage?.dataUrl) {
      const response = await fetch(settings.backgroundImage.dataUrl);
      const blob = await response.blob();
      frameBitmap = await createImageBitmap(blob);
    }
    const composed = composePresentationCanvas({
      source: bitmap,
      backgroundSource: frameBitmap ?? undefined,
      settings,
    }) as
      | HTMLCanvasElement
      | OffscreenCanvas;

    const fw = composed.width;
    const fh = composed.height;
    const ctx = composed.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Unable to read presentation export canvas");

    const topDown = ctx.getImageData(0, 0, fw, fh).data;
    const bottomUp = new Uint8Array(topDown.length);
    const rowBytes = fw * 4;
    for (let y = 0; y < fh; y += 1) {
      const sourceOffset = y * rowBytes;
      const targetOffset = (fh - 1 - y) * rowBytes;
      bottomUp.set(topDown.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset);
    }

    return encodeExportPixels(bottomUp.buffer, fw, fh, {
      format,
      quality,
      dpi,
      metadata,
      float16: false,
    });
  } finally {
    frameBitmap?.close();
    bitmap.close();
  }
}
