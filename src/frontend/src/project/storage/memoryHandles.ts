// In-memory FileSystem fallback — faithful port of the legacy `yh`
// (MemoryDirectoryHandle) and `Sh` (MemoryFileHandle) from package.min.js. Used
// when `navigator.storage.getDirectory()` (OPFS) is unavailable so the rest of the
// stack can run against the same handle shape regardless of backend.
//
// The structural interfaces below are the common denominator between the native
// OPFS handles and these memory handles (the native handles satisfy them at
// runtime; lib.dom just doesn't type entries()/keys()/values()).

export interface FsFileHandle {
  readonly name: string;
  readonly kind: "file";
  getFile(): Promise<File | Blob | string>;
}

export interface FsDirectoryHandle {
  readonly name: string;
  readonly kind: "directory";
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FsDirectoryHandle | FsFileHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FsDirectoryHandle | FsFileHandle>;
}

export type MemoryFileValue = Blob | string | ArrayBuffer | ArrayBufferView | object;

/** Legacy `Sh` — a file handle backed by an in-memory value. */
export class MemoryFileHandle implements FsFileHandle {
  readonly kind = "file" as const;
  readonly isMemoryFileHandle = true;
  private readonly value: Blob | string | object;

  constructor(
    readonly name: string,
    value: MemoryFileValue,
  ) {
    // Legacy only special-cases ArrayBuffer → Blob; strings/objects pass through
    // and are interpreted by ProjectDirectory.getFileAs* (string | Blob | JSON).
    this.value =
      value instanceof ArrayBuffer ? new Blob([value]) : (value as Blob | string | object);
  }

  getFile(): Promise<File | Blob | string> {
    return Promise.resolve(this.value as Blob | string);
  }
}

/** Legacy `yh` — a directory handle backed by an in-memory Map of entries. */
export class MemoryDirectoryHandle implements FsDirectoryHandle {
  readonly kind = "directory" as const;
  readonly isMemoryDirectoryHandle = true;
  readonly contents = new Map<string, MemoryDirectoryHandle | MemoryFileHandle>();

  constructor(readonly name: string) {}

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle> {
    const existing = this.contents.get(name);
    if (existing && existing.kind === "directory") return Promise.resolve(existing);
    if (options?.create === true) {
      const dir = new MemoryDirectoryHandle(name);
      this.contents.set(name, dir);
      return Promise.resolve(dir);
    }
    return Promise.reject(new Error("Not found"));
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle> {
    const existing = this.contents.get(name);
    if (existing && existing.kind === "file") return Promise.resolve(existing);
    if (options?.create === true) {
      const file = new MemoryFileHandle(name, new Blob([]));
      this.contents.set(name, file);
      return Promise.resolve(file);
    }
    return Promise.reject(new Error("Not found"));
  }

  removeEntry(name: string): Promise<void> {
    this.contents.delete(name);
    return Promise.resolve();
  }

  async *entries(): AsyncIterableIterator<[string, FsDirectoryHandle | FsFileHandle]> {
    for (const entry of this.contents) {
      await Promise.resolve();
      yield entry;
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const key of this.contents.keys()) {
      await Promise.resolve();
      yield key;
    }
  }

  async *values(): AsyncIterableIterator<FsDirectoryHandle | FsFileHandle> {
    for (const value of this.contents.values()) {
      await Promise.resolve();
      yield value;
    }
  }
}
