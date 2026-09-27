import { getStorageAccountKey } from "../project/storage/storageWriter";

export type RelayStagedFile = {
  write(chunk: ArrayBuffer): Promise<void>;
  finish(): Promise<File>;
  cleanup(): Promise<void>;
};

const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "relay-file";
}

export async function createRelayStagedFile(meta: {
  id: string;
  name: string;
  type: string;
  lastModified?: number;
}): Promise<RelayStagedFile> {
  if (navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const accounts = await root.getDirectoryHandle("accounts", { create: true });
      const account = await accounts.getDirectoryHandle(getStorageAccountKey(), { create: true });
      const inbox = await account.getDirectoryHandle("relay-inbox", { create: true });
      const stagedName = `${Date.now().toString(36)}-${safeName(meta.id)}-${safeName(meta.name)}`;
      const handle = await inbox.getFileHandle(stagedName, { create: true });
      const writer = await handle.createWritable();
      return {
        async write(chunk) {
          await writer.write(chunk);
        },
        async finish() {
          await writer.close();
          const file = await handle.getFile();
          return new File([file], meta.name, {
            type: meta.type || file.type,
            lastModified: meta.lastModified ?? Date.now(),
          });
        },
        async cleanup() {
          await inbox.removeEntry(stagedName).catch(() => undefined);
        },
      };
    } catch {
      // Fall through to memory staging. Some browsers expose OPFS but block it in
      // private contexts or non-secure origins.
    }
  }

  const chunks: ArrayBuffer[] = [];
  let total = 0;
  return {
    async write(chunk) {
      total += chunk.byteLength;
      if (total > MEMORY_LIMIT_BYTES) {
        throw new Error("This file is too large for relay memory staging in this browser.");
      }
      chunks.push(chunk);
    },
    async finish() {
      return new File(chunks, meta.name, {
        type: meta.type,
        lastModified: meta.lastModified ?? Date.now(),
      });
    },
    async cleanup() {
      chunks.length = 0;
    },
  };
}
