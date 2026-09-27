import { afterEach, describe, expect, it, vi } from "vitest";
import * as indexedDbMediaStore from "./mediaStore";
import { createProjectRepository } from "./projectRepository";
import type { MediaVersionSnapshot, SerializedEditState } from "./ProjectTypes";
import * as opfsStorage from "./storage/storageBridge";

const state = { preset: { selectedPresetId: "test" } } as SerializedEditState;
const current: MediaVersionSnapshot[] = [
  { id: "old", name: "Old", createdAt: 1, editState: state },
];

afterEach(() => vi.restoreAllMocks());

describe("projectRepository", () => {
  it("maps OPFS snapshot metadata to the shared contract", async () => {
    vi.spyOn(opfsStorage, "saveActiveSnapshot").mockResolvedValue({
      id: "snapshot-1",
      name: "Version 1",
      date: 123,
    });
    const repository = createProjectRepository({ kind: "opfs" });

    await expect(
      repository.saveVersionSnapshot("asset-ignored", "Version 1", state, current),
    ).resolves.toEqual({
      id: "snapshot-1",
      name: "Version 1",
      createdAt: 123,
      editState: state,
    });
    expect(repository.mediaListProvider).toBe(opfsStorage.listMediaSummaries);
  });

  it("persists IndexedDB snapshots through the same contract", async () => {
    const save = vi.spyOn(indexedDbMediaStore, "saveMediaSnapshots").mockResolvedValue();
    const repository = createProjectRepository({ kind: "indexeddb" });

    const snapshot = await repository.saveVersionSnapshot("asset-1", "Version 2", state, current);

    expect(snapshot).toMatchObject({ name: "Version 2", editState: state });
    expect(save).toHaveBeenCalledWith("asset-1", [snapshot, ...current]);
    expect(repository.mediaListProvider).toBeNull();
  });

  it("applies snapshot-list updates consistently in IndexedDB", async () => {
    const save = vi.spyOn(indexedDbMediaStore, "saveMediaSnapshots").mockResolvedValue();
    const repository = createProjectRepository({ kind: "indexeddb" });

    await repository.deleteVersionSnapshot("asset-1", "old", []);
    await repository.renameVersionSnapshot("asset-1", "old", "Renamed", current);
    await repository.updateVersionSnapshot("asset-1", "old", state, current);
    await repository.clearVersionSnapshots("asset-1");

    expect(save.mock.calls).toEqual([
      ["asset-1", []],
      ["asset-1", current],
      ["asset-1", current],
      ["asset-1", []],
    ]);
  });
});
