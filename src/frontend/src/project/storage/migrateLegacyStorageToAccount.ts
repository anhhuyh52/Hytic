import type { FsFileHandle } from "./memoryHandles";
import { openLegacyRootDirectory, openRootDirectory, ProjectDirectory } from "./ProjectDirectory";
import { getStorageAccountKey } from "./storageWriter";

const CLAIM_FILE = ".account-isolation-v1.json";
const MIGRATED_MARKER = ".migrated";

type IsolationClaim = {
  accountKey: string;
  claimedAt: number;
};

async function copyDirectory(source: ProjectDirectory, target: ProjectDirectory): Promise<void> {
  const entries = await source.getAllEntries(true, false);
  for (const entry of entries) {
    if (entry instanceof ProjectDirectory) {
      const child = (await target.getDirectory(entry.name, true))!;
      await copyDirectory(entry, child);
      continue;
    }

    const file = await (entry as FsFileHandle).getFile();
    await target.saveFile((entry as FsFileHandle).name, file);
  }
}

/**
 * Assign the old origin-wide workspace to exactly one account. The first account
 * opened after this upgrade receives `/projects`; subsequent accounts get a
 * clean namespace. Legacy files are copied, never deleted, for recovery.
 */
export async function migrateLegacyStorageToAccount(): Promise<void> {
  const accountKey = getStorageAccountKey();
  const accountRoot = await openRootDirectory();
  const legacyRoot = await openLegacyRootDirectory();
  const claim = await legacyRoot.getFileAsParsedJSON<IsolationClaim>(CLAIM_FILE).catch(() => null);

  if (claim && claim.accountKey !== accountKey) {
    // Prevent the global pre-isolation IndexedDB store from being copied into a
    // second account by the following IndexedDB -> OPFS migration.
    const projects = (await accountRoot.getDirectory("projects", true))!;
    if (!(await projects.hasFile(MIGRATED_MARKER))) {
      await projects.saveFile(MIGRATED_MARKER, String(Date.now()));
    }
    return;
  }

  if (!claim) {
    const legacyProjects = await legacyRoot.getDirectory("projects", false).catch(() => undefined);
    if (legacyProjects) {
      const accountProjects = (await accountRoot.getDirectory("projects", true))!;
      await copyDirectory(legacyProjects, accountProjects);
      // A legacy OPFS workspace is authoritative; do not overwrite it from the
      // older IndexedDB mirror after copying.
      await accountProjects.saveFile(MIGRATED_MARKER, String(Date.now()));
    }

    await legacyRoot.saveFile(CLAIM_FILE, {
      accountKey,
      claimedAt: Date.now(),
    } satisfies IsolationClaim);
  }
}
