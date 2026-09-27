import {
  SESSION_PROJECT_ID,
  type AppSession,
  type BatchEditJournal,
  type CollectionRecord,
  type MatchReferenceRecord,
  type MediaRecord,
  type MediaSourceRecord,
  type MediaSummary,
  type ProjectRecord,
  type SavedProject,
  type SavedProjectSummary,
  type StoredImageRecord,
  type WatchedFolderRecord,
  type OverlayLibraryItem,
} from "./ProjectTypes";

const DB_NAME = "poto-projects";
const DB_VERSION = 14;

// ── DB lifecycle ───────────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("images")) {
          db.createObjectStore("images", { keyPath: "id" });
        }
        // v2: per-project JPEG thumbnails (keyed by id — project id or, in v3, asset id).
        if (!db.objectStoreNames.contains("thumbnails")) {
          db.createObjectStore("thumbnails", { keyPath: "id" });
        }
        // v3: the legacy-style multi-asset model.
        if (!db.objectStoreNames.contains("appSession")) {
          db.createObjectStore("appSession", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("media")) {
          const media = db.createObjectStore("media", { keyPath: "assetId" });
          media.createIndex("byProject", "projectId", { unique: false });
        }
        // v3 ProjectRecords live in their own store so they coexist with any
        // leftover v2 SavedProject rows in "projects" during/after migration.
        if (!db.objectStoreNames.contains("projectRecords")) {
          db.createObjectStore("projectRecords", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("matchReferences")) {
          db.createObjectStore("matchReferences", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("galleryPreviews")) {
          db.createObjectStore("galleryPreviews", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("overlayImages")) {
          db.createObjectStore("overlayImages", { keyPath: "id" });
        }
        // v8: account-scoped canonical collection records. Catalog search itself
        // lives in a separate disposable/rebuildable IndexedDB database.
        if (!db.objectStoreNames.contains("catalogCollections")) {
          const collections = db.createObjectStore("catalogCollections", { keyPath: "storageKey" });
          collections.createIndex("byAccount", "accountId", { unique: false });
        }
        // v9: project-local shared pixel records for originals + virtual copies.
        if (!db.objectStoreNames.contains("mediaSources")) {
          const sources = db.createObjectStore("mediaSources", { keyPath: "sourceId" });
          sources.createIndex("byProject", "projectId", { unique: false });
        }
        // v10: crash-recoverable project batch-edit journals.
        if (!db.objectStoreNames.contains("batchEditJournals")) {
          const journals = db.createObjectStore("batchEditJournals", { keyPath: "id" });
          journals.createIndex("byProject", "projectId", { unique: false });
        }
        if (!db.objectStoreNames.contains("smartPreviews")) {
          db.createObjectStore("smartPreviews", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("watchedFolders")) {
          const folders = db.createObjectStore("watchedFolders", { keyPath: "id" });
          folders.createIndex("byAccount", "accountId", { unique: false });
        }
        if (!db.objectStoreNames.contains("directoryHandles")) {
          db.createObjectStore("directoryHandles", { keyPath: "id" });
        }
        // Phase 5 optical profiles were withdrawn. Remove their orphaned store
        // while retaining a forward-only DB version for clients that opened v12.
        if (db.objectStoreNames.contains("lensProfiles")) {
          db.deleteObjectStore("lensProfiles");
        }
        // v14: library for reusable custom image overlays.
        if (!db.objectStoreNames.contains("overlayLibrary")) {
          db.createObjectStore("overlayLibrary", { keyPath: "id" });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        _dbPromise = null;
        reject(req.error ?? new Error("Failed to open IndexedDB"));
      };
      req.onblocked = () => {
        console.warn("[poto] IndexedDB open blocked — another tab may need refreshing.");
      };
    });
  }
  return _dbPromise;
}

// ── generic IDB helpers ────────────────────────────────────────────────────

async function idbPut(storeName: string, value: unknown): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllByIndex<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ── public store API ───────────────────────────────────────────────────────

/**
 * Persists a project record plus its image blob. Not a true atomic transaction
 * across stores (IDB multi-store transactions exist but are cumbersome here).
 * If any write fails the error propagates to the caller.
 */
export async function saveProject(
  project: SavedProject,
  imageBlob: Blob,
  thumbnail?: Blob,
): Promise<void> {
  // Store image blob
  await idbPut("images", { id: project.image.id, blob: imageBlob });

  await saveProjectRecord(project, thumbnail);
}

/**
 * Updates only the small project JSON record (and optionally thumbnail). Used by
 * session autosave so slider edits do not rewrite/copy the large cached image
 * blob on every debounce.
 */
export async function saveProjectRecord(project: SavedProject, thumbnail?: Blob): Promise<void> {
  // Store the thumbnail (keyed by project id) for the browser.
  if (thumbnail) {
    await idbPut("thumbnails", { id: project.id, blob: thumbnail });
  }

  // Store project record last (so a partial write doesn't create an orphaned project)
  await idbPut("projects", project);
}

export async function getProject(projectId: string): Promise<SavedProject | undefined> {
  return idbGet<SavedProject>("projects", projectId);
}

export async function listProjects(): Promise<SavedProjectSummary[]> {
  const all = await idbGetAll<SavedProject>("projects");
  const summaries = await Promise.all(
    all
      .filter((p) => p.id !== SESSION_PROJECT_ID) // hide the auto-saved session slot
      .map(async (p) => ({
        id: p.id,
        name: p.name,
        fileName: p.image.fileName,
        width: p.image.width,
        height: p.image.height,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        thumbnail: (await idbGet<{ id: string; blob: Blob }>("thumbnails", p.id))?.blob,
      })),
  );
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return;

  // Remove image blob
  await idbDelete("images", project.image.id);

  await idbDelete("thumbnails", projectId);
  await idbDelete("projects", projectId);
}

export async function loadProjectImage(imageId: string): Promise<Blob | undefined> {
  const record = await idbGet<{ id: string; blob: Blob }>("images", imageId);
  return record?.blob;
}

// ── v3 multi-asset accessors ─────────────────────────────────────────────────

export function getSession(): Promise<AppSession | undefined> {
  return idbGet<AppSession>("appSession", "current");
}

export function putSession(session: AppSession): Promise<void> {
  return idbPut("appSession", session);
}

export function getProjectRecord(id: string): Promise<ProjectRecord | undefined> {
  return idbGet<ProjectRecord>("projectRecords", id);
}

export function listProjectRecords(): Promise<ProjectRecord[]> {
  return idbGetAll<ProjectRecord>("projectRecords");
}

export function putProjectRecord(record: ProjectRecord): Promise<void> {
  return idbPut("projectRecords", record);
}

export function getMedia(assetId: string): Promise<MediaRecord | undefined> {
  return idbGet<MediaRecord>("media", assetId);
}

export function putMedia(record: MediaRecord): Promise<void> {
  return idbPut("media", record);
}

export function getMediaSource(sourceId: string): Promise<MediaSourceRecord | undefined> {
  return idbGet<MediaSourceRecord>("mediaSources", sourceId);
}

export function putMediaSource(record: MediaSourceRecord): Promise<void> {
  return idbPut("mediaSources", record);
}

export function deleteMediaSource(sourceId: string): Promise<void> {
  return idbDelete("mediaSources", sourceId);
}

export function listMediaSourcesByProject(projectId: string): Promise<MediaSourceRecord[]> {
  return idbGetAllByIndex<MediaSourceRecord>("mediaSources", "byProject", projectId);
}

export function putBatchEditJournal(journal: BatchEditJournal): Promise<void> {
  return idbPut("batchEditJournals", journal);
}

export function listBatchEditJournals(projectId: string): Promise<BatchEditJournal[]> {
  return idbGetAllByIndex<BatchEditJournal>("batchEditJournals", "byProject", projectId);
}

export function deleteBatchEditJournal(id: string): Promise<void> {
  return idbDelete("batchEditJournals", id);
}

export function deleteImageRecord(id: string): Promise<void> {
  return idbDelete("images", id);
}

export function deleteThumbnailRecord(id: string): Promise<void> {
  return idbDelete("thumbnails", id);
}

export async function putCollection(record: CollectionRecord): Promise<void> {
  return idbPut("catalogCollections", {
    ...record,
    storageKey: `${record.accountId}:${record.id}`,
  });
}

export async function listCollections(accountId: string): Promise<CollectionRecord[]> {
  const records = await idbGetAllByIndex<CollectionRecord & { storageKey: string }>(
    "catalogCollections",
    "byAccount",
    accountId,
  );
  return records.map(({ storageKey: _storageKey, ...record }) => record);
}

export function deleteCollection(accountId: string, id: string): Promise<void> {
  return idbDelete("catalogCollections", `${accountId}:${id}`);
}

export function listMediaByProject(projectId: string): Promise<MediaRecord[]> {
  return idbGetAllByIndex<MediaRecord>("media", "byProject", projectId);
}

export function getImageRecord(id: string): Promise<StoredImageRecord | undefined> {
  return idbGet<StoredImageRecord>("images", id);
}

export function putImageRecord(record: StoredImageRecord): Promise<void> {
  return idbPut("images", record);
}

export function listMatchReferences(): Promise<MatchReferenceRecord[]> {
  return idbGetAll<MatchReferenceRecord>("matchReferences");
}

export function putMatchReference(record: MatchReferenceRecord): Promise<void> {
  return idbPut("matchReferences", record);
}

export function deleteMatchReferenceRecord(id: string): Promise<void> {
  return idbDelete("matchReferences", id);
}

export async function putThumbnail(id: string, blob: Blob): Promise<void> {
  return idbPut("thumbnails", { id, blob });
}

export async function getThumbnail(id: string): Promise<Blob | undefined> {
  const record = await idbGet<{ id: string; blob: Blob }>("thumbnails", id);
  return record?.blob;
}

export async function putSmartPreview(id: string, blob: Blob): Promise<void> {
  return idbPut("smartPreviews", { id, blob });
}

export async function getSmartPreview(id: string): Promise<Blob | undefined> {
  return (await idbGet<{ id: string; blob: Blob }>("smartPreviews", id))?.blob;
}

export function deleteSmartPreview(id: string): Promise<void> {
  return idbDelete("smartPreviews", id);
}

export function putWatchedFolder(record: WatchedFolderRecord): Promise<void> {
  return idbPut("watchedFolders", record);
}

export function listWatchedFolders(accountId: string): Promise<WatchedFolderRecord[]> {
  return idbGetAllByIndex<WatchedFolderRecord>("watchedFolders", "byAccount", accountId);
}

export function deleteWatchedFolder(id: string): Promise<void> {
  return idbDelete("watchedFolders", id);
}

export function putDirectoryHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  return idbPut("directoryHandles", { id, handle });
}

export async function getDirectoryHandle(id: string): Promise<FileSystemDirectoryHandle | undefined> {
  return (await idbGet<{ id: string; handle: FileSystemDirectoryHandle }>("directoryHandles", id))?.handle;
}

export function deleteDirectoryHandle(id: string): Promise<void> {
  return idbDelete("directoryHandles", id);
}

export async function putGalleryPreview(id: string, blob: Blob): Promise<void> {
  return idbPut("galleryPreviews", { id, blob });
}

export async function getGalleryPreview(id: string): Promise<Blob | undefined> {
  const record = await idbGet<{ id: string; blob: Blob }>("galleryPreviews", id);
  return record?.blob;
}

export async function deleteGalleryPreview(id: string): Promise<void> {
  return idbDelete("galleryPreviews", id);
}

function overlayImageId(assetId: string, sourceId: string): string {
  return `${assetId}:${sourceId}`;
}

export async function putOverlayImage(
  assetId: string,
  sourceId: string,
  blob: Blob,
): Promise<void> {
  return idbPut("overlayImages", { id: overlayImageId(assetId, sourceId), blob });
}

export async function getOverlayImage(
  assetId: string,
  sourceId: string,
): Promise<Blob | undefined> {
  const record = await idbGet<{ id: string; blob: Blob }>(
    "overlayImages",
    overlayImageId(assetId, sourceId),
  );
  return record?.blob;
}

export async function deleteOverlayImage(assetId: string, sourceId: string): Promise<void> {
  return idbDelete("overlayImages", overlayImageId(assetId, sourceId));
}

/** Lightweight summaries for the active project's media strip. Thumbnails load on visibility. */
export async function listMediaSummaries(projectId: string): Promise<MediaSummary[]> {
  const records = await listMediaByProject(projectId);
  const groupOrder = new Map<string, number>();
  records.forEach((media) => {
    const key = media.sourceId ?? media.assetId;
    if (!groupOrder.has(key)) groupOrder.set(key, groupOrder.size);
  });
  const summaries = records.map((m) => ({
    assetId: m.assetId,
    projectId: m.projectId,
    fileName: m.fileName,
    width: m.width,
    height: m.height,
    updatedAt: m.updatedAt,
    catalog: m.catalog,
    metadata: m.metadata,
    sourceId: m.sourceId,
    variantKind: m.variantKind,
    variantName: m.variantName,
    isPrimary: m.isPrimary,
  }));
  return summaries.sort((a, b) => {
    const group = (groupOrder.get(a.sourceId ?? a.assetId) ?? 0) -
      (groupOrder.get(b.sourceId ?? b.assetId) ?? 0);
    if (group) return group;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.updatedAt - b.updatedAt;
  });
}

/** Project summaries for the browser, built from v3 ProjectRecords. */
export async function listProjectSummaries(): Promise<SavedProjectSummary[]> {
  const projects = await listProjectRecords();
  return projects
    .map((p) => ({
      id: p.id,
      name: p.name,
      fileName: "",
      width: 0,
      height: 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      assetCount: p.assetIds.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Hydrates one visible project card with its active media summary + thumbnail. */
export async function hydrateProjectSummary(
  projectId: string,
): Promise<SavedProjectSummary | undefined> {
  const p = await getProjectRecord(projectId);
  if (!p) return undefined;
  const activeId =
    p.activeUserMedia && p.assetIds.includes(p.activeUserMedia)
      ? p.activeUserMedia
      : p.assetIds[0];
  const active = activeId ? await getMedia(activeId) : undefined;
  return {
    id: p.id,
    name: p.name,
    fileName: active?.fileName ?? "",
    width: active?.width ?? 0,
    height: active?.height ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    assetCount: p.assetIds.length,
    thumbnail: active ? await getThumbnail(active.thumbnailId) : undefined,
  };
}

export async function deleteMedia(assetId: string): Promise<void> {
  const media = await getMedia(assetId);
  if (!media) return;

  if (media.sourceId) {
    const source = await getMediaSource(media.sourceId);
    const remaining = (await listMediaByProject(media.projectId)).filter(
      (candidate) => candidate.assetId !== assetId && candidate.sourceId === media.sourceId,
    );
    if (source && remaining.length > 0) {
      const nextPrimary =
        source.primaryAssetId === assetId ? remaining[0].assetId : source.primaryAssetId;
      await putMediaSource({
        ...source,
        primaryAssetId: nextPrimary,
        refCount: remaining.length,
        updatedAt: Date.now(),
      });
      if (source.primaryAssetId === assetId) {
        for (const variant of remaining) {
          await putMedia({ ...variant, isPrimary: variant.assetId === nextPrimary });
        }
      }
    } else {
      const imageId = source?.imageId ?? media.imageId;
      const thumbnailId = source?.thumbnailId ?? media.thumbnailId;
      const previewId = source?.galleryPreviewId ?? media.galleryPreviewId;
      await idbDelete("images", imageId);
      await idbDelete("thumbnails", thumbnailId);
      if (previewId) await idbDelete("galleryPreviews", previewId);
      const smartPreviewId = source?.smartPreviewId ?? media.smartPreviewId;
      if (smartPreviewId) await deleteSmartPreview(smartPreviewId);
      if (source) await deleteMediaSource(source.sourceId);
    }
  } else {
    await idbDelete("images", media.imageId);
    await idbDelete("thumbnails", media.thumbnailId);
    if (media.galleryPreviewId) await idbDelete("galleryPreviews", media.galleryPreviewId);
    if (media.smartPreviewId) await deleteSmartPreview(media.smartPreviewId);
  }

  if (media.originalImageId) await idbDelete("images", media.originalImageId);
  if (media.originalThumbnailId) await idbDelete("thumbnails", media.originalThumbnailId);
  if (media.originalGalleryPreviewId) await idbDelete("galleryPreviews", media.originalGalleryPreviewId);
  for (const overlay of media.editState.overlays ?? []) {
    if (overlay.type === "image" && overlay.sourceId) await deleteOverlayImage(assetId, overlay.sourceId);
  }
  await idbDelete("media", assetId);
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  const project = await getProjectRecord(projectId);
  if (!project) return;
  for (const assetId of project.assetIds) {
    await deleteMedia(assetId);
  }
  await idbDelete("projectRecords", projectId);
}

// ── v2 → v3 one-time data migration ──────────────────────────────────────────
//
// The schema upgrade (onupgradeneeded) only creates the new stores. This wraps
// each existing v2 SavedProject into a ProjectRecord + one MediaRecord, REUSING
// the existing image/thumbnail blob ids (no large-blob copy). The reserved
// SESSION_PROJECT_ID slot becomes a normal "Default Project". Idempotent: it
// no-ops once a session record exists. Old SavedProject rows are left in place.

const MIGRATION_FLAG = "current";

export async function migrateToV3IfNeeded(): Promise<void> {
  if (await getSession()) return; // already migrated / fresh-with-session

  const legacy = await idbGetAll<SavedProject>("projects");
  let mostRecent: { projectId: string; assetId: string; updatedAt: number } | null = null;

  for (const sp of legacy) {
    const isSession = sp.id === SESSION_PROJECT_ID;
    const projectId = isSession ? generateId() : sp.id;
    const assetId = generateId();

    // Re-tag the existing image blob with a kind (it was stored as {id, blob}).
    const existingImage = await idbGet<{ id: string; blob?: Blob }>("images", sp.image.id);
    if (existingImage?.blob) {
      await putImageRecord({
        id: sp.image.id,
        kind: sp.image.storage === "developed" ? "developed" : "original",
        blob: existingImage.blob,
      });
    }
    // The v2 thumbnail was keyed by project id; re-key a copy to the asset id.
    const thumb = await getThumbnail(sp.id);
    if (thumb) await putThumbnail(assetId, thumb);

    const media: MediaRecord = {
      assetId,
      projectId,
      fileName: sp.image.fileName,
      mimeType: sp.image.mimeType,
      width: sp.image.width,
      height: sp.image.height,
      sizeBytes: sp.image.sizeBytes,
      storage: sp.image.storage === "developed" ? "developed" : "original",
      imageId: sp.image.id,
      thumbnailId: assetId,
      editState: sp.editState,
      createdAt: sp.createdAt,
      updatedAt: sp.updatedAt,
    };
    await putMedia(media);

    const project: ProjectRecord = {
      id: projectId,
      schemaVersion: sp.schemaVersion,
      name: isSession ? "Default Project" : sp.name,
      createdAt: sp.createdAt,
      updatedAt: sp.updatedAt,
      activeUserMedia: assetId,
      assetIds: [assetId],
    };
    await putProjectRecord(project);

    if (!mostRecent || sp.updatedAt > mostRecent.updatedAt) {
      mostRecent = { projectId, assetId, updatedAt: sp.updatedAt };
    }
  }

  await putSession({
    id: MIGRATION_FLAG,
    activeProjectId: mostRecent?.projectId ?? null,
    activeAssetId: mostRecent?.assetId ?? null,
    lastOpenedAt: Date.now(),
  });
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── overlay library accessors ────────────────────────────────────────────────

export function putOverlayLibraryItem(item: OverlayLibraryItem): Promise<void> {
  return idbPut("overlayLibrary", item);
}

export function listOverlayLibraryItems(): Promise<OverlayLibraryItem[]> {
  return idbGetAll<OverlayLibraryItem>("overlayLibrary");
}

export function getOverlayLibraryItem(id: string): Promise<OverlayLibraryItem | undefined> {
  return idbGet<OverlayLibraryItem>("overlayLibrary", id);
}

export function deleteOverlayLibraryItem(id: string): Promise<void> {
  return idbDelete("overlayLibrary", id);
}
