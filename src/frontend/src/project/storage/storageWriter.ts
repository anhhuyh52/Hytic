// OPFS root accessor + serialized write queue. Writes are serialized through a
// single worker (createSyncAccessHandle); object/array values are JSON-stringified
// and binary buffers are transferred.

import { setCatalogIndexAccount } from "../catalogIndex";
import {
  MemoryDirectoryHandle,
  MemoryFileHandle,
  type FsDirectoryHandle,
  type MemoryFileValue,
} from "./memoryHandles";

export type WriteFiles = Record<string, unknown>;
export type WriteFn = (dirPath: string, files: WriteFiles) => Promise<void>;

/** Process-wide filesystem context. `dir` holds the root wrapper. */
export interface StorageContext {
  handle: FsDirectoryHandle | null;
  getWriteAccess: (() => Promise<WriteFn>) | null;
  write: WriteFn | null;
  dir: unknown | null;
}

export const storageContext: StorageContext = {
  handle: null,
  getWriteAccess: null,
  write: null,
  dir: null,
};

let storageAccountKey = "guest";

/** Stable, path-safe OPFS directory key for the active account workspace. */
export function storageAccountKeyFor(accountId: string | null | undefined): string {
  const value = accountId?.trim();
  return value ? `user-${encodeURIComponent(value)}` : "guest";
}

export function getStorageAccountKey(): string {
  return storageAccountKey;
}

export function getStorageAccountPath(accountKey = storageAccountKey): string {
  return `accounts/${accountKey}`;
}

/** Switch the process-wide storage scope. Callers must reset wrapper/store caches. */
export function setStorageAccount(accountId: string | null | undefined): boolean {
  const next = storageAccountKeyFor(accountId);
  if (next === storageAccountKey) return false;
  storageAccountKey = next;
  setCatalogIndexAccount(accountId?.trim() || null);
  storageContext.dir = null;
  return true;
}

/** Install the in-memory filesystem when OPFS is unavailable. */
export function initMemoryFs(): void {
  storageContext.handle = new MemoryDirectoryHandle("");
  storageContext.getWriteAccess = () => Promise.resolve(memoryWrite);
}

const memoryWrite: WriteFn = (dirPath, files) => {
  let dir = storageContext.handle as MemoryDirectoryHandle;
  for (const part of dirPath.split("/")) {
    if (!part) continue;
    const existing = dir.contents.get(part);
    if (existing && existing.kind === "directory") {
      dir = existing as MemoryDirectoryHandle;
    } else {
      const next = new MemoryDirectoryHandle(part);
      dir.contents.set(part, next);
      dir = next;
    }
  }
  for (const name in files) {
    dir.contents.set(name, new MemoryFileHandle(name, files[name] as MemoryFileValue));
  }
  return Promise.resolve();
};

/** Resolve the OPFS root (or the memory fallback) once and cache it. */
export function getStorageRoot(): Promise<FsDirectoryHandle> {
  if (storageContext.handle) return Promise.resolve(storageContext.handle);
  return new Promise((resolve) => {
    if (typeof navigator?.storage?.getDirectory !== "function") {
      initMemoryFs();
      resolve(storageContext.handle!);
      return;
    }
    navigator.storage
      .getDirectory()
      .then((root) => {
        if (storageContext.handle) {
          resolve(storageContext.handle);
          return;
        }
        storageContext.handle = root as unknown as FsDirectoryHandle;
        storageContext.getWriteAccess = createOpfsWriteQueue;
        resolve(storageContext.handle);
      })
      .catch(() => {
        if (!storageContext.handle) initMemoryFs();
        resolve(storageContext.handle!);
      });
  });
}

/** Resolve the directory dedicated to the active account. */
export async function getStorageAccountRoot(
  accountKey = storageAccountKey,
): Promise<FsDirectoryHandle> {
  const root = await getStorageRoot();
  const accounts = await root.getDirectoryHandle("accounts", { create: true });
  return accounts.getDirectoryHandle(accountKey, { create: true });
}

/**
 * A single worker that serializes OPFS writes. Returns the write function once
 * the worker signals ready: one write in flight at a time, the rest queue, and
 * `navigator.storage.persist()` is requested while idle under user activation.
 */
let writeQueuePromise: Promise<WriteFn> | null = null;
const WRITE_WORKER_READY_TIMEOUT_MS = 10_000;
// Large decoded RAW/TIFF caches can be hundreds of MB. A fixed one-minute
// deadline incorrectly failed healthy writes on slower disks while the worker was
// still making progress.
const WRITE_TIMEOUT_MS = 180_000;

export function createOpfsWriteQueue(): Promise<WriteFn> {
  if (writeQueuePromise) return writeQueuePromise;

  const worker = new Worker(new URL("./storageWriteWorker.ts", import.meta.url), {
    type: "module",
  });

  type Pending = {
    resolve: () => void;
    reject: (error: unknown) => void;
    dirPath: string;
    files: WriteFiles;
  };
  const queue: Pending[] = [];
  let busy = false;
  let resolveCurrent: (() => void) | null = null;
  let rejectCurrent: ((error: unknown) => void) | null = null;
  let persisted = false;
  let persistRequested = false;
  let ready = false;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let failWorker: ((reason: unknown) => void) | null = null;

  void navigator.storage?.persisted?.().then((value) => {
    persisted = value;
  });

  // Serialize + transfer: JSON objects/arrays; transfer buffers.
  const send = (dirPath: string, files: WriteFiles) => {
    const transfer: Transferable[] = [];
    const out: WriteFiles = { ...files };
    for (const key in out) {
      const value = out[key];
      if (value instanceof Blob || typeof value === "string") continue;
      if (
        value &&
        (value as object).constructor !== Object &&
        (value as object).constructor !== Array
      ) {
        if (value instanceof ArrayBuffer) transfer.push(value);
        else if (ArrayBuffer.isView(value)) transfer.push((value as ArrayBufferView).buffer);
      } else {
        out[key] = JSON.stringify(value);
      }
    }
    worker.postMessage({ dirPath, files: out }, transfer);
    writeTimer = setTimeout(
      () => failWorker?.(new Error(`OPFS write timed out for "${dirPath}".`)),
      WRITE_TIMEOUT_MS,
    );
  };

  const next = () => {
    const job = queue.shift();
    if (job) {
      busy = true;
      resolveCurrent = job.resolve;
      rejectCurrent = job.reject;
      send(job.dirPath, job.files);
    } else {
      busy = false;
      resolveCurrent = null;
      rejectCurrent = null;
      const active = navigator.userActivation?.isActive;
      const hadActivation = navigator.userActivation?.hasBeenActive;
      if (!persisted && !persistRequested && (active || hadActivation)) {
        persistRequested = true;
        void navigator.storage?.persist?.().then((value) => {
          persisted = value;
        });
      }
    }
  };

  writeQueuePromise = new Promise<WriteFn>((resolveReady, rejectReady) => {
    const fail = (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = undefined;
      rejectCurrent?.(error);
      for (const job of queue.splice(0)) job.reject(error);
      if (!ready) rejectReady(error);
      worker.terminate();
      writeQueuePromise = null;
      storageContext.write = async (dirPath, files) => {
        const nextWrite = await createOpfsWriteQueue();
        storageContext.write = nextWrite;
        return nextWrite(dirPath, files);
      };
      busy = false;
      resolveCurrent = null;
      rejectCurrent = null;
    };
    failWorker = fail;
    const readyTimer = setTimeout(
      () => fail(new Error("OPFS write worker did not start.")),
      WRITE_WORKER_READY_TIMEOUT_MS,
    );
    worker.onerror = (event) => {
      clearTimeout(readyTimer);
      fail(new Error(event.message || "OPFS write worker failed."));
    };
    worker.onmessage = (event: MessageEvent) => {
      if (event.data === 1) {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = undefined;
        resolveCurrent?.();
        next();
      } else if (event.data === 0) {
        clearTimeout(readyTimer);
        ready = true;
        resolveReady(
          (dirPath, files) =>
            new Promise<void>((resolve, reject) => {
              if (busy) {
                queue.push({ resolve, reject, dirPath, files });
              } else {
                busy = true;
                resolveCurrent = resolve;
                rejectCurrent = reject;
                send(dirPath, files);
              }
            }),
        );
      } else if (event.data && typeof event.data.error === "string") {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = undefined;
        rejectCurrent?.(new Error(event.data.error));
        next();
      }
    };
  });

  return writeQueuePromise;
}
