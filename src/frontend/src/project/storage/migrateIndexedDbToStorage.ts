// One-time migration from the current IndexedDB project/media records into the
// OPFS layout (req 19). The IndexedDB schema already mirrors the legacy folders
// (AppSession=active.txt, ProjectRecord=state.json, MediaRecord+images/thumbnails),
// so this is a faithful copy:
//
//   projects/active.txt                         ← AppSession.activeProjectId
//   projects/<projectId>/state.json             ← { id, name, activeUserMedia(dir) }
//   projects/<projectId>/user-media/<dir>/
//       image.<ext> | image.data + metadata.json ← StoredImageRecord (blob|buffer)
//       thumbnail.jpeg                            ← thumbnails store
//       state.json                                ← MediaRecord.editState
//       versions.json + versions/<id>             ← MediaRecord.snapshots
//
// Idempotent: a `projects/.migrated` marker is written once so it never re-runs
// (re-running could overwrite OPFS edits with stale IndexedDB data). IndexedDB
// rows are left intact (read-only) so nothing is lost if the port is reverted.

import * as idb from "../indexedDbProjectStore";
import type { MediaRecord } from "../ProjectTypes";
import { openRootDirectory, type ProjectDirectory } from "./ProjectDirectory";

const MIGRATED_MARKER = ".migrated";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tif",
};

export type MigrationResult = {
  migrated: boolean;
  projects: number;
  media: number;
  activeProjectId: string | null;
};

async function getProjectsDir(): Promise<ProjectDirectory> {
  const root = await openRootDirectory();
  return (await root.getDirectory("projects", true))!;
}

/** True once the OPFS layout has been populated (or deliberately marked empty). */
export async function isOpfsMigrated(): Promise<boolean> {
  return (await getProjectsDir()).hasFile(MIGRATED_MARKER);
}

function imageExtension(blob: Blob, fileName: string): string {
  if (blob.type && MIME_TO_EXT[blob.type]) return MIME_TO_EXT[blob.type];
  const dot = fileName.lastIndexOf(".");
  if (dot >= 0) {
    const ext = fileName.slice(dot).toLowerCase();
    if (ext.length <= 6) return ext;
  }
  return ".png"; // "developed" records are re-encoded PNG
}

function uniqueDirName(used: Set<string>, fileName: string): string {
  const base = fileName && fileName.trim() ? fileName : "image";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  let candidate = `${base} (${index})`;
  while (used.has(candidate)) candidate = `${base} (${++index})`;
  used.add(candidate);
  return candidate;
}

async function migrateMedia(
  media: MediaRecord,
  dirName: string,
  userMediaDir: ProjectDirectory,
): Promise<boolean> {
  const imageRecord = await idb.getImageRecord(media.imageId);
  const files: Record<string, unknown> = {};
  const metadata = {
    width: media.width,
    height: media.height,
    name: media.fileName,
    type: media.mimeType,
    format: media.format,
  };

  if (media.storage === "data" && imageRecord?.buffer) {
    files["image.data"] = imageRecord.buffer;
  } else if (imageRecord?.blob) {
    files[`image${imageExtension(imageRecord.blob, media.fileName)}`] = imageRecord.blob;
  } else {
    return false; // image bytes missing — skip this media
  }
  files["metadata.json"] = metadata;
  files["state.json"] = media.editState;

  const thumbnail = await idb.getThumbnail(media.thumbnailId);
  if (thumbnail) files["thumbnail.jpeg"] = thumbnail;

  const mediaDir = (await userMediaDir.getDirectory(dirName, true))!;
  await mediaDir.saveFiles(files);

  if (media.snapshots?.length) {
    const versionsDir = (await mediaDir.getDirectory("versions", true))!;
    const index: Array<{ id: string; name: string; date: number }> = [];
    for (const snapshot of media.snapshots) {
      await versionsDir.saveFile(snapshot.id, snapshot.editState);
      index.push({ id: snapshot.id, name: snapshot.name, date: snapshot.createdAt });
    }
    await mediaDir.saveFile("versions.json", index);
  }
  return true;
}

/**
 * Copy all IndexedDB projects/media into the OPFS layout, once. Returns stats; a
 * no-op (already migrated) returns `migrated: false`.
 */
export async function migrateIndexedDbToStorage(): Promise<MigrationResult> {
  const projectsDir = await getProjectsDir();
  if (await projectsDir.hasFile(MIGRATED_MARKER)) {
    return { migrated: false, projects: 0, media: 0, activeProjectId: null };
  }

  // Ensure the IndexedDB v2→v3 records exist before reading them.
  await idb.migrateToV3IfNeeded().catch(() => {});

  const session = await idb.getSession().catch(() => undefined);
  const projectRecords = await idb.listProjectRecords().catch(() => []);

  let mediaCount = 0;
  for (const project of projectRecords) {
    const projectDir = (await projectsDir.getDirectory(project.id, true))!;
    const userMediaDir = (await projectDir.getDirectory("user-media", true))!;

    const records = await idb.listMediaByProject(project.id);
    const byId = new Map(records.map((m) => [m.assetId, m]));
    // Preserve the project's asset order.
    const ordered = project.assetIds.map((id) => byId.get(id)).filter((m): m is MediaRecord => !!m);

    const usedNames = new Set<string>();
    let activeUserMediaDir = "";
    for (const media of ordered) {
      const dirName = uniqueDirName(usedNames, media.fileName);
      const ok = await migrateMedia(media, dirName, userMediaDir);
      if (!ok) continue;
      mediaCount += 1;
      if (media.assetId === project.activeUserMedia) activeUserMediaDir = dirName;
    }

    await projectDir.saveFile("state.json", {
      id: project.id,
      name: project.name,
      // dir name of the active asset, or "" → the store falls back to first.
      activeUserMedia: activeUserMediaDir,
    });
  }

  const activeProjectId =
    session?.activeProjectId && projectRecords.some((p) => p.id === session.activeProjectId)
      ? session.activeProjectId
      : (projectRecords[0]?.id ?? null);

  if (activeProjectId) {
    await projectsDir.saveFile("active.txt", activeProjectId);
  }
  // Mark done even with zero projects so the (no-op) migration never re-runs;
  // boot then creates a Default Project on the OPFS side.
  await projectsDir.saveFile(MIGRATED_MARKER, String(Date.now()));

  return { migrated: true, projects: projectRecords.length, media: mediaCount, activeProjectId };
}
