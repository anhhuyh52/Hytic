import { ImageIOService } from "./io/ImageIOService";
import type { SupportedImageFormat } from "./io/CodecRegistry";
import type { ImageMetadata } from "./io/ImageMetadata";

export type LoadedImage = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  fileName: string;
  format: SupportedImageFormat;
  mimeType: string;
  colorSpaceHint?: string;
  bitDepth?: number;
  hasAlpha: boolean;
  orientationApplied: boolean;
  metadata: ImageMetadata;
  depthMap?: { data: Float32Array; width: number; height: number; source: "embedded" | "sidecar" | "generated" };
};

export class ImageLoader {
  private readonly imageIO = new ImageIOService();

  async load(file: File): Promise<LoadedImage> {
    const decoded = await this.imageIO.decode(file);

    return {
      bitmap: decoded.bitmap,
      width: decoded.width,
      height: decoded.height,
      fileName: decoded.fileName,
      format: decoded.format,
      mimeType: decoded.mimeType,
      colorSpaceHint: decoded.colorSpaceHint,
      bitDepth: decoded.bitDepth,
      hasAlpha: decoded.hasAlpha,
      orientationApplied: decoded.orientationApplied,
      metadata: decoded.metadata,
      depthMap: decoded.depthMap,
    };
  }
}
