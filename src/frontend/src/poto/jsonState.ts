import type { SerializedEditState } from "../project/ProjectTypes";

/** Deep-clones persisted editor data, whose storage contract is JSON-only. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneSerializedState(state: SerializedEditState): SerializedEditState {
  return cloneJson(state);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Recursively applies an object patch while replacing arrays and scalar values. */
export function mergeJsonPatch<T>(base: T, patch: Record<string, unknown>): T {
  const out = cloneJson(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeJsonPatch(current, value)
        : cloneJson(value);
  }
  return out as T;
}
