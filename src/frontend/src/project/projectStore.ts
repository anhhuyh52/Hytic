/*
 * Project store — legacy project state.json ({ id, name, activeUserMedia }).
 * A project owns an ordered list of media assets; activeUserMedia is the
 * last-selected one. (package.min.js: C @ 167, Vh()/wh() @ 18704/18234.)
 */
import {
  CURRENT_SCHEMA_VERSION,
  type ProjectRecord,
  type SavedProjectSummary,
} from "./ProjectTypes";
import * as store from "./indexedDbProjectStore";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createProject(name = "Hytic"): Promise<ProjectRecord> {
  const now = Date.now();
  const project: ProjectRecord = {
    id: generateId(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    activeUserMedia: null,
    assetIds: [],
  };
  await store.putProjectRecord(project);
  return project;
}

export function getProject(id: string): Promise<ProjectRecord | undefined> {
  return store.getProjectRecord(id);
}

export function listProjects(): Promise<SavedProjectSummary[]> {
  return store.listProjectSummaries();
}

export async function renameProject(id: string, name: string): Promise<void> {
  const project = await store.getProjectRecord(id);
  if (!project) return;
  await store.putProjectRecord({ ...project, name, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  await store.deleteProjectRecord(id);
}

/** Sets the project's active media (legacy activeUserMedia) — JSON-only. */
export async function deleteMediaAssets(
  projectId: string,
  assetIds: readonly string[],
): Promise<string | null> {
  const project = await store.getProjectRecord(projectId);
  if (!project || assetIds.length === 0) return project?.activeUserMedia ?? null;

  const deleteSet = new Set(assetIds);
  const activeIndex = project.activeUserMedia
    ? project.assetIds.indexOf(project.activeUserMedia)
    : -1;
  const firstDeletedIndex = project.assetIds.findIndex((assetId) => deleteSet.has(assetId));
  const remaining = project.assetIds.filter((assetId) => !deleteSet.has(assetId));
  const deletedActive = !!project.activeUserMedia && deleteSet.has(project.activeUserMedia);
  const nextIndex = Math.max(
    0,
    Math.min(deletedActive ? activeIndex : firstDeletedIndex, remaining.length - 1),
  );
  const nextActive = deletedActive
    ? (remaining[nextIndex] ?? null)
    : project.activeUserMedia && remaining.includes(project.activeUserMedia)
      ? project.activeUserMedia
      : (remaining[0] ?? null);

  for (const assetId of deleteSet) {
    await store.deleteMedia(assetId);
  }
  await store.putProjectRecord({
    ...project,
    assetIds: remaining,
    activeUserMedia: nextActive,
    updatedAt: Date.now(),
  });
  return nextActive;
}

export async function setActiveUserMedia(projectId: string, assetId: string | null): Promise<void> {
  const project = await store.getProjectRecord(projectId);
  if (!project) return;
  if (project.activeUserMedia === assetId) return;
  await store.putProjectRecord({ ...project, activeUserMedia: assetId, updatedAt: Date.now() });
}

/**
 * Boot helper: the project to open on launch. Prefers the requested id, else
 * creates a fresh "Default Project". It intentionally does not scan every project
 * on startup; the project gallery hydrates other projects lazily when opened.
 */
export async function resolveBootProject(preferredId: string | null): Promise<ProjectRecord> {
  if (preferredId) {
    const wanted = await store.getProjectRecord(preferredId);
    if (wanted) return wanted;
  }
  return createProject("Default Project");
}
