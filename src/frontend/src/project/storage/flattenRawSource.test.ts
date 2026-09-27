// Flatten-for-RAW invariants at the storage layer. Flatten must render from the
// RAW media's cached, already-decoded payload — never re-run the RAW decoder and
// never fall back to the thumbnail:
//   - resolveImageSource resolves `image.data` (not `thumbnail.jpeg`) and rebuilds
//     ImageData from the width/height in `metadata.json`.
//   - readMediaState applies `state.json` when present, else the RAW IDT default.
// These are the load steps flatten relies on (PotoApp.flattenMedia →
// performMediaSwitch → loadMedia), exercised here without a GPU/renderer.

import { beforeEach, describe, expect, it } from "vitest";
import { openLegacyRootDirectory, resetStorageDirectoryCaches } from "./ProjectDirectory";
import { resetProjectStore } from "./projectStore";
import { readMediaState, resolveImageSource } from "./mediaStore";
import { initMemoryFs, setStorageAccount, storageContext } from "./storageWriter";

// The node test env has no DOM ImageData; mediaStore.rebuildImageData constructs
// one from the cached buffer + metadata dims. Minimal stand-in mirrors the
// browser constructor (data, width, height) so `instanceof` + dims hold.
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
  (globalThis as unknown as { ImageData: unknown }).ImageData = TestImageData;
  initMemoryFs();
  setStorageAccount("flatten-account");
  resetStorageDirectoryCaches();
  resetProjectStore();
});

async function makeRawMediaDir(name: string, files: Record<string, unknown>) {
  const root = await openLegacyRootDirectory(); // also initialises the write fn
  const projects = (await root.getDirectory("projects", true))!;
  const project = (await projects.getDirectory("proj", true))!;
  const userMedia = (await project.getDirectory("user-media", true))!;
  const dir = (await userMedia.getDirectory(name, true))!;
  await dir.saveFiles(files);
  return dir;
}

describe("RAW flatten source resolution", () => {
  it("resolves image.data (never the thumbnail) and rebuilds ImageData from metadata dims", async () => {
    const width = 4;
    const height = 3;
    const dir = await makeRawMediaDir("IMG_001.CR3", {
      // A decoded RGBA buffer is exactly width*height*4 bytes.
      "image.data": new Uint8ClampedArray(width * height * 4).fill(128).buffer,
      "metadata.json": { width, height, name: "IMG_001.CR3", format: "raw", storage: "data" },
      // Present so a thumbnail-fallback bug would be caught here.
      "thumbnail.jpeg": new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    });

    const { image, sourceName } = await resolveImageSource(dir);

    expect(sourceName).toBe("image.data");
    expect(image).toBeInstanceOf(TestImageData);
    const rebuilt = image as unknown as TestImageData;
    expect(rebuilt.width).toBe(width);
    expect(rebuilt.height).toBe(height);
    expect(rebuilt.data.length).toBe(width * height * 4);
  });

  it("falls back to the RAW IDT default state when no state.json exists", async () => {
    const dir = await makeRawMediaDir("IMG_002.CR3", {
      "image.data": new Uint8ClampedArray(2 * 2 * 4).buffer,
      "metadata.json": { width: 2, height: 2, name: "IMG_002.CR3", format: "raw", storage: "data" },
    });

    const state = await readMediaState(dir);

    expect(state.colorManagement?.inputColorSpaceId).toBe("VisionLog");
  });

  it("uses the media's persisted state.json when present", async () => {
    const dir = await makeRawMediaDir("IMG_003.CR3", {
      "image.data": new Uint8ClampedArray(2 * 2 * 4).buffer,
      "metadata.json": { width: 2, height: 2, name: "IMG_003.CR3", format: "raw", storage: "data" },
      "state.json": { colorManagement: { inputColorSpaceId: "CustomIDT" } },
    });

    const state = await readMediaState(dir);

    expect(state.colorManagement?.inputColorSpaceId).toBe("CustomIDT");
  });
});
