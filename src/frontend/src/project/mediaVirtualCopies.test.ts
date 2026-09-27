import { afterEach, describe, expect, it, vi } from "vitest";
import * as mediaStore from "./mediaStore";
import * as store from "./indexedDbProjectStore";
import type {
  MediaRecord,
  MediaSourceRecord,
  ProjectRecord,
  StoredImageRecord,
} from "./ProjectTypes";

const media: MediaRecord = {
  assetId: "original.jpg",
  projectId: "project-1",
  fileName: "original.jpg",
  mimeType: "image/jpeg",
  width: 100,
  height: 80,
  sizeBytes: 12,
  storage: "original",
  imageId: "old-image",
  thumbnailId: "old-thumb",
  galleryPreviewId: "old-preview",
  editState: { preset: { selectedPresetId: "look" } } as MediaRecord["editState"],
  snapshots: [{ id: "s", name: "snapshot", createdAt: 1, editState: {} as MediaRecord["editState"] }],
  createdAt: 1,
  updatedAt: 1,
};

const project: ProjectRecord = {
  id: "project-1",
  schemaVersion: 1,
  name: "Project",
  createdAt: 1,
  updatedAt: 1,
  activeUserMedia: "original.jpg",
  assetIds: ["original.jpg"],
};

afterEach(() => vi.restoreAllMocks());

describe("virtual copies", () => {
  it("migrates with copy/verify/commit ordering and shares one source", async () => {
    const records = new Map<string, MediaRecord>([[media.assetId, media]]);
    const sources = new Map<string, MediaSourceRecord>();
    const images = new Map<string, StoredImageRecord>([
      ["old-image", { id: "old-image", kind: "original", blob: new Blob(["pixels"]) }],
    ]);
    const thumbs = new Map([["old-thumb", new Blob(["thumb"])]]);
    const previews = new Map([["old-preview", new Blob(["preview"])]]);
    vi.spyOn(store, "getMedia").mockImplementation(async (id) => records.get(id));
    vi.spyOn(store, "putMedia").mockImplementation(async (record) => { records.set(record.assetId, record); });
    vi.spyOn(store, "getMediaSource").mockImplementation(async (id) => sources.get(id));
    vi.spyOn(store, "putMediaSource").mockImplementation(async (source) => { sources.set(source.sourceId, source); });
    vi.spyOn(store, "getImageRecord").mockImplementation(async (id) => images.get(id));
    vi.spyOn(store, "putImageRecord").mockImplementation(async (record) => { images.set(record.id, record); });
    vi.spyOn(store, "deleteImageRecord").mockImplementation(async (id) => { images.delete(id); });
    vi.spyOn(store, "getThumbnail").mockImplementation(async (id) => thumbs.get(id));
    vi.spyOn(store, "putThumbnail").mockImplementation(async (id, blob) => { thumbs.set(id, blob); });
    vi.spyOn(store, "deleteThumbnailRecord").mockImplementation(async (id) => { thumbs.delete(id); });
    vi.spyOn(store, "getGalleryPreview").mockImplementation(async (id) => previews.get(id));
    vi.spyOn(store, "putGalleryPreview").mockImplementation(async (id, blob) => { previews.set(id, blob); });
    vi.spyOn(store, "deleteGalleryPreview").mockImplementation(async (id) => { previews.delete(id); });
    vi.spyOn(store, "getProjectRecord").mockResolvedValue(project);
    const saveProject = vi.spyOn(store, "putProjectRecord").mockResolvedValue();

    const copy = await mediaStore.createVirtualCopy("original.jpg", "Version B");
    const migrated = records.get("original.jpg")!;
    const source = sources.get(copy.sourceId!)!;

    expect(migrated.sourceId).toBe(copy.sourceId);
    expect(copy.variantKind).toBe("virtual-copy");
    expect(copy.snapshots).toEqual([]);
    expect(copy.editState).toEqual(media.editState);
    expect(copy.editState).not.toBe(media.editState);
    expect(source.refCount).toBe(2);
    expect(images.has("old-image")).toBe(false);
    expect(images.has(source.imageId)).toBe(true);
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({
      assetIds: ["original.jpg", copy.assetId],
    }));
  });
});
