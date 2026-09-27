import { createMemo, createSignal, For, Show } from "solid-js";
import type { MediaVersionSnapshot } from "../project/ProjectTypes";
import {
  HistoryTimeline as TickHistoryTimeline,
  type HistoryTimelineItem,
} from "../components/history-timeline";
import { ContextMenu, openContextMenu, type ContextMenuState } from "./controls/ContextMenu";

export type HistoryTimelineEntry = {
  id: string;
  createdAt: number;
  label?: string;
};

export type HistoryTimelineProps = {
  hasImage: boolean;
  entries: HistoryTimelineEntry[];
  index: number;
  snapshots: MediaVersionSnapshot[];
  onGoTo(index: number): void;
  onUndo(): void;
  onRedo(): void;
  onSaveSnapshot(): void;
  onApplySnapshot(id: string): void;
  onDeleteSnapshot(id: string): void;
  onRenameSnapshot(id: string, name: string): void;
  onUpdateSnapshot(id: string): void;
  onDeleteAllSnapshots(): void;
};

const MAX_VISIBLE_HISTORY_POINTS = 17;

export function HistoryTimeline(props: HistoryTimelineProps) {
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null);
  const total = () => props.entries.length;
  const canUndo = () => props.hasImage && props.index > 0;
  const canRedo = () => props.hasImage && props.index < total() - 1;
  const current = () => Math.min(total(), props.index + 1);
  const selectedId = () => props.entries[props.index]?.id;
  const visibleTimeline = createMemo(() => {
    const visibleCount = Math.min(MAX_VISIBLE_HISTORY_POINTS, props.entries.length);
    const maxStart = Math.max(0, props.entries.length - visibleCount);
    const centeredStart = props.index - Math.floor(visibleCount / 2);
    const startIndex = Math.max(0, Math.min(maxStart, centeredStart));
    const items: HistoryTimelineItem[] = props.entries
      .slice(startIndex, startIndex + visibleCount)
      .map((entry, localIndex) => {
        const historyIndex = startIndex + localIndex;
        return {
          id: entry.id,
          label: entry.label ?? `History ${historyIndex + 1}`,
          timestamp: new Date(entry.createdAt).toLocaleString(),
          disabled: !props.hasImage,
        };
      });

    return { items, startIndex };
  });

  function openSnapshotMenu(snapshot: MediaVersionSnapshot, event: MouseEvent) {
    setMenu(
      openContextMenu(
        event,
        [
          `<context-title>${escapeHtml(snapshot.name)}</context-title>`,
          `<context-item data-action="rename">Rename</context-item>`,
          `<context-item data-action="update">Update</context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="remove">Remove</context-item>`,
          `<context-item data-action="removeAll">Remove All</context-item>`,
        ].join(""),
        {
          rename: {
            action: () => {
              const name = window.prompt("Snapshot name", snapshot.name)?.trim();
              if (name) props.onRenameSnapshot(snapshot.id, name);
            },
          },
          update: {
            action: () => props.onUpdateSnapshot(snapshot.id),
          },
          remove: {
            action: () => props.onDeleteSnapshot(snapshot.id),
          },
          removeAll: {
            action: () => props.onDeleteAllSnapshots(),
          },
        },
      ),
    );
  }

  return (
    <section class="history-timeline" aria-label="History">
      <div class="history-timeline__head">
        <span class="history-timeline__label">History</span>
        <span class="history-timeline__count">
          <strong>{current()}</strong> / {Math.max(1, total())}
        </span>
      </div>

      <div class="history-timeline__transport">
        <button
          class="history-timeline__nav"
          type="button"
          disabled={!canUndo()}
          onClick={props.onUndo}
          title="Undo"
        >
          Undo
        </button>

        <Show when={total() > 0} fallback={<span class="history-timeline__track-empty" />}>
          <TickHistoryTimeline
            class="history-timeline__ruler"
            items={visibleTimeline().items}
            selectedId={selectedId()}
            onSelect={(_, index) => {
              const historyIndex = visibleTimeline().startIndex + index;
              if (historyIndex !== props.index) props.onGoTo(historyIndex);
            }}
          />
        </Show>

        <button
          class="history-timeline__nav"
          type="button"
          disabled={!canRedo()}
          onClick={props.onRedo}
          title="Redo"
        >
          Redo
        </button>
      </div>

      <div class="history-timeline__divider" aria-hidden="true" />

      <div class="history-timeline__snap-head">
        <span class="history-timeline__label">Snapshots</span>
        <button
          class="history-timeline__add"
          type="button"
          disabled={!props.hasImage}
          onClick={props.onSaveSnapshot}
          title="Save snapshot"
          aria-label="Save snapshot"
        >
          +
        </button>
      </div>

      <div class="history-timeline__snapshots">
        <Show
          when={props.snapshots.length > 0}
          fallback={<span class="history-timeline__empty">No snapshots</span>}
        >
          <For each={props.snapshots}>
            {(snapshot) => (
              <version-snapshot
                class="history-timeline__snapshot"
                version-id={snapshot.id}
                onContextMenu={(event) => openSnapshotMenu(snapshot, event)}
              >
                <button
                  type="button"
                  class="history-timeline__snapshot-main"
                  title={new Date(snapshot.createdAt).toLocaleString()}
                  onClick={() => props.onApplySnapshot(snapshot.id)}
                >
                  <span class="history-timeline__snapshot-name">{snapshot.name}</span>
                  <small>{formatSnapshotAge(snapshot.createdAt)}</small>
                </button>
                <button
                  type="button"
                  class="history-timeline__snapshot-delete"
                  title="Delete snapshot"
                  aria-label={`Delete ${snapshot.name}`}
                  onClick={() => props.onDeleteSnapshot(snapshot.id)}
                >
                  ×
                </button>
              </version-snapshot>
            )}
          </For>
        </Show>
      </div>

      <Show when={menu()}>
        {(state) => <ContextMenu state={state()} onClose={() => setMenu(null)} />}
      </Show>
    </section>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSnapshotAge(createdAt: number): string {
  const elapsed = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
