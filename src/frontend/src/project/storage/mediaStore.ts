// Media store — faithful port of the legacy media helpers in package.min.js:
//   lu  loadMedia (reentrancy-guarded; resolve image/thumbnail/state → jh → emit)
//   au  resolveImageSource   ru  isImageEntry   vh  rebuildImageData
//   ou  readMediaState (per-image state.json, RAW/EXR IDT default)
//   Zh  generateThumbnail (JPEG q0.7, max-side 256)
//   qh  writeDecodedMedia (image.data + thumbnail.jpeg + metadata.json)
//   $h  clearCurrentMedia
//
// The legacy global `y` (current media) is module state here. The image DRAW and
// "apply state after draw" (req 9) stay with the caller (Phase 6 wiring): loadMedia
// resolves the source/thumbnail/state into a MediaContext; the caller draws, then
// patches `stateToApply` on success. legacy `jh` cross-project re-activation is
// handled via the Phase 2 project store.

import {
  createImageDerivatives,
  THUMBNAIL_LONG_EDGE,
  THUMBNAIL_JPEG_QUALITY,
  GALLERY_PREVIEW_LONG_EDGE,
  GALLERY_PREVIEW_JPEG_QUALITY,
} from "../imageDerivatives";
import type { FsFileHandle } from "./memoryHandles";
import type { ProjectDirectory } from "./ProjectDirectory";
import {
  buildProjectContext,
  getActiveProject,
  setActiveProject,
  setActiveUserMedia,
} from "./projectStore";
import * as perf from "../../app/performanceCounters";
import { DEFAULT_EDIT_STATE } from "../../engine/state/EditState";
import { toPlainSerializedEditState } from "../serializeEditState";
import { deserializeEditState } from "../deserializeEditState";
import type { SerializedEditState } from "../ProjectTypes";
import { RAW_EXTENSIONS } from "../../engine/io/CodecRegistry";

/** Resolved visible image source — a Blob (image.<ext>) or rebuilt ImageData (image.data). */
export type MediaImageSource = Blob | ImageData;

export type MediaMetadata = { width: number; height: number; [key: string]: unknown };

/** Legacy `y`: the loaded media context. */
export type MediaContext = {
  rootDirectory: ProjectDirectory;
  name: string;
  mainPreviewSourceName: string;
  image: MediaImageSource;
  thumbnail: Blob;
  thumbnailURL: string;
  stateToApply: SerializedEditState;
  metadata: MediaMetadata;
};

/** Lightweight media data that can be read before the renderer is ready. */
export type PreparedMediaContext = {
  rootDirectory: ProjectDirectory;
  name: string;
  thumbnail: Blob;
  stateToApply: SerializedEditState;
  metadata: MediaMetadata;
};

// RAW extensions get the camera/log IDT; .exr gets the EXR IDT (matches the
// engine's defaultEditStateForImport). Everything else uses the plain default.
const RAW_IDT = "VisionLog";
const EXR_IDT = "EXR_IDT";

let mediaLoadToken = 0;
let currentMedia: MediaContext | null = null; // legacy `y`

/** The loaded media context (legacy `y`), or null. */
export function getCurrentMedia(): MediaContext | null {
  return currentMedia;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Legacy `ru`: an entry whose name starts with "image". */
function isImageEntry(entry: { name: string }): boolean {
  return typeof entry.name === "string" && entry.name.startsWith("image");
}

async function resolvePayloadDirectory(dir: ProjectDirectory): Promise<ProjectDirectory> {
  const pointer = await dir
    .getFileAsParsedJSON<{ sourceId?: string }>("source-pointer.json")
    .catch(() => undefined);
  if (!pointer?.sourceId) return dir;
  const projectDir = await dir.getAncestorDirectory(2);
  const sourcesDir = await projectDir?.getDirectory("sources", false).catch(() => undefined);
  const sourceDir = await sourcesDir?.getDirectory(pointer.sourceId, false).catch(() => undefined);
  if (!sourceDir) throw new Error(`[storage] shared source missing: ${pointer.sourceId}`);
  return sourceDir;
}

/** Legacy `vh`: rebuild ImageData from an `image.data` handle + metadata dims. */
async function rebuildImageData(handle: FsFileHandle, metadata: MediaMetadata): Promise<ImageData> {
  const file = await handle.getFile();
  const buffer = await (file as Blob).arrayBuffer();
  return new ImageData(new Uint8ClampedArray(buffer), metadata.width, metadata.height);
}

/** Legacy `au`: resolve the visible image source for a media directory. */
export async function resolveImageSource(
  dir: ProjectDirectory,
): Promise<{ image: MediaImageSource; sourceName: string }> {
  const payloadDir = await resolvePayloadDirectory(dir);
  const handle = (await payloadDir.findFile(isImageEntry as never, false)) as FsFileHandle | undefined;
  if (!handle) throw new Error(`[storage] no image file in media "${dir.name}"`);
  if (handle.name === "thumbnail.jpeg") {
    throw new Error("thumbnail.jpeg must not be used as main editor preview");
  }
  if (handle.name.endsWith(".data")) {
    const metadata = await payloadDir.getFileAsParsedJSON<MediaMetadata>("metadata.json");
    return { image: await rebuildImageData(handle, metadata), sourceName: handle.name };
  }
  return { image: (await handle.getFile()) as Blob, sourceName: handle.name };
}

/** Default per-image state with the right IDT for RAW/EXR (legacy `ou` fallback). */
function defaultMediaState(name: string): SerializedEditState {
  const editState = deserializeEditState(toPlainSerializedEditState(DEFAULT_EDIT_STATE));
  const ext = extensionOf(name);
  if (RAW_EXTENSIONS.has(`.${ext}`)) editState.colorManagement.inputColorSpaceId = RAW_IDT;
  else if (ext === "exr") editState.colorManagement.inputColorSpaceId = EXR_IDT;
  return toPlainSerializedEditState(editState);
}

/** Legacy `ou`: the media's `state.json`, or a default (RAW/EXR-aware) if absent. */
export async function readMediaState(dir: ProjectDirectory): Promise<SerializedEditState> {
  try {
    const state = await dir.getFileAsParsedJSON<SerializedEditState>("state.json");
    perf.recordActiveStateJsonLoad();
    return state;
  } catch {
    return defaultMediaState(dir.name);
  }
}

/** Persist a media's per-image `state.json` (autosave target, req 12). */
export async function writeMediaState(
  dir: ProjectDirectory,
  state: SerializedEditState,
): Promise<void> {
  return dir.saveFile("state.json", state);
}

/**
 * Legacy `Jm` (FS-side): merge an edit-state patch into a (non-active) media's
 * `state.json` — the copy/paste-edits-to-selected-media path (req 15). Applying to
 * the active media is the caller's concern (it edits the live editor state).
 */
export async function applyStateToMedia(
  dir: ProjectDirectory,
  patch: Partial<SerializedEditState>,
): Promise<SerializedEditState> {
  const current = await readMediaState(dir);
  const next = { ...current, ...patch } as SerializedEditState;
  await writeMediaState(dir, next);
  return next;
}

/** Legacy `tg`: reset a media's edits to the (RAW/EXR-aware) default (req 15). */
export async function resetMediaState(dir: ProjectDirectory): Promise<SerializedEditState> {
  const next = defaultMediaState(dir.name);
  await writeMediaState(dir, next);
  return next;
}

const THUMB_OPTIONS: ImageEncodeOptions = { type: "image/jpeg", quality: 0.7 };

function importDebugEnabled(): boolean {
  return (
    !!(globalThis as { __DEBUG_IMPORT_IMAGES__?: boolean; __DEBUG_PREVIEW_LOADING__?: boolean })
      .__DEBUG_IMPORT_IMAGES__ ||
    !!(globalThis as { __DEBUG_IMPORT_IMAGES__?: boolean; __DEBUG_PREVIEW_LOADING__?: boolean })
      .__DEBUG_PREVIEW_LOADING__
  );
}

function logImportStore(stage: string, values: Record<string, unknown>): void {
  if (!importDebugEnabled()) return;
  console.table({ stage, ...values });
}

/** Aspect-preserving downscale to a max side (legacy `uh`). */
function aspectResize(width: number, height: number, max: number): [number, number] {
  if (Math.max(width, height) <= max) return [width, height];
  const aspect = width / height;
  return width > height ? [max, Math.round(max / aspect)] : [Math.round(max * aspect), max];
}

/**
 * Legacy `Zh`: JPEG thumbnail (quality 0.7, max side default 256). A Blob with
 * unknown dimensions is measured via an <img>; ImageData / known-dimension buffers
 * use `createImageBitmap` with `resizeQuality: "low"` (req 11).
 */
export function generateThumbnail(
  source: Blob | ImageData | ImageBitmap,
  maxSide = 256,
): Promise<Blob> {
  if (source instanceof Blob) {
    return new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onerror = reject;
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        URL.revokeObjectURL(img.src);
        const [tw, th] = aspectResize(w, h, maxSide);
        const canvas = new OffscreenCanvas(tw, th);
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h, 0, 0, tw, th);
        logImportStore("legacy-thumbnail", {
          sourceWidth: w,
          sourceHeight: h,
          thumbnailWidth: tw,
          thumbnailHeight: th,
          thumbnailType: THUMB_OPTIONS.type,
          thumbnailQuality: THUMB_OPTIONS.quality,
        });
        canvas.convertToBlob(THUMB_OPTIONS).then(resolve, reject);
      };
      img.src = URL.createObjectURL(source);
    });
  }

  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    const [width, height] = aspectResize(source.width, source.height, maxSide);
    const canvas = new OffscreenCanvas(width, height);
    canvas
      .getContext("2d")!
      .drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
    logImportStore("legacy-thumbnail", {
      sourceWidth: source.width,
      sourceHeight: source.height,
      thumbnailWidth: width,
      thumbnailHeight: height,
      thumbnailType: THUMB_OPTIONS.type,
      thumbnailQuality: THUMB_OPTIONS.quality,
    });
    return canvas.convertToBlob(THUMB_OPTIONS);
  }

  const { width, height } = source;
  return createImageBitmap(source, {
    resizeQuality: "low",
    [width > height ? "resizeWidth" : "resizeHeight"]: maxSide,
  } as ImageBitmapOptions).then((bitmap) => {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    logImportStore("legacy-thumbnail", {
      sourceWidth: width,
      sourceHeight: height,
      thumbnailWidth: bitmap.width,
      thumbnailHeight: bitmap.height,
      thumbnailType: THUMB_OPTIONS.type,
      thumbnailQuality: THUMB_OPTIONS.quality,
    });
    bitmap.close();
    return canvas.convertToBlob(THUMB_OPTIONS);
  });
}

/**
 * Legacy `qh`: write a decoded (RGBA) media directory — `image.data` +
 * `thumbnail.jpeg` + `metadata.json` (with width/height). Returns the media dir.
 */
export async function writeDecodedMedia(
  rgba: ArrayBuffer | Uint8ClampedArray,
  name: string,
  width: number,
  height: number,
  userMediaDir: ProjectDirectory,
  metadata: Record<string, unknown> = {},
  derivativeSource?: ImageBitmap,
  onBeforeWrite?: () => void,
): Promise<ProjectDirectory> {
  const ext = extensionOf(name);
  const meta: MediaMetadata = {
    ...metadata,
    width,
    height,
    originalName: typeof metadata.originalName === "string" ? metadata.originalName : name,
    name,
    extension: typeof metadata.extension === "string" ? metadata.extension : ext,
    storage: "data",
  };
  const bytes = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const imageData = new ImageData(bytes as any, width, height);
  const [thumbnail, galleryPreview] = await createImageDerivatives(derivativeSource ?? imageData, [
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
  onBeforeWrite?.();
  const mediaDir = (await userMediaDir.getDirectory(name, true))!;
  await mediaDir.saveFiles({
    "image.data": rgba,
    "thumbnail.jpeg": thumbnail,
    "gallery-preview.jpeg": galleryPreview,
    "smart-preview.jpeg": galleryPreview,
    "smart-preview.json": { policy: 2560, colorSpace: "sRGB", generatedAt: Date.now() },
    "metadata.json": meta,
  });
  logImportStore("legacy-write-decoded-media", {
    activeMediaId: mediaDir.name,
    activeMediaName: name,
    storage: "image.data",
    metadataWidth: width,
    metadataHeight: height,
    thumbnailBytes: thumbnail.size,
  });
  return mediaDir;
}

/** Legacy `$h`: clear the current media context (revokes the thumbnail URL). */
export function clearCurrentMedia(): void {
  if (currentMedia?.thumbnailURL) URL.revokeObjectURL(currentMedia.thumbnailURL);
  currentMedia = null;
}

/**
 * Legacy `jh` (media-loaded branch): ensure the active project matches the media's
 * project (re-activating via the media's ancestor when it doesn't), then record
 * the active media name.
 */
async function syncActiveMediaToProject(media: MediaContext): Promise<void> {
  const active = getActiveProject();
  if (!active || !(await active.rootDirectory.contains(media.rootDirectory))) {
    const projectDir = await media.rootDirectory.getAncestorDirectory(2); // media → user-media → project
    if (projectDir) await setActiveProject(await buildProjectContext(projectDir));
  }
  await setActiveUserMedia(media.name);
}

/**
 * Read only the startup-safe media header. The full image payload is deliberately
 * excluded so the cached thumbnail can paint before a large image.data allocation.
 */
export async function prepareMedia(dir: ProjectDirectory): Promise<PreparedMediaContext> {
  const payloadDir = await resolvePayloadDirectory(dir);
  const [thumbnailFile, stateToApply, metadata] = await Promise.all([
    payloadDir.getFile("thumbnail.jpeg").catch(() => undefined),
    readMediaState(dir),
    dir.getFileAsParsedJSON<MediaMetadata>("metadata.json").catch(() => ({ width: 0, height: 0 })),
  ]);

  return {
    rootDirectory: dir,
    name: dir.name,
    thumbnail: thumbnailFile instanceof Blob ? thumbnailFile : new Blob([]),
    stateToApply,
    metadata,
  };
}

async function hydratePreparedMedia(
  prepared: PreparedMediaContext,
  token: number,
): Promise<MediaContext | null> {
  const { image, sourceName } = await resolveImageSource(prepared.rootDirectory);
  if (token !== mediaLoadToken) return currentMedia;

  const thumbnailURL = prepared.thumbnail.size > 0 ? URL.createObjectURL(prepared.thumbnail) : "";

  clearCurrentMedia();
  currentMedia = {
    ...prepared,
    mainPreviewSourceName: sourceName,
    image,
    thumbnailURL,
  };
  await syncActiveMediaToProject(currentMedia);
  return currentMedia;
}

/** Finish a prepared startup media load once the renderer is ready. */
export async function loadPreparedMedia(
  prepared: PreparedMediaContext,
  force = false,
): Promise<MediaContext | null> {
  if (currentMedia && currentMedia.rootDirectory.path === prepared.rootDirectory.path && !force) {
    return currentMedia;
  }

  return hydratePreparedMedia(prepared, ++mediaLoadToken);
}

/**
 * Legacy `lu`: load a media directory. Reentrancy-guarded; clears the previous
 * media; resolves image source + thumbnail + per-image state; syncs activeUserMedia.
 * Returns the MediaContext the caller draws (then applies `stateToApply` AFTER the
 * draw/upload succeeds — req 9). `dir === null` with media loaded is a no-op reload
 * hook; with no media it clears.
 */
export async function loadMedia(
  dir: ProjectDirectory | null,
  force = false,
): Promise<MediaContext | null> {
  const token = ++mediaLoadToken;
  if (!dir) {
    if (!currentMedia) clearCurrentMedia();
    return currentMedia;
  }
  if (currentMedia && currentMedia.rootDirectory.path === dir.path && !force) {
    return currentMedia;
  }

  const prepared = await prepareMedia(dir);
  if (token !== mediaLoadToken) return currentMedia;
  return hydratePreparedMedia(prepared, token);
}
