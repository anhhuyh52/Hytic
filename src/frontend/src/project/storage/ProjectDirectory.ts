// Directory wrapper + caches for the OPFS-backed project/media store. The wrapper
// exposes the navigation/IO surface the project and media stores build on.

import {
  storageContext,
  getStorageAccountKey,
  getStorageAccountPath,
  getStorageAccountRoot,
  getStorageRoot,
  type WriteFiles,
} from "./storageWriter";
import type { FsDirectoryHandle, FsFileHandle } from "./memoryHandles";

export type DirectoryEntry = ProjectDirectory | FsFileHandle;

// ── caches ───────────────────────────────────────────────────────────────────
// Eh: path → ProjectDirectory wrapper (LRU, max 70). Ih: path → entry list (max 30).
const wrapperCache = new Map<string, ProjectDirectory>();
const entryListCache = new Map<string, DirectoryEntry[]>();
const NAME_COMPARE: Intl.CollatorOptions = { numeric: true };
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, NAME_COMPARE);

/** Get a cached wrapper, refreshing its LRU position. */
function getCachedWrapper(path: string): ProjectDirectory | undefined {
  const cached = wrapperCache.get(path);
  if (cached) {
    wrapperCache.delete(path);
    wrapperCache.set(path, cached);
  }
  return cached;
}

/** Cache a wrapper, evicting the oldest beyond 70. */
function setCachedWrapper(path: string, wrapper: ProjectDirectory): ProjectDirectory {
  wrapperCache.delete(path);
  wrapperCache.set(path, wrapper);
  if (wrapperCache.size > 70) {
    for (const key of wrapperCache.keys()) {
      wrapperCache.delete(key);
      break;
    }
  }
  return wrapper;
}

/** Invalidate a cached wrapper. */
function invalidateWrapper(path: string): boolean {
  return wrapperCache.delete(path);
}

/** Invalidate a cached entry list. */
function invalidateEntryList(path: string): void {
  entryListCache.delete(path);
}

/** List a directory's entries (cached), wrapping sub-directories. */
async function listEntries(
  path: string,
  prefix: string,
  handle: FsDirectoryHandle,
  parent: ProjectDirectory,
): Promise<DirectoryEntry[]> {
  const cached = entryListCache.get(path);
  if (cached) {
    entryListCache.delete(path);
    entryListCache.set(path, cached);
    return cached;
  }
  const entries: DirectoryEntry[] = [];
  for await (const [name, child] of handle.entries()) {
    if (child.kind === "directory") {
      const childPath = prefix + name;
      entries.push(
        getCachedWrapper(childPath) ??
          setCachedWrapper(childPath, new ProjectDirectory(childPath, child, parent)),
      );
    } else {
      entries.push(child);
    }
  }
  entries.sort(byName);
  entryListCache.set(path, entries);
  if (entryListCache.size > 30) {
    for (const key of entryListCache.keys()) {
      entryListCache.delete(key);
      break;
    }
  }
  return entries;
}

export class ProjectDirectory {
  readonly name: string;
  readonly isOpfsDirectory = true;
  /** Path prefix for children: `path + "/"`, or "" at the root. */
  private readonly prefix: string;
  /** Underlying directory handle. */
  private readonly handle: FsDirectoryHandle;
  /** Parent wrapper, null at the root. */
  private readonly parent: ProjectDirectory | null;

  constructor(
    readonly path: string,
    handle: FsDirectoryHandle,
    parent: ProjectDirectory | null,
  ) {
    this.name = handle.name;
    this.prefix = path ? path + "/" : path;
    this.handle = handle;
    this.parent = parent;
  }

  private entries(): Promise<DirectoryEntry[]> {
    return listEntries(this.path, this.prefix, this.handle, this);
  }

  async count(): Promise<number> {
    return (await this.entries()).length;
  }

  async clear(): Promise<void> {
    const entries = await this.entries();
    for (const entry of entries) {
      if (entry instanceof ProjectDirectory) invalidateWrapper(entry.path);
      await this.handle.removeEntry(entry.name, { recursive: true });
    }
    invalidateEntryList(this.path);
  }

  async isEmpty(): Promise<boolean> {
    return (await this.entries()).length === 0;
  }

  async contains(other: ProjectDirectory): Promise<boolean> {
    return other.path.includes(this.path);
  }

  async matches(other: ProjectDirectory): Promise<boolean> {
    return other.path === this.path;
  }

  async delete(): Promise<void> {
    if (!this.parent) return;
    return this.parent.deleteEntry(this.name);
  }

  async findEntry(
    predicate: (entry: DirectoryEntry | File | Blob | string) => boolean | Promise<boolean>,
    kind: "any" | "directory" | "file" = "any",
    resolveFile = true,
  ): Promise<DirectoryEntry | File | Blob | string | undefined> {
    const entries = await this.entries();
    for (const entry of entries) {
      let candidate: DirectoryEntry | File | Blob | string | null;
      if (entry instanceof ProjectDirectory && kind !== "file") {
        candidate = entry;
      } else if (kind === "file" && !(entry instanceof ProjectDirectory)) {
        candidate = resolveFile ? await entry.getFile() : entry;
      } else {
        candidate = null;
      }
      if (candidate && (await predicate(candidate)) === true) return candidate;
    }
    return undefined;
  }

  async findDirectory(
    predicate: (entry: ProjectDirectory) => boolean | Promise<boolean>,
  ): Promise<ProjectDirectory | undefined> {
    return this.findEntry(predicate as never, "directory", false) as Promise<
      ProjectDirectory | undefined
    >;
  }

  async findFile(
    predicate: (file: File | Blob | string | FsFileHandle) => boolean | Promise<boolean>,
    resolveFile = true,
  ): Promise<File | Blob | string | FsFileHandle | undefined> {
    return this.findEntry(predicate as never, "file", resolveFile) as Promise<
      File | Blob | string | FsFileHandle | undefined
    >;
  }

  async hasDirectory(name: string): Promise<boolean> {
    return this.handle
      .getDirectoryHandle(name, { create: false })
      .then(() => true)
      .catch(() => false);
  }

  async getDirectory(
    name: string,
    create = false,
    allowEmpty = true,
  ): Promise<ProjectDirectory | undefined> {
    const childPath = this.prefix + name;
    const cached = getCachedWrapper(childPath);
    if (cached && (allowEmpty || !(await cached.isEmpty()))) return cached;
    const handle = await this.handle.getDirectoryHandle(name, { create });
    if (create) invalidateEntryList(this.path);
    if (allowEmpty)
      return setCachedWrapper(childPath, new ProjectDirectory(childPath, handle, this));
    for await (const _ of handle.keys()) {
      void _;
      return setCachedWrapper(childPath, new ProjectDirectory(childPath, handle, this));
    }
    return undefined;
  }

  async getDirectories(names: string[], includeEmpty = true): Promise<ProjectDirectory[]> {
    return (await this.getAllDirectories(includeEmpty)).filter((dir) => names.includes(dir.name));
  }

  async getAllDirectories(includeEmpty = true): Promise<ProjectDirectory[]> {
    const entries = await this.entries();
    const dirs: ProjectDirectory[] = [];
    for (const entry of entries) {
      if (!(entry instanceof ProjectDirectory)) continue;
      if (!includeEmpty && (await entry.isEmpty())) continue;
      dirs.push(entry);
    }
    return dirs;
  }

  async getFirstDirectory(includeEmpty = true): Promise<ProjectDirectory | undefined> {
    return (await this.getAllDirectories(includeEmpty))[0];
  }

  async getSiblingDirectories(includeEmpty = true): Promise<ProjectDirectory[]> {
    if (!this.parent) return [];
    return (await this.parent.getAllDirectories(includeEmpty)).filter(
      (dir) => dir.path !== this.path,
    );
  }

  async getAdjacentDirectory(includeEmpty = true): Promise<ProjectDirectory | undefined> {
    if (!this.parent) return undefined;
    const siblings = await this.parent.getAllDirectories(includeEmpty);
    if (siblings.length < 2) return undefined;
    const index = siblings.findIndex((dir) => dir.path === this.path);
    return index < siblings.length - 1 ? siblings[index + 1] : siblings[index - 1];
  }

  async getAncestorDirectory(levels = 1): Promise<ProjectDirectory | null> {
    let ancestor: ProjectDirectory | null = this.parent;
    for (let i = 1; i < levels && ancestor; i++) ancestor = ancestor.parent;
    return ancestor;
  }

  async getNextSiblingDirectory(
    includeEmpty = true,
    wrap = true,
  ): Promise<ProjectDirectory | undefined> {
    if (!this.parent) return undefined;
    const siblings = await this.parent.getAllDirectories(includeEmpty);
    const index = siblings.findIndex((dir) => dir.path === this.path);
    return index + 1 < siblings.length ? siblings[index + 1] : wrap ? siblings[0] : undefined;
  }

  async getPreviousSiblingDirectory(
    includeEmpty = true,
    wrap = true,
  ): Promise<ProjectDirectory | undefined> {
    if (!this.parent) return undefined;
    const siblings = await this.parent.getAllDirectories(includeEmpty);
    const index = siblings.findIndex((dir) => dir.path === this.path);
    return index >= 1 ? siblings[index - 1] : wrap ? siblings[siblings.length - 1] : undefined;
  }

  async hasFile(name: string): Promise<boolean> {
    return this.handle
      .getFileHandle(name)
      .then(() => true)
      .catch(() => false);
  }

  async getFile(name: string, resolve = true): Promise<File | Blob | string | FsFileHandle> {
    const handle = await this.handle.getFileHandle(name);
    return resolve ? handle.getFile() : handle;
  }

  async getFileAsText(name: string): Promise<string> {
    const file = await this.getFile(name, true);
    if (typeof file === "string") return file;
    if (file instanceof Blob) return file.text();
    return JSON.stringify(file);
  }

  async getFileAsParsedJSON<T = unknown>(name: string): Promise<T> {
    return JSON.parse(await this.getFileAsText(name)) as T;
  }

  async getAllFiles(resolve = true): Promise<Array<File | Blob | string | FsFileHandle>> {
    const entries = await this.entries();
    const files: Array<File | Blob | string | FsFileHandle> = [];
    for (const entry of entries) {
      if (entry instanceof ProjectDirectory) continue;
      files.push(resolve ? await entry.getFile() : entry);
    }
    return files;
  }

  async getAllFilesAsParsedJSON(keyed = true): Promise<Record<string, unknown> | unknown[]> {
    const files = await this.getAllFiles(true);
    const out: Record<string, unknown> | unknown[] = keyed ? {} : [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = keyed && file instanceof File && file.name ? file.name : i;
      const value =
        typeof file === "string"
          ? JSON.parse(file)
          : file instanceof Blob
            ? JSON.parse(await file.text())
            : JSON.parse(JSON.stringify(file));
      (out as Record<string | number, unknown>)[key] = value;
    }
    return out;
  }

  async getAllEntries(
    includeEmptyDirs = true,
    resolveFiles = true,
  ): Promise<Array<DirectoryEntry | File | Blob | string>> {
    const entries = await this.entries();
    const out: Array<DirectoryEntry | File | Blob | string> = [];
    for (const entry of entries) {
      if (entry instanceof ProjectDirectory && (includeEmptyDirs || !(await entry.isEmpty()))) {
        out.push(entry);
      } else if (!(entry instanceof ProjectDirectory)) {
        out.push(resolveFiles ? await entry.getFile() : entry);
      }
    }
    return out;
  }

  async forEachHandle(
    visitor: (handle: FsDirectoryHandle | FsFileHandle) => boolean | Promise<boolean>,
  ): Promise<void> {
    for await (const handle of this.handle.values()) {
      if ((await visitor(handle)) === false) break;
    }
  }

  async saveFile(name: string, value: unknown): Promise<void> {
    return this.saveFiles({ [name]: value });
  }

  async saveFiles(files: WriteFiles): Promise<void> {
    invalidateEntryList(this.path);
    if (!storageContext.write) throw new Error("[storage] write access not initialised");
    return storageContext.write(this.path, files);
  }

  async deleteEntry(name: string): Promise<void> {
    invalidateWrapper(this.prefix + name);
    invalidateEntryList(this.path);
    return this.handle.removeEntry(name, { recursive: true });
  }
}

/**
 * Resolve the root directory wrapper, initialising write access. Cached on
 * `storageContext.dir`.
 */
let rootPromise: Promise<ProjectDirectory> | null = null;

/** Drop wrappers that belong to the previous account before switching scope. */
export function resetStorageDirectoryCaches(): void {
  rootPromise = null;
  storageContext.dir = null;
  wrapperCache.clear();
  entryListCache.clear();
}

export function openRootDirectory(): Promise<ProjectDirectory> {
  if (rootPromise) return rootPromise;
  const accountKey = getStorageAccountKey();
  rootPromise = (async () => {
    if (!storageContext.dir) {
      const handle = await getStorageAccountRoot(accountKey);
      if (getStorageAccountKey() !== accountKey) {
        rootPromise = null;
        return openRootDirectory();
      }
      storageContext.dir = new ProjectDirectory(getStorageAccountPath(accountKey), handle, null);
    }
    if (!storageContext.write && storageContext.getWriteAccess) {
      storageContext.write = await storageContext.getWriteAccess();
    }
    return storageContext.dir as ProjectDirectory;
  })();
  return rootPromise;
}

/** Origin-wide root, used only to claim/copy the pre-isolation legacy layout. */
export async function openLegacyRootDirectory(): Promise<ProjectDirectory> {
  await openRootDirectory(); // Ensures the shared write queue is ready.
  return new ProjectDirectory("", await getStorageRoot(), null);
}
