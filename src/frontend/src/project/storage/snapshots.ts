// Version snapshots — faithful port of the legacy snapshot helpers in
// package.min.js:
//   ni  getVersionsDir       ei  readSnapshots (versions.json, newest-first)
//   ii  writeSnapshots       oi  readSnapshotState (versions/<id>)
//   si  saveSnapshot         removeAll → clearSnapshots
//
// Layout (per media directory):
//   versions.json          → [{ id, name, date }] (newest first)
//   versions/<snapshotId>  → the snapshot's SerializedEditState

import type { ProjectDirectory } from "./ProjectDirectory";
import type { SerializedEditState } from "../ProjectTypes";
import type { SerializedVideoState } from "../../video/types";

/** Legacy snapshot index entry. */
export type Snapshot = {
  id: string;
  name: string;
  date: number;
  videoState?: SerializedVideoState;
};

function newSnapshotId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Legacy `ni`: the media's `versions/` directory. */
function getVersionsDir(
  mediaDir: ProjectDirectory,
  create = true,
): Promise<ProjectDirectory | undefined> {
  return mediaDir.getDirectory("versions", create);
}

/** Legacy `ei`: the snapshot index (newest first), or [] when absent. */
export async function readSnapshots(mediaDir: ProjectDirectory): Promise<Snapshot[]> {
  try {
    return await mediaDir.getFileAsParsedJSON<Snapshot[]>("versions.json");
  } catch {
    return [];
  }
}

/** Legacy `ii`: persist the snapshot index. */
async function writeSnapshots(mediaDir: ProjectDirectory, list: Snapshot[]): Promise<void> {
  return mediaDir.saveFile("versions.json", list);
}

/** Legacy `oi`: read a snapshot's edit state from `versions/<id>`. */
export async function readSnapshotState(
  mediaDir: ProjectDirectory,
  id: string,
): Promise<SerializedEditState> {
  const versions = await getVersionsDir(mediaDir, false);
  if (!versions) throw new Error("[storage] no versions directory");
  return versions.getFileAsParsedJSON<SerializedEditState>(id);
}

/** Legacy `si`: write `versions/<id>` and prepend `{id,name,date}` to the index. */
export async function saveSnapshot(
  mediaDir: ProjectDirectory,
  name: string,
  state: SerializedEditState,
  videoState?: SerializedVideoState,
): Promise<Snapshot> {
  const snapshot: Snapshot = { id: newSnapshotId(), name, date: Date.now(), videoState };
  const versions = (await getVersionsDir(mediaDir, true))!;
  await versions.saveFile(snapshot.id, state);
  const list = await readSnapshots(mediaDir);
  list.unshift(snapshot);
  await writeSnapshots(mediaDir, list);
  return snapshot;
}

/** Remove one snapshot (index entry + `versions/<id>`). */
export async function deleteSnapshot(mediaDir: ProjectDirectory, id: string): Promise<void> {
  const list = (await readSnapshots(mediaDir)).filter((snapshot) => snapshot.id !== id);
  await writeSnapshots(mediaDir, list);
  const versions = await getVersionsDir(mediaDir, false).catch(() => undefined);
  if (versions) await versions.deleteEntry(id).catch(() => {});
}

/** Rename one snapshot without changing its saved edit state. */
export async function renameSnapshot(
  mediaDir: ProjectDirectory,
  id: string,
  name: string,
): Promise<void> {
  const list = await readSnapshots(mediaDir);
  await writeSnapshots(
    mediaDir,
    list.map((snapshot) => (snapshot.id === id ? { ...snapshot, name } : snapshot)),
  );
}

/** Replace one snapshot payload while preserving its index entry. */
export async function updateSnapshotState(
  mediaDir: ProjectDirectory,
  id: string,
  state: SerializedEditState,
  videoState?: SerializedVideoState,
): Promise<void> {
  const versions = (await getVersionsDir(mediaDir, true))!;
  await versions.saveFile(id, state);
  if (videoState) {
    const list = await readSnapshots(mediaDir);
    await writeSnapshots(
      mediaDir,
      list.map((snapshot) => (snapshot.id === id ? { ...snapshot, videoState } : snapshot)),
    );
  }
}

/** Legacy `removeAll`: clear every snapshot. */
export async function clearSnapshots(mediaDir: ProjectDirectory): Promise<void> {
  const versions = await getVersionsDir(mediaDir, false).catch(() => undefined);
  if (versions) await versions.clear();
  await writeSnapshots(mediaDir, []);
}
