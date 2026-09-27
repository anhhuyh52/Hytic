import type {
  CatalogSearchDocument,
  MediaCatalogFields,
  MediaFlag,
  MediaRating,
  SmartCollectionField,
  SmartCollectionQuery,
} from "./ProjectTypes";

export const CATALOG_SCHEMA_VERSION = 1 as const;

export function normalizeKeywords(values: unknown): string[] {
  const input = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[,;]/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of input) {
    const keyword = String(value).trim().replace(/\s+/g, " ");
    const key = keyword.toLocaleLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

export function createCatalogFields(input: {
  fileName: string;
  size?: number;
  lastModified?: number;
  now?: number;
}): MediaCatalogFields {
  const now = input.now ?? Date.now();
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    rating: 0,
    flag: "none",
    keywords: [],
    importedAt: now,
    catalogUpdatedAt: now,
    sourceIdentity: {
      fileName: input.fileName,
      size: Math.max(0, Number(input.size) || 0),
      lastModified:
        Number.isFinite(input.lastModified) && Number(input.lastModified) > 0
          ? Number(input.lastModified)
          : undefined,
    },
  };
}

export function normalizeCatalogFields(
  value: unknown,
  fallback: { fileName: string; size?: number; timestamp?: number },
): MediaCatalogFields {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const source =
    record.sourceIdentity && typeof record.sourceIdentity === "object"
      ? (record.sourceIdentity as Record<string, unknown>)
      : {};
  const ratingNumber = Math.round(Number(record.rating));
  const rating = (ratingNumber >= 0 && ratingNumber <= 5 ? ratingNumber : 0) as MediaRating;
  const flag = (["none", "pick", "reject"] as MediaFlag[]).includes(record.flag as MediaFlag)
    ? (record.flag as MediaFlag)
    : "none";
  const timestamp = Math.max(0, Number(fallback.timestamp) || Date.now());
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    rating,
    flag,
    keywords: normalizeKeywords(record.keywords),
    importedAt: Math.max(0, Number(record.importedAt) || timestamp),
    catalogUpdatedAt: Math.max(0, Number(record.catalogUpdatedAt) || timestamp),
    sourceIdentity: {
      fileName:
        typeof source.fileName === "string" && source.fileName.trim()
          ? source.fileName.trim()
          : fallback.fileName,
      size: Math.max(0, Number(source.size) || Number(fallback.size) || 0),
      lastModified:
        Number.isFinite(Number(source.lastModified)) && Number(source.lastModified) > 0
          ? Number(source.lastModified)
          : undefined,
      contentHash:
        typeof source.contentHash === "string" && source.contentHash
          ? source.contentHash
          : undefined,
    },
  };
}

export function patchCatalogFields(
  current: MediaCatalogFields,
  patch: Partial<Pick<MediaCatalogFields, "rating" | "flag" | "keywords">>,
  now = Date.now(),
): MediaCatalogFields {
  return normalizeCatalogFields(
    {
      ...current,
      ...patch,
      keywords: patch.keywords === undefined ? current.keywords : normalizeKeywords(patch.keywords),
      catalogUpdatedAt: now,
    },
    {
      fileName: current.sourceIdentity.fileName,
      size: current.sourceIdentity.size,
      timestamp: current.importedAt,
    },
  );
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const ratio = value.match(/^\s*([\d.]+)\s*\/\s*([\d.]+)/);
  if (ratio) {
    const denominator = Number(ratio[2]);
    return denominator ? Number(ratio[1]) / denominator : undefined;
  }
  const match = value.match(/-?[\d.]+/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function parseCaptureDate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function text(metadata: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function createCatalogSearchDocument(input: {
  accountId: string;
  projectId: string;
  projectName: string;
  assetId: string;
  fileName: string;
  width: number;
  height: number;
  mediaType?: "image" | "video";
  metadata?: Record<string, unknown>;
  catalog: MediaCatalogFields;
}): CatalogSearchDocument {
  const metadata = input.metadata ?? {};
  return {
    ...input.catalog,
    key: `${input.accountId}:${input.projectId}:${input.assetId}`,
    accountId: input.accountId,
    projectId: input.projectId,
    projectName: input.projectName,
    assetId: input.assetId,
    fileName: input.fileName,
    width: input.width,
    height: input.height,
    mediaType: input.mediaType ?? "image",
    camera: text(metadata, "cameraModel", "model", "make"),
    lens: text(metadata, "lens", "lensModel"),
    iso: parseNumeric(metadata.iso),
    aperture: parseNumeric(metadata.aperture),
    shutter: parseNumeric(metadata.shutterSpeed),
    focalLength: parseNumeric(metadata.focalLength),
    captureDate: parseCaptureDate(metadata.capturedAt),
  };
}

function fieldValue(document: CatalogSearchDocument, field: SmartCollectionField): unknown {
  switch (field) {
    case "project": return document.projectId;
    case "filename": return document.fileName;
    case "mediaType": return document.mediaType;
    default: return document[field];
  }
}

function normalized(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase();
}

function evaluatePredicate(document: CatalogSearchDocument, query: Extract<SmartCollectionQuery, { type: "predicate" }>): boolean {
  const actual = fieldValue(document, query.field);
  const expected = query.value;
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const actualList = Array.isArray(actual) ? actual : [actual];
  switch (query.operator) {
    case "equals": return actualList.some((a) => expectedList.some((e) => normalized(a) === normalized(e)));
    case "not-equals": return !actualList.some((a) => expectedList.some((e) => normalized(a) === normalized(e)));
    case "contains": return expectedList.some((e) => actualList.some((a) => normalized(a).includes(normalized(e))));
    case "not-contains": return !expectedList.some((e) => actualList.some((a) => normalized(a).includes(normalized(e))));
    case "gte": return Number(actual) >= Number(expectedList[0]);
    case "lte": return Number(actual) <= Number(expectedList[0]);
    case "between": return Number(actual) >= Number(expectedList[0]) && Number(actual) <= Number(expectedList[1]);
    case "in": return actualList.some((a) => expectedList.some((e) => normalized(a) === normalized(e)));
  }
}

export function evaluateSmartCollection(
  document: CatalogSearchDocument,
  query: SmartCollectionQuery,
): boolean {
  if (query.type === "predicate") return evaluatePredicate(document, query);
  if (query.type === "not") return !evaluateSmartCollection(document, query.child);
  if (query.type === "and") return query.children.every((child) => evaluateSmartCollection(document, child));
  return query.children.some((child) => evaluateSmartCollection(document, child));
}

export function matchesCatalogText(document: CatalogSearchDocument, search: string): boolean {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    document.fileName,
    document.projectName,
    document.camera,
    document.lens,
    ...document.keywords,
  ].join("\n").toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}
