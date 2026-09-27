/*
 * Session controller — shared reactive state for legacy-style auto-load/save.
 *
 * Holds the "what's open right now" signals (the active.txt + project
 * activeUserMedia mirror) so PotoApp and the media strip read one source of
 * truth. The boot/autosave/import orchestration lives in PotoApp (where the
 * editor store, engine viewer API, and edit state are wired); this module owns
 * only the cross-component state + the media-list refresh.
 */
import { createSignal } from "solid-js";
import type { MediaSummary } from "../project/ProjectTypes";
import * as mediaStore from "../project/mediaStore";

// True until the boot restore completes — gates autosave so restoring never
// rewrites the saved state (initial-load guard, Option B in the plan).
const [isBooting, setIsBooting] = createSignal(true);

const [activeProjectId, setActiveProjectId] = createSignal<string | null>(null);
const [activeProjectName, setActiveProjectName] = createSignal("Hytic");
const [activeAssetId, setActiveAssetId] = createSignal<string | null>(null);

// Thumbnails of the active project's assets (the media strip).
const [mediaList, setMediaList] = createSignal<MediaSummary[]>([]);
let mediaListProvider: (() => Promise<MediaSummary[]>) | null = null;

export {
  isBooting,
  setIsBooting,
  activeProjectId,
  setActiveProjectId,
  activeProjectName,
  setActiveProjectName,
  activeAssetId,
  setActiveAssetId,
  mediaList,
};

export function setMediaListProvider(provider: (() => Promise<MediaSummary[]>) | null): void {
  mediaListProvider = provider;
}

/** Re-reads the active project's media summaries (after import/switch/delete). */
export async function refreshMediaList(): Promise<void> {
  if (mediaListProvider) {
    setMediaList(await mediaListProvider());
    return;
  }
  const pid = activeProjectId();
  setMediaList(pid ? await mediaStore.listMedia(pid) : []);
}
