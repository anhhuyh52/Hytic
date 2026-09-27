import { describe, expect, it, vi } from "vitest";
import type { SerializedEditState } from "../project/ProjectTypes";
import { createHistoryController } from "./historyController";

const state = (strength: number) => ({ preset: { strength } }) as unknown as SerializedEditState;

describe("historyController", () => {
  it("deduplicates states and drops redo entries after a new edit", () => {
    let id = 0;
    const applyState = vi.fn();
    const history = createHistoryController({
      getProjectId: () => "project-1",
      getActiveAssetId: () => "asset-1",
      applyState,
      createId: () => `history-${++id}`,
      now: () => id,
    });

    history.reset("asset-1", state(0));
    history.push("asset-1", state(1));
    history.push("asset-1", state(1));
    history.goTo(0);
    history.push("asset-1", state(2));

    expect(history.entries().map((entry) => entry.state.preset.strength)).toEqual([0, 2]);
    expect(history.index()).toBe(1);
    expect(applyState).toHaveBeenCalledWith(state(0));
  });

  it("restores cached history when switching back to an asset", () => {
    let activeAsset = "asset-1";
    const history = createHistoryController({
      getProjectId: () => "project-1",
      getActiveAssetId: () => activeAsset,
      applyState: () => undefined,
      createId: () => crypto.randomUUID(),
    });

    history.reset("asset-1", state(0));
    history.push("asset-1", state(1));
    activeAsset = "asset-2";
    history.reset("asset-2", state(5));
    activeAsset = "asset-1";
    history.reset("asset-1", state(99));

    expect(history.entries().map((entry) => entry.state.preset.strength)).toEqual([0, 1]);
    expect(history.index()).toBe(1);
  });

  it("debounces scheduled records", () => {
    vi.useFakeTimers();
    const history = createHistoryController({
      getProjectId: () => "project-1",
      getActiveAssetId: () => "asset-1",
      applyState: () => undefined,
      createId: () => "id",
    });
    history.reset("asset-1", state(0));

    history.schedulePush("asset-1", state(1));
    history.schedulePush("asset-1", state(2));
    vi.runAllTimers();

    expect(history.entries().map((entry) => entry.state.preset.strength)).toEqual([0, 2]);
    vi.useRealTimers();
  });
});
