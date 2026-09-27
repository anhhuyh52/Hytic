import {
  detectImageFormat,
  getFormatSupportDescriptor,
  getImageIOAuditSnapshot,
  getUnsupportedImageMessage,
  isSupportedImageFile,
} from "./CodecRegistry";
import type { SupportedImageFormat } from "./CodecRegistry";
import type { DecodedImageBitmap } from "./DecodedImage";
import { createBrowserNativeMetadata } from "./ImageMetadata";
import { readExifOffThread } from "./ExifMetadataClient";
import { shouldUseImageDecodeWorker } from "./ImageDecodeProtocol";
import { decodeWithWorker, type WorkerDecodedImage } from "./ImageDecodeClient";
import { extractVideoFrameFile } from "./videoFrame";

export class ImageIOService {
  async decode(file: File, options: { includePixels?: boolean } = {}): Promise<DecodedImageBitmap> {
    const format = detectImageFormat(file);
    if (!format || !isSupportedImageFile(file)) {
      throw new Error(getUnsupportedImageMessage(file));
    }

    const descriptor = getFormatSupportDescriptor(format);
    if (!descriptor) {
      throw new Error(getUnsupportedImageMessage(file));
    }

    if (format === "video") {
      return this.decode(await extractVideoFrameFile(file));
    }

    const mimeType = normalizeMimeType(file, format);
    const colorSpaceHint = "srgb";
    const baseMetadata = createBrowserNativeMetadata({
      fileName: file.name,
      mimeType,
      colorSpaceHint,
    });
    // Start decode and metadata extraction together. ExifReader's synchronous
    // parsing runs in its own worker, so malformed or very large files cannot
    // freeze the UI thread while a RAW/native decode is in progress.
    const heavyDecode = shouldUseImageDecodeWorker(format);
    const decodePromise = heavyDecode
      ? this.decodeHeavy(file, format, options)
      : createImageBitmap(file, {
          imageOrientation: "from-image",
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        });
    const [decodedSource, exif] = await Promise.all([decodePromise, readExifOffThread(file)]);
    const metadata = {
      ...baseMetadata,
      orientation: exif.orientation,
      make: exif.make,
      model: exif.model,
      cameraModel: exif.cameraModel ?? baseMetadata.cameraModel,
      capturedAt: exif.capturedAt ?? baseMetadata.capturedAt,
      lens: exif.lens,
      iso: exif.iso,
      aperture: exif.aperture,
      shutterSpeed: exif.shutterSpeed,
      focalLength: exif.focalLength,
      software: exif.software,
      colorProfile: exif.iccProfileDescription ?? baseMetadata.colorProfile,
      iccProfileDetected: exif.iccProfileDetected,
      iccProfileDescription: exif.iccProfileDescription,
      iccColorSpace: exif.iccColorSpace,
      limitations: baseMetadata.limitations.filter(
        (l) => !l.startsWith("EXIF tags are not parsed"),
      ),
    };

    // Pro/heavy formats (RAW, TIFF, DPX, EXR, HEIC) decode in a worker so they
    // don't block the UI; the worker returns a ready ImageBitmap. JPEG/PNG stay on
    // the browser-native createImageBitmap path (already off-thread internally).
    if (heavyDecode) {
      const decoded = decodedSource as WorkerDecodedImage;
      const cameraModel = [decoded.make, decoded.model].filter(Boolean).join(" ") || undefined;
      return {
        bitmap: decoded.bitmap,
        rgba8: decoded.rgbaBuffer ? new Uint8Array(decoded.rgbaBuffer) : undefined,
        fileName: file.name,
        mimeType,
        format,
        decoder: "worker",
        width: decoded.width,
        height: decoded.height,
        colorSpaceHint,
        bitDepth: decoded.bitDepth,
        hasAlpha: decoded.hasAlpha,
        orientationApplied: true, // the worker bakes orientation (e.g. TIFF tag 274)
        metadata: {
          ...metadata,
          orientation: decoded.orientation ?? metadata.orientation,
          orientationSource: "codec",
          orientationApplied: true,
          cameraModel: cameraModel ?? metadata.cameraModel,
          capturedAt: decoded.dateTime ?? metadata.capturedAt,
        },
      };
    }

    const bitmap = decodedSource as ImageBitmap;

    return {
      bitmap,
      fileName: file.name,
      mimeType,
      format,
      decoder: "browser-native",
      width: bitmap.width,
      height: bitmap.height,
      colorSpaceHint,
      bitDepth: 8,
      hasAlpha: format === "png" || format === "webp" || format === "avif" || format === "gif",
      orientationApplied: true,
      metadata,
    };
  }

  // Runs a heavy/pro decode in the worker. RAW must be developed by the legacy
  // wlbr build; falling back to another LibRaw wrapper changes upstream pixels
  // while the preset/IDT/ODT appear identical.
  private async decodeHeavy(
    file: File,
    format: SupportedImageFormat,
    options: { includePixels?: boolean } = {},
  ): Promise<WorkerDecodedImage> {
    try {
      return await decodeWithWorker(file, format, options);
    } catch (err) {
      if (format !== "raw") throw err;
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Legacy RAW develop failed for "${file.name}": ${detail}`);
    }
  }

  getAuditSnapshot() {
    return getImageIOAuditSnapshot();
  }
}

function normalizeMimeType(file: File, format: SupportedImageFormat): string {
  if (file.type) return file.type;
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "gif") return "image/gif";
  if (format === "bmp") return "image/bmp";
  return `image/${format}`;
}
