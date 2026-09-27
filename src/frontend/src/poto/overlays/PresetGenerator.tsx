import { createSignal, onCleanup, onMount, Show, untrack, For } from "solid-js";
import type { EditState } from "../../engine/state/EditState";
import {
  applyGenerator,
  cancelGenerator,
  cells,
  COLS,
  generatorAnchor,
  generatorOpen,
  regenerate,
  selectCell,
  selectedGeneratorLook,
  selectedIndex,
  selectedVariantPresetData,
  selectedVariantId,
} from "../spectraGenerator";
import { openPresetEditor, presetEditorRequest } from "../presetEditorStore";

/**
 * Spectra preset generator overlay — the legacy 7×9 remix control surface,
 * restyled to the flat / minimal dark-neutral project skin and shrunk into a
 * compact popover. Scrubbing the grid live-previews each variant on the image;
 * Apply commits, Cancel restores the look from when the popover opened.
 * Unlike the legacy modal, this dismisses (cancels) on outside click, matching
 * Escape — so it behaves like a popover.
 */
type PresetGeneratorProps = {
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  clearPreviewPatch?: (reason?: string) => void;
};

const D = {
  bg: "#1e1e1e",
  surface: "#222226",
  surface3: "#29292e",
  surface4: "#2f2f35",

  border: "#34343a",
  borderSoft: "#2e2e34",
  borderActive: "#6a2d16",

  text: "#d2d2d4",
  textSoft: "#a5a5aa",
  muted: "#6b6b72",
  subtle: "#4d4d54",

  accent: "#E1DCC9",
  accentSoft: "#2b211d",
  accentSoft2: "#33231d",

  focus: "#6a2d16",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
} as const;

const GEN_CSS = `
  .poto-spg-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    pointer-events: auto;
  }

  .poto-spg {
    position: fixed;
    width: min(280px, calc(100vw - 24px));
    max-height: min(78dvh, 520px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: ${D.surface};
    border: 1px solid ${D.border};
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
    color: ${D.text};
    font-family: ${D.font};
    outline: none;
  }

  .poto-spg *,
  .poto-spg *::before,
  .poto-spg *::after {
    box-sizing: border-box;
  }

  .poto-spg__header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 2px;
  }

  .poto-spg__title {
    display: flex;
    align-items: baseline;
    gap: 5px;
    color: ${D.text};
    font-size: 12px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: 0.02em;
  }

  .poto-spg__title sup {
    font-size: 7px;
    font-weight: 800;
    color: ${D.accent};
    letter-spacing: 0.08em;
  }

  .poto-spg__subtitle {
    color: ${D.muted};
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .poto-spg__main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 30px;
    gap: 8px;
    align-items: center;
  }

  .poto-spg__grid {
    display: grid;
    grid-template-columns: repeat(${COLS}, minmax(0, 1fr));
    gap: 4px;
    padding: 6px;
    border-radius: 9px;
    background: ${D.bg};
    border: 1px solid ${D.borderSoft};
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .poto-spg__grid.dragging,
  .poto-spg__grid.dragging .poto-spg__cell {
    cursor: grabbing;
  }

  .poto-spg__cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: 0;
    border-radius: 6px;
    border: 1px solid ${D.borderSoft};
    opacity: 0.42;
    cursor: pointer;
    transition:
      opacity 150ms ease,
      border-color 150ms ease,
      box-shadow 150ms ease;
  }

  .poto-spg__cell:hover {
    opacity: 0.72;
    border-color: ${D.border};
  }

  .poto-spg__cell.origin {
    opacity: 0.9;
    border-color: ${D.subtle};
  }

  .poto-spg__cell::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f4f1e8;
    border: 1px solid ${D.bg};
    transform: scale(0);
    transition: transform 180ms ease-out;
  }

  .poto-spg__cell.selected {
    opacity: 1;
    border-color: ${D.accent};
    box-shadow: 0 0 0 1px rgba(255, 90, 26, 0.5);
    cursor: grab;
  }

  .poto-spg__cell.selected::before {
    transform: scale(1);
  }

  .poto-spg__side {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .poto-spg__round {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 9px;
    border: 1px solid ${D.border};
    background: ${D.surface3};
    color: ${D.text};
    cursor: pointer;
    outline: none;
    transition:
      background 150ms ease,
      border-color 150ms ease;
  }

  .poto-spg__round:hover {
    background: ${D.surface4};
    border-color: ${D.borderActive};
  }

  .poto-spg__round:focus-visible {
    border-color: ${D.borderActive};
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-spg__round img {
    width: 13px;
    height: 13px;
    opacity: 0.7;
  }

  .poto-spg__round[data-action="generate"] img {
    width: 15px;
    height: 15px;
  }

  .poto-spg__round.loading {
    pointer-events: none;
  }

  .poto-spg__round.loading img {
    animation: poto-spg-spin 900ms linear infinite;
    opacity: 0.5;
  }

  .poto-spg__save {
    margin-top: auto;
  }

  .poto-spg__save.saved {
    border-color: ${D.borderActive};
    background: ${D.accentSoft};
  }

  .poto-spg__save.saved img {
    opacity: 0.95;
  }

  @keyframes poto-spg-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .poto-spg__footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 2px;
  }

  .poto-spg__variant {
    margin-right: auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: ${D.muted};
    font-size: 9px;
    font-weight: 600;
    line-height: 1.2;
  }

  .poto-spg__variant strong {
    color: ${D.muted};
    font-weight: 700;
  }

  .poto-spg__variant [data-id] {
    color: ${D.textSoft};
    font-family: ${D.mono};
    font-size: 9px;
  }

  .poto-spg__btn {
    min-height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid ${D.border};
    background: ${D.surface3};
    color: ${D.text};
    font-family: ${D.font};
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    outline: none;
    transition:
      background 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }

  .poto-spg__btn:hover {
    background: ${D.surface4};
  }

  .poto-spg__btn:focus-visible {
    border-color: ${D.borderActive};
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-spg__btn.tertiary {
    border-color: transparent;
    background: transparent;
    color: ${D.textSoft};
  }

  .poto-spg__btn.tertiary:hover {
    background: ${D.surface3};
    color: ${D.text};
  }

  .poto-spg__btn.primary {
    border-color: ${D.borderActive};
    background: ${D.accentSoft};
    color: ${D.accent};
  }

  .poto-spg__btn.primary:hover {
    background: ${D.accentSoft2};
  }

  @media (max-width: 720px) {
    .poto-spg {
      left: 12px !important;
      right: 12px !important;
      bottom: 12px !important;
      top: auto !important;
      width: auto;
      max-height: min(68dvh, 520px);
      transform-origin: center bottom !important;
    }

    .poto-spg__grid {
      max-height: min(34dvh, 280px);
    }
  }
`;

export function PresetGenerator(props: PresetGeneratorProps) {
  return (
    <Show when={generatorOpen()}>
      <GeneratorDialog {...props} />
    </Show>
  );
}

function GeneratorDialog(props: PresetGeneratorProps) {
  let backdrop!: HTMLElement;
  let dialog!: HTMLElement;
  let grid!: HTMLElement;
  let applyButton!: HTMLButtonElement;
  let cancelButton!: HTMLButtonElement;
  const [loading, setLoading] = createSignal<"all" | "extend" | null>(null);
  const [dialogStyle, setDialogStyle] = createSignal<Record<string, string>>({});
  const [positioned, setPositioned] = createSignal(false);
  let generationTimer: number | undefined;
  let dragging = false;

  function previewCell(index: number) {
    const look = selectCell(index);
    if (look) props.previewEditPatch?.(look, "preset-generator-cell-preview");
  }

  function previewSelectedVariant(reason: string): void {
    const look = selectedGeneratorLook();
    if (look) props.previewEditPatch?.(look, reason);
  }

  function selectAt(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const cell = el?.closest<HTMLElement>("generated-preset");
    if (cell && grid.contains(cell)) previewCell(Number(cell.dataset.cell));
  }

  const onDocumentMove = (event: PointerEvent) => {
    if (dragging) selectAt(event.clientX, event.clientY);
  };

  const endCellDrag = () => {
    if (!dragging) return;
    dragging = false;
    grid.classList.remove("dragging");
    document.removeEventListener("pointermove", onDocumentMove);
    document.removeEventListener("pointerup", endCellDrag);
    document.removeEventListener("pointercancel", endCellDrag);
  };

  function onCellPointerDown(e: PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    previewCell(index);
    if (dragging) return;
    dragging = true;
    grid.classList.add("dragging");
    document.addEventListener("pointermove", onDocumentMove);
    document.addEventListener("pointerup", endCellDrag);
    document.addEventListener("pointercancel", endCellDrag);
  }

  // Dismiss like a popover: a press on the backdrop (outside the dialog)
  // cancels and restores the look captured when the popover opened.
  function onBackdropPointerDown(event: PointerEvent) {
    if (event.target !== backdrop) return;
    props.clearPreviewPatch?.("preset-generator-dismiss");
    cancelGenerator();
  }

  // Legacy fakes an "AI" think time of 750–1500ms before regenerating.
  function runGenerate(mode: "all" | "extend") {
    if (loading()) return;
    setLoading(mode);
    window.clearTimeout(generationTimer);
    generationTimer = window.setTimeout(
      () => {
        untrack(() => {
          regenerate(mode);
          previewSelectedVariant("preset-generator-regenerate-preview");
        });
        setLoading(null);
      },
      750 + Math.random() * 750,
    );
  }

  function onSave() {
    const fallbackName = `Variation: ${selectedVariantId()}`;
    const data = selectedVariantPresetData();
    if (!data) return;
    const anchor = generatorAnchor();
    openPresetEditor(anchor?.x ?? null, anchor?.y ?? null, {
      preset: {
        name: fallbackName,
        data,
        meta: { generated: true, packName: "Custom" },
      },
      mode: "create",
      useActiveImageState: false,
    });
  }

  const onKey = (e: KeyboardEvent) => {
    if (presetEditorRequest()) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      applyButton.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelButton.click();
    }
  };

  function positionDialog() {
    const anchor = generatorAnchor();
    if (!anchor) {
      setDialogStyle({
        left: `${Math.max(12, window.innerWidth - dialog.offsetWidth - 12)}px`,
        top: "72px",
        "transform-origin": "top right",
      });
      setPositioned(true);
      return;
    }

    const rect = dialog.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 10;
    const anchorWidth = anchor.width ?? 0;
    const anchorHeight = anchor.height ?? 0;
    const preferredLeft = anchor.x + anchorWidth - rect.width;
    const left = Math.max(12, Math.min(preferredLeft, viewportWidth - rect.width - 12));
    const belowTop = anchor.y + anchorHeight + gap;
    const aboveTop = anchor.y - rect.height - gap;
    const opensBelow = belowTop + rect.height <= viewportHeight - 12 || aboveTop < 12;
    const top = opensBelow
      ? Math.max(12, Math.min(belowTop, viewportHeight - rect.height - 12))
      : Math.max(12, aboveTop);
    setDialogStyle({
      left: `${left}px`,
      top: `${top}px`,
      "transform-origin": `${preferredLeft <= left + 1 ? "left" : "right"} ${opensBelow ? "top" : "bottom"}`,
    });
    setPositioned(true);
  }

  onMount(() => {
    dialog.focus();
    requestAnimationFrame(() => {
      positionDialog();
      previewSelectedVariant("preset-generator-open-preview");
    });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", positionDialog);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", positionDialog);
    endCellDrag();
    props.clearPreviewPatch?.("preset-generator-close");
    window.clearTimeout(generationTimer);
  });

  return (
    <div
      class="poto-spg-backdrop"
      ref={(el) => (backdrop = el)}
      onPointerDown={onBackdropPointerDown}
    >
      <style>{GEN_CSS}</style>
      <preset-generator
        ref={(el) => (dialog = el)}
        class="poto-spg"
        role="dialog"
        aria-label="Spectra Preset Generator"
        tabIndex={-1}
        style={{ ...dialogStyle(), visibility: positioned() ? "visible" : "hidden" }}
      >
        <header class="poto-spg__header">
          <span class="poto-spg__subtitle">Preset Generator</span>
        </header>
        <div class="poto-spg__main">
          <preset-generator-grid class="poto-spg__grid" ref={(el) => (grid = el)}>
            <For each={cells()}>
              {(cell, i) => (
                <generated-preset
                  data-cell={i()}
                  class="poto-spg__cell"
                  classList={{ selected: selectedIndex() === i(), origin: cell.grey === null }}
                  style={{ background: cell.grey ?? "transparent" }}
                  onPointerDown={(event) => onCellPointerDown(event, i())}
                  onClick={() => previewCell(i())}
                />
              )}
            </For>
          </preset-generator-grid>
          <div class="poto-spg__side">
            <button
              type="button"
              class="poto-spg__round"
              classList={{ loading: loading() === "extend" }}
              data-action="extend"
              title="Generate More Like This"
              onClick={() => runGenerate("extend")}
            >
              <img src="/assets/icons/focus_icon.svg" alt="" />
            </button>
            <button
              type="button"
              class="poto-spg__round"
              classList={{ loading: loading() === "all" }}
              data-action="generate"
              title="Re-Generate All"
              onClick={() => runGenerate("all")}
            >
              <img src="/assets/icons/remix_icon.svg" alt="" />
            </button>
            <button
              type="button"
              class="poto-spg__round poto-spg__save"
              data-action="save"
              title="Save Variation as Preset"
              onClick={onSave}
            >
              <img src="/assets/icons/save_icon.svg" alt="" />
            </button>
          </div>
        </div>
        <div class="poto-spg__footer">
          <span class="poto-spg__variant">
            <strong>Variant ID: </strong>
            <span data-id>{selectedVariantId()}</span>
          </span>
          <button
            ref={(el) => (cancelButton = el)}
            type="button"
            class="poto-spg__btn tertiary"
            data-action="cancel"
            onClick={() => {
              props.clearPreviewPatch?.("preset-generator-cancel");
              cancelGenerator();
            }}
          >
            Cancel
          </button>
          <button
            ref={(el) => (applyButton = el)}
            type="button"
            class="poto-spg__btn primary"
            data-action="apply"
            onClick={() => {
              applyGenerator();
              props.clearPreviewPatch?.("preset-generator-apply");
            }}
          >
            Apply
          </button>
        </div>
      </preset-generator>
    </div>
  );
}

