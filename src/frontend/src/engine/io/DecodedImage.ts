import type { SupportedImageFormat } from "./CodecRegistry";
import type { ImageMetadata } from "./ImageMetadata";

export type DecodedImage = {
  width: number;
  height: number;
  rgba8?: Uint8Array;
  rgba16?: Uint16Array;
  float32?: Float32Array;
  colorSpaceHint?: string;
  bitDepth?: number;
  hasAlpha: boolean;
  orientationApplied: boolean;
  metadata: ImageMetadata;
  /** Optional normalized depth map. Convention: 0 = nearest, 1 = farthest. */
  depthMap?: { data: Float32Array; width: number; height: number; source: "embedded" | "sidecar" | "generated" };
};

export type DecodedImageBitmap = DecodedImage & {
  bitmap: ImageBitmap;
  fileName: string;
  mimeType: string;
  format: SupportedImageFormat;
  decoder: "browser-native" | "worker";
};
