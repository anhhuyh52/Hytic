import type {
  MediaSummary,
  MediaVersionSnapshot,
  SavedProjectSummary,
  SerializedEditState,
} from "./ProjectTypes";
import type { SerializedVideoState } from "../video/types";
import * as indexedDbMediaStore from "./mediaStore";
import * as indexedDbProjectStore from "./projectStore";
import * as indexedDbStorage from "./indexedDbProjectStore";
import * as opfsStorage from "./storage/storageBridge";

export type PersistenceKind = "opfs" | "indexeddb";

export type ProjectRepository = {
  readonly kind: PersistenceKind;
  readonly mediaListProvider: (() => Promise<MediaSummary[]>) | null;
  listProjectSummaries(): Promise<SavedProjectSummary[]>;
  hydrateProjectSummary(projectId: string): Promise<SavedProjectSummary | undefined>;
  hydrateMediaThumbnail(assetId: string): Promise<Blob | undefined>;
  saveVersionSnapshot(
    assetId: string,
    name: string,
    state: SerializedEditState,
    current: MediaVersionSnapshot[],
    videoState?: SerializedVideoState,
  ): Promise<MediaVersionSnapshot | null>;
  deleteVersionSnapshot(assetId: string, id: string, next: MediaVersionSnapshot[]): Promise<void>;
  renameVersionSnapshot(
    assetId: string,
    id: string,
    name: string,
    next: MediaVersionSnapshot[],
  ): Promise<void>;
  updateVersionSnapshot(
    assetId: string,
    id: string,
    state: SerializedEditState,
    next: MediaVersionSnapshot[],
    videoState?: SerializedVideoState,
  ): Promise<void>;
  clearVersionSnapshots(assetId: string): Promise<void>;
};

type RepositoryOptions = {
  kind?: PersistenceKind;
};

function runtimePersistenceKind(): PersistenceKind {
  return (window as { __USE_INDEXEDDB_PERSISTENCE?: boolean }).__USE_INDEXEDDB_PERSISTENCE === true
    ? "indexeddb"
    : "opfs";
}

function createOpfsRepository(): ProjectRepository {
  return {
    kind: "opfs",
    mediaListProvider: opfsStorage.listMediaSummaries,
    listProjectSummaries: opfsStorage.listProjectSummaries,
    hydrateProjectSummary: opfsStorage.hydrateVisibleProjectSummary,
    hydrateMediaThumbnail: opfsStorage.hydrateVisibleMediaThumbnail,
    async saveVersionSnapshot(_assetId, name, state, _current, videoState) {
      const saved = await opfsStorage.saveActiveSnapshot(name, state, videoState);
      return saved
        ? { id: saved.id, name: saved.name, createdAt: saved.date, editState: state, videoState }
        : null;
    },
    async deleteVersionSnapshot(_assetId, id) {
      await opfsStorage.deleteActiveSnapshot(id);
    },
    async renameVersionSnapshot(_assetId, id, name) {
      await opfsStorage.renameActiveSnapshot(id, name);
    },
    async updateVersionSnapshot(_assetId, id, state, _next, videoState) {
      await opfsStorage.updateActiveSnapshot(id, state, videoState);
    },
    async clearVersionSnapshots() {
      await opfsStorage.clearActiveSnapshots();
    },
  };
}

function createIndexedDbRepository(): ProjectRepository {
  return {
    kind: "indexeddb",
    mediaListProvider: null,
    listProjectSummaries: indexedDbProjectStore.listProjects,
    hydrateProjectSummary: indexedDbStorage.hydrateProjectSummary,
    hydrateMediaThumbnail: indexedDbMediaStore.getThumbnail,
    async saveVersionSnapshot(assetId, name, state, current, videoState) {
      const snapshot: MediaVersionSnapshot = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        name,
        createdAt: Date.now(),
        editState: state,
        videoState,
      };
      await indexedDbMediaStore.saveMediaSnapshots(assetId, [snapshot, ...current]);
      return snapshot;
    },
    async deleteVersionSnapshot(assetId, _id, next) {
      await indexedDbMediaStore.saveMediaSnapshots(assetId, next);
    },
    async renameVersionSnapshot(assetId, _id, _name, next) {
      await indexedDbMediaStore.saveMediaSnapshots(assetId, next);
    },
    async updateVersionSnapshot(assetId, _id, _state, next) {
      await indexedDbMediaStore.saveMediaSnapshots(assetId, next);
    },
    async clearVersionSnapshots(assetId) {
      await indexedDbMediaStore.saveMediaSnapshots(assetId, []);
    },
  };
}

/** Selects the browser persistence adapter once during application composition. */
export function createProjectRepository(options: RepositoryOptions = {}): ProjectRepository {
  return (options.kind ?? runtimePersistenceKind()) === "opfs"
    ? createOpfsRepository()
    : createIndexedDbRepository();
}
