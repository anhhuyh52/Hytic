import {
  detectImageFormat,
  getUnsupportedImageMessage,
  isSupportedImageFile,
} from "../../engine/io/CodecRegistry";
import type { SupportedImageFormat } from "../../engine/io/CodecRegistry";
import { ImageIOService } from "../../engine/io/ImageIOService";
import { shouldUseImageDecodeWorker } from "../../engine/io/ImageDecodeProtocol";
import { readExifOffThread } from "../../engine/io/ExifMetadataClient";
import { probeVideoFile } from "../../video/probeVideo";

export type DecodedImport = {
  kind: "blob-image" | "image-data";
  imageFileName: string;
  imageBlob?: Blob;
  imageData?: ImageData;
  metadata: Record<string, unknown>;
  thumbnailSource: Blob | ImageData | ImageBitmap;
};

const imageIO = new ImageIOService();

function importDebugEnabled(): boolean {
  return (
    !!(globalThis as { __DEBUG_IMPORT_IMAGES__?: boolean; __DEBUG_PREVIEW_LOADING__?: boolean })
      .__DEBUG_IMPORT_IMAGES__ ||
    !!(globalThis as { __DEBUG_IMPORT_IMAGES__?: boolean; __DEBUG_PREVIEW_LOADING__?: boolean })
      .__DEBUG_PREVIEW_LOADING__
  );
}

function logImportDecode(stage: string, values: Record<string, unknown>): void {
  if (!importDebugEnabled()) return;
  console.table({ stage, ...values });
}

function extensionWithDot(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function imageFileNameFor(file: File, format: SupportedImageFormat): string {
  const ext = extensionWithDot(file.name);
  if (ext) return `image${ext}`;
  if (format === "jpeg") return "image.jpg";
  if (format === "png") return "image.png";
  if (format === "webp") return "image.webp";
  if (format === "avif") return "image.avif";
  if (format === "gif") return "image.gif";
  if (format === "bmp") return "image.bmp";
  return "image.data";
}

async function decodeBrowserImage(
  file: File,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement("canvas"), {
          width: bitmap.width,
          height: bitmap.height,
        });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Unable to read decoded image pixels");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function decodeImportFile(file: File): Promise<DecodedImport> {
  const format = detectImageFormat(file);
  if (!format || !isSupportedImageFile(file)) {
    throw new Error(getUnsupportedImageMessage(file));
  }

  if (format === "video") {
    const extension = extensionWithDot(file.name).replace(/^\./, "");
    const { metadata, poster } = await probeVideoFile(file);
    return {
      kind: "blob-image",
      imageFileName: imageFileNameFor(file, format),
      imageBlob: file,
      metadata: {
        ...metadata,
        width: metadata.width,
        height: metadata.height,
        originalName: file.name,
        name: file.name,
        type: file.type,
        extension,
        format: "video",
        mimeType: file.type || "video/mp4",
        mediaKind: "video",
        videoMetadata: metadata,
        videoState: { trimStartUs: 0, trimEndUs: metadata.durationUs },
        storage: "original",
      },
      thumbnailSource: poster,
    };
  }

  if (!shouldUseImageDecodeWorker(format)) {
    const extension = extensionWithDot(file.name).replace(/^\./, "");
    const [{ bitmap, width, height }, exif] = await Promise.all([
      decodeBrowserImage(file),
      readExifOffThread(file),
    ]);
    logImportDecode("legacy-import-decode", {
      fileName: file.name,
      fileType: file.type || "(empty)",
      fileSize: file.size,
      format,
      storage: "original",
      decodedNaturalWidth: width,
      decodedNaturalHeight: height,
      metadataWidth: width,
      metadataHeight: height,
      metadataOrientation: exif.orientation ?? "(unknown)",
      finalOrientedWidth: width,
      finalOrientedHeight: height,
      imageOrientation: "from-image",
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    return {
      kind: "blob-image",
      imageFileName: imageFileNameFor(file, format),
      imageBlob: file,
      metadata: {
        ...exif,
        width,
        height,
        originalName: file.name,
        name: file.name,
        type: file.type,
        extension,
        format,
        mimeType: file.type || `image/${format}`,
        storage: "original",
      },
      thumbnailSource: bitmap,
    };
  }

  const decoded = await imageIO.decode(file, { includePixels: true });
  const extension = extensionWithDot(file.name).replace(/^\./, "");
  // Heavy codecs already produced RGBA in the decode worker. Reuse that
  // transferred buffer; a full-size drawImage/getImageData readback here can
  // freeze the tab and temporarily doubles memory for large RAW/TIFF files.
  const imageData = decoded.rgba8
    ? new ImageData(
        new Uint8ClampedArray(
          decoded.rgba8.buffer,
          decoded.rgba8.byteOffset,
          decoded.rgba8.byteLength,
        ),
        decoded.width,
        decoded.height,
      )
    : bitmapToImageData(decoded.bitmap);
  logImportDecode("legacy-import-decode", {
    fileName: file.name,
    fileType: file.type || "(empty)",
    fileSize: file.size,
    format: decoded.format,
    storage: "data",
    decodedNaturalWidth: decoded.width,
    decodedNaturalHeight: decoded.height,
    metadataWidth: decoded.width,
    metadataHeight: decoded.height,
    metadataOrientation: decoded.metadata.orientation ?? "(unknown)",
    finalOrientedWidth: decoded.width,
    finalOrientedHeight: decoded.height,
    imageOrientation: decoded.orientationApplied ? "codec-applied" : "none",
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  return {
    kind: "image-data",
    imageFileName: "image.data",
    imageData,
    metadata: {
      ...decoded.metadata,
      width: decoded.width,
      height: decoded.height,
      originalName: file.name,
      name: file.name,
      type: file.type,
      extension,
      format: decoded.format,
      mimeType: decoded.mimeType,
      bitDepth: decoded.bitDepth,
      hasAlpha: decoded.hasAlpha,
      orientationApplied: decoded.orientationApplied,
      storage: "data",
    },
    // Transfer the worker-created bitmap directly to derivative generation. The
    // RGBA ImageData remains available for persistence without another full-size
    // bitmap allocation.
    thumbnailSource: decoded.bitmap,
  };
}
