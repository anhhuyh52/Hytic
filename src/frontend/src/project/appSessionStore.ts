/*
 * App session — the active.txt equivalent. A single persisted record pointing at
 * the last-open project + asset, so a page reload continues where you left off.
 * Legacy: `active.txt` holds the active project id (package.min.js a_() @ 27240,
 * Yh() @ 18720); poto stores the active project AND asset (multi-asset) plus a
 * lastOpenedAt timestamp.
 */
import { APP_SESSION_KEY, type AppSession } from "./ProjectTypes";
import * as store from "./indexedDbProjectStore";

/** The persisted boot pointer, or an empty session if none was saved yet. */
export async function getSession(): Promise<AppSession> {
  return (
    (await store.getSession()) ?? {
      id: APP_SESSION_KEY,
      activeProjectId: null,
      activeAssetId: null,
      lastOpenedAt: Date.now(),
    }
  );
}

/** Records the active project + asset and bumps lastOpenedAt (active.txt write). */
export async function setActive(
  activeProjectId: string | null,
  activeAssetId: string | null,
): Promise<void> {
  await store.putSession({
    id: APP_SESSION_KEY,
    activeProjectId,
    activeAssetId,
    lastOpenedAt: Date.now(),
  });
}

/** Runs the one-time v2→v3 data migration (no-op once a session exists). */
export async function ensureMigrated(): Promise<void> {
  await store.migrateToV3IfNeeded();
}
