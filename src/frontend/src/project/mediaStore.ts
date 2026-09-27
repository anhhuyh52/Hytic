/*
 * Media store — per-asset persistent state (legacy user-media/{id}/: metadata.json
 * + state.json + image.data|image.ext + thumbnail.jpeg).
 *
 * The fast-reload contract:
 *  - The image blob is written ONCE on import (addMedia). Heavy formats are cached
 *    as raw RGBA (kind:"data") so reload skips decode entirely; light formats keep
 *    the native file (kind:"original").
 *  - saveMediaState is JSON-only — the autosave path never rewrites image/thumbnail.
 *  - loadCachedImageAsset rebuilds the ImageData (legacy au()/vh()) with zero decode.
 */
import type { EditState } from "../engine/state/EditState";
import {
  type LoadedImageAsset,
  type MediaImageStorage,
  type MediaRecord,
  type MediaSourceRecord,
  type MediaSummary,
  type MediaVersionSnapshot,
} from "./ProjectTypes";
import { toPlainSerializedEditState } from "./serializeEditState";
import type { CropSourceData } from "../poto/cropSourceTypes";
import { deserializeEditState } from "./deserializeEditState";
import * as store from "./indexedDbProjectStore";
import { createCatalogFields } from "./catalog";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneViewport(viewport?: { zoom: number; panX: number; panY: number }) {
  if (!viewport) return undefined;
  return {
    zoom: Number(viewport.zoom) || 1,
    panX: Number(viewport.panX) || 0,
    panY: Number(viewport.panY) || 0,
  };
}

function cloneSnapshots(snapshots?: MediaVersionSnapshot[]): MediaVersionSnapshot[] {
  return JSON.parse(JSON.stringify(snapshots ?? [])) as MediaVersionSnapshot[];
}

function safeMediaDirectoryName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[\\/]/g, "_");
  return trimmed || "untitled";
}

async function generateMediaAssetId(projectId: string, fileName: string): Promise<string> {
  const project = await store.getProjectRecord(projectId);
  const used = new Set(project?.assetIds ?? []);
  const safeName = safeMediaDirectoryName(fileName);
  if (!used.has(safeName)) return safeName;

  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : "";
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${stem} ${index}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${stem} ${generateId()}${ext}`;
}

export type AddMediaParams = {
  fileName: string;
  mimeType: string;
  format?: string;
  width: number;
  height: number;
  sourceSize?: number;
  sourceLastModified?: number;
  catalogAccountId?: string;
  editState: EditState;
  storage: MediaImageStorage;
  /** Source image metadata captured at import (EXIF/ICC fields when available). */
  metadata?: Record<string, unknown>;
  /** Native source file (kind:"original"/"developed"). */
  blob?: Blob;
  /** Decoded raw RGBA (kind:"data"). */
  buffer?: ArrayBuffer;
  /** Small JPEG thumbnail (shown first on reload). */
  thumbnail?: Blob;
  /** Medium JPEG preview for the gallery lightbox. */
  galleryPreview?: Blob;
  viewport?: { zoom: number; panX: number; panY: number };
  snapshots?: MediaVersionSnapshot[];
};

/**
 * Imports a new asset into a project: writes the image blob + thumbnail ONCE,
 * persists the MediaRecord, appends it to the project's asset list, and marks it
 * active. Returns the new MediaRecord.
 */
export async function addMedia(
  projectId: string,
  params: AddMediaParams,
  options: { activate?: boolean } = {},
): Promise<MediaRecord> {
  const assetId = await generateMediaAssetId(projectId, params.fileName);
  const imageId = generateId();
  const thumbnailId = assetId;
  const galleryPreviewId = assetId;
  const smartPreviewId = `${assetId}:smart-2560`;
  const now = Date.now();

  await store.putImageRecord({
    id: imageId,
    kind: params.storage,
    blob: params.blob,
    buffer: params.buffer,
    width: params.width,
    height: params.height,
  });
  if (params.thumbnail) await store.putThumbnail(thumbnailId, params.thumbnail);
  if (params.galleryPreview) {
    await store.putGalleryPreview(galleryPreviewId, params.galleryPreview);
    await store.putSmartPreview(smartPreviewId, params.galleryPreview);
  }

  const sizeBytes = params.buffer?.byteLength ?? params.blob?.size ?? 0;
  const media: MediaRecord = {
    assetId,
    projectId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    format: params.format,
    width: params.width,
    height: params.height,
    sizeBytes,
    storage: params.storage,
    metadata: params.metadata ? { ...params.metadata } : undefined,
    catalog: createCatalogFields({
      fileName: params.fileName,
      size: params.sourceSize ?? sizeBytes,
      lastModified: params.sourceLastModified,
      now,
    }),
    catalogAccountId: params.catalogAccountId,
    variantKind: "original",
    variantName: params.fileName,
    isPrimary: true,
    imageId,
    thumbnailId,
    galleryPreviewId: params.galleryPreview ? galleryPreviewId : undefined,
    smartPreviewId: params.galleryPreview ? smartPreviewId : undefined,
    smartPreviewPolicy: params.galleryPreview ? 2560 : "off",
    editState: toPlainSerializedEditState(params.editState),
    viewport: cloneViewport(params.viewport),
    snapshots: cloneSnapshots(params.snapshots),
    createdAt: now,
    updatedAt: now,
  };
  await store.putMedia(media);

  // Append to the project's ordered asset list. Imports may opt out of activation
  // so background imports do not disturb the currently edited preview.
  const project = await store.getProjectRecord(projectId);
  if (project) {
    await store.putProjectRecord({
      ...project,
      assetIds: [...project.assetIds, assetId],
      activeUserMedia: options.activate === false ? project.activeUserMedia : assetId,
      updatedAt: now,
    });
  }
  return media;
}

export function getMedia(assetId: string): Promise<MediaRecord | undefined> {
  return store.getMedia(assetId);
}

export function getMediaSource(sourceId: string): Promise<MediaSourceRecord | undefined> {
  return store.getMediaSource(sourceId);
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function ensureSharedSource(media: MediaRecord): Promise<{
  media: MediaRecord;
  source: MediaSourceRecord;
}> {
  if (media.sourceId) {
    const existing = await store.getMediaSource(media.sourceId);
    if (existing) return { media, source: existing };
  }

  const image = await store.getImageRecord(media.imageId);
  if (!image) throw new Error("The source image is missing and cannot be shared.");
  const thumbnail = await store.getThumbnail(media.thumbnailId);
  const galleryPreview = media.galleryPreviewId
    ? await store.getGalleryPreview(media.galleryPreviewId)
    : undefined;
  const sourceId = `source-${generateId()}`;
  const imageId = `${sourceId}:image`;
  const thumbnailId = `${sourceId}:thumbnail`;
  const galleryPreviewId = galleryPreview ? `${sourceId}:preview` : undefined;

  // Copy → verify. The original records remain authoritative until every copied
  // payload can be read back successfully.
  await store.putImageRecord({ ...image, id: imageId });
  if (thumbnail) await store.putThumbnail(thumbnailId, thumbnail);
  if (galleryPreview && galleryPreviewId) await store.putGalleryPreview(galleryPreviewId, galleryPreview);
  const verifiedImage = await store.getImageRecord(imageId);
  const verifiedThumbnail = thumbnail ? await store.getThumbnail(thumbnailId) : undefined;
  if (!verifiedImage || (thumbnail && !verifiedThumbnail)) {
    await store.deleteImageRecord(imageId);
    if (thumbnail) await store.deleteThumbnailRecord(thumbnailId);
    if (galleryPreviewId) await store.deleteGalleryPreview(galleryPreviewId);
    throw new Error("Unable to verify shared source storage.");
  }

  const now = Date.now();
  const source: MediaSourceRecord = {
    sourceId,
    projectId: media.projectId,
    imageId,
    thumbnailId,
    galleryPreviewId,
    smartPreviewId: media.smartPreviewId,
    smartPreviewPolicy: media.smartPreviewPolicy,
    storage: media.storage,
    mimeType: media.mimeType,
    format: media.format,
    width: media.width,
    height: media.height,
    sizeBytes: media.sizeBytes,
    captureMetadata: cloneState(media.metadata ?? {}),
    primaryAssetId: media.assetId,
    refCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  await store.putMediaSource(source);

  // Pointer commit. Only after this succeeds are the legacy payloads cleaned up.
  const migrated: MediaRecord = {
    ...media,
    sourceId,
    variantKind: "original",
    variantName: media.variantName ?? media.fileName,
    isPrimary: true,
    imageId,
    thumbnailId,
    galleryPreviewId,
    updatedAt: now,
  };
  await store.putMedia(migrated);
  if (media.imageId !== imageId) await store.deleteImageRecord(media.imageId);
  if (media.thumbnailId !== thumbnailId) await store.deleteThumbnailRecord(media.thumbnailId);
  if (media.galleryPreviewId && media.galleryPreviewId !== galleryPreviewId) {
    await store.deleteGalleryPreview(media.galleryPreviewId);
  }
  return { media: migrated, source };
}

export async function createVirtualCopy(
  assetId: string,
  requestedName?: string,
): Promise<MediaRecord> {
  const existing = await store.getMedia(assetId);
  if (!existing) throw new Error("Media not found.");
  const { media, source } = await ensureSharedSource(existing);
  const variantName = requestedName?.trim() || `${media.variantName ?? media.fileName} Copy`;
  const copyId = await generateMediaAssetId(media.projectId, variantName);
  const now = Date.now();
  const copy: MediaRecord = {
    ...media,
    assetId: copyId,
    fileName: variantName,
    variantName,
    variantKind: "virtual-copy",
    isPrimary: false,
    editState: cloneState(media.editState),
    snapshots: [],
    viewport: cloneViewport(media.viewport),
    catalog: media.catalog
      ? {
          ...cloneState(media.catalog),
          catalogUpdatedAt: now,
          sourceIdentity: { ...media.catalog.sourceIdentity },
        }
      : undefined,
    originalImageId: undefined,
    originalThumbnailId: undefined,
    originalGalleryPreviewId: undefined,
    originalImageMeta: undefined,
    createdAt: now,
    updatedAt: now,
  };
  await store.putMedia(copy);
  for (const overlay of copy.editState.overlays ?? []) {
    if (overlay.type !== "image" || !overlay.sourceId) continue;
    const blob = await store.getOverlayImage(media.assetId, overlay.sourceId);
    if (blob) await store.putOverlayImage(copyId, overlay.sourceId, blob);
  }
  await store.putMediaSource({ ...source, refCount: source.refCount + 1, updatedAt: now });
  const project = await store.getProjectRecord(media.projectId);
  if (project) {
    const sourceIndex = project.assetIds.indexOf(media.assetId);
    const assetIds = [...project.assetIds];
    assetIds.splice(sourceIndex >= 0 ? sourceIndex + 1 : assetIds.length, 0, copyId);
    await store.putProjectRecord({ ...project, assetIds, updatedAt: now });
  }
  return copy;
}

export async function renameMediaVariant(assetId: string, name: string): Promise<void> {
  const media = await store.getMedia(assetId);
  const trimmed = name.trim();
  if (!media || !trimmed) return;
  await store.putMedia({ ...media, fileName: trimmed, variantName: trimmed, updatedAt: Date.now() });
}

export async function setPrimaryMediaVariant(assetId: string): Promise<void> {
  const media = await store.getMedia(assetId);
  if (!media?.sourceId) return;
  const source = await store.getMediaSource(media.sourceId);
  if (!source) return;
  const variants = (await store.listMediaByProject(media.projectId)).filter(
    (candidate) => candidate.sourceId === media.sourceId,
  );
  const now = Date.now();
  for (const variant of variants) {
    await store.putMedia({ ...variant, isPrimary: variant.assetId === assetId, updatedAt: now });
  }
  await store.putMediaSource({ ...source, primaryAssetId: assetId, updatedAt: now });
}

export function listMedia(projectId: string): Promise<MediaSummary[]> {
  return store.listMediaSummaries(projectId);
}

/** Deserializes a media record's persisted edit state to a live EditState. */
export function hydrateEditState(media: MediaRecord): EditState {
  return deserializeEditState(media.editState);
}

export type SaveMediaStateParams = {
  editState: EditState;
  viewport?: { zoom: number; panX: number; panY: number };
};

/**
 * JSON-only update of an asset's edit state + viewport (legacy state.json write).
 * Never touches the image/thumbnail blobs — this is the autosave write path.
 */
export async function saveMediaState(assetId: string, params: SaveMediaStateParams): Promise<void> {
  const existing = await store.getMedia(assetId);
  if (!existing) return;
  await store.putMedia({
    ...existing,
    editState: toPlainSerializedEditState(params.editState),
    viewport: cloneViewport(params.viewport ?? existing.viewport),
    updatedAt: Date.now(),
  });
}

async function blobToCropSourceData(blob: Blob): Promise<CropSourceData> {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement("canvas"), {
            width: bitmap.width,
            height: bitmap.height,
          });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Unable to read crop source pixels");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      buffer: data.data.buffer.slice(0),
      width: data.width,
      height: data.height,
      token: Date.now(),
    };
  } finally {
    bitmap.close();
  }
}

export async function loadCropSourceData(assetId: string): Promise<CropSourceData | null> {
  const existing = await store.getMedia(assetId);
  if (!existing?.originalImageId) return null;
  const image = await store.getImageRecord(existing.originalImageId);
  if (!image) return null;

  const width = image.width ?? existing.originalImageMeta?.width ?? existing.width;
  const height = image.height ?? existing.originalImageMeta?.height ?? existing.height;
  if (image.kind === "data" && image.buffer) {
    return {
      buffer: image.buffer.slice(0),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      token: Date.now(),
    };
  }

  if (image.blob) return blobToCropSourceData(image.blob);
  return null;
}

export async function saveMediaSnapshots(
  assetId: string,
  snapshots: MediaVersionSnapshot[],
): Promise<void> {
  const existing = await store.getMedia(assetId);
  if (!existing) return;
  await store.putMedia({
    ...existing,
    snapshots: JSON.parse(JSON.stringify(snapshots)) as MediaVersionSnapshot[],
    updatedAt: Date.now(),
  });
}

async function detachVariantSourceForWrite(media: MediaRecord): Promise<MediaRecord> {
  if (!media.sourceId) return media;
  const source = await store.getMediaSource(media.sourceId);
  if (!source || source.refCount <= 1) return media;
  const image = await store.getImageRecord(source.imageId);
  if (!image) throw new Error("Shared source image is missing.");
  const thumbnail = await store.getThumbnail(source.thumbnailId);
  const preview = source.galleryPreviewId
    ? await store.getGalleryPreview(source.galleryPreviewId)
    : undefined;
  const sourceId = `source-${generateId()}`;
  const imageId = `${sourceId}:image`;
  const thumbnailId = `${sourceId}:thumbnail`;
  const galleryPreviewId = preview ? `${sourceId}:preview` : undefined;
  await store.putImageRecord({ ...image, id: imageId });
  if (thumbnail) await store.putThumbnail(thumbnailId, thumbnail);
  if (preview && galleryPreviewId) await store.putGalleryPreview(galleryPreviewId, preview);
  const now = Date.now();
  await store.putMediaSource({
    ...source,
    sourceId,
    imageId,
    thumbnailId,
    galleryPreviewId,
    primaryAssetId: media.assetId,
    refCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  const remaining = (await store.listMediaByProject(media.projectId)).filter(
    (candidate) => candidate.assetId !== media.assetId && candidate.sourceId === source.sourceId,
  );
  const oldPrimary = source.primaryAssetId === media.assetId ? remaining[0]?.assetId : source.primaryAssetId;
  await store.putMediaSource({
    ...source,
    primaryAssetId: oldPrimary ?? source.primaryAssetId,
    refCount: remaining.length,
    updatedAt: now,
  });
  if (source.primaryAssetId === media.assetId && oldPrimary) {
    const promoted = remaining.find((candidate) => candidate.assetId === oldPrimary);
    if (promoted) await store.putMedia({ ...promoted, isPrimary: true, updatedAt: now });
  }
  const detached = {
    ...media,
    sourceId,
    imageId,
    thumbnailId,
    galleryPreviewId,
    isPrimary: true,
    updatedAt: now,
  };
  await store.putMedia(detached);
  return detached;
}

export type ReplaceMediaImageParams = {
  width: number;
  height: number;
  buffer: ArrayBuffer;
  thumbnail?: Blob;
  galleryPreview?: Blob;
  editState: EditState;
  viewport?: { zoom: number; panX: number; panY: number };
};

/**
 * Legacy Crop & Rotate apply: preserve the first pre-transform cache as
 * `original`, then replace the active `image.data` with transformed RGBA.
 */
export async function replaceMediaImageWithData(
  assetId: string,
  params: ReplaceMediaImageParams,
): Promise<void> {
  let existing = await store.getMedia(assetId);
  if (!existing) return;
  existing = await detachVariantSourceForWrite(existing);

  let originalImageId = existing.originalImageId;
  let originalThumbnailId = existing.originalThumbnailId;
  let originalGalleryPreviewId = existing.originalGalleryPreviewId;
  let galleryPreviewId = existing.galleryPreviewId;
  let originalImageMeta = existing.originalImageMeta;

  if (!originalImageId) {
    const currentImage = await store.getImageRecord(existing.imageId);
    if (currentImage) {
      originalImageId = generateId();
      await store.putImageRecord({ ...currentImage, id: originalImageId });
      originalImageMeta = {
        width: existing.width,
        height: existing.height,
        sizeBytes: existing.sizeBytes,
        storage: existing.storage,
        mimeType: existing.mimeType,
        format: existing.format,
      };
    }
  }

  if (!originalThumbnailId) {
    const currentThumb = await store.getThumbnail(existing.thumbnailId);
    if (currentThumb) {
      originalThumbnailId = generateId();
      await store.putThumbnail(originalThumbnailId, currentThumb);
    }
  }

  if (!originalGalleryPreviewId && existing.galleryPreviewId) {
    const currentPreview = await store.getGalleryPreview(existing.galleryPreviewId);
    if (currentPreview) {
      originalGalleryPreviewId = generateId();
      await store.putGalleryPreview(originalGalleryPreviewId, currentPreview);
    }
  }

  await store.putImageRecord({
    id: existing.imageId,
    kind: "data",
    buffer: params.buffer,
    width: params.width,
    height: params.height,
  });
  if (params.thumbnail) await store.putThumbnail(existing.thumbnailId, params.thumbnail);
  if (params.galleryPreview) {
    galleryPreviewId = existing.galleryPreviewId ?? existing.assetId;
    await store.putGalleryPreview(galleryPreviewId, params.galleryPreview);
  }

  await store.putMedia({
    ...existing,
    width: params.width,
    height: params.height,
    sizeBytes: params.buffer.byteLength,
    storage: "data",
    mimeType: "image/rgba",
    format: "cached-rgba",
    originalImageId,
    originalThumbnailId,
    originalGalleryPreviewId,
    galleryPreviewId,
    originalImageMeta,
    editState: toPlainSerializedEditState(params.editState),
    viewport: cloneViewport(params.viewport ?? existing.viewport),
    updatedAt: Date.now(),
  });
  if (existing.sourceId) {
    const source = await store.getMediaSource(existing.sourceId);
    if (source) {
      await store.putMediaSource({
        ...source,
        storage: "data",
        mimeType: "image/rgba",
        format: "cached-rgba",
        width: params.width,
        height: params.height,
        sizeBytes: params.buffer.byteLength,
        updatedAt: Date.now(),
      });
    }
  }
}

/** Legacy Crop & Rotate reset apply: restore the backed-up original cache. */
export async function restoreOriginalMediaImage(
  assetId: string,
  params: SaveMediaStateParams,
): Promise<void> {
  const existing = await store.getMedia(assetId);
  if (!existing?.originalImageId || !existing.originalImageMeta) {
    await saveMediaState(assetId, params);
    return;
  }

  const original = await store.getImageRecord(existing.originalImageId);
  if (!original) {
    await saveMediaState(assetId, params);
    return;
  }

  await store.putImageRecord({ ...original, id: existing.imageId });
  if (existing.originalThumbnailId) {
    const thumb = await store.getThumbnail(existing.originalThumbnailId);
    if (thumb) await store.putThumbnail(existing.thumbnailId, thumb);
  }
  let galleryPreviewId = existing.galleryPreviewId;
  if (existing.originalGalleryPreviewId) {
    const preview = await store.getGalleryPreview(existing.originalGalleryPreviewId);
    galleryPreviewId = existing.galleryPreviewId ?? existing.assetId;
    if (preview) {
      await store.putGalleryPreview(galleryPreviewId, preview);
    } else {
      galleryPreviewId = undefined;
    }
  } else if (galleryPreviewId) {
    await store.deleteGalleryPreview(galleryPreviewId);
    galleryPreviewId = undefined;
  }

  await store.putMedia({
    ...existing,
    width: existing.originalImageMeta.width,
    height: existing.originalImageMeta.height,
    sizeBytes: existing.originalImageMeta.sizeBytes,
    storage: existing.originalImageMeta.storage,
    mimeType: existing.originalImageMeta.mimeType,
    format: existing.originalImageMeta.format,
    originalImageId: undefined,
    originalThumbnailId: undefined,
    originalGalleryPreviewId: undefined,
    galleryPreviewId,
    originalImageMeta: undefined,
    editState: toPlainSerializedEditState(params.editState),
    viewport: cloneViewport(params.viewport ?? existing.viewport),
    updatedAt: Date.now(),
  });
  if (existing.sourceId) {
    const source = await store.getMediaSource(existing.sourceId);
    if (source) {
      await store.putMediaSource({
        ...source,
        width: existing.originalImageMeta.width,
        height: existing.originalImageMeta.height,
        sizeBytes: existing.originalImageMeta.sizeBytes,
        storage: existing.originalImageMeta.storage,
        mimeType: existing.originalImageMeta.mimeType,
        format: existing.originalImageMeta.format,
        updatedAt: Date.now(),
      });
    }
  }
}

/**
 * Resolves an asset's cached pixels for loading (legacy au()/vh()):
 *  - "data"     → ImageData rebuilt from raw RGBA — ZERO decode.
 *  - "original"/"developed" → the native blob (decoded on load).
 *  - missing    → caller marks the asset failed / offers re-import.
 */
export async function loadCachedImageAsset(assetId: string): Promise<LoadedImageAsset> {
  const media = await store.getMedia(assetId);
  if (!media) return { kind: "missing" };
  const source = media.sourceId ? await store.getMediaSource(media.sourceId) : undefined;
  const image = await store.getImageRecord(source?.imageId ?? media.imageId);
  if (!image) return { kind: "missing" };

  if (image.kind === "data" && image.buffer) {
    const width = image.width ?? media.width;
    const height = image.height ?? media.height;
    return {
      kind: "data",
      imageData: new ImageData(new Uint8ClampedArray(image.buffer), width, height),
      fileName: media.fileName,
    };
  }
  if (image.blob) {
    return { kind: "blob", blob: image.blob, fileName: media.fileName, mimeType: media.mimeType };
  }
  return { kind: "missing" };
}

export async function deleteMedia(assetId: string): Promise<void> {
  await store.deleteMedia(assetId);
}

/** The asset's JPEG thumbnail (shown immediately on reload, before the texture). */
export async function getThumbnail(assetId: string): Promise<Blob | undefined> {
  const media = await store.getMedia(assetId);
  if (!media) return undefined;
  return store.getThumbnail(media.thumbnailId);
}

/** Medium JPEG preview for the gallery lightbox. */
export async function getGalleryPreview(assetId: string): Promise<Blob | undefined> {
  const media = await store.getMedia(assetId);
  if (!media) return undefined;
  if (media.galleryPreviewId) {
    const preview = await store.getGalleryPreview(media.galleryPreviewId);
    if (preview) return preview;
  }
  return store.getThumbnail(media.thumbnailId);
}

export function saveOverlayImage(assetId: string, sourceId: string, blob: Blob): Promise<void> {
  return store.putOverlayImage(assetId, sourceId, blob);
}

export function getOverlayImage(assetId: string, sourceId: string): Promise<Blob | undefined> {
  return store.getOverlayImage(assetId, sourceId);
}

/**
 * The distinct legacy IDT/ODT color combos used by a project's media — fed to the
 * engine's prewarm so switching to any asset is a compile-free cache hit (legacy
 * has no IDT/ODT switch lag because its pipeline is likewise pre-prepared).
 */
export async function listColorCombos(
  projectId: string,
): Promise<Array<{ idtId: string; odtId: string }>> {
  const records = await store.listMediaByProject(projectId);
  const seen = new Set<string>();
  const combos: Array<{ idtId: string; odtId: string }> = [];
  for (const m of records) {
    const cm = m.editState.colorManagement;
    if (!cm || cm.useAcesPipeline === false) continue;
    const idtId = cm.inputColorSpaceId ?? "sRGB";
    const odtId = cm.displayColorSpaceId ?? "sRGB";
    const key = `${idtId}|${odtId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push({ idtId, odtId });
  }
  return combos;
}
