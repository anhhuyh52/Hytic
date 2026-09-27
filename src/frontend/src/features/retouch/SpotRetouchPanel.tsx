import { createEffect, For, Show } from "solid-js";
import { useEditState } from "../../poto/panels/EditStateContext";
import {
  canAddRetouchSpot,
  createRetouchSpot,
  hoveredSpot,
  selectedSpot,
  setHoveredSpot,
  setSelectedSpot,
} from "./retouchStore";
import { cloneRetouchSpot, type RetouchSpot, type SpotRemovalMode } from "./retouchTypes";

export function SpotRetouchPanel(props: { onHistory?: (historyKey: string) => void }) {
  const { state, setState } = useEditState();
  const spots = () => state.retouch.spots;
  const selected = () => {
    const index = selectedSpot();
    return index == null ? null : (spots()[index] ?? null);
  };

  createEffect(() => {
    const count = spots().length;
    const index = selectedSpot();
    if (count === 0 && index !== null) setSelectedSpot(null);
    else if (index !== null && index >= count) setSelectedSpot(count - 1);
  });

  function commitSpots(next: RetouchSpot[], historyKey?: string) {
    setState("retouch", {
      ...state.retouch,
      enabled: true,
      bypass: false,
      spots: next.map(cloneRetouchSpot),
    });
    if (historyKey) props.onHistory?.(historyKey);
  }

  function addSpot() {
    if (!canAddRetouchSpot(spots().length)) return;
    const next = [...spots().map(cloneRetouchSpot), createRetouchSpot()];
    commitSpots(next, "add_spot_removal");
    setSelectedSpot(next.length - 1);
  }

  function updateSelected(patch: Partial<RetouchSpot>, historyKey?: string) {
    const index = selectedSpot();
    if (index == null || !spots()[index]) return;
    const next = spots().map(cloneRetouchSpot);
    next[index] = { ...next[index], ...patch } as RetouchSpot;
    commitSpots(next, historyKey);
  }

  function removeSelected() {
    const index = selectedSpot();
    if (index == null) return;
    const next = spots()
      .filter((_, spotIndex) => spotIndex !== index)
      .map(cloneRetouchSpot);
    commitSpots(next, "remove_spot_removal");
    setSelectedSpot(next.length ? Math.min(index, next.length - 1) : null);
  }

  function setMode(mode: SpotRemovalMode) {
    if (selected()?.mode === mode) return;
    updateSelected({ mode }, "spot_removal_mode");
  }

  return (
    <div class="retouch-panel">
      <div class="retouch-panel__list" aria-label="Spot removals">
        <For
          each={spots()}
          fallback={
            <button class="retouch-panel__empty" type="button" onClick={addSpot}>
              Add your first spot removal
            </button>
          }
        >
          {(spot, index) => (
            <button
              type="button"
              class="retouch-panel__spot"
              classList={{
                "is-selected": selectedSpot() === index(),
                "is-hovered": hoveredSpot() === index(),
              }}
              onClick={() => setSelectedSpot(index())}
              onPointerEnter={() => setHoveredSpot(index())}
              onPointerLeave={() => setHoveredSpot(null)}
              title={`Select spot removal ${index() + 1}`}
            >
              <span class="retouch-panel__index">{index() + 1}</span>
              <span>{spot.mode === 1 ? "Heal" : "Clone"}</span>
            </button>
          )}
        </For>
      </div>

      <Show when={selected()}>
        {(spot) => (
          <div class="retouch-panel__options">
            <div class="retouch-panel__mode" role="group" aria-label="Spot removal mode">
              <button
                type="button"
                classList={{ active: spot().mode === 1 }}
                onClick={() => setMode(1)}
              >
                Heal
              </button>
              <button
                type="button"
                classList={{ active: spot().mode === 0 }}
                onClick={() => setMode(0)}
              >
                Clone
              </button>
            </div>

            <label class="poto-control">
              <span class="poto-control__head">
                <span class="poto-control__label">Feather</span>
                <span class="poto-control__value">{Math.round(spot().feather * 100)}%</span>
              </span>
              <input
                class="poto-range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={spot().feather}
                onInput={(event) => updateSelected({ feather: event.currentTarget.valueAsNumber })}
                onChange={() => props.onHistory?.("spot_removal_feather")}
              />
            </label>

            <label class="poto-control">
              <span class="poto-control__head">
                <span class="poto-control__label">Opacity</span>
                <span class="poto-control__value">{Math.round(spot().opacity * 100)}%</span>
              </span>
              <input
                class="poto-range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={spot().opacity}
                onInput={(event) => updateSelected({ opacity: event.currentTarget.valueAsNumber })}
                onChange={() => props.onHistory?.("spot_removal_opacity")}
              />
            </label>
          </div>
        )}
      </Show>

      <div class="retouch-panel__actions">
        <button type="button" onClick={addSpot} disabled={!canAddRetouchSpot(spots().length)}>
          Add Spot
        </button>
        <button type="button" onClick={removeSelected} disabled={selectedSpot() === null}>
          Delete Spot
        </button>
      </div>
    </div>
  );
}
