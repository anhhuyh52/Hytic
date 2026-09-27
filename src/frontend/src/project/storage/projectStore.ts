// Project store — faithful port of the legacy project helpers in package.min.js:
//   Fh  getProjectsRoot          zh  getProjectDirectory
//   Vh  buildProjectContext      Bh  findFallbackProject
//   Yh  setActiveProject         wh  saveProjectState
//   dg  loadProjectContext       pg  createProject        fg  renameProject
//   jh  (activeUserMedia sync, FS-side)                   gg  deleteProject
//   a_/s_  bootProject           Bt  id generator (→ crypto.randomUUID)
//
// The legacy `C` (current project context) is modelled as module state here. The
// media-load boundary is kept clean: functions that legacy resolves via `lu()`
// (Wh, gg) return the ProjectDirectory the caller should load — the actual media
// load is Phase 3. UI event-bus triggers (a.trigger / transactions) are the
// caller's concern and are intentionally omitted from this pure store.

import { openRootDirectory, type ProjectDirectory } from "./ProjectDirectory";

/** Legacy project `state.json` shape. */
export type ProjectState = {
  id: string;
  name: string;
  activeUserMedia: string;
};

/** Legacy project context (`C` / the object `Vh` builds). */
export type ProjectContext = {
  rootDirectory: ProjectDirectory;
  userMediaDirectory: ProjectDirectory;
  state: ProjectState;
};

let projectsRootPromise: Promise<ProjectDirectory> | null = null;
let currentProject: ProjectContext | null = null;

export function resetProjectStore(): void {
  projectsRootPromise = null;
  currentProject = null;
}

/** The active project context (legacy `C`), or null before boot. */
export function getActiveProject(): ProjectContext | null {
  return currentProject;
}

function newProjectId(): string {
  // Legacy `Bt()` is a custom crypto id; randomUUID is the modern equivalent.
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Legacy `Fh`: the `projects/` root directory (cached). */
export function getProjectsRoot(): Promise<ProjectDirectory> {
  if (!projectsRootPromise) {
    projectsRootPromise = openRootDirectory().then(
      (root) => root.getDirectory("projects", true) as Promise<ProjectDirectory>,
    );
  }
  return projectsRootPromise;
}

/** Legacy `zh`: a project directory by id (create by default). */
export async function getProjectDirectory(
  id: string,
  create = true,
): Promise<ProjectDirectory | undefined> {
  return (await getProjectsRoot()).getDirectory(id, create);
}

/** Legacy `Vh`: build a project context, creating `user-media/` if absent. */
export async function buildProjectContext(dir: ProjectDirectory): Promise<ProjectContext> {
  return {
    rootDirectory: dir,
    userMediaDirectory: (await dir.getDirectory("user-media", true))!,
    state: await dir.getFileAsParsedJSON<ProjectState>("state.json"),
  };
}

/** Legacy `wh`: persist a project's `state.json`. */
export async function saveProjectState(ctx: ProjectContext): Promise<void> {
  return ctx.rootDirectory.saveFile("state.json", ctx.state);
}

/** Legacy `Yh`: activate a project and write `projects/active.txt`. */
export async function setActiveProject(ctx: ProjectContext): Promise<ProjectContext> {
  currentProject = ctx;
  await (await getProjectsRoot()).saveFile("active.txt", ctx.state.id);
  return ctx;
}

/** Legacy `dg`: load a project context by id (returns the active one if same). */
export async function loadProjectContext(id: string): Promise<ProjectContext> {
  if (currentProject && id === currentProject.state.id) return currentProject;
  const dir = await getProjectDirectory(id, false);
  if (!dir) throw new Error(`[storage] project not found: ${id}`);
  return buildProjectContext(dir);
}

/** Legacy `pg`: create a new project (dir + user-media + state.json). */
export async function createProject(name = "New Project"): Promise<ProjectContext> {
  const state: ProjectState = { id: newProjectId(), name, activeUserMedia: "" };
  const rootDirectory = (await getProjectDirectory(state.id, true))!;
  const userMediaDirectory = (await rootDirectory.getDirectory("user-media", true))!;
  await rootDirectory.saveFile("state.json", state);
  return { rootDirectory, userMediaDirectory, state };
}

/** Legacy `fg`: rename a project (writes state.json only when changed). */
export async function renameProject(ctx: ProjectContext, name: string): Promise<void> {
  if (name && name !== ctx.state.name) {
    ctx.state.name = name;
    await saveProjectState(ctx);
  }
}

/**
 * Legacy `Bh`: the first project (other than the active one) that has a
 * `user-media/` directory. `allowEmptyMedia=false` requires it to contain media.
 */
export async function findFallbackProject(
  allowEmptyMedia: boolean,
): Promise<ProjectContext | undefined> {
  const projects = await getProjectsRoot();
  const dir = await projects.findDirectory(async (candidate) => {
    if (currentProject && (await candidate.matches(currentProject.rootDirectory))) return false;
    try {
      return !!(await candidate.getDirectory("user-media", false, allowEmptyMedia));
    } catch {
      return false;
    }
  });
  return dir ? buildProjectContext(dir) : undefined;
}

/** Read `projects/active.txt` (empty string when absent). */
export async function readActiveProjectId(): Promise<string> {
  try {
    return (await (await getProjectsRoot()).getFileAsText("active.txt")).trim();
  } catch {
    return "";
  }
}

/**
 * Startup-only project load: read just one project's state.json and user-media
 * handle. Does not activate, scan fallback projects, or load any media.
 */
export async function loadProjectStateOnly(id: string): Promise<ProjectContext | undefined> {
  const dir = await getProjectDirectory(id, false);
  if (!dir) return undefined;
  const state = await dir.getFileAsParsedJSON<ProjectState>("state.json");
  const userMediaDirectory =
    (await dir.getDirectory("user-media", false).catch(() => undefined)) ??
    ((await dir.getDirectory("user-media", true)) as ProjectDirectory);
  return { rootDirectory: dir, userMediaDirectory, state };
}

/**
 * Startup-only active project. Reads active.txt and that project's state.json.
 * When absent/corrupt, creates an empty default project without scanning all
 * project directories.
 */
export async function bootProjectFromActivePointerOnly(): Promise<ProjectContext> {
  const id = await readActiveProjectId();
  if (id) {
    const active = await loadProjectStateOnly(id).catch(() => undefined);
    if (active) {
      currentProject = active;
      return active;
    }
  }
  return setActiveProject(await createProject("Default Project"));
}

/**
 * Legacy `a_` + `s_`: startup. Read `active.txt`; activate that project, or
 * create + activate a Default Project. Returns the active context. Does NOT load
 * media (that is Phase 3 via `resolveActiveMediaDirectory` + `lu`).
 */
export async function bootProject(): Promise<ProjectContext> {
  const id = await readActiveProjectId();
  if (id) {
    try {
      return await setActiveProject(await loadProjectContext(id));
    } catch {
      // active.txt points at a missing/corrupt project — fall through to default.
    }
  }
  const fallback = await findFallbackProject(true);
  return setActiveProject(fallback ?? (await createProject("Default Project")));
}

/**
 * Legacy `Wh` (minus `lu`): the media directory to load for a project — its
 * `activeUserMedia`, or the first media directory when that is missing/invalid
 * (req 8). Returns undefined when the project has no media.
 */
export async function resolveActiveMediaDirectory(
  ctx: ProjectContext,
): Promise<ProjectDirectory | undefined> {
  if (ctx.state.activeUserMedia) {
    const dir = await ctx.userMediaDirectory
      .getDirectory(ctx.state.activeUserMedia, false)
      .catch(() => undefined);
    if (dir) return dir;
  }
  return ctx.userMediaDirectory.getFirstDirectory(false);
}

/** Startup alias documenting that this resolves one media directory only. */
export function resolveStartupMediaDirectory(
  ctx: ProjectContext,
): Promise<ProjectDirectory | undefined> {
  return resolveActiveMediaDirectory(ctx);
}

/** Legacy `jh` (FS-side): set the active project's `activeUserMedia` + persist. */
export async function setActiveUserMedia(name: string): Promise<void> {
  if (!currentProject) return;
  if (currentProject.state.activeUserMedia !== name) {
    currentProject.state.activeUserMedia = name;
    await saveProjectState(currentProject);
  }
}

/** Legacy `jh` (FS-side, no media): clear `activeUserMedia` + persist. */
export async function clearActiveUserMedia(): Promise<void> {
  if (currentProject && currentProject.state.activeUserMedia) {
    currentProject.state.activeUserMedia = "";
    await saveProjectState(currentProject);
  }
}

export type DeleteProjectResult =
  | { kind: "deleted-other"; activeProject: ProjectContext | null }
  | { kind: "switched"; activeProject: ProjectContext; mediaDirectory: ProjectDirectory | null };

/**
 * Legacy `gg` (minus `lu`): delete a project. Deleting a non-active project
 * leaves the active one untouched. Deleting the active project switches to a
 * fallback (or a freshly created Default Project) and reports the media directory
 * the caller should load next (or null to clear).
 */
export async function deleteProject(ctx: ProjectContext): Promise<DeleteProjectResult> {
  const isCurrent =
    !!currentProject && currentProject.rootDirectory.path === ctx.rootDirectory.path;

  if (!isCurrent) {
    await ctx.rootDirectory.delete();
    return { kind: "deleted-other", activeProject: currentProject };
  }

  const fallback = await findFallbackProject(true);
  await ctx.rootDirectory.delete();

  if (fallback && !(await fallback.userMediaDirectory.isEmpty())) {
    await setActiveProject(fallback);
    return {
      kind: "switched",
      activeProject: fallback,
      mediaDirectory: (await resolveActiveMediaDirectory(fallback)) ?? null,
    };
  }

  const active = fallback ?? (await createProject("Default Project"));
  await setActiveProject(active);
  return { kind: "switched", activeProject: active, mediaDirectory: null };
}
