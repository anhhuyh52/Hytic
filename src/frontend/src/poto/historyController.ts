import { createSignal, type Accessor } from "solid-js";
import type { SerializedEditState } from "../project/ProjectTypes";
import type { HistoryTimelineEntry } from "./HistoryTimeline";
import { cloneSerializedState } from "./jsonState";
import { recordHistoryPush } from "../app/performanceCounters";

export type HistoryEntry = HistoryTimelineEntry & {
  state: SerializedEditState;
};

type HistorySession = {
  entries: HistoryEntry[];
  index: number;
};

type HistoryControllerOptions = {
  getProjectId(): string | null;
  getActiveAssetId(): string | null;
  applyState(state: SerializedEditState): void;
  createId(): string;
  now?: () => number;
  maxEntries?: number;
};

export type HistoryController = {
  entries: Accessor<HistoryEntry[]>;
  index: Accessor<number>;
  isApplying(): boolean;
  reset(assetId: string | null, state: SerializedEditState | null): void;
  push(assetId: string, state: SerializedEditState, label?: string): void;
  recordInactive(assetId: string, previous: SerializedEditState, next: SerializedEditState): void;
  apply(state: SerializedEditState): void;
  goTo(index: number): void;
  undo(): void;
  redo(): void;
  schedulePush(assetId: string, state: SerializedEditState, delay?: number): void;
  cancelPending(): void;
  dispose(): void;
};

function statesMatch(left: SerializedEditState, right: SerializedEditState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createHistoryController(options: HistoryControllerOptions): HistoryController {
  const [entries, setEntries] = createSignal<HistoryEntry[]>([]);
  const [index, setIndex] = createSignal(0);
  const sessions = new Map<string, HistorySession>();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 100;
  let assetId: string | null = null;
  let projectId: string | null = null;
  let recordTimer: ReturnType<typeof setTimeout> | undefined;
  let applying = false;

  const cloneEntry = (entry: HistoryEntry): HistoryEntry => ({
    ...entry,
    state: cloneSerializedState(entry.state),
  });
  const createEntry = (state: SerializedEditState, label?: string): HistoryEntry => ({
    id: options.createId(),
    createdAt: now(),
    ...(label ? { label } : {}),
    state: cloneSerializedState(state),
  });
  const sessionKey = (sessionProjectId: string, sessionAssetId: string) =>
    `${sessionProjectId}\u0000${sessionAssetId}`;

  function cancelPending() {
    if (recordTimer) clearTimeout(recordTimer);
    recordTimer = undefined;
  }

  function reset(nextAssetId: string | null, state: SerializedEditState | null) {
    cancelPending();
    if (projectId && assetId && entries().length > 0) {
      sessions.set(sessionKey(projectId, assetId), {
        entries: entries().map(cloneEntry),
        index: index(),
      });
    }

    assetId = nextAssetId;
    projectId = nextAssetId ? options.getProjectId() : null;
    if (!nextAssetId || !state) {
      setEntries([]);
      setIndex(0);
      return;
    }

    const cached = projectId ? sessions.get(sessionKey(projectId, nextAssetId)) : undefined;
    if (cached?.entries.length) {
      setEntries(cached.entries.map(cloneEntry));
      setIndex(Math.max(0, Math.min(cached.index, cached.entries.length - 1)));
      return;
    }

    setEntries([createEntry(state)]);
    setIndex(0);
  }

  function push(nextAssetId: string, state: SerializedEditState, label?: string) {
    if (assetId !== nextAssetId) {
      reset(nextAssetId, state);
      return;
    }
    const currentEntries = entries();
    const currentIndex = index();
    if (currentEntries[currentIndex] && statesMatch(currentEntries[currentIndex].state, state))
      return;
    recordHistoryPush();
    const next = [...currentEntries.slice(0, currentIndex + 1), createEntry(state, label)].slice(
      -maxEntries,
    );
    setEntries(next);
    setIndex(next.length - 1);
  }

  function recordInactive(
    inactiveAssetId: string,
    previous: SerializedEditState,
    nextState: SerializedEditState,
  ) {
    if (inactiveAssetId === options.getActiveAssetId()) return;
    const currentProjectId = options.getProjectId();
    if (!currentProjectId) return;
    const key = sessionKey(currentProjectId, inactiveAssetId);
    const cached = sessions.get(key);
    const nextEntries = cached?.entries.length
      ? cached.entries.map(cloneEntry)
      : [createEntry(previous)];
    if (
      nextEntries.length > 0 &&
      statesMatch(nextEntries[nextEntries.length - 1].state, nextState)
    ) {
      return;
    }
    nextEntries.push(createEntry(nextState));
    const trimmed = nextEntries.slice(-maxEntries);
    sessions.set(key, { entries: trimmed, index: trimmed.length - 1 });
  }

  function apply(state: SerializedEditState) {
    applying = true;
    options.applyState(state);
    setTimeout(() => {
      applying = false;
    }, 0);
  }

  function goTo(requestedIndex: number) {
    const currentEntries = entries();
    if (!currentEntries.length) return;
    const nextIndex = Math.max(0, Math.min(currentEntries.length - 1, Math.round(requestedIndex)));
    const entry = currentEntries[nextIndex];
    if (!entry) return;
    setIndex(nextIndex);
    apply(entry.state);
  }

  function schedulePush(nextAssetId: string, state: SerializedEditState, delay = 300) {
    cancelPending();
    const snapshot = cloneSerializedState(state);
    recordTimer = setTimeout(() => {
      recordTimer = undefined;
      push(nextAssetId, snapshot);
    }, delay);
  }

  return {
    entries,
    index,
    isApplying: () => applying,
    reset,
    push,
    recordInactive,
    apply,
    goTo,
    undo: () => goTo(index() - 1),
    redo: () => goTo(index() + 1),
    schedulePush,
    cancelPending,
    dispose: cancelPending,
  };
}
