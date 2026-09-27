/// <reference lib="webworker" />
//
// OPFS write worker — faithful port of the worker body inside the legacy `Lh()`.
// `createSyncAccessHandle()` is only available off the main thread, so all OPFS
// writes are funnelled here. Each message resolves/creates the directory chain
// under the OPFS root, then writes every file with a sync access handle.

type WriteMessage = {
  dirPath: string;
  files: Record<string, ArrayBuffer | ArrayBufferView | Blob | string>;
};

// lib.dom doesn't always ship FileSystemSyncAccessHandle; type it minimally.
interface SyncAccessHandle {
  write(buffer: ArrayBuffer | ArrayBufferView): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

const ctx = self as unknown as Worker & {
  postMessage(message: unknown): void;
};

// Signal readiness (legacy worker posts 0 on startup; the queue resolves its
// write function only once this arrives).
ctx.postMessage(0);

ctx.onmessage = async (event: MessageEvent<WriteMessage>) => {
  let access: SyncAccessHandle | null = null;
  let encoder: TextEncoder | undefined;
  try {
    const { dirPath, files } = event.data;
    let dir = await navigator.storage.getDirectory();
    for (const part of dirPath.split("/")) {
      if (part) dir = await dir.getDirectoryHandle(part, { create: true });
    }

    for (const name in files) {
      const value = files[name];
      let data: ArrayBuffer | ArrayBufferView;
      if (value instanceof Blob) {
        data = await value.arrayBuffer();
      } else if (typeof value === "string") {
        data = (encoder ??= new TextEncoder()).encode(value);
      } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        data = value;
      } else {
        throw new Error("[OPFS] Invalid Type " + typeof value);
      }

      const fileHandle = await dir.getFileHandle(name, { create: true });
      access = await (
        fileHandle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
      ).createSyncAccessHandle();
      const written = access.write(data);
      if (written !== data.byteLength) throw new Error("[OPFS] Incomplete Write Op");
      access.truncate(written);
      access.flush();
      access.close();
      access = null;
    }
    ctx.postMessage(1);
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    access?.close();
  }
};
