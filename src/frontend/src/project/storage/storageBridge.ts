// Integration facade for the OPFS persistence stack. It ties migration + project
// + media + import + snapshots together and maps loaded media to the Viewer's
// inputs, so PotoApp can switch persistence backends in one place instead of
// threading individual stores through boot/import/autosave/delete logic.
//
// The image DRAW and "apply state after draw" stay with the caller (the Viewer
// draws `viewerInput`; PotoApp patches `media.stateToApply` once the upload
// succeeds). Heavy-format decode is injected because the engine owns the decoders.

import { migrateIndexedDbToStorage } from "./migrateIndexedDbToStorage";
import { migrateLegacyStorageToAccount } from "./migrateLegacyStorageToAccount";
import {
  openRootDirectory,
  resetStorageDirectoryCaches,
  type ProjectDirectory,
} from "./ProjectDirectory";
import { setStorageAccount } from "./storageWriter";
import {
  bootProject,
  bootProjectFromActivePointerOnly,
  createProject,
  deleteProject,
  getActiveProject,
  getProjectsRoot,
  loadProjectContext,
  loadProjectStateOnly,
  renameProject,
  readActiveProjectId as readStoredActiveProjectId,
  resolveStartupMediaDirectory,
  setActiveProject,
  setActiveUserMedia,
  clearActiveUserMedia,
  type ProjectContext,
  resetProjectStore,
} from "./projectStore";
import {
  applyStateToMedia,
  loadMedia,
  loadPreparedMedia,
  prepareMedia,
  resolveImageSource,
  getCurrentMedia,
  clearCurrentMedia,
  readMediaState,
  resetMediaState,
  writeMediaState,
  type MediaContext,
  type PreparedMediaContext,
} from "./mediaStore";
import { importMedia, type MediaImportOptions } from "./mediaImport";
import { decodeImportFile } from "./mediaImportDecoders";
import {
  createImageDerivative,
  createImageDerivatives,
  GALLERY_PREVIEW_JPEG_QUALITY,
  GALLERY_PREVIEW_LONG_EDGE,
} from "../imageDerivatives";
import {
  saveSnapshot,
  readSnapshots,
  readSnapshotState,
  deleteSnapshot,
  renameSnapshot,
  updateSnapshotState,
  clearSnapshots,
  type Snapshot,
} from "./snapshots";
import type {
  BatchEditJournal,
  CatalogMediaRef,
  CatalogSearchDocument,
  CollectionRecord,
  MediaCatalogFields,
  MediaSourceRecord,
  MediaSummary,
  SavedProjectSummary,
  SerializedEditState,
  SmartPreviewPolicy,
  ManagedCacheUsage,
} from "../ProjectTypes";
import { DEFAULT_EDIT_STATE, type EditState } from "../../engine/state/EditState";
import type { CropSourceData } from "../../poto/cropSourceTypes";
import type { SerializedVideoState } from "../../video/types";
import * as indexedDbStore from "../indexedDbProjectStore";
import * as indexedDbMedia from "../mediaStore";
import { detectImageFormat, isSupportedImageFile } from "../../engine/io/CodecRegistry";
import {
  createCatalogSearchDocument,
  normalizeCatalogFields,
  patchCatalogFields,
} from "../catalog";
import { rebuildCatalogIndex } from "../catalogIndex";

/** Viewer-ready input for a loaded media (Blob → file, ImageData → cached RGBA). */
export type ViewerInput =
  | { file: File; imageData?: undefined }
  | {
      file?: undefined;
      imageData: { buffer: ArrayBuffer; width: number; height: number; fileName: string };
    };

let restoreToken = 0;

/** Map a media's resolved source to the Viewer's `file` / `imageData` props. */
export function mediaToViewerInput(media: MediaContext): ViewerInput {
  if (media.image instanceof Blob) {
    return {
      file: new File(
        [media.image],
        typeof media.metadata.name === "string" ? media.metadata.name : media.mainPreviewSourceName,
        {
          type: media.image.type || "application/octet-stream",
        },
      ),
    };
  }
  return {
    imageData: {
      buffer: media.image.data.buffer,
      width: media.image.width,
      height: media.image.height,
      fileName: media.mainPreviewSourceName,
    },
  };
}

export type BootResult = {
  project: ProjectContext;
  media: MediaContext | null;
};

export type PreparedBootResult = {
  project: ProjectContext;
  media: PreparedMediaContext | null;
};

async function loadFirstReadableMedia(
  project: ProjectContext,
  force = false,
): Promise<MediaContext | null> {
  const mediaDirs = await project.userMediaDirectory.getAllDirectories(false);
  const preferred = project.state.activeUserMedia
    ? mediaDirs.find((dir) => dir.name === project.state.activeUserMedia)
    : undefined;
  const candidates = preferred
    ? [preferred, ...mediaDirs.filter((dir) => dir.path !== preferred.path)]
    : mediaDirs;

  for (const dir of candidates) {
    try {
      return await loadMedia(dir, force);
    } catch {
      // Try the next ordered media directory when a cache is incomplete/corrupt.
    }
  }
  clearCurrentMedia();
  await clearActiveUserMedia();
  return null;
}

/**
 * Startup: run the one-time IndexedDB→OPFS migration, activate the last project
 * (or create Default), and resolve + load its active media (or first). Deferred
 * migrations run later after the shell is interactive.
 */
export async function bootOpfs(accountId: string): Promise<BootResult> {
  const prepared = await prepareOpfsBoot(accountId);
  const media = prepared.media ? await loadPreparedMedia(prepared.media) : null;
  return { project: prepared.project, media };
}

/**
 * Startup phase one: resolve account/project and read only thumbnail/state metadata.
 * Pixel hydration is intentionally deferred until the Viewer is ready.
 */
export async function prepareOpfsBoot(accountId: string): Promise<PreparedBootResult> {
  if (setStorageAccount(accountId)) {
    resetStorageDirectoryCaches();
    resetProjectStore();
    clearCurrentMedia();
  }
  // This migration decides which account owns the pre-isolation workspace. Run it
  // before project boot so the first account opens the legacy active project.
  await migrateLegacyStorageToAccount();
  const project = await bootProjectFromActivePointerOnly();
  const mediaDir = await resolveStartupMediaDirectory(project);
  const media = mediaDir ? await prepareMedia(mediaDir) : null;
  return { project, media };
}

export async function runDeferredStorageMigrations(): Promise<void> {
  await migrateLegacyStorageToAccount();
  await migrateIndexedDbToStorage();
  const root = await openRootDirectory();
  const catalog = await root.getDirectory("catalog", false).catch(() => undefined);
  await catalog?.deleteEntry("lens-profiles.json").catch(() => {});
}

export const readActiveProjectId = readStoredActiveProjectId;

export function loadProjectStateOnlyById(id: string): Promise<ProjectContext | undefined> {
  return loadProjectStateOnly(id);
}

export function loadStartupMediaPayload(dir: ProjectDirectory): Promise<MediaContext | null> {
  return loadMedia(dir);
}

export function loadPreparedStartupMedia(
  media: PreparedMediaContext,
): Promise<MediaContext | null> {
  return loadPreparedMedia(media);
}

/** OPFS media summaries for the active project's media strip. */
export async function listMediaSummaries(): Promise<MediaSummary[]> {
  const project = getActiveProject();
  if (!project) return [];
  const dirs = await project.userMediaDirectory.getAllDirectories(false);
  return dirs.map((dir) => ({
    assetId: dir.name,
    projectId: project.state.id,
    fileName: dir.name,
    width: 0,
    height: 0,
    updatedAt: 0,
  }));
}

/** OPFS project summaries for the project browser. */
export async function listProjectSummaries(): Promise<SavedProjectSummary[]> {
  return listProjectDirectoryPlaceholders();
}

export async function listProjectDirectoryPlaceholders(): Promise<SavedProjectSummary[]> {
  const projectsRoot = await getProjectsRoot();
  const dirs = await projectsRoot.getAllDirectories(true);
  return Promise.all(
    dirs.map(async (dir) => {
      const state: { id?: string; name?: string } = await dir
        .getFileAsParsedJSON<{ id?: string; name?: string }>("state.json")
        .catch(() => ({}));
      return {
        id: typeof state.id === "string" && state.id ? state.id : dir.name,
        name: typeof state.name === "string" && state.name ? state.name : dir.name,
        fileName: "",
        width: 0,
        height: 0,
        createdAt: 0,
        updatedAt: 0,
      };
    }),
  );
}

export async function hydrateVisibleProjectSummary(
  projectId: string,
): Promise<SavedProjectSummary | undefined> {
  try {
    const project = await loadProjectContext(projectId);
    const mediaDirs = await project.userMediaDirectory.getAllDirectories(false);
    const activeDir = project.state.activeUserMedia
      ? mediaDirs.find((mediaDir) => mediaDir.name === project.state.activeUserMedia)
      : undefined;
    const thumbDir = activeDir ?? mediaDirs[0];
    let thumbnailBlob: Blob | undefined;
    let updatedAt = 0;
    if (thumbDir) {
      const payloadDir = await getMediaPayloadDirectory(thumbDir).catch(() => thumbDir);
      const tFile = await payloadDir.getFile("thumbnail.jpeg").catch(() => undefined);
      if (tFile instanceof Blob) {
        thumbnailBlob = tFile;
        updatedAt = tFile instanceof File ? tFile.lastModified : 0;
      }
    }
    return {
      id: project.state.id,
      name: project.state.name,
      fileName: thumbDir?.name ?? "",
      width: 0,
      height: 0,
      createdAt: 0,
      updatedAt,
      assetCount: mediaDirs.length,
      thumbnail: thumbnailBlob,
    };
  } catch {
    return undefined;
  }
}

export async function listMediaDirectoryPlaceholders(projectId?: string): Promise<MediaSummary[]> {
  const project = projectId ? await loadProjectContext(projectId) : getActiveProject();
  if (!project) return [];
  const dirs = await project.userMediaDirectory.getAllDirectories(false);
  const summaries = await Promise.all(
    dirs.map(async (dir) => {
      const metadata = await dir
        .getFileAsParsedJSON<Record<string, unknown>>("metadata.json")
        .catch((): Record<string, unknown> => ({}));
      const payloadDir = await getMediaPayloadDirectory(dir).catch(() => dir);
      const thumbnail = await payloadDir.getFile("thumbnail.jpeg").catch(() => undefined);
      const fileName =
        typeof metadata.name === "string" && metadata.name
          ? metadata.name
          : typeof metadata.originalName === "string" && metadata.originalName
            ? metadata.originalName
            : dir.name;
      const width = Number(metadata.width);
      const height = Number(metadata.height);
      return {
        assetId: dir.name,
        projectId: project.state.id,
        fileName,
        width: Number.isFinite(width) && width > 0 ? width : 0,
        height: Number.isFinite(height) && height > 0 ? height : 0,
        updatedAt: thumbnail instanceof File ? thumbnail.lastModified : 0,
        thumbnail: thumbnail instanceof Blob ? thumbnail : undefined,
        sourceId: typeof metadata.sourceId === "string" ? metadata.sourceId : undefined,
        variantKind:
          metadata.variantKind === "virtual-copy" ? ("virtual-copy" as const) : ("original" as const),
        variantName:
          typeof metadata.variantName === "string" ? metadata.variantName : fileName,
        isPrimary: metadata.isPrimary !== false,
      };
    }),
  );
  const groupOrder = new Map<string, number>();
  summaries.forEach((media) => {
    const key = media.sourceId ?? media.assetId;
    if (!groupOrder.has(key)) groupOrder.set(key, groupOrder.size);
  });
  return summaries.sort((a, b) => {
    const group =
      (groupOrder.get(a.sourceId ?? a.assetId) ?? 0) -
      (groupOrder.get(b.sourceId ?? b.assetId) ?? 0);
    if (group) return group;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.updatedAt - b.updatedAt;
  });
}

export type CatalogPersistenceKind = "opfs" | "indexeddb";

export async function saveBatchEditJournal(
  kind: CatalogPersistenceKind,
  journal: BatchEditJournal,
): Promise<void> {
  if (kind === "indexeddb") return indexedDbStore.putBatchEditJournal(journal);
  const project = await loadProjectContext(journal.projectId);
  const journals = await project.rootDirectory.getDirectory("batch-edit-journals", true);
  await journals?.saveFile(`${journal.id}.json`, journal);
}

export async function listBatchEditJournals(
  kind: CatalogPersistenceKind,
  projectId: string,
): Promise<BatchEditJournal[]> {
  if (kind === "indexeddb") return indexedDbStore.listBatchEditJournals(projectId);
  const project = await loadProjectContext(projectId);
  const journals = await project.rootDirectory
    .getDirectory("batch-edit-journals", false)
    .catch(() => undefined);
  if (!journals) return [];
  const values = await journals.getAllFiles(true);
  const result: BatchEditJournal[] = [];
  for (const value of values) {
    try {
      const text = typeof value === "string" ? value : value instanceof Blob ? await value.text() : "";
      if (text) result.push(JSON.parse(text) as BatchEditJournal);
    } catch {
      // Corrupt journals are ignored; no target state can be trusted from them.
    }
  }
  return result;
}

export async function deleteBatchEditJournal(
  kind: CatalogPersistenceKind,
  projectId: string,
  journalId: string,
): Promise<void> {
  if (kind === "indexeddb") return indexedDbStore.deleteBatchEditJournal(journalId);
  const project = await loadProjectContext(projectId);
  const journals = await project.rootDirectory
    .getDirectory("batch-edit-journals", false)
    .catch(() => undefined);
  await journals?.deleteEntry(`${journalId}.json`).catch(() => {});
}

/**
 * Read canonical catalog metadata and normalize only the supported EXIF fields
 * into disposable search documents. Legacy assets receive neutral defaults by
 * updating metadata JSON/MediaRecord only; image, edit state, and thumbnails are
 * never touched.
 */
export async function listCatalogDocuments(
  kind: CatalogPersistenceKind,
  accountId: string,
): Promise<CatalogSearchDocument[]> {
  const documents: CatalogSearchDocument[] = [];
  if (kind === "indexeddb") {
    const projects = await indexedDbStore.listProjectRecords();
    for (const project of projects) {
      const records = await indexedDbStore.listMediaByProject(project.id);
      for (const media of records) {
        if (media.catalogAccountId && media.catalogAccountId !== accountId) continue;
        const catalog = normalizeCatalogFields(media.catalog, {
          fileName: media.fileName,
          size: media.sizeBytes,
          timestamp: media.createdAt,
        });
        if (!media.catalog || !media.catalogAccountId) {
          await indexedDbStore.putMedia({ ...media, catalog, catalogAccountId: accountId });
        }
        documents.push(
          createCatalogSearchDocument({
            accountId,
            projectId: project.id,
            projectName: project.name,
            assetId: media.assetId,
            fileName: media.fileName,
            width: media.width,
            height: media.height,
            mediaType: media.mediaKind ?? "image",
            metadata: media.metadata,
            catalog,
          }),
        );
      }
    }
    return documents;
  }

  const projects = await listProjectDirectoryPlaceholders();
  for (const summary of projects) {
    const project = await loadProjectContext(summary.id).catch(() => undefined);
    if (!project) continue;
    const mediaDirs = await project.userMediaDirectory.getAllDirectories(false);
    for (const dir of mediaDirs) {
      const metadata = await dir
        .getFileAsParsedJSON<Record<string, unknown>>("metadata.json")
        .catch((): Record<string, unknown> => ({}));
      const fileName =
        (typeof metadata.name === "string" && metadata.name) ||
        (typeof metadata.originalName === "string" && metadata.originalName) ||
        dir.name;
      const sourceSize = Number(
        (metadata.catalog as { sourceIdentity?: { size?: unknown } } | undefined)?.sourceIdentity
          ?.size,
      );
      const catalog = normalizeCatalogFields(metadata.catalog, {
        fileName,
        size: Number.isFinite(sourceSize) ? sourceSize : 0,
        timestamp: 0,
      });
      if (!metadata.catalog) await dir.saveFile("metadata.json", { ...metadata, catalog });
      documents.push(
        createCatalogSearchDocument({
          accountId,
          projectId: project.state.id,
          projectName: project.state.name,
          assetId: dir.name,
          fileName,
          width: Math.max(0, Number(metadata.width) || 0),
          height: Math.max(0, Number(metadata.height) || 0),
          mediaType: metadata.mediaKind === "video" ? "video" : "image",
          metadata,
          catalog,
        }),
      );
    }
  }
  return documents;
}

export async function updateCatalogFields(
  kind: CatalogPersistenceKind,
  accountId: string,
  refs: readonly CatalogMediaRef[],
  patch: Partial<Pick<MediaCatalogFields, "rating" | "flag" | "keywords">>,
): Promise<{ updated: CatalogMediaRef[]; missing: CatalogMediaRef[] }> {
  const updated: CatalogMediaRef[] = [];
  const missing: CatalogMediaRef[] = [];
  for (const ref of refs) {
    if (kind === "indexeddb") {
      const media = await indexedDbStore.getMedia(ref.assetId);
      if (!media || media.projectId !== ref.projectId) {
        missing.push(ref);
        continue;
      }
      if (media.catalogAccountId && media.catalogAccountId !== accountId) {
        missing.push(ref);
        continue;
      }
      const current = normalizeCatalogFields(media.catalog, {
        fileName: media.fileName,
        size: media.sizeBytes,
        timestamp: media.createdAt,
      });
      await indexedDbStore.putMedia({
        ...media,
        catalog: patchCatalogFields(current, patch),
        catalogAccountId: accountId,
      });
      updated.push(ref);
      continue;
    }
    const dir = await getProjectMediaDirectory(ref.projectId, ref.assetId);
    if (!dir) {
      missing.push(ref);
      continue;
    }
    const metadata = await dir
      .getFileAsParsedJSON<Record<string, unknown>>("metadata.json")
      .catch((): Record<string, unknown> => ({}));
    const fileName =
      (typeof metadata.name === "string" && metadata.name) ||
      (typeof metadata.originalName === "string" && metadata.originalName) ||
      ref.assetId;
    const current = normalizeCatalogFields(metadata.catalog, { fileName });
    await dir.saveFile("metadata.json", {
      ...metadata,
      catalog: patchCatalogFields(current, patch),
    });
    updated.push(ref);
  }
  // Keep the derived index coherent. Rebuilding is intentionally cheap JSON-only
  // work and also self-heals stale/corrupt index records.
  await rebuildCatalogIndex(accountId, await listCatalogDocuments(kind, accountId));
  return { updated, missing };
}

async function readOpfsCollections(accountId: string): Promise<CollectionRecord[]> {
  const root = await openRootDirectory();
  const catalogDir = await root.getDirectory("catalog", true);
  const records = await catalogDir
    ?.getFileAsParsedJSON<CollectionRecord[]>("collections.json")
    .catch(() => []);
  return (records ?? []).filter((record) => record.accountId === accountId);
}

async function writeOpfsCollections(records: CollectionRecord[]): Promise<void> {
  const root = await openRootDirectory();
  const catalogDir = await root.getDirectory("catalog", true);
  await catalogDir?.saveFile("collections.json", records);
}

export function listCollections(
  kind: CatalogPersistenceKind,
  accountId: string,
): Promise<CollectionRecord[]> {
  return kind === "opfs"
    ? readOpfsCollections(accountId)
    : indexedDbStore.listCollections(accountId);
}

export async function saveCollection(
  kind: CatalogPersistenceKind,
  record: CollectionRecord,
): Promise<void> {
  if (kind === "indexeddb") return indexedDbStore.putCollection(record);
  const records = await readOpfsCollections(record.accountId);
  const index = records.findIndex((candidate) => candidate.id === record.id);
  if (index >= 0) records[index] = record;
  else records.push(record);
  await writeOpfsCollections(records);
}

export async function deleteCollectionRecord(
  kind: CatalogPersistenceKind,
  accountId: string,
  id: string,
): Promise<void> {
  if (kind === "indexeddb") return indexedDbStore.deleteCollection(accountId, id);
  const records = await readOpfsCollections(accountId);
  await writeOpfsCollections(records.filter((record) => record.id !== id));
}

export async function cleanupCollectionReferences(
  kind: CatalogPersistenceKind,
  accountId: string,
  removed: readonly CatalogMediaRef[],
): Promise<void> {
  const keys = new Set(removed.map((ref) => `${ref.projectId}:${ref.assetId}`));
  const collections = await listCollections(kind, accountId);
  for (const collection of collections) {
    if (collection.kind !== "manual") continue;
    const items = collection.items.filter((ref) => !keys.has(`${ref.projectId}:${ref.assetId}`));
    if (items.length !== collection.items.length) {
      await saveCollection(kind, { ...collection, items, updatedAt: Date.now() });
    }
  }
}

export function hydrateVisibleMediaThumbnail(assetId: string): Promise<Blob | undefined> {
  return getMediaThumbnail(assetId);
}

async function getMediaPayloadDirectory(dir: ProjectDirectory): Promise<ProjectDirectory> {
  const pointer = await dir
    .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
    .catch(() => undefined);
  if (!pointer?.sourceId) return dir;
  const projectDir = await dir.getAncestorDirectory(2);
  const sourcesDir = await projectDir?.getDirectory("sources", false).catch(() => undefined);
  const sourceDir = await sourcesDir?.getDirectory(pointer.sourceId, false).catch(() => undefined);
  if (!sourceDir) throw new Error(`Shared source ${pointer.sourceId} is unavailable.`);
  return sourceDir;
}

async function getProjectMediaDirectory(
  projectId: string,
  assetId: string,
): Promise<ProjectDirectory | undefined> {
  const project = await loadProjectContext(projectId).catch(() => undefined);
  return project?.userMediaDirectory.getDirectory(assetId, false).catch(() => undefined);
}

export async function generateSmartPreview(
  kind: CatalogPersistenceKind,
  projectId: string,
  assetId: string,
  policy: SmartPreviewPolicy,
): Promise<Blob | undefined> {
  if (kind === "indexeddb") {
    const media = await indexedDbStore.getMedia(assetId);
    if (!media || media.projectId !== projectId) return undefined;
    if (media.smartPreviewId) await indexedDbStore.deleteSmartPreview(media.smartPreviewId);
    if (policy === "off") {
      await indexedDbStore.putMedia({ ...media, smartPreviewId: undefined, smartPreviewPolicy: "off" });
      return undefined;
    }
    const source = media.sourceId ? await indexedDbStore.getMediaSource(media.sourceId) : undefined;
    const image = await indexedDbStore.getImageRecord(source?.imageId ?? media.imageId);
    if (!image) return undefined;
    const input = image.blob ?? (image.buffer
      ? new ImageData(new Uint8ClampedArray(image.buffer), image.width ?? media.width, image.height ?? media.height)
      : undefined);
    if (!input) return undefined;
    const preview = await createImageDerivative(input, {
      maxLongEdge: policy,
      mimeType: "image/jpeg",
      quality: 0.86,
    });
    const id = `${source?.sourceId ?? media.assetId}:smart-${policy}`;
    await indexedDbStore.putSmartPreview(id, preview);
    await indexedDbStore.putMedia({ ...media, smartPreviewId: id, smartPreviewPolicy: policy });
    if (source) await indexedDbStore.putMediaSource({ ...source, smartPreviewId: id, smartPreviewPolicy: policy });
    return preview;
  }
  const dir = await getProjectMediaDirectory(projectId, assetId);
  if (!dir) return undefined;
  const payload = await getMediaPayloadDirectory(dir);
  if (policy === "off") {
    await payload.deleteEntry("smart-preview.jpeg").catch(() => {});
    await payload.saveFile("smart-preview.json", { policy: "off" });
    return undefined;
  }
  const resolved = await resolveImageSource(dir);
  const preview = await createImageDerivative(resolved.image, {
    maxLongEdge: policy,
    mimeType: "image/jpeg",
    quality: 0.86,
  });
  await payload.saveFiles({
    "smart-preview.jpeg": preview,
    "smart-preview.json": { policy, colorSpace: "sRGB", generatedAt: Date.now() },
  });
  return preview;
}

export async function getSmartPreview(
  kind: CatalogPersistenceKind,
  projectId: string,
  assetId: string,
): Promise<Blob | undefined> {
  if (kind === "indexeddb") {
    const media = await indexedDbStore.getMedia(assetId);
    return media?.smartPreviewId ? indexedDbStore.getSmartPreview(media.smartPreviewId) : undefined;
  }
  const dir = await getProjectMediaDirectory(projectId, assetId);
  const payload = dir ? await getMediaPayloadDirectory(dir).catch(() => undefined) : undefined;
  const preview = await payload?.getFile("smart-preview.jpeg").catch(() => undefined);
  return preview instanceof Blob ? preview : undefined;
}

export async function getProjectCacheUsage(
  kind: CatalogPersistenceKind,
  projectId: string,
): Promise<ManagedCacheUsage> {
  const usage: ManagedCacheUsage = { sourceBytes: 0, smartPreviewBytes: 0, thumbnailBytes: 0, runtimeBytes: 0 };
  if (kind === "indexeddb") {
    const media = await indexedDbStore.listMediaByProject(projectId);
    const sourceIds = new Set<string>();
    for (const item of media) {
      const key = item.sourceId ?? item.assetId;
      if (!sourceIds.has(key)) { usage.sourceBytes += item.sizeBytes; sourceIds.add(key); }
      const thumb = await indexedDbStore.getThumbnail(item.thumbnailId);
      usage.thumbnailBytes += thumb?.size ?? 0;
      const preview = item.smartPreviewId ? await indexedDbStore.getSmartPreview(item.smartPreviewId) : undefined;
      usage.smartPreviewBytes += preview?.size ?? 0;
    }
    return usage;
  }
  const project = await loadProjectContext(projectId);
  const dirs = await project.userMediaDirectory.getAllDirectories(false);
  const visited = new Set<string>();
  for (const dir of dirs) {
    const payload = await getMediaPayloadDirectory(dir).catch(() => dir);
    if (visited.has(payload.path)) continue;
    visited.add(payload.path);
    const files = (await payload.getAllFiles(true)).filter((file): file is Blob => file instanceof Blob);
    for (const file of files) {
      const name = file instanceof File ? file.name : "";
      if (name === "smart-preview.jpeg") usage.smartPreviewBytes += file.size;
      else if (name === "thumbnail.jpeg") usage.thumbnailBytes += file.size;
      else if (name.startsWith("image")) usage.sourceBytes += file.size;
    }
  }
  return usage;
}

export async function hydrateProjectMediaThumbnail(
  projectId: string,
  assetId: string,
): Promise<Blob | undefined> {
  const dir = await getProjectMediaDirectory(projectId, assetId);
  const payloadDir = dir ? await getMediaPayloadDirectory(dir).catch(() => dir) : undefined;
  const file = await payloadDir?.getFile("thumbnail.jpeg").catch(() => undefined);
  return file instanceof Blob ? file : undefined;
}

// async function imageDataFileToPngBlob(
//   file: File | Blob | string,
//   metadata: Record<string, unknown>,
// ): Promise<Blob | undefined> {
//   if (!(file instanceof Blob)) return undefined;
//   const width = Math.max(1, Math.round(Number(metadata.width)));
//   const height = Math.max(1, Math.round(Number(metadata.height)));
//   if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
//
//   const imageData = new ImageData(new Uint8ClampedArray(await file.arrayBuffer()), width, height);
//   const canvas =
//     typeof OffscreenCanvas !== "undefined"
//       ? new OffscreenCanvas(width, height)
//       : Object.assign(document.createElement("canvas"), { width, height });
//   const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
//   if (!ctx) return undefined;
//   ctx.putImageData(imageData, 0, 0);
//   if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
//   return new Promise<Blob | undefined>((resolve) => {
//     canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
//   });
// }

export async function getProjectMediaPreview(
  projectId: string,
  assetId: string,
): Promise<Blob | undefined> {
  const dir = await getProjectMediaDirectory(projectId, assetId);
  if (!dir) return undefined;
  const payloadDir = await getMediaPayloadDirectory(dir).catch(() => dir);
  const previewFile = await payloadDir.getFile("gallery-preview.jpeg").catch(() => undefined);
  if (previewFile instanceof Blob) return previewFile;
  const thumbnailFile = await payloadDir.getFile("thumbnail.jpeg").catch(() => undefined);
  const handle = (await payloadDir.findFile(isActiveImageFile as never, false).catch(() => undefined)) as
    | { name?: string; getFile?: () => Promise<File | Blob | string> }
    | undefined;
  const file = await handle?.getFile?.().catch(() => undefined);
  if (file instanceof Blob && handle?.name) {
    let source: Blob | ImageData = file;
    if (handle.name.endsWith(".data")) {
      const metadata = await readMetadata(payloadDir);
      const width = Math.round(Number(metadata.width));
      const height = Math.round(Number(metadata.height));
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        source = new ImageData(new Uint8ClampedArray(await file.arrayBuffer()), width, height);
      } else {
        return thumbnailFile instanceof Blob ? thumbnailFile : undefined;
      }
    }
    const generated = await createImageDerivative(source, {
      maxLongEdge: GALLERY_PREVIEW_LONG_EDGE,
      mimeType: "image/jpeg",
      quality: GALLERY_PREVIEW_JPEG_QUALITY,
    }).catch(() => undefined);
    if (generated) {
      await payloadDir.saveFiles({ "gallery-preview.jpeg": generated }).catch(() => {});
      return generated;
    }
  }
  return thumbnailFile instanceof Blob ? thumbnailFile : undefined;
}

export async function createAndActivateProject(name: string): Promise<ProjectContext> {
  return setActiveProject(await createProject(name));
}

export async function renameProjectById(id: string, name: string): Promise<void> {
  const project = await loadProjectContext(id);
  await renameProject(project, name);
}

export async function openProject(id: string): Promise<BootResult> {
  const project = await setActiveProject(await loadProjectContext(id));
  const media = await loadFirstReadableMedia(project, true);
  return { project, media };
}

export async function deleteProjectById(id: string): Promise<BootResult> {
  const project = await loadProjectContext(id);
  const result = await deleteProject(project);
  if (result.kind === "switched") {
    const media = await loadFirstReadableMedia(result.activeProject, true);
    return { project: result.activeProject, media };
  }
  const active = getActiveProject() ?? (await bootProject());
  const media = await loadFirstReadableMedia(active, true);
  return { project: active, media };
}

type OpfsSharedSource = MediaSourceRecord & { imageName: string };

function newStorageId(prefix: string): string {
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

async function ensureUniqueMediaDirectoryName(
  project: ProjectContext,
  requested: string,
): Promise<string> {
  const safe = requested.trim().replace(/[\\/]/g, "_") || "Virtual Copy";
  if (!(await project.userMediaDirectory.hasDirectory(safe))) return safe;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${safe} ${index}`;
    if (!(await project.userMediaDirectory.hasDirectory(candidate))) return candidate;
  }
  return `${safe} ${newStorageId("copy")}`;
}

async function ensureOpfsSharedSource(
  project: ProjectContext,
  mediaDir: ProjectDirectory,
): Promise<{ sourceDir: ProjectDirectory; source: OpfsSharedSource }> {
  const existingPointer = await mediaDir
    .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
    .catch(() => undefined);
  const sourcesDir = (await project.rootDirectory.getDirectory("sources", true))!;
  if (existingPointer?.sourceId) {
    const sourceDir = await sourcesDir.getDirectory(existingPointer.sourceId, false);
    const source = await sourceDir?.getFileAsParsedJSON<OpfsSharedSource>("source.json");
    if (sourceDir && source) return { sourceDir, source };
    throw new Error(`Shared source ${existingPointer.sourceId} is incomplete.`);
  }

  const metadata = await readMetadata(mediaDir);
  const imageHandle = (await mediaDir.findFile(isActiveImageFile as never, false)) as
    | { name: string; getFile(): Promise<File | Blob | string> }
    | undefined;
  if (!imageHandle) throw new Error("Source image is missing.");
  const image = await imageHandle.getFile();
  const thumbnail = await mediaDir.getFile("thumbnail.jpeg").catch(() => undefined);
  const preview = await mediaDir.getFile("gallery-preview.jpeg").catch(() => undefined);
  const sourceId = newStorageId("source");
  const sourceDir = (await sourcesDir.getDirectory(sourceId, true))!;
  const now = Date.now();
  const source: OpfsSharedSource = {
    sourceId,
    projectId: project.state.id,
    imageId: imageHandle.name,
    imageName: imageHandle.name,
    thumbnailId: "thumbnail.jpeg",
    galleryPreviewId: preview instanceof Blob ? "gallery-preview.jpeg" : undefined,
    storage: metadata.storage === "data" ? "data" : metadata.storage === "developed" ? "developed" : "original",
    mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream",
    format: typeof metadata.format === "string" ? metadata.format : undefined,
    width: Math.max(0, Number(metadata.width) || 0),
    height: Math.max(0, Number(metadata.height) || 0),
    sizeBytes: image instanceof Blob ? image.size : typeof image === "string" ? image.length : 0,
    captureMetadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
    primaryAssetId: mediaDir.name,
    refCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  const files: Record<string, unknown> = {
    [imageHandle.name]: image,
    "metadata.json": metadata,
    "source.json": source,
  };
  if (thumbnail instanceof Blob) files["thumbnail.jpeg"] = thumbnail;
  if (preview instanceof Blob) files["gallery-preview.jpeg"] = preview;
  await sourceDir.saveFiles(files);

  // Verify copied pixels before committing the pointer.
  const verified = await sourceDir.getFile(imageHandle.name).catch(() => undefined);
  if (!verified || (verified instanceof Blob && image instanceof Blob && verified.size !== image.size)) {
    await sourceDir.delete();
    throw new Error("Unable to verify shared source storage.");
  }
  await mediaDir.saveFiles({
    "source-pointer.json": { sourceId },
    "metadata.json": {
      ...metadata,
      sourceId,
      variantKind: "original",
      variantName:
        typeof metadata.variantName === "string"
          ? metadata.variantName
          : typeof metadata.name === "string"
            ? metadata.name
            : mediaDir.name,
      isPrimary: true,
    },
  });
  await deleteActiveImageFiles(mediaDir);
  await mediaDir.deleteEntry("thumbnail.jpeg").catch(() => {});
  await mediaDir.deleteEntry("gallery-preview.jpeg").catch(() => {});
  return { sourceDir, source };
}

export async function createVirtualCopyByName(
  assetId: string,
  requestedName?: string,
): Promise<string> {
  const project = getActiveProject();
  if (!project) throw new Error("No active project.");
  const mediaDir = await project.userMediaDirectory.getDirectory(assetId, false);
  if (!mediaDir) throw new Error("Media not found.");
  const { sourceDir, source } = await ensureOpfsSharedSource(project, mediaDir);
  const sourceMetadata = await readMetadata(mediaDir);
  const defaultName = `${
    typeof sourceMetadata.variantName === "string"
      ? sourceMetadata.variantName
      : typeof sourceMetadata.name === "string"
        ? sourceMetadata.name
        : assetId
  } Copy`;
  const name = requestedName?.trim() || defaultName;
  const copyId = await ensureUniqueMediaDirectoryName(project, name);
  const copyDir = (await project.userMediaDirectory.getDirectory(copyId, true))!;
  const state = await readMediaState(mediaDir);
  const now = Date.now();
  const copyFiles: Record<string, unknown> = {
    "source-pointer.json": { sourceId: source.sourceId },
    "metadata.json": {
      ...sourceMetadata,
      name,
      sourceId: source.sourceId,
      variantKind: "virtual-copy",
      variantName: name,
      isPrimary: false,
      catalog:
        sourceMetadata.catalog && typeof sourceMetadata.catalog === "object"
          ? {
              ...(sourceMetadata.catalog as Record<string, unknown>),
              catalogUpdatedAt: now,
            }
          : undefined,
    },
    "state.json": JSON.parse(JSON.stringify(state)),
  };
  const mediaFiles = (await mediaDir.getAllFiles(false)) as Array<{
    name: string;
    getFile(): Promise<File | Blob | string>;
  }>;
  for (const file of mediaFiles) {
    if (file.name.startsWith("overlay-")) copyFiles[file.name] = await file.getFile();
  }
  await copyDir.saveFiles(copyFiles);
  await sourceDir.saveFile("source.json", {
    ...source,
    refCount: source.refCount + 1,
    updatedAt: now,
  });
  return copyId;
}

export async function renameMediaVariantByName(assetId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const dir = await getMediaDirectoryByName(assetId);
  const metadata = await readMetadata(dir);
  await dir.saveFile("metadata.json", { ...metadata, name: trimmed, variantName: trimmed });
}

export async function setPrimaryMediaVariantByName(assetId: string): Promise<void> {
  const project = getActiveProject();
  if (!project) return;
  const target = await project.userMediaDirectory.getDirectory(assetId, false);
  if (!target) return;
  const pointer = await target
    .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
    .catch(() => undefined);
  if (!pointer?.sourceId) return;
  const dirs = await project.userMediaDirectory.getAllDirectories(false);
  for (const dir of dirs) {
    const candidate = await dir
      .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
      .catch(() => undefined);
    if (candidate?.sourceId !== pointer.sourceId) continue;
    const metadata = await readMetadata(dir);
    await dir.saveFile("metadata.json", { ...metadata, isPrimary: dir.name === assetId });
  }
  const sourcesDir = await project.rootDirectory.getDirectory("sources", false);
  const sourceDir = await sourcesDir?.getDirectory(pointer.sourceId, false);
  const source = await sourceDir?.getFileAsParsedJSON<OpfsSharedSource>("source.json");
  if (sourceDir && source) {
    await sourceDir.saveFile("source.json", {
      ...source,
      primaryAssetId: assetId,
      updatedAt: Date.now(),
    });
  }
}

export async function importWatchedFile(
  kind: CatalogPersistenceKind,
  projectId: string,
  accountId: string,
  file: File,
): Promise<string> {
  if (!isSupportedImageFile(file)) throw new Error(`Unsupported watched file: ${file.name}`);
  if (kind === "opfs") {
    const project = await loadProjectContext(projectId);
    if (!project) throw new Error("The watched folder's target project no longer exists.");
    return (await importMedia(file, project.userMediaDirectory)).name;
  }

  const project = await indexedDbStore.getProjectRecord(projectId);
  if (!project) throw new Error("The watched folder's target project no longer exists.");
  const decoded = await decodeImportFile(file);
  const [thumbnail, galleryPreview] = await createImageDerivatives(decoded.thumbnailSource, [
    { maxLongEdge: 256, mimeType: "image/jpeg", quality: 0.7 },
    { maxLongEdge: GALLERY_PREVIEW_LONG_EDGE, mimeType: "image/jpeg", quality: GALLERY_PREVIEW_JPEG_QUALITY },
  ]);
  const width = Number(decoded.metadata.width) || decoded.imageData?.width || 0;
  const height = Number(decoded.metadata.height) || decoded.imageData?.height || 0;
  const media = await indexedDbMedia.addMedia(projectId, {
    fileName: String(decoded.metadata.name ?? file.name),
    mimeType: String(decoded.metadata.mimeType ?? file.type ?? "image/png"),
    format: detectImageFormat(file) ?? undefined,
    width,
    height,
    sourceSize: file.size,
    sourceLastModified: file.lastModified,
    catalogAccountId: accountId,
    editState: DEFAULT_EDIT_STATE,
    storage: decoded.kind === "image-data" ? "data" : "original",
    metadata: decoded.metadata,
    blob: decoded.imageBlob,
    buffer: decoded.imageData?.data.buffer,
    thumbnail: thumbnail ?? undefined,
    galleryPreview: galleryPreview ?? undefined,
  }, { activate: false });
  return media.assetId;
}

/** Import a file into active `user-media` without mutating the loaded/active media context. */
export async function importToOpfs(
  file: File,
  options: MediaImportOptions = {},
): Promise<ProjectDirectory> {
  const project = getActiveProject();
  if (!project) throw new Error("[storageBridge] no active project");
  return importMedia(file, project.userMediaDirectory, options);
}

/** Switch the active media by its directory name (media-strip select). */
export async function switchMedia(dirName: string, force = false): Promise<MediaContext | null> {
  const project = getActiveProject();
  if (!project) return null;
  const dir = await project.userMediaDirectory.getDirectory(dirName, false).catch(() => undefined);
  return dir ? loadMedia(dir, force) : null;
}

/** Persist the active media's edit state (autosave target — only current media). */
async function getMediaDirectoryByName(name: string): Promise<ProjectDirectory> {
  const project = getActiveProject();
  if (!project) throw new Error("[storageBridge] no active project");
  const dir = await project.userMediaDirectory.getDirectory(name, false).catch(() => undefined);
  if (!dir) throw new Error(`[storageBridge] media not found: ${name}`);
  return dir;
}

export async function getMediaThumbnail(assetId: string): Promise<Blob | undefined> {
  const dir = await getMediaDirectoryByName(assetId).catch(() => undefined);
  if (!dir) return undefined;
  const payloadDir = await getMediaPayloadDirectory(dir).catch(() => dir);
  const file = await payloadDir.getFile("thumbnail.jpeg").catch(() => undefined);
  return file instanceof Blob ? file : undefined;
}

/** Resolves the original media payload without falling back to its thumbnail. */
export async function getMediaImageSource(assetId: string) {
  return resolveImageSource(await getMediaDirectoryByName(assetId));
}

export async function readMediaStateByName(name: string): Promise<SerializedEditState> {
  return readMediaState(await getMediaDirectoryByName(name));
}

export async function applyStateToMediaByName(
  name: string,
  state: Partial<SerializedEditState>,
): Promise<SerializedEditState> {
  return applyStateToMedia(await getMediaDirectoryByName(name), state);
}

export async function resetMediaStateByName(name: string): Promise<SerializedEditState> {
  return resetMediaState(await getMediaDirectoryByName(name));
}

export async function readMediaMetadataByName(name: string): Promise<Record<string, unknown>> {
  const dir = await getMediaDirectoryByName(name);
  return dir.getFileAsParsedJSON<Record<string, unknown>>("metadata.json").catch(() => ({}));
}

export async function readMediaMainImageName(name: string): Promise<string | undefined> {
  const dir = await getMediaDirectoryByName(name);
  const handle = await dir
    .findFile(
      (entry) => {
        const name = typeof entry === "string" ? entry : (entry as { name?: string }).name;
        return typeof name === "string" && name.startsWith("image") && name !== "thumbnail.jpeg";
      },
      false,
    )
    .catch(() => undefined);
  return handle && typeof (handle as { name?: unknown }).name === "string"
    ? ((handle as { name: string }).name)
    : undefined;
}

export async function autosaveActiveState(state: SerializedEditState): Promise<void> {
  const media = getCurrentMedia();
  if (media) await writeMediaState(media.rootDirectory, state);
}

/** Persist a named media item without depending on which item is currently active. */
export async function autosaveMediaState(
  assetId: string,
  state: SerializedEditState,
): Promise<void> {
  await writeMediaState(await getMediaDirectoryByName(assetId), state);
}

/** Persist video trim beside media metadata without disturbing the source or grade. */
export async function autosaveActiveVideoState(state: SerializedVideoState): Promise<void> {
  const media = getCurrentMedia();
  if (!media) return;
  const metadata = await media.rootDirectory
    .getFileAsParsedJSON<Record<string, unknown>>("metadata.json")
    .catch(() => ({}) as Record<string, unknown>);
  const next = {
    ...metadata,
    width: Number(metadata.width ?? media.metadata.width ?? 0),
    height: Number(metadata.height ?? media.metadata.height ?? 0),
    mediaKind: "video",
    videoState: state,
  };
  await media.rootDirectory.saveFile("metadata.json", next);
  media.metadata = next;
}

// ── Crop & Rotate baked-image writes (legacy transform Done) ────────────────
type CropPersistEditState = EditState | SerializedEditState;
type CropViewport = { zoom: number; panX: number; panY: number };
type CropOriginalMetadata = {
  activeImageName: string;
  originalImageName: string;
  metadata: Record<string, unknown>;
};

function cloneSerializedEditState(state: CropPersistEditState): SerializedEditState {
  return JSON.parse(JSON.stringify(state)) as SerializedEditState;
}

function isActiveImageFile(entry: { name: string }): boolean {
  return entry.name.startsWith("image");
}

function isOriginalImageFile(entry: { name: string }): boolean {
  return (
    entry.name.startsWith("original") &&
    entry.name !== "original-metadata.json" &&
    entry.name !== "original-thumbnail.jpeg" &&
    entry.name !== "original-gallery-preview.jpeg"
  );
}

function activeNameForOriginal(originalName: string): string {
  return originalName.startsWith("original")
    ? `image${originalName.slice("original".length)}`
    : "image.data";
}

async function blobToImageDataBuffer(blob: Blob): Promise<CropSourceData> {
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
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

async function cropSourceDataFromFile(
  file: File | Blob | string,
  imageName: string,
  metadata: Record<string, unknown>,
): Promise<CropSourceData | null> {
  if (!(file instanceof Blob)) return null;
  if (imageName.endsWith(".data")) {
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      return null;
    return {
      buffer: await file.arrayBuffer(),
      width: Math.round(width),
      height: Math.round(height),
      token: Date.now(),
    };
  }
  return blobToImageDataBuffer(file);
}

async function getActiveMediaDirectory(): Promise<ProjectDirectory> {
  const media = getCurrentMedia();
  if (media) return media.rootDirectory;
  const project = getActiveProject();
  if (!project?.state.activeUserMedia) throw new Error("[storageBridge] no active media");
  const dir = await project.userMediaDirectory
    .getDirectory(project.state.activeUserMedia, false)
    .catch(() => undefined);
  if (!dir) throw new Error("[storageBridge] active media directory not found");
  return dir;
}

async function readMetadata(dir: ProjectDirectory): Promise<Record<string, unknown>> {
  return dir.getFileAsParsedJSON<Record<string, unknown>>("metadata.json").catch(() => ({}));
}

async function deleteActiveImageFiles(dir: ProjectDirectory): Promise<void> {
  const files = (await dir.getAllFiles(false)) as Array<{ name: string }>;
  for (const file of files) {
    if (isActiveImageFile(file)) {
      await dir.deleteEntry(file.name).catch(() => {});
    }
  }
}

async function deleteOriginalBackupFiles(dir: ProjectDirectory): Promise<void> {
  const files = (await dir.getAllFiles(false)) as Array<{ name: string }>;
  for (const file of files) {
    if (
      isOriginalImageFile(file) ||
      file.name === "original-metadata.json" ||
      file.name === "original-thumbnail.jpeg" ||
      file.name === "original-gallery-preview.jpeg"
    ) {
      await dir.deleteEntry(file.name).catch(() => {});
    }
  }
}

async function detachOpfsVariantForWrite(dir: ProjectDirectory): Promise<void> {
  const pointer = await dir
    .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
    .catch(() => undefined);
  if (!pointer?.sourceId) return;
  const projectDir = await dir.getAncestorDirectory(2);
  const userMediaDir = await projectDir?.getDirectory("user-media", false);
  const sourcesDir = await projectDir?.getDirectory("sources", false);
  const sourceDir = await sourcesDir?.getDirectory(pointer.sourceId, false);
  const source = await sourceDir?.getFileAsParsedJSON<OpfsSharedSource>("source.json");
  if (!projectDir || !userMediaDir || !sourceDir || !source) {
    throw new Error(`Shared source ${pointer.sourceId} is unavailable.`);
  }
  const siblings = await userMediaDir.getAllDirectories(false);
  const remaining: ProjectDirectory[] = [];
  for (const sibling of siblings) {
    if (sibling.path === dir.path) continue;
    const candidate = await sibling
      .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
      .catch(() => undefined);
    if (candidate?.sourceId === pointer.sourceId) remaining.push(sibling);
  }
  const image = await sourceDir.getFile(source.imageName);
  const thumbnail = await sourceDir.getFile("thumbnail.jpeg").catch(() => undefined);
  const preview = await sourceDir.getFile("gallery-preview.jpeg").catch(() => undefined);
  const metadata = await readMetadata(dir);
  const files: Record<string, unknown> = {
    [source.imageName]: image,
    "metadata.json": { ...metadata, sourceId: undefined, isPrimary: true },
  };
  if (thumbnail instanceof Blob) files["thumbnail.jpeg"] = thumbnail;
  if (preview instanceof Blob) files["gallery-preview.jpeg"] = preview;
  await dir.saveFiles(files);
  if (!(await dir.hasFile(source.imageName))) throw new Error("Unable to detach shared source.");
  await dir.deleteEntry("source-pointer.json");

  if (remaining.length === 0) {
    await sourceDir.delete();
  } else {
    const nextPrimary =
      source.primaryAssetId === dir.name ? remaining[0].name : source.primaryAssetId;
    await sourceDir.saveFile("source.json", {
      ...source,
      primaryAssetId: nextPrimary,
      refCount: remaining.length,
      updatedAt: Date.now(),
    });
    if (source.primaryAssetId === dir.name) {
      for (const sibling of remaining) {
        const siblingMetadata = await readMetadata(sibling);
        await sibling.saveFile("metadata.json", {
          ...siblingMetadata,
          isPrimary: sibling.name === nextPrimary,
        });
      }
    }
  }
}

async function preserveOriginalForCrop(dir: ProjectDirectory): Promise<void> {
  await detachOpfsVariantForWrite(dir);
  if (await dir.hasFile("original-metadata.json")) return;

  const current = getCurrentMedia();
  const activeImageName =
    current?.rootDirectory.path === dir.path
      ? current.mainPreviewSourceName
      : ((await dir.findFile(isActiveImageFile as never, false)) as { name: string } | undefined)
          ?.name;
  if (!activeImageName) throw new Error(`[storageBridge] no active image file in ${dir.name}`);

  const activeImage = await dir.getFile(activeImageName);
  const originalImageName = activeImageName.replace(/^image/, "original");
  const metadata = await readMetadata(dir);
  const files: Record<string, unknown> = {
    [originalImageName]: activeImage,
    "original-metadata.json": {
      activeImageName,
      originalImageName,
      metadata,
    } satisfies CropOriginalMetadata,
  };

  const thumbnail = await dir.getFile("thumbnail.jpeg").catch(() => undefined);
  if (thumbnail instanceof Blob) files["original-thumbnail.jpeg"] = thumbnail;
  const galleryPreview = await dir.getFile("gallery-preview.jpeg").catch(() => undefined);
  if (galleryPreview instanceof Blob) files["original-gallery-preview.jpeg"] = galleryPreview;
  await dir.saveFiles(files);
}

async function loadOriginalBackup(dir: ProjectDirectory): Promise<{
  imageName: string;
  image: File | Blob | string;
  metadata: Record<string, unknown>;
  thumbnail?: Blob;
  galleryPreview?: Blob;
} | null> {
  const backup = await dir
    .getFileAsParsedJSON<CropOriginalMetadata>("original-metadata.json")
    .catch(() => null);
  if (!backup) return null;

  const originalName =
    backup.originalImageName ||
    ((await dir.findFile(isOriginalImageFile as never, false)) as { name: string } | undefined)
      ?.name;
  if (!originalName) return null;

  const image = (await dir.getFile(originalName).catch(() => undefined)) as
    | File
    | Blob
    | string
    | undefined;
  if (!image) return null;

  const thumb = await dir.getFile("original-thumbnail.jpeg").catch(() => undefined);
  const galleryPreview = await dir.getFile("original-gallery-preview.jpeg").catch(() => undefined);
  return {
    imageName: backup.activeImageName || activeNameForOriginal(originalName),
    image,
    metadata: backup.metadata ?? {},
    thumbnail: thumb instanceof Blob ? thumb : undefined,
    galleryPreview: galleryPreview instanceof Blob ? galleryPreview : undefined,
  };
}

export async function loadActiveOriginalCropSourceData(): Promise<CropSourceData | null> {
  const dir = await getActiveMediaDirectory();
  const original = await loadOriginalBackup(dir);
  return original
    ? cropSourceDataFromFile(original.image, original.imageName, original.metadata)
    : null;
}

function bakedCropMetadata(
  previous: Record<string, unknown>,
  width: number,
  height: number,
  storage: "png" | "data",
): Record<string, unknown> {
  return {
    ...previous,
    width,
    height,
    name: typeof previous.name === "string" && previous.name ? previous.name : "image.png",
    type: storage === "png" ? "image/png" : "image/rgba",
    mimeType: storage === "png" ? "image/png" : "image/rgba",
    format: storage === "png" ? "png" : "cached-rgba",
    storage: storage === "png" ? "developed" : "data",
    orientation: 1,
  };
}

export async function replaceActiveMediaImageWithData(params: {
  width: number;
  height: number;
  buffer: ArrayBuffer;
  /** Legacy transform apply writes image.png from OffscreenCanvas.convertToBlob(). */
  blob?: Blob;
  thumbnail?: Blob;
  galleryPreview?: Blob;
  editState: CropPersistEditState;
  viewport?: CropViewport;
}): Promise<MediaContext | null> {
  const dir = await getActiveMediaDirectory();
  const width = Math.max(1, Math.round(params.width));
  const height = Math.max(1, Math.round(params.height));
  const editState = cloneSerializedEditState(params.editState);

  await preserveOriginalForCrop(dir);
  const previousMetadata = await readMetadata(dir);
  await deleteActiveImageFiles(dir);

  const storage = params.blob ? "png" : "data";
  const files: Record<string, unknown> = {
    [params.blob ? "image.png" : "image.data"]: params.blob ?? params.buffer,
    "metadata.json": bakedCropMetadata(previousMetadata, width, height, storage),
    "state.json": editState,
  };
  if (params.thumbnail) files["thumbnail.jpeg"] = params.thumbnail;
  if (params.galleryPreview) files["gallery-preview.jpeg"] = params.galleryPreview;
  await dir.saveFiles(files);

  return loadMedia(dir, true);
}

export async function restoreActiveOriginalMediaImage(params: {
  editState: CropPersistEditState;
  viewport?: CropViewport;
}): Promise<MediaContext | null> {
  const dir = await getActiveMediaDirectory();
  const editState = cloneSerializedEditState(params.editState);
  const original = await loadOriginalBackup(dir);

  if (!original) {
    await writeMediaState(dir, editState);
    return loadMedia(dir, true);
  }

  await deleteActiveImageFiles(dir);
  const files: Record<string, unknown> = {
    [original.imageName]: original.image,
    "metadata.json": original.metadata,
    "state.json": editState,
  };
  if (original.thumbnail) files["thumbnail.jpeg"] = original.thumbnail;
  if (original.galleryPreview) {
    files["gallery-preview.jpeg"] = original.galleryPreview;
  } else {
    await dir.deleteEntry("gallery-preview.jpeg").catch(() => {});
  }
  await dir.saveFiles(files);
  await deleteOriginalBackupFiles(dir);

  return loadMedia(dir, true);
}

/** The active project's media directory names (ordered), for the media strip/list. */
export async function listMediaNames(): Promise<string[]> {
  const project = getActiveProject();
  if (!project) return [];
  return (await project.userMediaDirectory.getAllDirectories(false)).map((dir) => dir.name);
}

/**
 * Delete the active media; select the adjacent one if present (req 14). Returns the
 * newly-loaded media, or null when none remain.
 */
async function deleteOpfsVariantDirectory(
  project: ProjectContext,
  dir: ProjectDirectory,
): Promise<void> {
  const pointer = await dir
    .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
    .catch(() => undefined);
  if (pointer?.sourceId) {
    const siblings = await project.userMediaDirectory.getAllDirectories(false);
    const remaining: ProjectDirectory[] = [];
    for (const sibling of siblings) {
      if (sibling.path === dir.path) continue;
      const candidate = await sibling
        .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
        .catch(() => undefined);
      if (candidate?.sourceId === pointer.sourceId) remaining.push(sibling);
    }
    const sourcesDir = await project.rootDirectory.getDirectory("sources", false);
    const sourceDir = await sourcesDir?.getDirectory(pointer.sourceId, false);
    const source = await sourceDir?.getFileAsParsedJSON<OpfsSharedSource>("source.json");
    if (sourceDir && source) {
      if (remaining.length === 0) {
        await sourceDir.delete();
      } else {
        const primaryAssetId =
          source.primaryAssetId === dir.name ? remaining[0].name : source.primaryAssetId;
        await sourceDir.saveFile("source.json", {
          ...source,
          primaryAssetId,
          refCount: remaining.length,
          updatedAt: Date.now(),
        });
        if (source.primaryAssetId === dir.name) {
          for (const sibling of remaining) {
            const metadata = await readMetadata(sibling);
            await sibling.saveFile("metadata.json", {
              ...metadata,
              isPrimary: sibling.name === primaryAssetId,
            });
          }
        }
      }
    }
  }
  await dir.delete();
}

export async function deleteMediaVariantsByName(assetIds: readonly string[]): Promise<void> {
  const project = getActiveProject();
  if (!project) return;
  for (const assetId of assetIds) {
    const dir = await project.userMediaDirectory.getDirectory(assetId, false).catch(() => undefined);
    if (dir) await deleteOpfsVariantDirectory(project, dir);
  }
}

export async function deleteActiveMedia(): Promise<MediaContext | null> {
  const media = getCurrentMedia();
  const project = getActiveProject();
  if (!media || !project) return null;
  const adjacent = await media.rootDirectory.getAdjacentDirectory(false);
  await deleteOpfsVariantDirectory(project, media.rootDirectory);
  if (adjacent) {
    const next = await loadMedia(adjacent, true);
    return next;
  }
  clearCurrentMedia();
  await clearActiveUserMedia();
  return null;
}

/** Set the active media name on the project (after a successful load/draw). */
export function commitActiveMedia(name: string): Promise<void> {
  return setActiveUserMedia(name);
}

// ── snapshots (bound to the active media) ────────────────────────────────────
export function saveActiveSnapshot(
  name: string,
  state: SerializedEditState,
  videoState?: SerializedVideoState,
): Promise<Snapshot | null> {
  const media = getCurrentMedia();
  if (!media) return Promise.resolve(null);
  return saveSnapshot(media.rootDirectory, name, state, videoState);
}
export function listActiveSnapshots(): Promise<Snapshot[]> {
  const media = getCurrentMedia();
  return media ? readSnapshots(media.rootDirectory) : Promise.resolve([]);
}
export function readActiveSnapshotState(id: string): Promise<SerializedEditState> {
  const media = getCurrentMedia();
  if (!media) return Promise.reject(new Error("[storageBridge] no active media"));
  return readSnapshotState(media.rootDirectory, id);
}
export function deleteActiveSnapshot(id: string): Promise<void> {
  const media = getCurrentMedia();
  return media ? deleteSnapshot(media.rootDirectory, id) : Promise.resolve();
}
export function renameActiveSnapshot(id: string, name: string): Promise<void> {
  const media = getCurrentMedia();
  return media ? renameSnapshot(media.rootDirectory, id, name) : Promise.resolve();
}
export function updateActiveSnapshot(
  id: string,
  state: SerializedEditState,
  videoState?: SerializedVideoState,
): Promise<void> {
  const media = getCurrentMedia();
  return media
    ? updateSnapshotState(media.rootDirectory, id, state, videoState)
    : Promise.resolve();
}
export function clearActiveSnapshots(): Promise<void> {
  const media = getCurrentMedia();
  return media ? clearSnapshots(media.rootDirectory) : Promise.resolve();
}

export type HydratedSnapshot = Snapshot & { state: SerializedEditState };

/** Read snapshot index + edit-state payloads for a specific loaded media. */
export async function listSnapshotsForMedia(media: MediaContext): Promise<HydratedSnapshot[]> {
  const snapshots = await readSnapshots(media.rootDirectory);
  const hydrated: HydratedSnapshot[] = [];
  for (const snapshot of snapshots) {
    try {
      const state = await readSnapshotState(media.rootDirectory, snapshot.id);
      hydrated.push({ ...snapshot, state });
    } catch {
      // Ignore orphaned index entries whose version payload is missing/corrupt.
    }
  }
  return hydrated;
}

/** Bump + return a restore token (Viewer reloads cached RGBA only on a new token). */
export function nextRestoreToken(): number {
  return ++restoreToken;
}

export async function saveOverlayImage(id: string, file: File | Blob): Promise<void> {
  const dir = await getActiveMediaDirectory();
  await dir.saveFiles({ [`overlay-${id}.png`]: file });
}

export async function saveOverlayImageForMedia(
  mediaName: string,
  id: string,
  file: File | Blob,
): Promise<void> {
  const dir = await getMediaDirectoryByName(mediaName);
  await dir.saveFiles({ [`overlay-${id}.png`]: file });
}

export async function loadOverlayImage(id: string): Promise<Blob | undefined> {
  const dir = await getActiveMediaDirectory().catch(() => undefined);
  if (!dir) return undefined;
  const file = await dir.getFile(`overlay-${id}.png`).catch(() => undefined);
  return file instanceof Blob ? file : undefined;
}

export async function loadOverlayImageForMedia(
  mediaName: string,
  id: string,
): Promise<Blob | undefined> {
  const dir = await getMediaDirectoryByName(mediaName).catch(() => undefined);
  if (!dir) return undefined;
  const file = await dir.getFile(`overlay-${id}.png`).catch(() => undefined);
  return file instanceof Blob ? file : undefined;
}

export async function deleteOverlayImage(id: string): Promise<void> {
  const dir = await getActiveMediaDirectory().catch(() => undefined);
  if (!dir) return;
  await dir.deleteEntry(`overlay-${id}.png`).catch(() => {});
}
