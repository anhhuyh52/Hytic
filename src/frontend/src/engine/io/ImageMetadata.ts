export type ImageOrientationSource = "browser-create-image-bitmap" | "codec" | "none" | "unread";

export type ImageMetadata = {
  fileName: string;
  mimeType: string;
  orientation?: number | "unknown";
  orientationSource: ImageOrientationSource;
  orientationApplied: boolean;
  colorProfile?: string;
  colorSpaceHint?: string;
  iccProfileDetected?: boolean;
  iccProfileDescription?: string;
  iccColorSpace?: string;
  iccTransformApplied: boolean;
  browserColorConversionApplied: boolean;
  cameraModel?: string;
  make?: string;
  model?: string;
  capturedAt?: string;
  // EXIF fields parsed by ExifReader (when present).
  lens?: string;
  iso?: number;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  software?: string;
  /** Decoder-confirmed presence of embedded or sidecar depth data. */
  hasDepth?: boolean;
  warnings: string[];
  limitations: string[];
};

export function createBrowserNativeMetadata(input: {
  fileName: string;
  mimeType: string;
  colorSpaceHint: string;
}): ImageMetadata {
  return {
    fileName: input.fileName,
    mimeType: input.mimeType,
    orientation: "unknown",
    orientationSource: "browser-create-image-bitmap",
    orientationApplied: true,
    colorSpaceHint: input.colorSpaceHint,
    iccTransformApplied: false,
    browserColorConversionApplied: false,
    warnings: [],
    limitations: [
      "EXIF tags are not parsed in the current build.",
      "ICC profile metadata may be preserved/detected, but full ICC transform parity is not implemented.",
      "Browser color conversion is disabled during image decode; no raw ICC byte transform is applied.",
      "Browser createImageBitmap applies orientation; the app does not rotate again during preview or export.",
    ],
  };
}
