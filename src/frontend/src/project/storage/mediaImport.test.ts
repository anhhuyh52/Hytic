import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRootDirectory, resetStorageDirectoryCaches } from "./ProjectDirectory";
import { importMedia } from "./mediaImport";
import { resetProjectStore } from "./projectStore";
import { initMemoryFs, setStorageAccount, storageContext } from "./storageWriter";
import { decodeImportFile } from "./mediaImportDecoders";

vi.mock("../imageDerivatives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../imageDerivatives")>();
  return {
    ...actual,
    createImageDerivatives: vi.fn(async () => [
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" }),
    ]),
  };
});

vi.mock("./mediaImportDecoders", () => ({
  decodeImportFile: vi.fn(),
}));

beforeEach(() => {
  storageContext.handle = null;
  storageContext.getWriteAccess = null;
  storageContext.write = null;
  storageContext.dir = null;
  initMemoryFs();
  setStorageAccount("media-import-account");
  resetStorageDirectoryCaches();
  resetProjectStore();
  vi.clearAllMocks();
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(
    async () => ({
      width: 4000,
      height: 3000,
      close: vi.fn(),
    }),
  );
});

async function makeUserMediaDirectory() {
  const root = await openRootDirectory();
  const projects = (await root.getDirectory("projects", true))!;
  const project = (await projects.getDirectory("project-1", true))!;
  return (await project.getDirectory("user-media", true))!;
}

describe("OPFS media import", () => {
  it("keeps browser-decodable images as original blobs instead of decoded image.data", async () => {
    const userMedia = await makeUserMediaDirectory();
    const file = new File([new Uint8Array([255, 216, 255, 217])], "photo.jpg", {
      type: "image/jpeg",
      lastModified: 123,
    });

    const dir = await importMedia(file, userMedia);
    const metadata = await dir.getFileAsParsedJSON<Record<string, unknown>>("metadata.json");

    expect(decodeImportFile).not.toHaveBeenCalled();
    expect(await dir.hasFile("image.jpg")).toBe(true);
    expect(await dir.hasFile("image.data")).toBe(false);
    expect(metadata).toMatchObject({
      width: 4000,
      height: 3000,
      storage: "original",
      mimeType: "image/jpeg",
      extension: "jpg",
      originalName: "photo.jpg",
    });
  });

  it("uses the original-blob path for browser image extensions even when MIME is empty", async () => {
    const userMedia = await makeUserMediaDirectory();
    const file = new File([new Uint8Array([255, 216, 255, 217])], "empty-type.jpeg");

    const dir = await importMedia(file, userMedia);
    const metadata = await dir.getFileAsParsedJSON<Record<string, unknown>>("metadata.json");

    expect(decodeImportFile).not.toHaveBeenCalled();
    expect(await dir.hasFile("image.jpeg")).toBe(true);
    expect(await dir.hasFile("image.data")).toBe(false);
    expect(metadata).toMatchObject({
      storage: "original",
      extension: "jpeg",
      originalName: "empty-type.jpeg",
    });
  });
});
