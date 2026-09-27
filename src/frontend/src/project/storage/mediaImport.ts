// Media import — faithful port of the legacy import dispatcher in package.min.js:
//   km  importMedia  — browser-decodable images keep ORIGINAL bytes (image.<ext>);
//                      heavy formats (RAW/TIFF/HEIC/EXR/DPX/video) are decoded to
//                      RGBA and stored as image.data (via writeDecodedMedia = qh).
//   Nm  importBrowserImage — original bytes + thumbnail.jpeg + metadata.json.
//   Um  isBrowserDecodable — the browser-renderable mime set.
//
// The legacy `km` decodes heavy formats inline (libraw/utif/libheif/exr/dpx
// workers). Those decoders already live in the engine's decode pipeline, so the
// heavy-format decode is injected here as a callback (wired in Phase 6) rather than
// duplicated — `importMedia` only owns the browser-vs-decoded dispatch + the writes.

import type { ProjectDirectory } from "./ProjectDirectory";
import {
  createImageDerivatives,
  THUMBNAIL_LONG_EDGE,
  THUMBNAIL_JPEG_QUALITY,
  GALLERY_PREVIEW_LONG_EDGE,
  GALLERY_PREVIEW_JPEG_QUALITY,
} from "../imageDerivatives";
import { writeDecodedMedia } from "./mediaStore";
import { decodeImportFile } from "./mediaImportDecoders";
import { createCatalogFields } from "../catalog";

export type MediaImportStage = "decoding" | "derivatives" | "writing";

export type MediaImportOptions = {
  onStage?: (stage: MediaImportStage) => void;
};

const BROWSER_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/avif",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const BROWSER_EXT = new Set([".jpg", ".jpeg", ".png", ".avif", ".webp", ".gif", ".bmp"]);

function importDebugEnabled(): boolean {
  return (
    !!(globalThis as { __DEBUG_IMPORT_IMAGES__?: boolean; __DEBUG_PREVIEW_LOADING__?: boolean })
      .__DEBUG_IMPORT_IMAGES__ ||
    !!(globalThis as { __DEBUG_IMPORT_IMAGES__?: boolean; __DEBUG_PREVIEW_LOADING__?: boolean })
      .__DEBUG_PREVIEW_LOADING__
  );
}

function logImportWrite(stage: string, values: Record<string, unknown>): void {
  if (!importDebugEnabled()) return;
  console.table({ stage, ...values });
}

/** Legacy `Um`: a mime type the browser can decode for `image.<ext>` storage. */
export function isBrowserDecodable(mimeType: string): boolean {
  return BROWSER_MIME.has(mimeType);
}

function extensionWithDot(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Legacy `Nm`: store a browser-decodable image's ORIGINAL bytes as
 * `user-media/<name>/image.<ext>`, plus `thumbnail.jpeg` and `metadata.json`
 * (with measured dimensions). The original bytes — not a decode — are the source,
 * so reload renders at full quality straight from the Blob (`au`).
 */
export async function importBrowserImage(
  file: File,
  userMediaDir: ProjectDirectory,
): Promise<ProjectDirectory> {
  const ext = extensionWithDot(file.name);
  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // dimensions are best-effort metadata; the visible source is the Blob itself.
  }
  const [thumbnail, galleryPreview] = await createImageDerivatives(file, [
    {
      maxLongEdge: 256,
      mimeType: "image/jpeg",
      quality: 0.7,
    },
    {
      maxLongEdge: GALLERY_PREVIEW_LONG_EDGE,
      mimeType: "image/jpeg",
      quality: GALLERY_PREVIEW_JPEG_QUALITY,
    },
  ]);
  const mediaDir = (await userMediaDir.getDirectory(file.name, true))!;
  await mediaDir.saveFiles({
    [`image${ext}`]: file,
    "thumbnail.jpeg": thumbnail,
    "gallery-preview.jpeg": galleryPreview,
    "smart-preview.jpeg": galleryPreview,
    "smart-preview.json": { policy: 2560, colorSpace: "sRGB", generatedAt: Date.now() },
    "metadata.json": {
      width,
      height,
      originalName: file.name,
      name: file.name,
      type: file.type,
      mimeType: file.type,
      extension: ext.replace(/^\./, ""),
      storage: "original",
      catalog: createCatalogFields({
        fileName: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }),
      variantKind: "original",
      variantName: file.name,
      isPrimary: true,
    },
  });
  return mediaDir;
}

async function importDecodedFile(
  file: File,
  userMediaDir: ProjectDirectory,
  options: MediaImportOptions = {},
): Promise<ProjectDirectory> {
  options.onStage?.("decoding");
  const decoded = await decodeImportFile(file);
  decoded.metadata.catalog = createCatalogFields({
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
  });
  decoded.metadata.variantKind = "original";
  decoded.metadata.variantName = file.name;
  decoded.metadata.isPrimary = true;

  if (decoded.metadata.mediaKind === "video" && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    const available = Math.max(0, Number(estimate.quota ?? 0) - Number(estimate.usage ?? 0));
    const required = Math.ceil(file.size * 1.05 + 2 * 1024 * 1024);
    if (estimate.quota && available < required) {
      throw new Error(
        `Not enough local storage for this video. Free at least ${Math.ceil((required - available) / 1048576)} MB and try again.`,
      );
    }
  }

  if (decoded.kind === "blob-image") {
    if (!decoded.imageBlob) throw new Error(`[storage] image blob missing for ${file.name}`);
    try {
      options.onStage?.("derivatives");
      const [thumbnail, galleryPreview] = await createImageDerivatives(decoded.thumbnailSource, [
        {
          maxLongEdge: THUMBNAIL_LONG_EDGE,
          mimeType: "image/jpeg",
          quality: THUMBNAIL_JPEG_QUALITY,
        },
        {
          maxLongEdge: GALLERY_PREVIEW_LONG_EDGE,
          mimeType: "image/jpeg",
          quality: GALLERY_PREVIEW_JPEG_QUALITY,
        },
      ]);
      options.onStage?.("writing");
      const mediaDir = (await userMediaDir.getDirectory(file.name, true))!;
      await mediaDir.saveFiles({
        [decoded.imageFileName]: decoded.imageBlob,
        "thumbnail.jpeg": thumbnail,
        "gallery-preview.jpeg": galleryPreview,
        "smart-preview.jpeg": galleryPreview,
        "smart-preview.json": { policy: 2560, colorSpace: "sRGB", generatedAt: Date.now() },
        "metadata.json": decoded.metadata,
      });
      logImportWrite("legacy-write-browser-media", {
        activeMediaId: mediaDir.name,
        activeMediaName: file.name,
        storage: decoded.imageFileName,
        originalBytes: decoded.imageBlob.size,
        metadataWidth: decoded.metadata.width,
        metadataHeight: decoded.metadata.height,
        metadataOrientation: decoded.metadata.orientation ?? "(unknown)",
        thumbnailBytes: thumbnail.size,
        defaultIDT: "sRGB",
        defaultODT: "sRGB",
      });
      return mediaDir;
    } finally {
      // createImageDerivatives transfers and closes ImageBitmap sources.
    }
  }

  if (!decoded.imageData) throw new Error(`[storage] decoded image data missing for ${file.name}`);
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    const available = Math.max(0, Number(estimate.quota ?? 0) - Number(estimate.usage ?? 0));
    const required = Math.ceil(decoded.imageData.data.byteLength * 1.05 + 4 * 1024 * 1024);
    if (estimate.quota && available < required) {
      throw new Error(
        `Not enough local storage for this decoded image. Free at least ${Math.ceil((required - available) / 1048576)} MB and try again.`,
      );
    }
  }
  options.onStage?.("derivatives");
  return writeDecodedMedia(
    decoded.imageData.data,
    file.name,
    decoded.imageData.width,
    decoded.imageData.height,
    userMediaDir,
    decoded.metadata,
    decoded.thumbnailSource instanceof ImageBitmap ? decoded.thumbnailSource : undefined,
    () => options.onStage?.("writing"),
  );
}

/**
 * Legacy `km`: import dispatcher. Browser-native images keep their original
 * bytes; heavy/pro formats are decoded to RGBA by mediaImportDecoders and
 * written as `image.data` + dimensions. Returns the created media directory.
 */
export async function importMedia(
  file: File,
  userMediaDir: ProjectDirectory,
  options: MediaImportOptions = {},
): Promise<ProjectDirectory> {
  if (isBrowserDecodable(file.type) || BROWSER_EXT.has(extensionWithDot(file.name))) {
    options.onStage?.("derivatives");
    return importBrowserImage(file, userMediaDir);
  }
  return importDecodedFile(file, userMediaDir, options);
}
