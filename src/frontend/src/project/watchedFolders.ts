import { isSupportedImageFile } from "../engine/io/CodecRegistry";
import type { WatchedFolderRecord } from "./ProjectTypes";
import * as store from "./indexedDbProjectStore";

export type WatchedFolderChange = {
  kind: "added" | "changed" | "removed";
  relativePath: string;
  file?: File;
  assetId?: string;
};

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" }): Promise<PermissionState>;
};
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
};

const HASH_SAMPLE_BYTES = 1024 * 1024;

async function hashFile(file: File): Promise<string> {
  const head = file.slice(0, HASH_SAMPLE_BYTES);
  const tail = file.size > HASH_SAMPLE_BYTES
    ? file.slice(Math.max(HASH_SAMPLE_BYTES, file.size - HASH_SAMPLE_BYTES))
    : new Blob();
  const size = new TextEncoder().encode(String(file.size));
  const bytes = new Uint8Array(size.byteLength + head.size + tail.size);
  bytes.set(size, 0);
  bytes.set(new Uint8Array(await head.arrayBuffer()), size.byteLength);
  bytes.set(new Uint8Array(await tail.arrayBuffer()), size.byteLength + head.size);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function scanDirectory(
  handle: FileSystemDirectoryHandle,
  prefix = "",
  errors: string[] = [],
): Promise<{ files: Array<{ relativePath: string; file: File }>; errors: string[] }> {
  const files: Array<{ relativePath: string; file: File }> = [];
  try {
    for await (const [name, entry] of (handle as IterableDirectoryHandle).entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      try {
        if (entry.kind === "directory") {
          const nested = await scanDirectory(entry, path, errors);
          files.push(...nested.files);
        } else if (isSupportedImageFile({ name, type: "" })) {
          files.push({ relativePath: path, file: await entry.getFile() });
        }
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : "Unable to read entry"}`);
      }
    }
  } catch (error) {
    if (!prefix) throw error;
    errors.push(`${prefix}: ${error instanceof Error ? error.message : "Unable to read directory"}`);
  }
  return { files, errors };
}

export async function connectWatchedFolder(input: {
  accountId: string;
  projectId: string;
  handle: FileSystemDirectoryHandle;
  scanIntervalMs?: number;
}): Promise<WatchedFolderRecord> {
  if (!input.projectId) throw new Error("Select a target project before connecting a folder.");
  const candidate = input.handle as FileSystemDirectoryHandle & {
    isSameEntry?(other: FileSystemHandle): Promise<boolean>;
  };
  if (candidate.isSameEntry) {
    const existingRecords = await store.listWatchedFolders(input.accountId);
    for (const existingRecord of existingRecords) {
      const existingHandle = await store.getDirectoryHandle(existingRecord.handleKey);
      if (existingHandle && await candidate.isSameEntry(existingHandle)) {
        throw new Error("This folder is already being watched for this account.");
      }
    }
  }
  const permissionHandle = input.handle as PermissionHandle;
  const permission = permissionHandle.requestPermission
    ? await permissionHandle.requestPermission({ mode: "read" })
    : "granted";
  if (permission !== "granted") throw new Error("Folder read permission was not granted.");
  const id = `watch-${crypto.randomUUID()}`;
  const handleKey = `${input.accountId}:${id}`;
  await store.putDirectoryHandle(handleKey, input.handle);
  const record: WatchedFolderRecord = {
    id,
    accountId: input.accountId,
    projectId: input.projectId,
    name: input.handle.name,
    handleKey,
    status: "connected",
    lastScanAt: 0,
    scanIntervalMs: Math.max(30_000, input.scanIntervalMs ?? 120_000),
    files: [],
  };
  await store.putWatchedFolder(record);
  return record;
}

export function listWatchedFolders(accountId: string): Promise<WatchedFolderRecord[]> {
  return store.listWatchedFolders(accountId);
}

export function saveWatchedFolder(record: WatchedFolderRecord): Promise<void> {
  return store.putWatchedFolder(record);
}

export async function disconnectWatchedFolder(record: WatchedFolderRecord): Promise<void> {
  await Promise.all([
    store.deleteWatchedFolder(record.id),
    store.deleteDirectoryHandle(record.handleKey),
  ]);
}

export async function reconnectWatchedFolder(
  record: WatchedFolderRecord,
  handle: FileSystemDirectoryHandle,
): Promise<WatchedFolderRecord> {
  const permissionHandle = handle as PermissionHandle;
  const permission = permissionHandle.requestPermission
    ? await permissionHandle.requestPermission({ mode: "read" })
    : "granted";
  if (permission !== "granted") throw new Error("Folder read permission was not granted.");
  await store.putDirectoryHandle(record.handleKey, handle);
  const sameFolder = handle.name === record.name;
  const next: WatchedFolderRecord = {
    ...record,
    name: handle.name,
    status: "connected",
    lastError: undefined,
    lastScanAt: 0,
    files: sameFolder ? record.files : [],
  };
  await store.putWatchedFolder(next);
  return next;
}

export async function scanWatchedFolder(
  record: WatchedFolderRecord,
): Promise<{ record: WatchedFolderRecord; changes: WatchedFolderChange[] }> {
  const handle = await store.getDirectoryHandle(record.handleKey);
  if (!handle) {
    const next = { ...record, status: "disconnected" as const, lastError: "Stored folder handle is unavailable.", lastScanAt: Date.now() };
    await store.putWatchedFolder(next);
    return { record: next, changes: [] };
  }
  const permissionHandle = handle as PermissionHandle;
  const permission = permissionHandle.queryPermission
    ? await permissionHandle.queryPermission({ mode: "read" })
    : "granted";
  if (permission !== "granted") {
    const next = { ...record, status: "permission-expired" as const, lastError: "Folder permission must be renewed.", lastScanAt: Date.now() };
    await store.putWatchedFolder(next);
    return { record: next, changes: [] };
  }

  try {
    const scanned = await scanDirectory(handle);
    const scannedPaths = new Set(scanned.files.map((item) => item.relativePath));
    const previous = new Map(record.files.map((file) => [file.relativePath, file]));
    const changes: WatchedFolderChange[] = [];
    const files: WatchedFolderRecord["files"] = [];

    for (const item of scanned.files) {
      const contentHash = await hashFile(item.file);
      let old = previous.get(item.relativePath);
      if (!old) {
        const renamed = [...previous.values()].find((candidate) =>
          candidate.contentHash === contentHash && !scannedPaths.has(candidate.relativePath),
        );
        if (renamed) {
          old = renamed;
          previous.delete(renamed.relativePath);
        }
      }
      const restored = Boolean(old?.missing);
      const changed = Boolean(old) && !restored && (
        old!.size !== item.file.size || old!.contentHash !== contentHash
      );
      if (!old || restored) {
        changes.push({ kind: "added", relativePath: item.relativePath, file: item.file, assetId: old?.assetId });
      } else if (changed) {
        changes.push({ kind: "changed", relativePath: item.relativePath, file: item.file, assetId: old.assetId });
      }
      files.push({
        relativePath: item.relativePath,
        size: item.file.size,
        lastModified: item.file.lastModified,
        contentHash,
        assetId: old?.assetId,
        missing: false,
      });
      previous.delete(item.relativePath);
    }

    for (const removed of previous.values()) {
      files.push({ ...removed, missing: true });
      if (!removed.missing) changes.push({ kind: "removed", relativePath: removed.relativePath, assetId: removed.assetId });
    }
    const next: WatchedFolderRecord = {
      ...record,
      status: scanned.errors.length ? "error" : "connected",
      lastError: scanned.errors.length ? scanned.errors.slice(0, 3).join(" · ") : undefined,
      lastScanAt: Date.now(),
      files,
    };
    await store.putWatchedFolder(next);
    return { record: next, changes };
  } catch (error) {
    const next: WatchedFolderRecord = {
      ...record,
      status: "error",
      lastError: error instanceof Error ? error.message : "Folder scan failed.",
      lastScanAt: Date.now(),
    };
    await store.putWatchedFolder(next);
    return { record: next, changes: [] };
  }
}

export function startForegroundFolderWatching(input: {
  accountId: string;
  onChanges(record: WatchedFolderRecord, changes: WatchedFolderChange[]): Promise<void>;
}): () => void {
  let stopped = false;
  let scanning = false;
  let timer = 0;
  const scan = async (force = false) => {
    if (stopped || scanning || document.visibilityState === "hidden") return;
    scanning = true;
    try {
      const records = await store.listWatchedFolders(input.accountId);
      for (const record of records) {
        if (!force && Date.now() - record.lastScanAt < record.scanIntervalMs) continue;
        const result = await scanWatchedFolder(record);
        try {
          await input.onChanges(result.record, result.changes);
        } catch (error) {
          const failed = {
            ...result.record,
            status: "error" as const,
            lastError: error instanceof Error ? error.message : "Unable to process folder changes.",
          };
          await store.putWatchedFolder(failed);
          await input.onChanges(failed, []).catch(() => {});
        }
      }
    } finally {
      scanning = false;
    }
  };
  timer = window.setInterval(() => void scan(false), 30_000);
  const focus = () => void scan(true);
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", focus);
  void scan(false);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", focus);
  };
}
