import type { EditState } from "../engine/state/EditState";
import type { ImageInfo } from "../app/editor-store";
import type { LoadedProject, SavedProject, SavedProjectSummary } from "./ProjectTypes";
import { CURRENT_SCHEMA_VERSION, SESSION_PROJECT_ID } from "./ProjectTypes";
import { toPlainSerializedEditState } from "./serializeEditState";
import { deserializeEditState } from "./deserializeEditState";
import { migrateProject } from "./projectMigrations";
import * as store from "./indexedDbProjectStore";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type SaveParams = {
  name: string;
  editState: EditState;
  imageBlob: Blob;
  imageInfo: ImageInfo;
  /** Pass an existing project id to update it; omit to create a new record. */
  existingProjectId?: string;
  /**
   * How imageBlob is stored: "original" = the source file as-uploaded; "developed"
   * = the decoded source re-encoded (for heavy formats, so reopen skips re-decode).
   * Defaults to "original".
   */
  storage?: "original" | "developed";
  /** Small JPEG thumbnail for the project browser. */
  thumbnail?: Blob;
};

/** Create or update a project in IndexedDB. Returns the saved project record. */
export async function saveProject(params: SaveParams): Promise<SavedProject> {
  const {
    name,
    editState,
    imageBlob,
    imageInfo,
    existingProjectId,
    storage,
    thumbnail,
  } = params;

  const serialized = toPlainSerializedEditState(editState);
  const now = Date.now();
  const imageId = existingProjectId
    ? ((await store.getProject(existingProjectId))?.image.id ?? generateId())
    : generateId();

  const project: SavedProject = {
    id: existingProjectId ?? generateId(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    createdAt: existingProjectId
      ? ((await store.getProject(existingProjectId))?.createdAt ?? now)
      : now,
    updatedAt: now,
    image: {
      id: imageId,
      fileName: imageInfo.fileName,
      mimeType: imageBlob.type || "image/png",
      width: imageInfo.width,
      height: imageInfo.height,
      sizeBytes: imageBlob.size,
      storage: storage ?? "original",
    },
    editState: serialized,
  };

  await store.saveProject(project, imageBlob, thumbnail);
  return project;
}

export async function openProject(projectId: string): Promise<LoadedProject> {
  const raw = await store.getProject(projectId);
  if (!raw) throw new Error(`Project ${projectId} not found.`);

  // Run schema migration/validation
  const project = migrateProject(raw);

  const imageBlob = await store.loadProjectImage(project.image.id);
  if (!imageBlob) {
    throw new Error(
      `Image data for project "${project.name}" is missing. The project may be corrupted.`,
    );
  }

  return {
    project,
    imageBlob,
    editState: project.editState,
  };
}

export async function deleteProject(projectId: string): Promise<void> {
  await store.deleteProject(projectId);
}

export async function listProjects(): Promise<SavedProjectSummary[]> {
  return store.listProjects();
}

/** Deserialize a project's serialized edit state to a live EditState. */
export function hydrateEditState(loaded: LoadedProject): EditState {
  return deserializeEditState(loaded.editState);
}

// ── Current-session autosave ───────────────────────────────────────────────
// The working image + edits are continuously persisted to a reserved project slot
// so reloading the page restores what you were doing (like legacy). The image is
// stored as-uploaded ("original") so autosaving on every edit is cheap (no
// re-encode); restoring re-runs the normal decode. Hidden from the project browser.

export type SaveSessionParams = {
  editState: EditState;
  imageBlob: Blob;
  imageInfo: ImageInfo;
  /** "developed" = the decoded source PNG (instant restore for RAW); "original" = the
   *  source file (re-decoded on restore). Defaults to "original". */
  storage?: "original" | "developed";
};

export async function saveSession(params: SaveSessionParams): Promise<void> {
  const storage = params.storage ?? "original";
  const existing = await store.getProject(SESSION_PROJECT_ID);
  const mimeType = params.imageBlob.type || "image/png";
  const sizeBytes = params.imageBlob.size;

  // Hot autosave path: when the active image did not change, update only the
  // small JSON project/edit-state record. Rewriting a 40–100MB developed RAW PNG
  // to IndexedDB on every slider change causes the same lag legacy avoids.
  if (
    existing &&
    existing.image.fileName === params.imageInfo.fileName &&
    existing.image.mimeType === mimeType &&
    existing.image.width === params.imageInfo.width &&
    existing.image.height === params.imageInfo.height &&
    existing.image.sizeBytes === sizeBytes &&
    existing.image.storage === storage
  ) {
    const now = Date.now();
    await store.saveProjectRecord({
      ...existing,
      updatedAt: now,
      image: {
        ...existing.image,
        fileName: params.imageInfo.fileName,
        mimeType,
        width: params.imageInfo.width,
        height: params.imageInfo.height,
        sizeBytes,
        storage,
      },
      editState: toPlainSerializedEditState(params.editState),
    });
    return;
  }

  // Cold path: image changed or session image not stored yet, so write the image
  // blob once. Later edit autosaves will take the JSON-only path above.
  await saveProject({
    name: "(session)",
    editState: params.editState,
    imageBlob: params.imageBlob,
    imageInfo: params.imageInfo,
    existingProjectId: SESSION_PROJECT_ID,
    storage,
  });
}

/** Loads the auto-saved session, or null if there isn't one. */
export async function loadSession(): Promise<LoadedProject | null> {
  try {
    return await openProject(SESSION_PROJECT_ID);
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await deleteProject(SESSION_PROJECT_ID);
}
