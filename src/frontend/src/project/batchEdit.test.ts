import { describe, expect, it } from "vitest";
import type { BatchEditJournal, SerializedEditState } from "./ProjectTypes";
import {
  executeBatchEdit,
  recoverBatchJournals,
  undoBatchEdit,
  type BatchEditPersistence,
} from "./batchEdit";

function state(value: number): SerializedEditState {
  return { preset: { strength: value } } as SerializedEditState;
}

function memoryPersistence(initial: Record<string, SerializedEditState>) {
  const values = new Map(Object.entries(initial));
  const journals = new Map<string, BatchEditJournal>();
  const persistence: BatchEditPersistence = {
    read: async (id) => values.get(id),
    write: async (id, value) => { values.set(id, value); },
    saveJournal: async (journal) => { journals.set(journal.id, structuredClone(journal)); },
    deleteJournal: async (id) => { journals.delete(id); },
  };
  return { values, journals, persistence };
}

describe("transactional batch editing", () => {
  it("commits target states and undoes the operation in one step", async () => {
    const memory = memoryPersistence({ a: state(1), b: state(2), c: state(3) });
    const result = await executeBatchEdit({
      projectId: "p",
      primaryAssetId: "a",
      targetAssetIds: ["a", "b", "c"],
      moduleKeys: ["balance"],
      buildAfter: () => state(9),
      persistence: memory.persistence,
    });

    expect(result.committed).toBe(true);
    expect(memory.values.get("b")).toEqual(state(9));
    expect(result.targets.map((target) => target.status)).toEqual(["applied", "applied"]);

    await undoBatchEdit(result.journal, memory.persistence);
    expect(memory.values.get("b")).toEqual(state(2));
    expect(memory.values.get("c")).toEqual(state(3));
    expect(memory.journals.has(result.journal.id)).toBe(false);
  });

  it("rolls every applied target back after a partial storage failure", async () => {
    const memory = memoryPersistence({ a: state(1), b: state(2), c: state(3) });
    const normalWrite = memory.persistence.write;
    memory.persistence.write = async (id, value) => {
      if (id === "c" && (value.preset as { strength: number }).strength === 9) {
        throw new Error("quota");
      }
      await normalWrite(id, value);
    };
    const result = await executeBatchEdit({
      projectId: "p",
      primaryAssetId: "a",
      targetAssetIds: ["b", "c"],
      moduleKeys: ["balance"],
      buildAfter: () => state(9),
      persistence: memory.persistence,
    });

    expect(result.committed).toBe(false);
    expect(result.journal.status).toBe("rolled-back");
    expect(memory.values.get("b")).toEqual(state(2));
    expect(memory.values.get("c")).toEqual(state(3));
    expect(result.targets).toEqual([
      { assetId: "b", status: "rolled-back" },
      { assetId: "c", status: "failed", error: "quota" },
    ]);
  });

  it("recovers an interrupted journal by restoring pre-change states", async () => {
    const memory = memoryPersistence({ b: state(9) });
    const interrupted: BatchEditJournal = {
      id: "batch-crash",
      projectId: "p",
      primaryAssetId: "a",
      moduleKeys: ["balance"],
      status: "applying",
      entries: [{ assetId: "b", before: state(2), after: state(9), status: "applied" }],
      createdAt: 1,
      updatedAt: 2,
    };

    await recoverBatchJournals([interrupted], memory.persistence);
    expect(memory.values.get("b")).toEqual(state(2));
    expect(memory.journals.get("batch-crash")?.status).toBe("rolled-back");
  });

  it("reports missing targets instead of silently partially succeeding", async () => {
    const memory = memoryPersistence({ a: state(1), b: state(2) });
    const result = await executeBatchEdit({
      projectId: "p",
      primaryAssetId: "a",
      targetAssetIds: ["b", "missing"],
      moduleKeys: ["balance"],
      buildAfter: () => state(9),
      persistence: memory.persistence,
    });
    expect(result.targets).toContainEqual({
      assetId: "missing",
      status: "skipped",
      error: "Media state is unavailable.",
    });
  });
});
