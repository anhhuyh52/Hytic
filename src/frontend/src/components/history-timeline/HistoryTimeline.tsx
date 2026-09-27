import { createMemo, createSignal, For } from "solid-js";
import type { JSX } from "solid-js";
import "./HistoryTimeline.css";

export type HistoryTimelineItem = {
  id: string;
  label?: string;
  timestamp?: string;
  disabled?: boolean;
};

export type HistoryTimelineProps = {
  items: HistoryTimelineItem[];
  selectedId?: string;
  onSelect?: (item: HistoryTimelineItem, index: number) => void;
  class?: string;
};

type TickTone = "active" | "near" | "default";

const DEFAULT_TICK_SCALE = 0.22;

export function HistoryTimeline(props: HistoryTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null);

  const selectedIndex = createMemo(() => {
    if (!props.selectedId) return -1;
    return props.items.findIndex((item) => item.id === props.selectedId);
  });

  const activeIndex = () => hoveredIndex() ?? selectedIndex();

  function tickScale(index: number): number {
    const hover = hoveredIndex();
    if (hover !== null) {
      const distance = Math.abs(index - hover);
      if (distance === 0) return 1;
      if (distance === 1) return 0.68;
      if (distance === 2) return 0.42;
      return DEFAULT_TICK_SCALE;
    }

    const selected = selectedIndex();
    if (selected >= 0) {
      const distance = Math.abs(index - selected);
      if (distance === 0) return 0.85;
      if (distance === 1) return 0.45;
    }

    return DEFAULT_TICK_SCALE;
  }

  function tickOpacity(index: number, item: HistoryTimelineItem): number {
    if (item.disabled) return 0.22;

    const active = activeIndex();
    if (active >= 0) {
      const distance = Math.abs(index - active);
      if (distance === 0) return 1;
      if (distance === 1) return 0.85;
      if (distance === 2) return 0.65;
    }

    return 0.45;
  }

  function tickTone(index: number): TickTone {
    const active = activeIndex();
    if (active < 0) return "default";

    const distance = Math.abs(index - active);
    if (distance === 0) return "active";
    if (distance <= 2) return "near";
    return "default";
  }

  function tickStyle(index: number, item: HistoryTimelineItem): JSX.CSSProperties {
    return {
      "--tick-scale": String(tickScale(index)),
      "--tick-opacity": String(tickOpacity(index, item)),
      "--tick-width": tickTone(index) === "active" ? "3px" : "2px",
    } as JSX.CSSProperties;
  }

  function itemLabel(item: HistoryTimelineItem, index: number): string {
    return item.label || `History item ${index + 1}`;
  }

  function selectItem(item: HistoryTimelineItem, index: number) {
    if (item.disabled) return;
    props.onSelect?.(item, index);
  }

  function handleKeyDown(event: KeyboardEvent, item: HistoryTimelineItem, index: number) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    selectItem(item, index);
  }

  function clearHover(index: number) {
    setHoveredIndex((current) => (current === index ? null : current));
  }

  return (
    <div
      class={["historyTimeline", props.class].filter(Boolean).join(" ")}
      aria-label="History timeline"
    >
      <div class="historyTimeline__scroll" onPointerLeave={() => setHoveredIndex(null)}>
        <For each={props.items}>
          {(item, index) => {
            const currentIndex = () => index();
            const label = () => itemLabel(item, currentIndex());
            const selected = () => item.id === props.selectedId;
            const tone = () => tickTone(currentIndex());

            return (
              <button
                type="button"
                class="timelineTick"
                classList={{
                  "timelineTick--selected": selected(),
                  "timelineTick--hovered": hoveredIndex() === currentIndex(),
                  "timelineTick--near": tone() === "near",
                  "timelineTick--disabled": !!item.disabled,
                }}
                style={tickStyle(currentIndex(), item)}
                disabled={item.disabled}
                aria-label={label()}
                aria-current={selected() ? "step" : undefined}
                title={item.timestamp ? `${label()} - ${item.timestamp}` : label()}
                onPointerEnter={() => {
                  if (!item.disabled) setHoveredIndex(currentIndex());
                }}
                onFocus={() => {
                  if (!item.disabled) setHoveredIndex(currentIndex());
                }}
                onBlur={() => clearHover(currentIndex())}
                onClick={() => selectItem(item, currentIndex())}
                onKeyDown={(event) => handleKeyDown(event, item, currentIndex())}
              >
                <span class="timelineTickLine" aria-hidden="true" />
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default HistoryTimeline;

/**
 * Example usage:
 *
 * const items = Array.from({ length: 60 }, (_, index) => ({
 *   id: String(index),
 *   label: `History ${index + 1}`,
 * }));
 *
 * <HistoryTimeline
 *   items={items}
 *   selectedId={selectedId()}
 *   onSelect={(item) => setSelectedId(item.id)}
 * />
 */
