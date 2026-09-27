import {
  For,
  Show,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { LOCAL_WORKSPACE_ID } from "../project/localWorkspace";
import { isFeatureAvailable, featureUnavailableMessage } from "../features/editorCapabilities";
import * as indexedDbMediaStore from "../project/mediaStore";
import * as indexedDbProjectStore from "../project/projectStore";
import * as storageBridge from "../project/storage/storageBridge";
import { resetStorageDirectoryCaches } from "../project/storage/ProjectDirectory";
import { resetProjectStore } from "../project/storage/projectStore";
import { setStorageAccount } from "../project/storage/storageWriter";
import type {
  CatalogSearchDocument,
  CollectionRecord,
  MediaCatalogFields,
  MediaSummary,
  SavedProjectSummary,
  SmartCollectionQuery,
  SmartPreviewPolicy,
  ManagedCacheUsage,
  WatchedFolderRecord,
} from "../project/ProjectTypes";
import {
  evaluateSmartCollection,
  matchesCatalogText,
  normalizeKeywords,
  patchCatalogFields,
} from "../project/catalog";
import {
  connectWatchedFolder,
  disconnectWatchedFolder,
  listWatchedFolders,
  reconnectWatchedFolder,
  saveWatchedFolder,
  scanWatchedFolder,
  startForegroundFolderWatching,
  type WatchedFolderChange,
} from "../project/watchedFolders";
import {
  ensureCatalogIndex,
  rebuildCatalogIndex,
  setCatalogIndexAccount,
} from "../project/catalogIndex";

export type GalleryProject = {
  id: string;
  name: string;
  count: number;
};

export type GalleryImage = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  category: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  catalog: MediaCatalogFields;
  catalogDocument: CatalogSearchDocument;
};

type GalleryState = "loading" | "ready" | "empty" | "error";
type PersistenceKind = "opfs" | "indexeddb";
type LightboxPhase = "opening" | "open" | "closing";
type Rect = { top: number; left: number; width: number; height: number };
type LightboxState = {
  image: GalleryImage;
  index: number;
  sourceRect: Rect;
  targetRect: Rect;
  previewUrl: string;
  phase: LightboxPhase;
  switching: boolean;
};
type PreviewCacheEntry = {
  url?: string;
  promise?: Promise<string>;
};

const ALL_PROJECTS_ID = "__all__";
const ALL_COLLECTIONS_ID = "__none__";
const LIGHTBOX_PADDING = 56;
const LIGHTBOX_CLOSE_MS = 180;
const IMAGE_SWITCH_MS = 95;
const THUMB_PRELOAD_MARGIN = "800px 0px";

function fileStem(fileName: string): string {
  return (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^/.]+$/, "") || fileName;
}

// function scaleImageData(imageData: ImageData): Promise<Blob | undefined> {
//   const canvas =
//     typeof OffscreenCanvas !== "undefined"
//       ? new OffscreenCanvas(imageData.width, imageData.height)
//       : Object.assign(document.createElement("canvas"), {
//         width: imageData.width,
//         height: imageData.height,
//       });
//   const ctx = canvas.getContext("2d") as
//     | OffscreenCanvasRenderingContext2D
//     | CanvasRenderingContext2D
//     | null;
//   if (!ctx) return Promise.resolve(undefined);
//   ctx.putImageData(imageData, 0, 0);
//   if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
//   return new Promise((resolve) => {
//     canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
//   });
// }

function objectUrl(blob: Blob | undefined, urls: Set<string>): string | null {
  if (!blob || blob.size <= 0) return null;
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextPaint(callback: () => void): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

async function decodeImageUrl(url: string): Promise<void> {
  if (!url) return;
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  if (typeof image.decode === "function") {
    await image.decode().catch(() => undefined);
    return;
  }

  if (image.complete) return;
  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
  });
}

async function detectPersistenceKind(): Promise<PersistenceKind> {
  const forcedIndexedDb = (window as { __USE_INDEXEDDB_PERSISTENCE?: boolean })
    .__USE_INDEXEDDB_PERSISTENCE;
  if (forcedIndexedDb) return "indexeddb";
  if (typeof navigator?.storage?.getDirectory === "function") {
    try {
      await navigator.storage.getDirectory();
      return "opfs";
    } catch {
      return "indexeddb";
    }
  }
  return "indexeddb";
}

async function resolveGalleryAccountId(): Promise<string | null> {
  return LOCAL_WORKSPACE_ID;
}

function configureOpfsAccount(accountId: string): void {
  if (!setStorageAccount(accountId)) return;
  resetStorageDirectoryCaches();
  resetProjectStore();
}

async function loadIndexedDbProjects(): Promise<SavedProjectSummary[]> {
  return indexedDbProjectStore.listProjects();
}

async function loadIndexedDbMedia(projectId: string): Promise<MediaSummary[]> {
  const summaries = await indexedDbMediaStore.listMedia(projectId);
  return Promise.all(
    summaries.map(async (summary) => ({
      ...summary,
      thumbnail: await indexedDbMediaStore.getThumbnail(summary.assetId).catch(() => undefined),
    })),
  );
}

async function resolveIndexedDbPreview(assetId: string): Promise<Blob | undefined> {
  return indexedDbMediaStore.getGalleryPreview(assetId);
}

function computeTargetRect(width: number, height: number): Rect {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(1, viewportWidth - LIGHTBOX_PADDING * 2);
  const maxHeight = Math.max(1, viewportHeight - LIGHTBOX_PADDING * 2);
  const ratio = width > 0 && height > 0 ? width / height : 1;
  let targetWidth = maxWidth;
  let targetHeight = targetWidth / ratio;
  if (targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = targetHeight * ratio;
  }
  return {
    left: (viewportWidth - targetWidth) / 2,
    top: (viewportHeight - targetHeight) / 2,
    width: targetWidth,
    height: targetHeight,
  };
}

function previewKey(image: GalleryImage): string {
  return `${image.projectId}:${image.id}`;
}

export default function GalleryPage() {
  const ownedUrls = new Set<string>();
  const previewCache = new Map<string, PreviewCacheEntry>();
  const [state, setState] = createSignal<GalleryState>("loading");
  const [error, setError] = createSignal("");
  const [projects, setProjects] = createSignal<GalleryProject[]>([]);
  const [images, setImages] = createSignal<GalleryImage[]>([]);
  const [activeProjectId, setActiveProjectId] = createSignal(ALL_PROJECTS_ID);
  const [activeCollectionId, setActiveCollectionId] = createSignal(ALL_COLLECTIONS_ID);
  const [collections, setCollections] = createSignal<CollectionRecord[]>([]);
  const [searchText, setSearchText] = createSignal("");
  const [minimumRating, setMinimumRating] = createSignal(0);
  const [flagFilter, setFlagFilter] = createSignal<"all" | "none" | "pick" | "reject">("all");
  const [sortOrder, setSortOrder] = createSignal<"updated" | "captured" | "rating" | "filename">("updated");
  const [selectedKeys, setSelectedKeys] = createSignal<string[]>([]);
  const [catalogAccountId, setCatalogAccountId] = createSignal("");
  const [persistenceKind, setPersistenceKind] = createSignal<PersistenceKind>("opfs");
  const [lightbox, setLightbox] = createSignal<LightboxState | null>(null);
  const [showStorageManager, setShowStorageManager] = createSignal(false);
  const [previewPolicy, setPreviewPolicy] = createSignal<SmartPreviewPolicy>(2560);
  const [cacheUsage, setCacheUsage] = createSignal<ManagedCacheUsage | null>(null);
  const [watchedFolders, setWatchedFolders] = createSignal<WatchedFolderRecord[]>([]);
  const [storageBusy, setStorageBusy] = createSignal(false);
  const [folderNotice, setFolderNotice] = createSignal("");
  let previousBodyOverflow = "";
  let bodyScrollLocked = false;
  let lightboxRequestId = 0;
  let navigationRequestId = 0;
  let closeTimer: number | undefined;
  let stopFolderWatching: (() => void) | undefined;

  const filteredImages = createMemo(() => {
    const projectId = activeProjectId();
    const collection = collections().find((item) => item.id === activeCollectionId());
    const manualKeys = collection?.kind === "manual"
      ? new Set(collection.items.map((ref) => `${ref.projectId}:${ref.assetId}`))
      : null;
    const result = images().filter((image) => {
      if (projectId !== ALL_PROJECTS_ID && image.projectId !== projectId) return false;
      if (image.catalog.rating < minimumRating()) return false;
      if (flagFilter() !== "all" && image.catalog.flag !== flagFilter()) return false;
      if (!matchesCatalogText(image.catalogDocument, searchText())) return false;
      if (manualKeys && !manualKeys.has(previewKey(image))) return false;
      if (collection?.query && !evaluateSmartCollection(image.catalogDocument, collection.query)) return false;
      return true;
    });
    const order = sortOrder();
    return result.sort((a, b) => {
      switch (order) {
        case "captured": return (b.catalogDocument.captureDate ?? 0) - (a.catalogDocument.captureDate ?? 0);
        case "rating": return b.catalog.rating - a.catalog.rating || a.title.localeCompare(b.title);
        case "filename": return a.title.localeCompare(b.title, undefined, { numeric: true });
        default: return b.catalog.catalogUpdatedAt - a.catalog.catalogUpdatedAt;
      }
    });
  });

  async function loadGallery() {
    setState("loading");
    setError("");
    try {
      const kind = await detectPersistenceKind();
      setPersistenceKind(kind);
      const accountId = await resolveGalleryAccountId();
      if (!accountId) {
        setProjects([]);
        setImages([]);
        setState("empty");
        return;
      }
      setCatalogAccountId(accountId);
      setCatalogIndexAccount(accountId);
      setWatchedFolders(await listWatchedFolders(accountId));
      if (kind === "opfs") configureOpfsAccount(accountId);

      const canonicalDocuments = await storageBridge.listCatalogDocuments(kind, accountId);
      const indexedDocuments = await ensureCatalogIndex(accountId, () =>
        Promise.resolve(canonicalDocuments),
      );
      const canonicalSignature = canonicalDocuments
        .map((document) => `${document.key}:${document.catalogUpdatedAt}`)
        .sort()
        .join("|");
      const indexSignature = indexedDocuments
        .map((document) => `${document.key}:${document.catalogUpdatedAt}`)
        .sort()
        .join("|");
      if (canonicalSignature !== indexSignature) await rebuildCatalogIndex(accountId, canonicalDocuments);
      const documentsByRef = new Map(
        canonicalDocuments.map((document) => [`${document.projectId}:${document.assetId}`, document]),
      );
      setCollections(await storageBridge.listCollections(kind, accountId));

      const projectSummaries =
        kind === "opfs" ? await storageBridge.listProjectSummaries() : await loadIndexedDbProjects();
      const hydratedProjects = (
        await Promise.all(
          projectSummaries.map(async (project) =>
            kind === "opfs"
              ? storageBridge.hydrateVisibleProjectSummary(project.id).then((value) => value ?? project)
              : project,
          ),
        )
      ).filter((project) => (project.assetCount ?? 0) > 0);

      const nextProjects: GalleryProject[] = [];
      const nextImages: GalleryImage[] = [];
      for (const project of hydratedProjects) {
        const media =
          kind === "opfs"
            ? await storageBridge.listMediaDirectoryPlaceholders(project.id)
            : await loadIndexedDbMedia(project.id);
        const projectImages = media.filter((item) => !!item.thumbnail);
        nextProjects.push({
          id: project.id,
          name: project.name || "Untitled Project",
          count: projectImages.length,
        });
        for (const item of projectImages) {
          const thumbnailUrl = objectUrl(item.thumbnail, ownedUrls);
          const catalogDocument = documentsByRef.get(`${item.projectId}:${item.assetId}`);
          if (!thumbnailUrl || !catalogDocument) continue;
          nextImages.push({
            id: item.assetId,
            projectId: item.projectId,
            projectName: project.name || "Untitled Project",
            title: fileStem(item.fileName || item.assetId),
            category: project.name || "Project",
            width: item.width,
            height: item.height,
            thumbnailUrl,
            catalog: catalogDocument,
            catalogDocument,
          });
        }
      }

      setProjects(nextProjects.filter((project) => project.count > 0));
      setImages(nextImages);
      setActiveProjectId(ALL_PROJECTS_ID);
      setState(nextImages.length > 0 ? "ready" : "empty");
      stopFolderWatching?.();
      stopFolderWatching = startForegroundFolderWatching({
        accountId,
        onChanges: processWatchedFolderChanges,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load gallery.");
      setState("error");
    }
  }

  async function refreshCacheUsage(): Promise<void> {
    const projectId = activeProjectId() === ALL_PROJECTS_ID ? projects()[0]?.id : activeProjectId();
    if (!projectId) { setCacheUsage(null); return; }
    setCacheUsage(await storageBridge.getProjectCacheUsage(persistenceKind(), projectId));
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function applySmartPreviewPolicy(): Promise<void> {
    if (!isFeatureAvailable("smart_preview_management")) {
      window.alert(featureUnavailableMessage("smart_preview_management"));
      return;
    }
    const targets = selectedImages().length ? selectedImages() : filteredImages();
    if (!targets.length) return;
    setStorageBusy(true);
    setError("");
    try {
      for (const image of targets) {
        await storageBridge.generateSmartPreview(persistenceKind(), image.projectId, image.id, previewPolicy());
        previewCache.delete(previewKey(image));
      }
      await refreshCacheUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update smart previews.");
    } finally { setStorageBusy(false); }
  }

  async function chooseDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error("Folder watching is not supported by this browser.");
    try {
      return await picker.call(window);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  }

  async function processWatchedFolderChanges(
    record: WatchedFolderRecord,
    changes: WatchedFolderChange[],
  ): Promise<void> {
    let next = record;
    let imported = 0;
    let updatedVersions = 0;
    const failures: string[] = [];
    for (const change of changes) {
      if (change.kind === "removed" || !change.file) continue;
      if (change.kind === "added" && change.assetId) continue;
      try {
        const assetId = await storageBridge.importWatchedFile(
          persistenceKind(), record.projectId, record.accountId, change.file,
        );
        next = {
          ...next,
          files: next.files.map((item) => item.relativePath === change.relativePath
            ? { ...item, assetId }
            : item),
        };
        imported += 1;
        if (change.kind === "changed") updatedVersions += 1;
      } catch (error) {
        failures.push(`${change.relativePath}: ${error instanceof Error ? error.message : "Import failed"}`);
      }
    }
    if (failures.length) {
      next = { ...next, status: "error", lastError: failures.slice(0, 3).join(" · ") };
    }
    await saveWatchedFolder(next);
    setWatchedFolders((current) => current.map((item) => item.id === next.id ? next : item));
    const removed = changes.filter((change) => change.kind === "removed").length;
    setFolderNotice([
      imported ? `${imported} imported${updatedVersions ? ` (${updatedVersions} changed-file versions)` : ""}` : "",
      removed ? `${removed} missing (catalog copies retained)` : "",
      failures.length ? `${failures.length} failed` : "",
    ].filter(Boolean).join(" · "));
    if (imported) await loadGallery();
  }

  async function connectFolder(record?: WatchedFolderRecord): Promise<void> {
    if (!record && activeProjectId() === ALL_PROJECTS_ID) {
      setError("Select a specific project before connecting a watched folder.");
      return;
    }
    let handle: FileSystemDirectoryHandle | undefined;
    try {
      handle = await chooseDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open the folder picker.");
      return;
    }
    if (!handle || !catalogAccountId()) return;
    setStorageBusy(true);
    try {
      const next = record
        ? await reconnectWatchedFolder(record, handle)
        : await connectWatchedFolder({
            accountId: catalogAccountId(),
            projectId: activeProjectId(),
            handle,
          });
      const scanned = await scanWatchedFolder(next);
      setWatchedFolders((current) => [...current.filter((item) => item.id !== next.id), scanned.record]);
      await processWatchedFolderChanges(scanned.record, scanned.changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect folder.");
    } finally { setStorageBusy(false); }
  }

  async function removeFolder(record: WatchedFolderRecord): Promise<void> {
    try {
      await disconnectWatchedFolder(record);
      setWatchedFolders((current) => current.filter((item) => item.id !== record.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove the watched folder.");
    }
  }

  async function rescanFolder(record: WatchedFolderRecord): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const result = await scanWatchedFolder(record);
      await processWatchedFolderChanges(result.record, result.changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to scan the watched folder.");
    } finally { setStorageBusy(false); }
  }

  async function resolvePreviewBlob(image: GalleryImage): Promise<Blob | undefined> {
    const smart = await storageBridge.getSmartPreview(persistenceKind(), image.projectId, image.id).catch(() => undefined);
    if (smart) return smart;
    return persistenceKind() === "opfs"
      ? await storageBridge.getProjectMediaPreview(image.projectId, image.id).catch(() => undefined)
      : await resolveIndexedDbPreview(image.id).catch(() => undefined);
  }

  function peekPreviewUrl(image: GalleryImage): string | undefined {
    return previewCache.get(previewKey(image))?.url;
  }

  function resolvePreviewUrl(image: GalleryImage): Promise<string> {
    const key = previewKey(image);
    const cached = previewCache.get(key);
    if (cached?.url) return Promise.resolve(cached.url);
    if (cached?.promise) return cached.promise;

    const promise = resolvePreviewBlob(image)
      .then((blob) => objectUrl(blob, ownedUrls) ?? image.thumbnailUrl)
      .catch(() => image.thumbnailUrl)
      .then((url) => {
        previewCache.set(key, { url });
        return url;
      });

    previewCache.set(key, { promise });
    return promise;
  }

  function warmPreview(image: GalleryImage): void {
    void resolvePreviewUrl(image).then(decodeImageUrl);
  }

  function warmAdjacentImages(index: number): void {
    const list = filteredImages();
    if (list.length < 2) return;
    warmPreview(list[(index - 1 + list.length) % list.length]);
    warmPreview(list[(index + 1) % list.length]);
  }

  async function openLightbox(image: GalleryImage, source: HTMLImageElement) {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }

    const requestId = ++lightboxRequestId;
    navigationRequestId += 1;
    const list = filteredImages();
    const index = Math.max(0, list.findIndex((item) => item.id === image.id));
    const sourceBox = source.getBoundingClientRect();
    const sourceRect: Rect = {
      top: sourceBox.top,
      left: sourceBox.left,
      width: sourceBox.width,
      height: sourceBox.height,
    };
    const width = image.width || source.naturalWidth || sourceRect.width;
    const height = image.height || source.naturalHeight || sourceRect.height;
    const targetRect = computeTargetRect(width, height);
    const sourceUrl = source.currentSrc || source.src || image.thumbnailUrl;

    setLightbox({
      image,
      index,
      sourceRect,
      targetRect,
      previewUrl: sourceUrl,
      phase: "opening",
      switching: false,
    });

    nextPaint(() => {
      if (requestId !== lightboxRequestId) return;
      setLightbox((current) =>
        current?.image.id === image.id ? { ...current, phase: "open" } : current,
      );
    });

    warmAdjacentImages(index);

    const previewUrl = await resolvePreviewUrl(image);
    if (previewUrl === sourceUrl) return;
    await decodeImageUrl(previewUrl);
    if (requestId !== lightboxRequestId) return;

    setLightbox((current) => {
      if (!current || current.image.id !== image.id || current.phase === "closing") return current;
      return { ...current, previewUrl };
    });
  }

  function closeLightbox() {
    if (!lightbox()) return;
    lightboxRequestId += 1;
    navigationRequestId += 1;
    setLightbox((current) => (current ? { ...current, phase: "closing" } : current));

    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined;
      setLightbox(null);
    }, LIGHTBOX_CLOSE_MS);
  }

  async function showRelativeImage(delta: number) {
    const current = lightbox();
    if (!current || current.phase === "closing") return;
    const list = filteredImages();
    if (!list.length) return;

    const requestId = ++navigationRequestId;
    const nextIndex = (current.index + delta + list.length) % list.length;
    const image = list[nextIndex];
    const width = image.width || current.targetRect.width;
    const height = image.height || current.targetRect.height;
    const targetRect = computeTargetRect(width, height);
    const cachedPreviewUrl = peekPreviewUrl(image);
    const firstUrl = cachedPreviewUrl ?? image.thumbnailUrl;
    const previewPromise = resolvePreviewUrl(image);

    setLightbox((value) => (value ? { ...value, switching: true } : value));
    await Promise.all([wait(IMAGE_SWITCH_MS), decodeImageUrl(firstUrl)]);
    if (requestId !== navigationRequestId) return;

    setLightbox((value) => {
      if (!value || value.phase === "closing") return value;
      return {
        ...value,
        image,
        index: nextIndex,
        targetRect,
        previewUrl: firstUrl,
        switching: true,
      };
    });

    window.requestAnimationFrame(() => {
      if (requestId !== navigationRequestId) return;
      setLightbox((value) =>
        value?.image.id === image.id ? { ...value, switching: false } : value,
      );
    });

    warmAdjacentImages(nextIndex);

    const previewUrl = await previewPromise;
    if (previewUrl === firstUrl) return;
    await decodeImageUrl(previewUrl);
    if (requestId !== navigationRequestId) return;

    setLightbox((value) => {
      if (!value || value.image.id !== image.id || value.phase === "closing") return value;
      return { ...value, previewUrl };
    });
  }

  function selectedImages(): GalleryImage[] {
    const selected = new Set(selectedKeys());
    if (selected.size) return images().filter((image) => selected.has(previewKey(image)));
    const active = lightbox()?.image;
    return active ? [active] : [];
  }

  async function applyCatalogPatch(
    patch: Partial<Pick<MediaCatalogFields, "rating" | "flag" | "keywords">>,
  ): Promise<void> {
    const targets = selectedImages();
    const accountId = catalogAccountId();
    if (!targets.length || !accountId) return;
    await storageBridge.updateCatalogFields(
      persistenceKind(),
      accountId,
      targets.map((image) => ({ projectId: image.projectId, assetId: image.id })),
      patch,
    );
    const targetKeys = new Set(targets.map(previewKey));
    setImages((current) =>
      current.map((image) => {
        if (!targetKeys.has(previewKey(image))) return image;
        const catalog = patchCatalogFields(image.catalog, patch);
        return {
          ...image,
          catalog,
          catalogDocument: { ...image.catalogDocument, ...catalog },
        };
      }),
    );
  }

  function toggleSelection(image: GalleryImage, additive: boolean): void {
    const key = previewKey(image);
    setSelectedKeys((current) => {
      if (!additive) return current.length === 1 && current[0] === key ? [] : [key];
      return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    });
  }

  function currentQuery(): SmartCollectionQuery {
    const children: SmartCollectionQuery[] = [];
    if (minimumRating() > 0) {
      children.push({ type: "predicate", field: "rating", operator: "gte", value: minimumRating() });
    }
    if (flagFilter() !== "all") {
      children.push({ type: "predicate", field: "flag", operator: "equals", value: flagFilter() });
    }
    if (activeProjectId() !== ALL_PROJECTS_ID) {
      children.push({ type: "predicate", field: "project", operator: "equals", value: activeProjectId() });
    }
    const text = searchText().trim();
    if (text) {
      children.push({
        type: "or",
        children: (["filename", "keywords", "camera", "lens"] as const).map((field) => ({
          type: "predicate" as const,
          field,
          operator: "contains" as const,
          value: text,
        })),
      });
    }
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  async function createCollection(kind: "manual" | "saved-search"): Promise<void> {
    const accountId = catalogAccountId();
    if (!accountId) return;
    const name = window.prompt(kind === "manual" ? "Collection name" : "Saved search name")?.trim();
    if (!name) return;
    const now = Date.now();
    const record: CollectionRecord = {
      id: crypto.randomUUID(),
      accountId,
      kind,
      name,
      items:
        kind === "manual"
          ? selectedImages().map((image) => ({ projectId: image.projectId, assetId: image.id }))
          : [],
      query: kind === "saved-search" ? currentQuery() : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await storageBridge.saveCollection(persistenceKind(), record);
    setCollections((current) => [...current, record]);
    setActiveCollectionId(record.id);
  }

  async function deleteActiveCollection(): Promise<void> {
    const id = activeCollectionId();
    const accountId = catalogAccountId();
    if (id === ALL_COLLECTIONS_ID || !accountId) return;
    const collection = collections().find((item) => item.id === id);
    if (!collection || !window.confirm(`Delete collection “${collection.name}”?`)) return;
    await storageBridge.deleteCollectionRecord(persistenceKind(), accountId, id);
    setCollections((current) => current.filter((item) => item.id !== id));
    setActiveCollectionId(ALL_COLLECTIONS_ID);
  }

  async function editKeywords(): Promise<void> {
    const targets = selectedImages();
    if (!targets.length) return;
    const initial = targets.length === 1 ? targets[0].catalog.keywords.join(", ") : "";
    const value = window.prompt("Keywords (comma separated)", initial);
    if (value === null) return;
    await applyCatalogPatch({ keywords: normalizeKeywords(value) });
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) return;
    if (event.key === "Escape") {
      if (lightbox()) closeLightbox();
      else setSelectedKeys([]);
      return;
    }
    if (lightbox() && event.key === "ArrowLeft") void showRelativeImage(-1);
    if (lightbox() && event.key === "ArrowRight") void showRelativeImage(1);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedKeys(filteredImages().map(previewKey));
      return;
    }
    if (/^[0-5]$/.test(event.key)) void applyCatalogPatch({ rating: Number(event.key) as MediaCatalogFields["rating"] });
    if (event.key.toLowerCase() === "p") void applyCatalogPatch({ flag: "pick" });
    if (event.key.toLowerCase() === "x") void applyCatalogPatch({ flag: "reject" });
    if (event.key.toLowerCase() === "u") void applyCatalogPatch({ flag: "none" });
  }

  onMount(() => {
    void loadGallery();
    window.addEventListener("keydown", onKeyDown);
  });

  createEffect(() => {
    if (lightbox() && !bodyScrollLocked) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      bodyScrollLocked = true;
    } else if (!lightbox() && bodyScrollLocked) {
      document.body.style.overflow = previousBodyOverflow;
      bodyScrollLocked = false;
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    stopFolderWatching?.();
    previewCache.clear();
    for (const url of ownedUrls) URL.revokeObjectURL(url);
    ownedUrls.clear();
    if (bodyScrollLocked) document.body.style.overflow = previousBodyOverflow;
  });

  return (
    <main class="gallery-page">
      <section class="gallery-shell" aria-label="Gallery">
        <header class="gallery-topbar">
          <h1>Gallery</h1>
          <button
            type="button"
            class="gallery-storage-button"
            onClick={() => {
              const opening = !showStorageManager();
              setShowStorageManager(opening);
              if (opening) void refreshCacheUsage();
            }}
          >
            Storage
          </button>
          <nav class="gallery-tabs" aria-label="Filter by image project">
            <button
              type="button"
              class="gallery-tab"
              classList={{ "gallery-tab--active": activeProjectId() === ALL_PROJECTS_ID }}
              onClick={() => setActiveProjectId(ALL_PROJECTS_ID)}
            >
              All
            </button>
            <For each={projects()}>
              {(project) => (
                <button
                  type="button"
                  class="gallery-tab"
                  classList={{ "gallery-tab--active": activeProjectId() === project.id }}
                  onClick={() => setActiveProjectId(project.id)}
                >
                  {project.name}
                </button>
              )}
            </For>
          </nav>
        </header>

        <Show when={showStorageManager()}>
          <section class="gallery-storage-manager" aria-label="Storage and watched folders">
            <div class="gallery-storage-manager__section">
              <h2>Smart previews</h2>
              <p>New imports use a free 2560 px preview. Custom policies apply to selected images, or all filtered images.</p>
              <div class="gallery-storage-manager__controls">
                <select
                  aria-label="Smart preview size"
                  value={String(previewPolicy())}
                  onChange={(event) => setPreviewPolicy(event.currentTarget.value === "off" ? "off" : Number(event.currentTarget.value) as SmartPreviewPolicy)}
                >
                  <option value="off">Off</option>
                  <option value="1280">1280 px</option>
                  <option value="2560">2560 px</option>
                  <option value="4096">4096 px</option>
                </select>
                <button type="button" disabled={storageBusy()} onClick={() => void applySmartPreviewPolicy()}>
                  {storageBusy() ? "Working…" : "Apply policy"}
                </button>
                <button type="button" disabled={storageBusy()} onClick={() => void refreshCacheUsage()}>Refresh usage</button>
              </div>
              <Show when={cacheUsage()} keyed>
                {(usage) => (
                  <dl class="gallery-storage-usage">
                    <div><dt>Sources</dt><dd>{formatBytes(usage.sourceBytes)}</dd></div>
                    <div><dt>Smart previews</dt><dd>{formatBytes(usage.smartPreviewBytes)}</dd></div>
                    <div><dt>Thumbnails</dt><dd>{formatBytes(usage.thumbnailBytes)}</dd></div>
                  </dl>
                )}
              </Show>
            </div>
            <div class="gallery-storage-manager__section">
              <h2>Watched folders</h2>
              <p>Scanning runs while Hytic is open. Supported images are imported locally and never uploaded. Select a project tab first.</p>
              <button
                type="button"
                disabled={storageBusy() || !projects().length || activeProjectId() === ALL_PROJECTS_ID}
                onClick={() => void connectFolder()}
              >
                Connect folder to {projects().find((project) => project.id === activeProjectId())?.name ?? "project"}
              </button>
              <Show when={folderNotice()}>
                <p class="gallery-folder-notice" role="status">{folderNotice()}</p>
              </Show>
              <div class="gallery-watched-folders">
                <For each={watchedFolders()}>
                  {(folder) => (
                    <article>
                      <div>
                        <strong>{folder.name}</strong>
                        <span>
                          {folder.status} · {folder.files.filter((file) => !file.missing).length} supported files · {folder.files.filter((file) => file.missing).length} missing
                          {folder.lastError ? ` · ${folder.lastError}` : ""}
                        </span>
                      </div>
                      <div>
                        <button type="button" disabled={storageBusy()} onClick={() => void rescanFolder(folder)}>Scan</button>
                        <Show when={folder.status === "disconnected" || folder.status === "permission-expired"}>
                          <button type="button" disabled={storageBusy()} onClick={() => void connectFolder(folder)}>Reconnect</button>
                        </Show>
                        <button type="button" onClick={() => void removeFolder(folder)}>Remove</button>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </div>
          </section>
        </Show>

        <div class="gallery-catalog-toolbar" aria-label="Catalog search and metadata">
          <input
            type="search"
            value={searchText()}
            onInput={(event) => setSearchText(event.currentTarget.value)}
            placeholder="Search filename, keyword, camera, or lens"
            aria-label="Search catalog"
          />
          <select
            value={minimumRating()}
            onChange={(event) => setMinimumRating(Number(event.currentTarget.value))}
            aria-label="Minimum rating"
          >
            <option value="0">Any rating</option>
            <option value="1">1+ stars</option>
            <option value="2">2+ stars</option>
            <option value="3">3+ stars</option>
            <option value="4">4+ stars</option>
            <option value="5">5 stars</option>
          </select>
          <select
            value={flagFilter()}
            onChange={(event) => setFlagFilter(event.currentTarget.value as "all" | "none" | "pick" | "reject")}
            aria-label="Flag filter"
          >
            <option value="all">Any flag</option>
            <option value="pick">Picks</option>
            <option value="reject">Rejected</option>
            <option value="none">Unflagged</option>
          </select>
          <select
            value={sortOrder()}
            onChange={(event) => setSortOrder(event.currentTarget.value as "updated" | "captured" | "rating" | "filename")}
            aria-label="Sort catalog"
          >
            <option value="updated">Recently cataloged</option>
            <option value="captured">Capture date</option>
            <option value="rating">Rating</option>
            <option value="filename">Filename</option>
          </select>
          <span class="gallery-catalog-toolbar__count">
            {selectedKeys().length ? `${selectedKeys().length} selected` : `${filteredImages().length} items`}
          </span>
          <select
            aria-label="Set selected rating"
            disabled={!selectedImages().length}
            value=""
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isInteger(value)) void applyCatalogPatch({ rating: value as MediaCatalogFields["rating"] });
              event.currentTarget.value = "";
            }}
          >
            <option value="">Set rating…</option>
            <option value="0">Unrated</option>
            <option value="1">★</option>
            <option value="2">★★</option>
            <option value="3">★★★</option>
            <option value="4">★★★★</option>
            <option value="5">★★★★★</option>
          </select>
          <button type="button" disabled={!selectedImages().length} onClick={() => void applyCatalogPatch({ flag: "pick" })}>Pick</button>
          <button type="button" disabled={!selectedImages().length} onClick={() => void applyCatalogPatch({ flag: "reject" })}>Reject</button>
          <button type="button" disabled={!selectedImages().length} onClick={() => void editKeywords()}>
            Keywords
          </button>
          <button type="button" disabled={!selectedImages().length} onClick={() => void createCollection("manual")}>
            New collection
          </button>
          <button type="button" onClick={() => void createCollection("saved-search")}>
            Save search
          </button>
          <button
            type="button"
            disabled={activeCollectionId() === ALL_COLLECTIONS_ID}
            onClick={() => void deleteActiveCollection()}
          >
            Delete collection
          </button>
        </div>

        <Show when={collections().length > 0}>
          <nav class="gallery-collections" aria-label="Collections and saved searches">
            <button
              type="button"
              classList={{ "gallery-collection--active": activeCollectionId() === ALL_COLLECTIONS_ID }}
              onClick={() => setActiveCollectionId(ALL_COLLECTIONS_ID)}
            >
              All catalog
            </button>
            <For each={collections()}>
              {(collection) => (
                <button
                  type="button"
                  classList={{ "gallery-collection--active": activeCollectionId() === collection.id }}
                  onClick={() => setActiveCollectionId(collection.id)}
                  title={collection.kind === "manual" ? "Manual collection" : "Saved search"}
                >
                  {collection.name}
                </button>
              )}
            </For>
          </nav>
        </Show>

        <Show when={state() === "loading"}>
          <div class="gallery-status" role="status">
            Loading gallery
          </div>
        </Show>
        <Show when={state() === "error"}>
          <div class="gallery-status" role="alert">
            {error()}
          </div>
        </Show>
        <Show when={state() === "empty"}>
          <div class="gallery-status">No imported images yet.</div>
        </Show>

        <Show when={state() === "ready"}>
          <div class="gallery-masonry">
            <For each={filteredImages()}>
              {(image, index) => (
                <button
                  type="button"
                  class="gallery-card"
                  classList={{ "gallery-card--selected": selectedKeys().includes(previewKey(image)) }}
                  aria-label={`Open ${image.title}`}
                  aria-pressed={selectedKeys().includes(previewKey(image))}
                  onPointerEnter={() => warmPreview(image)}
                  onPointerDown={() => warmPreview(image)}
                  onFocus={() => warmPreview(image)}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                      toggleSelection(image, true);
                      return;
                    }
                    const img = event.currentTarget.querySelector<HTMLImageElement>("img");
                    if (img) void openLightbox(image, img);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    toggleSelection(image, true);
                  }}
                >
                  <span
                    class="gallery-card__selector"
                    role="checkbox"
                    aria-checked={selectedKeys().includes(previewKey(image))}
                    tabindex="0"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSelection(image, true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== " " && event.key !== "Enter") return;
                      event.preventDefault();
                      event.stopPropagation();
                      toggleSelection(image, true);
                    }}
                  >
                    {selectedKeys().includes(previewKey(image)) ? "✓" : ""}
                  </span>
                  <GalleryThumb
                    image={image}
                    priority={index() < 8}
                    resolvePreviewUrl={resolvePreviewUrl}
                  />
                  <span class="gallery-card__overlay" aria-hidden="true" />
                  <span class="gallery-card__badges" aria-hidden="true">
                    <Show when={image.catalog.rating > 0}>
                      <span>{"★".repeat(image.catalog.rating)}</span>
                    </Show>
                    <Show when={image.catalog.flag !== "none"}>
                      <span class={`gallery-card__flag gallery-card__flag--${image.catalog.flag}`}>
                        {image.catalog.flag === "pick" ? "Pick" : "Reject"}
                      </span>
                    </Show>
                    <Show when={image.catalog.keywords.length > 0}>
                      <span>{image.catalog.keywords.length} tags</span>
                    </Show>
                  </span>
                  <span class="gallery-card__info">
                    <span>
                      <strong>{image.title}</strong>
                      <small>{image.category}</small>
                    </span>
                    <span class="gallery-card__open" aria-hidden="true">
                      ↗
                    </span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={lightbox()}>
        {(current) => (
          <div
            class="gallery-lightbox"
            classList={{
              "gallery-lightbox--open": current().phase === "open",
              "gallery-lightbox--closing": current().phase === "closing",
            }}
            role="dialog"
            aria-modal="true"
            aria-label={current().image.title}
            onClick={closeLightbox}
          >
            <button
              type="button"
              class="gallery-lightbox__close"
              aria-label="Close"
              onClick={(event) => {
                event.stopPropagation();
                closeLightbox();
              }}
            >
              ×
            </button>
            <button
              type="button"
              class="gallery-lightbox__nav gallery-lightbox__nav--prev"
              aria-label="Previous image"
              onClick={(event) => {
                event.stopPropagation();
                void showRelativeImage(-1);
              }}
            >
              ‹
            </button>
            <img
              class="gallery-lightbox__image"
              classList={{ "gallery-lightbox__image--switching": current().switching }}
              src={current().previewUrl}
              alt={current().image.title}
              width={current().image.width || undefined}
              height={current().image.height || undefined}
              decoding="async"
              style={{
                "--gallery-source-top": `${current().sourceRect.top}px`,
                "--gallery-source-left": `${current().sourceRect.left}px`,
                "--gallery-source-width": `${current().sourceRect.width}px`,
                "--gallery-source-height": `${current().sourceRect.height}px`,
                "--gallery-target-top": `${current().targetRect.top}px`,
                "--gallery-target-left": `${current().targetRect.left}px`,
                "--gallery-target-width": `${current().targetRect.width}px`,
                "--gallery-target-height": `${current().targetRect.height}px`,
              }}
              onClick={closeLightbox}
              draggable={false}
            />
            <button
              type="button"
              class="gallery-lightbox__nav gallery-lightbox__nav--next"
              aria-label="Next image"
              onClick={(event) => {
                event.stopPropagation();
                void showRelativeImage(1);
              }}
            >
              ›
            </button>
          </div>
        )}
      </Show>
    </main>
  );
}

function GalleryThumb(props: {
  image: GalleryImage;
  priority: boolean;
  resolvePreviewUrl: (image: GalleryImage) => Promise<string>;
}) {
  let ref: HTMLImageElement | undefined;
  const [url, setUrl] = createSignal(untrack(() => props.image.thumbnailUrl));
  const [shouldUpgrade, setShouldUpgrade] = createSignal(untrack(() => props.priority));
  const [loaded, setLoaded] = createSignal(false);
  const [upgraded, setUpgraded] = createSignal(false);

  onMount(() => {
    if (props.priority || !ref || typeof IntersectionObserver === "undefined") {
      setShouldUpgrade(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setShouldUpgrade(true);
        observer.disconnect();
      },
      { rootMargin: THUMB_PRELOAD_MARGIN },
    );

    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    // Only pre-resolve the preview url in the cache for the lightbox so it opens instantly,
    // but DO NOT set it as the src of the thumbnail img to save memory.
    if (!shouldUpgrade()) return;
    void props.resolvePreviewUrl(props.image);
  });

  return (
    <img
      ref={ref}
      class="gallery-card__thumb"
      classList={{
        "gallery-card__thumb--loaded": loaded(),
        "gallery-card__thumb--upgraded": upgraded(),
      }}
      src={url()}
      alt={props.image.title}
      width={props.image.width || undefined}
      height={props.image.height || undefined}
      loading={props.priority ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (url() !== props.image.thumbnailUrl) {
          setUrl(props.image.thumbnailUrl);
          setUpgraded(false);
        }
      }}
      draggable={false}
    />
  );
}
