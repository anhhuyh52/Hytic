import { beforeEach, describe, expect, it } from "vitest";
import { openRootDirectory, resetStorageDirectoryCaches } from "./ProjectDirectory";
import {
  clearCurrentMedia,
  loadMedia,
  loadPreparedMedia,
  prepareMedia,
} from "./mediaStore";
import { resetProjectStore } from "./projectStore";
import { initMemoryFs, setStorageAccount, storageContext } from "./storageWriter";
import {
  createVirtualCopyByName,
  listMediaDirectoryPlaceholders,
  openProject,
  switchMedia,
} from "./storageBridge";

class TestImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

beforeEach(() => {
  storageContext.handle = null;
  storageContext.getWriteAccess = null;
  storageContext.write = null;
  storageContext.dir = null;
  initMemoryFs();
  setStorageAccount("startup-account");
  resetStorageDirectoryCaches();
  resetProjectStore();
  clearCurrentMedia();
});

async function makeMediaDirectory() {
  const root = await openRootDirectory();
  const projects = (await root.getDirectory("projects", true))!;
  const project = (await projects.getDirectory("project-1", true))!;
  const userMedia = (await project.getDirectory("user-media", true))!;
  const media = (await userMedia.getDirectory("photo-1", true))!;

  await project.saveFile("state.json", {
    id: "project-1",
    name: "Project 1",
    activeUserMedia: "photo-1",
  });
  await media.saveFiles({
    "image.data": new Uint8ClampedArray(2 * 2 * 4).fill(128).buffer,
    "thumbnail.jpeg": new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    "metadata.json": { width: 2, height: 2, name: "photo-1" },
  });
  return media;
}

describe("startup media preparation", () => {
  it("exposes the thumbnail before constructing the full pixel payload", async () => {
    const media = await makeMediaDirectory();
    (globalThis as unknown as { ImageData: unknown }).ImageData = class {
      constructor() {
        throw new Error("pixel payload was touched during preparation");
      }
    };

    const prepared = await prepareMedia(media);

    expect(prepared.thumbnail.size).toBe(3);
    expect(prepared.metadata).toMatchObject({ width: 2, height: 2 });

    (globalThis as unknown as { ImageData: unknown }).ImageData = TestImageData;
    const loaded = await loadPreparedMedia(prepared);

    expect(loaded?.image).toBeInstanceOf(TestImageData);
    expect(loaded?.mainPreviewSourceName).toBe("image.data");
  });

  it("keeps the existing one-step media loader compatible", async () => {
    const media = await makeMediaDirectory();
    (globalThis as unknown as { ImageData: unknown }).ImageData = TestImageData;

    const loaded = await loadMedia(media);

    expect(loaded?.thumbnail.size).toBe(3);
    expect(loaded?.image).toBeInstanceOf(TestImageData);
    expect(loaded?.metadata).toMatchObject({ width: 2, height: 2 });
  });

  it("moves OPFS pixels into one verified source and restores a virtual copy", async () => {
    const original = await makeMediaDirectory();
    await original.saveFile("state.json", { preset: { selectedPresetId: "look-a" } });
    (globalThis as unknown as { ImageData: unknown }).ImageData = TestImageData;
    await openProject("project-1");

    const copyId = await createVirtualCopyByName("photo-1", "Version B");
    const originalPointer = await original.getFileAsParsedJSON<{ sourceId: string }>(
      "source-pointer.json",
    );
    const project = await original.getAncestorDirectory(2);
    const sourceDir = await (await project!.getDirectory("sources", false))!.getDirectory(
      originalPointer.sourceId,
      false,
    );
    const source = await sourceDir!.getFileAsParsedJSON<{ refCount: number }>("source.json");
    const summaries = await listMediaDirectoryPlaceholders("project-1");
    const copy = await switchMedia(copyId, true);

    expect(source.refCount).toBe(2);
    expect(await original.hasFile("image.data")).toBe(false);
    expect(await sourceDir!.hasFile("image.data")).toBe(true);
    expect(summaries.map((item) => item.variantKind)).toEqual(["original", "virtual-copy"]);
    expect(copy?.image).toBeInstanceOf(TestImageData);
    expect(copy?.stateToApply).toMatchObject({ preset: { selectedPresetId: "look-a" } });
  });
});
