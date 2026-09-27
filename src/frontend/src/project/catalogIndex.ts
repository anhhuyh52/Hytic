import type { CatalogSearchDocument, SmartCollectionQuery } from "./ProjectTypes";
import { evaluateSmartCollection, matchesCatalogText } from "./catalog";

const DB_NAME = "kalar-catalog-index";
const DB_VERSION = 1;
const INDEX_VERSION = 1;
let database: Promise<IDBDatabase> | null = null;
let activeAccountId: string | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) {
        const store = db.createObjectStore("documents", { keyPath: "key" });
        store.createIndex("byAccount", "accountId", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "accountId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error("Unable to open catalog index"));
    };
  });
  return database;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Catalog transaction aborted"));
  });
}

export function setCatalogIndexAccount(accountId: string | null): void {
  if (activeAccountId === accountId) return;
  activeAccountId = accountId;
  // No documents are retained in memory. Closing prevents transactions opened by
  // one account scope from leaking into the next account's work.
  void database?.then((db) => db.close()).catch(() => undefined);
  database = null;
}

export async function clearCatalogIndex(accountId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["documents", "meta"], "readwrite");
  const documents = transaction.objectStore("documents");
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = documents.index("byAccount").getAllKeys(accountId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const key of keys) documents.delete(key);
  transaction.objectStore("meta").delete(accountId);
  await transactionDone(transaction);
}

export async function rebuildCatalogIndex(
  accountId: string,
  documents: readonly CatalogSearchDocument[],
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["documents", "meta"], "readwrite");
  const store = transaction.objectStore("documents");
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = store.index("byAccount").getAllKeys(accountId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const key of keys) store.delete(key);
  for (const document of documents) store.put(document);
  transaction.objectStore("meta").put({
    accountId,
    version: INDEX_VERSION,
    count: documents.length,
    rebuiltAt: Date.now(),
  });
  await transactionDone(transaction);
}

export async function ensureCatalogIndex(
  accountId: string,
  loadCanonical: () => Promise<CatalogSearchDocument[]>,
): Promise<CatalogSearchDocument[]> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(["documents", "meta"], "readonly");
    const metaRequest = transaction.objectStore("meta").get(accountId);
    const documentsRequest = transaction
      .objectStore("documents")
      .index("byAccount")
      .getAll(accountId);
    const [meta, docs] = await Promise.all([
      new Promise<{ version?: number; count?: number } | undefined>((resolve, reject) => {
        metaRequest.onsuccess = () => resolve(metaRequest.result);
        metaRequest.onerror = () => reject(metaRequest.error);
      }),
      new Promise<CatalogSearchDocument[]>((resolve, reject) => {
        documentsRequest.onsuccess = () =>
          resolve(documentsRequest.result as CatalogSearchDocument[]);
        documentsRequest.onerror = () => reject(documentsRequest.error);
      }),
    ]);
    if (meta?.version === INDEX_VERSION && docs.length === meta.count) return docs;
  } catch {
    // The index is disposable. Canonical storage below repairs any corruption.
  }
  const canonical = await loadCanonical();
  await rebuildCatalogIndex(accountId, canonical).catch(async () => {
    const db = await openDatabase().catch(() => undefined);
    db?.close();
    database = null;
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await rebuildCatalogIndex(accountId, canonical);
  });
  return canonical;
}

export function searchCatalogDocuments(
  documents: readonly CatalogSearchDocument[],
  options: { text?: string; query?: SmartCollectionQuery },
): CatalogSearchDocument[] {
  return documents.filter(
    (document) =>
      (!options.text || matchesCatalogText(document, options.text)) &&
      (!options.query || evaluateSmartCollection(document, options.query)),
  );
}
