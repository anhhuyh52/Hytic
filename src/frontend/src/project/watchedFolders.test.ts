import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchedFolderRecord } from "./ProjectTypes";

const records = new Map<string, WatchedFolderRecord>();
const handles = new Map<string, FileSystemDirectoryHandle>();

vi.mock("./indexedDbProjectStore", () => ({
  putWatchedFolder: async (record: WatchedFolderRecord) => { records.set(record.id, structuredClone(record)); },
  listWatchedFolders: async (accountId: string) => [...records.values()].filter((record) => record.accountId === accountId),
  deleteWatchedFolder: async (id: string) => { records.delete(id); },
  putDirectoryHandle: async (id: string, handle: FileSystemDirectoryHandle) => { handles.set(id, handle); },
  getDirectoryHandle: async (id: string) => handles.get(id),
  deleteDirectoryHandle: async (id: string) => { handles.delete(id); },
}));

import { connectWatchedFolder, reconnectWatchedFolder, scanWatchedFolder } from "./watchedFolders";

type TestEntry = { kind: "file"; file: File } | { kind: "directory"; entries: Record<string, TestEntry> };

function directory(name: string, source: Record<string, TestEntry>): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    requestPermission: async () => "granted",
    queryPermission: async () => "granted",
    async *entries() {
      for (const [entryName, value] of Object.entries(source)) {
        if (value.kind === "directory") yield [entryName, directory(entryName, value.entries)];
        else yield [entryName, { kind: "file", name: entryName, getFile: async () => value.file }];
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

function image(name: string, contents: string, modified = 1): TestEntry {
  return { kind: "file", file: new File([contents], name, { type: "image/jpeg", lastModified: modified }) };
}

beforeEach(() => {
  records.clear();
  handles.clear();
});

describe("watched folders", () => {
  it("tracks only supported images and does not repeat removals", async () => {
    const source: Record<string, TestEntry> = {
      "photo.jpg": image("photo.jpg", "first"),
      "notes.txt": { kind: "file", file: new File(["notes"], "notes.txt", { type: "text/plain" }) },
    };
    const record = await connectWatchedFolder({ accountId: "a", projectId: "p", handle: directory("Photos", source) });
    const first = await scanWatchedFolder(record);
    expect(first.changes.map((change) => change.relativePath)).toEqual(["photo.jpg"]);
    expect(first.record.files).toHaveLength(1);

    delete source["photo.jpg"];
    const removed = await scanWatchedFolder(first.record);
    expect(removed.changes).toMatchObject([{ kind: "removed", relativePath: "photo.jpg" }]);
    const repeated = await scanWatchedFolder(removed.record);
    expect(repeated.changes).toEqual([]);
  });

  it("reports a restored file and preserves its linked asset", async () => {
    const source: Record<string, TestEntry> = { "photo.jpg": image("photo.jpg", "first") };
    const initial = await connectWatchedFolder({ accountId: "a", projectId: "p", handle: directory("Photos", source) });
    const scanned = await scanWatchedFolder(initial);
    scanned.record.files[0].assetId = "asset-1";
    delete source["photo.jpg"];
    const missing = await scanWatchedFolder(scanned.record);
    source["photo.jpg"] = image("photo.jpg", "first");
    const restored = await scanWatchedFolder(missing.record);
    expect(restored.changes).toMatchObject([{ kind: "added", assetId: "asset-1" }]);
    expect(restored.record.files[0].missing).toBe(false);
  });

  it("clears stale inventory when reconnecting to a different folder", async () => {
    const initial = await connectWatchedFolder({
      accountId: "a", projectId: "p", handle: directory("Old", { "old.jpg": image("old.jpg", "old") }),
    });
    const scanned = await scanWatchedFolder(initial);
    const reconnected = await reconnectWatchedFolder(scanned.record, directory("New", { "new.jpg": image("new.jpg", "new") }));
    expect(reconnected.files).toEqual([]);
    const next = await scanWatchedFolder(reconnected);
    expect(next.changes).toMatchObject([{ kind: "added", relativePath: "new.jpg" }]);
  });

  it("uses hashes to ignore metadata-only timestamp changes", async () => {
    const source: Record<string, TestEntry> = { "photo.jpg": image("photo.jpg", "same", 1) };
    const initial = await connectWatchedFolder({ accountId: "a", projectId: "p", handle: directory("Photos", source) });
    const first = await scanWatchedFolder(initial);
    source["photo.jpg"] = image("photo.jpg", "same", 2);
    const second = await scanWatchedFolder(first.record);
    expect(second.changes).toEqual([]);
  });
});
