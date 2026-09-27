import type { BatchEditJournal, SerializedEditState } from "./ProjectTypes";

export type BatchTargetResult = {
  assetId: string;
  status: "applied" | "skipped" | "failed" | "rolled-back";
  error?: string;
};

export type BatchEditResult = {
  journal: BatchEditJournal;
  targets: BatchTargetResult[];
  committed: boolean;
};

export type BatchEditPersistence = {
  read(assetId: string): Promise<SerializedEditState | undefined>;
  write(assetId: string, state: SerializedEditState): Promise<void>;
  saveJournal(journal: BatchEditJournal): Promise<void>;
  deleteJournal(journalId: string): Promise<void>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function updateJournal(journal: BatchEditJournal, patch: Partial<BatchEditJournal>): BatchEditJournal {
  return { ...journal, ...patch, updatedAt: Date.now() };
}

export async function executeBatchEdit(input: {
  projectId: string;
  primaryAssetId: string;
  targetAssetIds: readonly string[];
  moduleKeys: readonly string[];
  buildAfter(before: SerializedEditState): SerializedEditState;
  persistence: BatchEditPersistence;
  signal?: AbortSignal;
}): Promise<BatchEditResult> {
  const now = Date.now();
  let journal: BatchEditJournal = {
    id: `batch-${crypto.randomUUID()}`,
    projectId: input.projectId,
    primaryAssetId: input.primaryAssetId,
    moduleKeys: [...input.moduleKeys],
    status: "prepared",
    entries: [],
    createdAt: now,
    updatedAt: now,
  };
  const targets: BatchTargetResult[] = [];

  for (const assetId of [...new Set(input.targetAssetIds)]) {
    if (assetId === input.primaryAssetId) continue;
    const before = await input.persistence.read(assetId);
    if (!before) {
      targets.push({ assetId, status: "skipped", error: "Media state is unavailable." });
      continue;
    }
    try {
      journal.entries.push({
        assetId,
        before: clone(before),
        after: clone(input.buildAfter(before)),
        status: "pending",
      });
    } catch (error) {
      targets.push({
        assetId,
        status: "skipped",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await input.persistence.saveJournal(journal);
  journal = updateJournal(journal, { status: "applying" });
  await input.persistence.saveJournal(journal);

  let failed = false;
  for (const entry of journal.entries) {
    if (input.signal?.aborted) {
      entry.status = "failed";
      entry.error = "Cancelled";
      targets.push({ assetId: entry.assetId, status: "failed", error: "Cancelled" });
      failed = true;
      break;
    }
    try {
      await input.persistence.write(entry.assetId, clone(entry.after));
      entry.status = "applied";
      targets.push({ assetId: entry.assetId, status: "applied" });
      await input.persistence.saveJournal(updateJournal(journal, {}));
    } catch (error) {
      entry.status = "failed";
      entry.error = error instanceof Error ? error.message : String(error);
      targets.push({ assetId: entry.assetId, status: "failed", error: entry.error });
      failed = true;
      await input.persistence.saveJournal(updateJournal(journal, {}));
      break;
    }
  }

  if (failed) {
    for (const entry of journal.entries) {
      if (entry.status !== "pending") continue;
      entry.status = "skipped";
      entry.error = input.signal?.aborted
        ? "Cancelled before this target was applied."
        : "Skipped after an earlier target failed.";
      targets.push({ assetId: entry.assetId, status: "skipped", error: entry.error });
    }
    journal = updateJournal(journal, { status: "rolling-back" });
    await input.persistence.saveJournal(journal);
    for (const entry of [...journal.entries].reverse()) {
      if (entry.status !== "applied") continue;
      try {
        await input.persistence.write(entry.assetId, clone(entry.before));
        entry.status = "rolled-back";
        const target = targets.find((item) => item.assetId === entry.assetId);
        if (target) target.status = "rolled-back";
      } catch (error) {
        entry.status = "failed";
        entry.error = `Rollback failed: ${error instanceof Error ? error.message : String(error)}`;
        const target = targets.find((item) => item.assetId === entry.assetId);
        if (target) {
          target.status = "failed";
          target.error = entry.error;
        }
      }
      await input.persistence.saveJournal(updateJournal(journal, {}));
    }
    journal = updateJournal(journal, { status: "rolled-back" });
    await input.persistence.saveJournal(journal);
    return { journal, targets, committed: false };
  }

  journal = updateJournal(journal, { status: "committed" });
  await input.persistence.saveJournal(journal);
  return { journal, targets, committed: true };
}

export async function undoBatchEdit(
  journal: BatchEditJournal,
  persistence: BatchEditPersistence,
): Promise<BatchTargetResult[]> {
  const results: BatchTargetResult[] = [];
  for (const entry of [...journal.entries].reverse()) {
    try {
      await persistence.write(entry.assetId, clone(entry.before));
      results.push({ assetId: entry.assetId, status: "rolled-back" });
    } catch (error) {
      results.push({
        assetId: entry.assetId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (results.every((result) => result.status === "rolled-back")) {
    await persistence.deleteJournal(journal.id);
  }
  return results;
}

export async function recoverBatchJournals(
  journals: readonly BatchEditJournal[],
  persistence: BatchEditPersistence,
): Promise<void> {
  for (const journal of journals) {
    if (journal.status === "committed" || journal.status === "rolled-back") continue;
    const recovery = updateJournal(clone(journal), { status: "rolling-back" });
    await persistence.saveJournal(recovery);
    let recoveryFailed = false;
    for (const entry of [...recovery.entries].reverse()) {
      if (entry.status !== "applied") continue;
      try {
        await persistence.write(entry.assetId, clone(entry.before));
        entry.status = "rolled-back";
      } catch (error) {
        recoveryFailed = true;
        entry.status = "failed";
        entry.error = `Recovery rollback failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      await persistence.saveJournal(updateJournal(recovery, {}));
    }
    await persistence.saveJournal(
      updateJournal(recovery, { status: recoveryFailed ? "rolling-back" : "rolled-back" }),
    );
  }
}
