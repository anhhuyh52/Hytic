import type { SavedProject } from "./ProjectTypes";
import { CURRENT_SCHEMA_VERSION } from "./ProjectTypes";

/**
 * Validates and migrates a raw JSON object (read from IndexedDB or an uploaded
 * file) into a typed SavedProject. Throws a descriptive Error for:
 *   - non-object input
 *   - missing required top-level fields
 *   - future schema version we don't know how to handle
 *
 * Each migration step mutates a working copy, so callers always receive a
 * fully normalized project for the current schema version.
 */
export function migrateProject(raw: unknown): SavedProject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid project format: expected a JSON object.");
  }

  const o = raw as Record<string, unknown>;
  const version = o.schemaVersion;

  if (version === undefined || version === null) {
    throw new Error(
      "Invalid project format: missing schemaVersion field. " +
        "This file may not be a Hytic project.",
    );
  }

  if (typeof version !== "number") {
    throw new Error(
      `Invalid project format: schemaVersion must be a number, got ${typeof version}.`,
    );
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project was saved with a newer version of Hytic (schema v${version}). ` +
        `Please update the application to open it.`,
    );
  }

  if (version < 1) {
    throw new Error(`Unsupported schema version: ${version}.`);
  }

  // v1 is the only version — validate required fields and fill optional ones.
  return validateAndNormalizeV1(o);
}

function validateAndNormalizeV1(o: Record<string, unknown>): SavedProject {
  if (typeof o.id !== "string" || !o.id) {
    throw new Error("Invalid project: missing or empty id.");
  }
  if (typeof o.name !== "string") {
    throw new Error("Invalid project: missing name.");
  }
  if (typeof o.image !== "object" || o.image === null) {
    throw new Error("Invalid project: missing image metadata.");
  }
  if (typeof o.editState !== "object" || o.editState === null) {
    throw new Error("Invalid project: missing editState.");
  }

  const image = o.image as Record<string, unknown>;
  if (typeof image.id !== "string" || !image.id) {
    throw new Error("Invalid project: missing image.id.");
  }
  if (typeof image.fileName !== "string") {
    throw new Error("Invalid project: missing image.fileName.");
  }

  const now = Date.now();

  return {
    id: o.id,
    schemaVersion: 1,
    name: String(o.name),
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
    image: {
      id: String(image.id),
      fileName: String(image.fileName),
      mimeType: typeof image.mimeType === "string" ? image.mimeType : "image/png",
      width: typeof image.width === "number" ? image.width : 0,
      height: typeof image.height === "number" ? image.height : 0,
      sizeBytes: typeof image.sizeBytes === "number" ? image.sizeBytes : 0,
    },
    editState: o.editState as SavedProject["editState"],
  };
}
