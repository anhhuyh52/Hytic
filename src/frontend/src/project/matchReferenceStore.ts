import type { MatchReferenceRecord } from "./ProjectTypes";
import {
  listMatchReferences as listStoredMatchReferences,
  putMatchReference,
  deleteMatchReferenceRecord,
} from "./indexedDbProjectStore";

export const MATCH_REFERENCES_CHANGED = "kalar-match-references-changed";

function notifyReferencesChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MATCH_REFERENCES_CHANGED));
  }
}

function referenceIdFromName(name: string): string {
  return name.trim() || `reference-${Date.now().toString(36)}`;
}

export async function listMatchReferences(): Promise<MatchReferenceRecord[]> {
  const records = await listStoredMatchReferences();
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveMatchReferenceFile(file: File): Promise<MatchReferenceRecord> {
  const record: MatchReferenceRecord = {
    id: referenceIdFromName(file.name),
    name: file.name || "Imported reference",
    mimeType: file.type || "application/octet-stream",
    blob: file,
    sizeBytes: file.size,
    updatedAt: Date.now(),
  };
  await putMatchReference(record);
  notifyReferencesChanged();
  return record;
}

export function deleteMatchReference(id: string): Promise<void> {
  return deleteMatchReferenceRecord(id).then(() => notifyReferencesChanged());
}

export async function deleteAllMatchReferences(): Promise<void> {
  const records = await listStoredMatchReferences();
  await Promise.all(records.map((record) => deleteMatchReferenceRecord(record.id)));
  notifyReferencesChanged();
}
