import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  installedPresets,
  importPresetFile,
  selectedPresetId,
  previewPreset,
  endPreview,
  commitPreset,
  transmitPresetLook,
  disposePresetLookPreview,
  presetEdited,
  packFilterOptions,
  visiblePresetCount,
  exportPreset,
  deletePreset,
  exportPack,
  renamePack,
  deletePack,
  updatePreset,
  isDefaultPack,
  isDefaultPreset,
  type FlatPreset,
} from "../presetPacksStore";
import { defaultPresetData, openGenerator, lookToPresetData } from "../spectraGenerator";
import { presetExpectedLook, setLook, snapshotLook, type LookState } from "../applyPreset";
import { openPresetEditor } from "../presetEditorStore";
import { ContextMenu, openContextMenu, type ContextMenuState } from "../controls/ContextMenu";
import { createRafInput } from "../controls/rafInput";
import { OFFICIAL_PACKS, packThumbnail } from "../../engine/presets/officialPacks";

// Map a preset to a representative graded photo of its pack's look, used as the
// cinematic card background. Falls back to the base pack for derived presets.
const PACK_IMAGE = new Map(OFFICIAL_PACKS.map((pack) => [pack.name, packThumbnail(pack)]));

function presetImage(preset: FlatPreset): string | null {
  return (
    PACK_IMAGE.get(preset.packSlug) ??
    (preset.meta.basePackName ? (PACK_IMAGE.get(preset.meta.basePackName) ?? null) : null)
  );
}

/**
 * PresetPanel.tsx — Dark, neutral, flat/minimal preset panel.
 *
 * Design:
 * - fully neutral greyscale palette (no warm tints)
 * - neutral off-white accent instead of cream
 * - flat surfaces: no glow, no gradients beyond a single scrim, no hover zoom
 * - desaturated preset thumbnails so colour comes only from the actual look
 * - keeps logic/state unchanged
 */

const D = {
  // Flat dark-neutral glassmorphism: translucent frosted surfaces stacked on a
  // dark shell, hairline light borders, backdrop blur, no warm tints/glows.
  bg: "rgba(16, 16, 18, 0.55)",

  // Frosted glass fills (white-on-dark translucency, brightening on interaction).
  glass: "rgba(255, 255, 255, 0.045)",
  glassHover: "rgba(255, 255, 255, 0.08)",
  glassActive: "rgba(255, 255, 255, 0.11)",
  glassPanel: "rgba(22, 22, 26, 0.62)",

  // Hairline borders — light strokes that catch the frosted edge.
  border: "rgba(255, 255, 255, 0.09)",
  borderSoft: "rgba(255, 255, 255, 0.06)",
  borderActive: "rgba(255, 255, 255, 0.24)",

  text: "#e7e7ea",
  textSoft: "#aeaeb6",
  muted: "#74747e",
  subtle: "#54545c",

  accent: "#f3f3f6",
  accentSoft: "rgba(255, 255, 255, 0.12)",

  danger: "#d2796d",

  focus: "rgba(255, 255, 255, 0.45)",

  // Frosted-glass blur (with a touch of saturation for depth).
  blur: "blur(18px) saturate(1.25)",
  blurSoft: "blur(10px) saturate(1.2)",

  // Inset top highlight that sells the glass edge.
  inset: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
} as const;

const PRESET_PANEL_CSS = `
  .poto-presets {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    color: ${D.text};
    font-family: ${D.font};
  }

  .poto-presets *,
  .poto-presets *::before,
  .poto-presets *::after {
    box-sizing: border-box;
  }

  .poto-presets__bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .poto-presets__search {
    height: 34px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: 11px;
    background: ${D.glass};
    border: 1px solid ${D.border};
    backdrop-filter: ${D.blur};
    -webkit-backdrop-filter: ${D.blur};
    box-shadow: ${D.inset};
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .poto-presets__search:focus-within {
    border-color: ${D.borderActive};
    background: ${D.glassHover};
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-presets__search img {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.5;
  }

  .poto-presets__search input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: ${D.text};
    font-family: ${D.font};
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.01em;
  }

  .poto-presets__search input::placeholder {
    color: ${D.muted};
    font-weight: 500;
  }

  .poto-presets__iconbtn {
    width: 34px;
    height: 34px;
    border-radius: 11px;
    border: 1px solid ${D.border};
    background: ${D.glass};
    backdrop-filter: ${D.blur};
    -webkit-backdrop-filter: ${D.blur};
    box-shadow: ${D.inset};
    color: ${D.text};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    cursor: pointer;
    outline: none;
    appearance: none;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      opacity 0.15s ease;
  }

  .poto-presets__iconbtn:hover {
    background: ${D.glassHover};
    border-color: ${D.borderActive};
  }

  .poto-presets__iconbtn:focus-visible {
    border-color: ${D.borderActive};
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-presets__iconbtn img,
  .poto-presets__iconbtn svg {
    width: 16px;
    height: 16px;
    opacity: 0.62;
  }

  .poto-presets__iconbtn.loading {
    opacity: 0.55;
    pointer-events: none;
  }

  .poto-presets__pack-filter {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 12px;
    background: ${D.bg};
    border: 1px solid ${D.borderSoft};
    backdrop-filter: ${D.blur};
    -webkit-backdrop-filter: ${D.blur};
    box-shadow: ${D.inset};
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .poto-presets__pack-filter::-webkit-scrollbar {
    display: none;
  }

  .poto-presets__pack-filter.is-dragging {
    cursor: grabbing;
    user-select: none;
  }

  .poto-presets__pack-filter.is-dragging .poto-presets__pack-chip {
    pointer-events: none;
  }

  /* Relative shell so the edge arrows can overlay the scroller's ends. */
  .poto-presets__pack-row {
    position: relative;
    width: 100%;
    min-width: 0;
  }

  .poto-presets__pack-arrow {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 2;
    width: 40px;
    display: inline-flex;
    align-items: center;
    padding: 0 4px;
    margin: 0;
    border: 0;
    cursor: pointer;
    outline: none;
    appearance: none;
    color: ${D.text};
  }

  /* Fade the chips out under each arrow so they read as scrolling beneath it. */
  .poto-presets__pack-arrow--left {
    left: 0;
    justify-content: flex-start;
    border-radius: 12px 0 0 12px;
    background: linear-gradient(90deg, rgba(16, 16, 18, 0.92) 38%, rgba(16, 16, 18, 0));
  }

  .poto-presets__pack-arrow--right {
    right: 0;
    justify-content: flex-end;
    border-radius: 0 12px 12px 0;
    background: linear-gradient(270deg, rgba(16, 16, 18, 0.92) 38%, rgba(16, 16, 18, 0));
  }

  .poto-presets__pack-arrow-disc {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1px solid ${D.border};
    background: ${D.glassActive};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
    box-shadow: ${D.inset};
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .poto-presets__pack-arrow:hover .poto-presets__pack-arrow-disc {
    background: ${D.glassHover};
    border-color: ${D.borderActive};
  }

  .poto-presets__pack-arrow:focus-visible .poto-presets__pack-arrow-disc {
    border-color: ${D.borderActive};
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-presets__pack-arrow img {
    width: 12px;
    height: 12px;
    opacity: 0.82;
  }

  .poto-presets__pack-arrow--right img {
    transform: scaleX(-1);
  }

  .poto-presets__pack-label {
    flex: 0 0 auto;
    margin-right: 2px;
    color: ${D.muted};
    font-family: ${D.font};
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .poto-presets__pack-chip {
    flex: 0 0 auto;
    min-height: 28px;
    max-width: 210px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    border-radius: 999px;
    border: 1px solid ${D.border};
    background: ${D.glass};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
    color: ${D.textSoft};
    font-family: ${D.font};
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    outline: 0;
    appearance: none;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease,
      opacity 0.15s ease;
  }

  .poto-presets__pack-chip:hover {
    background: ${D.glassHover};
    border-color: ${D.borderActive};
    color: ${D.text};
  }

  .poto-presets__pack-chip:focus-visible {
    border-color: ${D.borderActive};
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-presets__pack-chip.is-active {
    border-color: ${D.borderActive};
    background: ${D.glassActive};
    color: ${D.accent};
  }

  .poto-presets__pack-chip-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .poto-presets__pack-chip-pro {
    flex: 0 0 auto;
    margin-left: 6px;
    padding: 2px 4px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    color: #aebcff;
    font-family: ${D.font};
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
  }

  .poto-presets__pack-chip.is-active .poto-presets__pack-chip-pro {
    border-color: rgba(255, 255, 255, 0.2);
    color: #c4ceff;
  }

  .poto-presets__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    min-width: 0;
    max-height: 320px;
    overflow: auto;
    padding: 1px 1px 2px;
  }

  .poto-preset-row {
    position: relative;
    isolation: isolate;
    min-height: 58px;
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: flex-end;
    padding: 9px 12px;
    border-radius: 12px;
    overflow: hidden;
    background: ${D.glass};
    border: 1px solid ${D.border};
    box-shadow: ${D.inset};
    cursor: pointer;
    user-select: none;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  /* Graded photo of the preset's look, desaturated and dimmed behind the label. */
  .poto-preset-row__bg {
    position: absolute;
    inset: 0;
    z-index: -2;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.4;
    filter: saturate(0.68) brightness(0.82);
    transition: opacity 0.15s ease;
  }

  /* Frosted scrim — flat translucent fill plus a blur that frosts the photo. */
  .poto-preset-row__scrim {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: 12px;
    background: ${D.bg};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
  }

  .poto-preset-row:hover {
    border-color: ${D.borderActive};
    background: ${D.glassHover};
  }

  .poto-preset-row:hover .poto-preset-row__bg {
    opacity: 0.52;
  }

  .poto-preset-row.active {
    border-color: ${D.borderActive};
    background: ${D.glassActive};
  }

  .poto-preset-row.active .poto-preset-row__bg {
    opacity: 0.6;
  }

  /* Accent edge marking the active preset. */
  .poto-preset-row.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1;
    width: 3px;
    background: ${D.accent};
  }

  .poto-preset-row__main {
    position: relative;
    z-index: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .poto-preset-row__name {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #f4f4f5;
    font-family: ${D.font};
    font-size: 12.5px;
    font-weight: 750;
    line-height: 1.25;
    letter-spacing: 0.005em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .poto-preset-row__pack {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    color: rgba(228, 228, 232, 0.78);
    font-family: ${D.font};
    font-size: 10px;
    font-weight: 650;
    line-height: 1.2;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  }

  .poto-preset-row__edited {
    display: inline-flex;
    align-items: center;
    height: 15px;
    padding: 0 6px;
    border-radius: 999px;
    color: ${D.text};
    background: ${D.glassActive};
    border: 1px solid ${D.border};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
    font-family: ${D.font};
    font-size: 8px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .poto-presets__empty {
    min-height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px 14px;
    border-radius: 14px;
    background: ${D.glass};
    border: 1px solid ${D.border};
    backdrop-filter: ${D.blur};
    -webkit-backdrop-filter: ${D.blur};
    box-shadow: ${D.inset};
    text-align: center;
  }

  .poto-presets__empty img {
    width: min(160px, 72%);
    height: auto;
    border-radius: 12px;
    opacity: 0.86;
  }

  .poto-presets__empty p {
    max-width: 260px;
    margin: 0;
    color: ${D.textSoft};
    font-family: ${D.font};
    font-size: 12px;
    font-weight: 600;
    line-height: 1.55;
    letter-spacing: 0.01em;
  }

  .poto-presets__explore {
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid ${D.borderActive};
    background: ${D.accentSoft};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
    color: ${D.accent};
    font-family: ${D.font};
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    outline: none;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .poto-presets__explore:hover {
    background: ${D.glassActive};
    border-color: ${D.borderActive};
  }

  .poto-presets__explore:focus-visible {
    outline: 1px solid ${D.focus};
    outline-offset: 2px;
  }

  .poto-presets__explore img {
    width: 14px;
    height: 14px;
    opacity: 0.75;
  }

  .poto-presets__no-results {
    padding: 14px 12px;
    border-radius: 11px;
    background: ${D.glass};
    border: 1px solid ${D.border};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
    color: ${D.muted};
    font-family: ${D.font};
    font-size: 12px;
    font-weight: 650;
    line-height: 1.4;
    text-align: center;
  }

  .poto-preset-mixer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .poto-preset-mixer {
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: 14px;
    border: 1px solid ${D.border};
    background: ${D.glassPanel};
    backdrop-filter: ${D.blur};
    -webkit-backdrop-filter: ${D.blur};
    box-shadow:
      ${D.inset},
      0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .poto-preset-mixer__title {
    color: ${D.text};
    font-size: 14px;
    font-weight: 700;
  }

  .poto-preset-mixer__desc,
  .poto-preset-mixer__tip {
    color: ${D.textSoft};
    font-size: 12px;
    line-height: 1.45;
  }

  .poto-preset-mixer__controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
    gap: 10px;
    align-items: center;
    padding: 10px;
    border-radius: 10px;
    background: ${D.glass};
    border: 1px solid ${D.borderSoft};
    box-shadow: ${D.inset};
  }

  .poto-preset-mixer__range {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) 44px;
    align-items: center;
    gap: 8px;
    color: ${D.text};
    font-size: 12px;
    font-weight: 650;
  }

  .poto-preset-mixer__range input {
    width: 100%;
    accent-color: ${D.accent};
  }

  .poto-preset-mixer select {
    min-height: 34px;
    max-width: 180px;
    border-radius: 9px;
    border: 1px solid ${D.border};
    background: ${D.glassHover};
    color: ${D.text};
    padding: 0 8px;
  }

  .poto-preset-mixer__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .poto-preset-mixer__button {
    min-height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid ${D.border};
    background: ${D.glassHover};
    backdrop-filter: ${D.blurSoft};
    -webkit-backdrop-filter: ${D.blurSoft};
    color: ${D.text};
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .poto-preset-mixer__button:hover {
    background: ${D.glassActive};
    border-color: ${D.borderActive};
  }

  .poto-preset-mixer__button--primary {
    border-color: ${D.borderActive};
    background: ${D.accentSoft};
    color: ${D.accent};
  }

  .poto-preset-mixer__button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const NO_PRESET_MIX_TARGET = "__no-preset__";

type PresetMixerState = {
  preset: FlatPreset;
  baseLook: LookState;
  targetId: string;
  mix: number;
};

export function PresetPanel() {
  const [query, setQuery] = createSignal("");
  const [packFilter, setPackFilter] = createSignal("all");
  const [importMessage, setImportMessage] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null);
  let importInput: HTMLInputElement | undefined;
  const [mixer, setMixer] = createSignal<PresetMixerState | null>(null);

  function requireCustomPresetAccess(): boolean {
    return true;
  }

  const all = createMemo(() => installedPresets());
  const packs = createMemo(() => packFilterOptions());

  // ── Horizontal pack-chip scroller: edge arrows + drag-to-scroll ──────────
  let packScroller: HTMLElement | undefined;
  const [canScrollLeft, setCanScrollLeft] = createSignal(false);
  const [canScrollRight, setCanScrollRight] = createSignal(false);

  function updatePackScroll(): void {
    const el = packScroller;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < max - 1);
  }

  function scrollPacks(direction: -1 | 1): void {
    const el = packScroller;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
  }

  // Pointer drag-to-scroll. Past a small threshold we capture the pointer and
  // suppress the trailing click so a drag never toggles the chip underneath.
  let packDrag: { pointerId: number; startX: number; startScroll: number; moved: boolean } | null =
    null;
  let suppressPackClick = false;

  function onPackPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !packScroller) return;
    packDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: packScroller.scrollLeft,
      moved: false,
    };
  }

  function onPackPointerMove(event: PointerEvent): void {
    const el = packScroller;
    if (!packDrag || !el || event.pointerId !== packDrag.pointerId) return;
    const dx = event.clientX - packDrag.startX;
    if (!packDrag.moved && Math.abs(dx) > 4) {
      packDrag.moved = true;
      el.setPointerCapture(packDrag.pointerId);
      el.classList.add("is-dragging");
    }
    if (packDrag.moved) {
      el.scrollLeft = packDrag.startScroll - dx;
      event.preventDefault();
    }
  }

  function endPackDrag(event: PointerEvent): void {
    const el = packScroller;
    if (!packDrag || event.pointerId !== packDrag.pointerId) return;
    if (el?.hasPointerCapture(packDrag.pointerId)) el.releasePointerCapture(packDrag.pointerId);
    el?.classList.remove("is-dragging");
    if (packDrag.moved) suppressPackClick = true;
    packDrag = null;
  }

  function onPackClickCapture(event: MouseEvent): void {
    if (!suppressPackClick) return;
    suppressPackClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  onMount(() => {
    updatePackScroll();
    const el = packScroller;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updatePackScroll());
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  // Re-measure after the pack list (re)renders so arrows reflect new overflow.
  createEffect(() => {
    packs();
    queueMicrotask(updatePackScroll);
  });

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const pack = packFilter();

    return all().filter((p) => {
      if (pack !== "all" && p.packSlug !== pack) return false;
      if (!q) return true;

      return (
        p.name.toLowerCase().includes(q) ||
        p.packTitle.toLowerCase().includes(q) ||
        p.meta.description?.toLowerCase().includes(q)
      );
    });
  });

  const selectedPackName = () => (packFilter() === "all" ? null : packFilter());

  function mixerTargetLook(state: PresetMixerState): LookState {
    if (state.targetId === NO_PRESET_MIX_TARGET) {
      return presetExpectedLook(defaultPresetData());
    }
    const target = all().find((preset) => preset.id === state.targetId);
    return target ? presetExpectedLook(target.data) : presetExpectedLook(defaultPresetData());
  }

  function mixerLook(state: PresetMixerState): LookState {
    return blendPresetLook(state.baseLook, mixerTargetLook(state), state.mix);
  }

  function previewMixerState(state: PresetMixerState): void {
    if (state.mix <= 0) {
      disposePresetLookPreview();
      return;
    }
    transmitPresetLook(mixerLook(state));
  }

  function applyMixerPatch(patch: Partial<Pick<PresetMixerState, "targetId" | "mix">>): void {
    setMixer((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      previewMixerState(next);
      return next;
    });
  }

  const mixerInput = createRafInput(applyMixerPatch);

  onCleanup(() => {
    mixerInput.cancel();
  });

  function updateMixer(
    patch: Partial<Pick<PresetMixerState, "targetId" | "mix">>,
    immediate = false,
  ): void {
    if (immediate) {
      mixerInput.cancel();
      applyMixerPatch(patch);
      return;
    }

    mixerInput.schedule(patch);
  }

  function openPresetMixer(preset: FlatPreset): void {
    mixerInput.cancel();
    disposePresetLookPreview();
    setMixer({
      preset,
      baseLook: presetExpectedLook(preset.data),
      targetId: NO_PRESET_MIX_TARGET,
      mix: 0,
    });
  }

  function cancelPresetMixer(): void {
    mixerInput.cancel();
    disposePresetLookPreview();
    setMixer(null);
  }

  function applyPresetMixer(): void {
    mixerInput.flush();
    const state = mixer();
    if (!state || state.mix <= 0) return;
    setLook(mixerLook(state));
    disposePresetLookPreview();
    setMixer(null);
  }

  function openPresetMenu(preset: FlatPreset, event: MouseEvent) {
    if (selectedPresetId() !== preset.id) commitPreset(preset);

    setMenu(
      openContextMenu(
        event,
        [
          `<context-title>${escapeHtml(preset.name)}</context-title>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="update">Update</context-item>`,
          `<context-item data-action="save">Save As New</context-item>`,
          `<context-item data-action="edit">Edit Details</context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="remix">Remix</context-item>`,
          `<context-item data-action="blend">Mix With</context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="export">Export</context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="reset">Reset</context-item>`,
          `<context-item data-action="delete">Delete</context-item>`,
        ].join(""),
        {
          update: {
            disabled: () =>
              isDefaultPreset(preset.entry) ||
              !!preset.meta.basePackName ||
              selectedPresetId() !== preset.id ||
              !presetEdited(),
            action: () => {
              if (!requireCustomPresetAccess()) return;
              if (
                window.confirm(
                  `Overwrite ${preset.name}?\n\nThis preset will be updated with your current settings.`,
                )
              ) {
                updatePreset(preset, lookToPresetData(snapshotLook()));
              }
            },
          },
          save: {
            disabled: () => selectedPresetId() !== preset.id || !presetEdited(),
            action: () => {
              if (!requireCustomPresetAccess()) return;
              openPresetEditor(event.clientX, event.clientY, {
                preset,
                mode: "create",
                useActiveImageState: true,
              });
            },
          },
          edit: {
            disabled: () => isDefaultPreset(preset.entry) || !!preset.meta.basePackName,
            action: () => {
              if (!requireCustomPresetAccess()) return;
              openPresetEditor(event.clientX, event.clientY, {
                preset,
                mode: "update",
                useActiveImageState: true,
              });
            },
          },
          remix: {
            action: () => openGenerator({ x: event.clientX, y: event.clientY }),
          },
          blend: {
            action: () => openPresetMixer(preset),
          },
          export: {
            disabled: () => isDefaultPreset(preset.entry) || !!preset.meta.basePackName,
            action: () => {
              if (requireCustomPresetAccess()) exportPreset(preset);
            },
          },
          reset: {
            disabled: () => selectedPresetId() !== preset.id || !presetEdited(),
            action: () => commitPreset(preset),
          },
          delete: {
            disabled: () => isDefaultPreset(preset.entry) || !!preset.meta.basePackName,
            action: () => {
              if (!requireCustomPresetAccess()) return;
              if (window.confirm(`Delete ${preset.name}?`)) {
                deletePreset(preset);
              }
            },
          },
        },
      ),
    );
  }

  function openPackMenu(event: MouseEvent) {
    const packName = selectedPackName();

    if (!packName) return;

    setMenu(
      openContextMenu(
        event,
        [
          `<context-title>${escapeHtml(packName)}</context-title>`,
          `<context-item data-action="rename">Rename</context-item>`,
          `<context-item data-action="export">Export</context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="delete">Delete</context-item>`,
        ].join(""),
        {
          rename: {
            disabled: () => isDefaultPack(packName),
            action: () => {
              if (requireCustomPresetAccess()) renameSelectedPack(packName);
            },
          },
          export: {
            disabled: () => isDefaultPack(packName),
            action: () => {
              if (requireCustomPresetAccess()) exportPack(packName);
            },
          },
          delete: {
            disabled: () => isDefaultPack(packName),
            action: () => {
              if (requireCustomPresetAccess()) deleteSelectedPack(packName);
            },
          },
        },
      ),
    );
  }

  function closeMenu() {
    setMenu(null);
  }

  function renameSelectedPack(packName: string) {
    const nextName = window.prompt("Rename pack", packName);

    if (nextName) renamePack(packName, nextName);
  }

  function deleteSelectedPack(packName: string) {
    if (
      window.confirm(
        `Delete ${packName}? All presets in this pack will be deleted from your device.`,
      )
    ) {
      deletePack(packName);
      setPackFilter("all");
    }
  }

  async function importPresetFromDevice(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const result = await importPresetFile(file);
      if (result) setImportMessage(result.message);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Could not import preset file.");
    }
  }

  return (
    <div class="poto-presets">
      <style>{PRESET_PANEL_CSS}</style>

      <div class="poto-presets__bar">
        <label class="poto-presets__search">
          <img src="/assets/icons/magnifier_icon.svg" alt="" />

          <input
            type="text"
            placeholder="Search presets"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>

        <button
          class="poto-presets__iconbtn"
          type="button"
          title="Import preset from device"
          data-action="import-preset"
          onClick={() => importInput?.click()}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m8 11 4 4 4-4" />
            <path d="M8 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
          </svg>
        </button>
        <input
          ref={(element) => (importInput = element)}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void importPresetFromDevice(file);
          }}
        />

      </div>

      <Show when={importMessage()}>
        {(message) => <div class="poto-presets__no-results">{message()}</div>}
      </Show>

      <Show when={visiblePresetCount() > 1}>
        <div class="poto-presets__pack-row">
          <Show when={canScrollLeft()}>
            <button
              type="button"
              class="poto-presets__pack-arrow poto-presets__pack-arrow--left"
              aria-label="Scroll packs left"
              tabindex="-1"
              onClick={() => scrollPacks(-1)}
            >
              <span class="poto-presets__pack-arrow-disc">
                <img src="/assets/icons/chevron_back_icon.svg" alt="" />
              </span>
            </button>
          </Show>

          <preset-pack
            ref={(el: HTMLElement) => (packScroller = el)}
            class="poto-presets__pack-filter"
            value={packFilter()}
            onContextMenu={openPackMenu}
            onScroll={updatePackScroll}
            onPointerDown={onPackPointerDown}
            onPointerMove={onPackPointerMove}
            onPointerUp={endPackDrag}
            onPointerCancel={endPackDrag}
            oncapture:click={onPackClickCapture}
          >
            <span class="poto-presets__pack-label">Pack</span>

            <For each={packs()}>
              {(pack) => (
                <button
                  type="button"
                  class="poto-presets__pack-chip"
                  classList={{ "is-active": packFilter() === pack.slug }}
                  title={pack.title}
                  aria-pressed={packFilter() === pack.slug}
                  onClick={() => setPackFilter(pack.slug)}
                >
                  <span class="poto-presets__pack-chip-name">{pack.title}</span>
                </button>
              )}
            </For>
          </preset-pack>

          <Show when={canScrollRight()}>
            <button
              type="button"
              class="poto-presets__pack-arrow poto-presets__pack-arrow--right"
              aria-label="Scroll packs right"
              tabindex="-1"
              onClick={() => scrollPacks(1)}
            >
              <span class="poto-presets__pack-arrow-disc">
                <img src="/assets/icons/chevron_back_icon.svg" alt="" />
              </span>
            </button>
          </Show>
        </div>

        <div class="poto-presets__list">
          <Show
            when={filtered().length > 0}
            fallback={<div class="poto-presets__no-results">No presets match this filter.</div>}
          >
            <For each={filtered()}>
              {(p) => {
                const image = presetImage(p);
                return (
                  <preset-item
                    class="poto-preset-row"
                    value={p.id}
                    classList={{ active: selectedPresetId() === p.id }}
                    onMouseEnter={() => previewPreset(p)}
                    onMouseLeave={() => endPreview()}
                    onClick={() => commitPreset(p)}
                    onContextMenu={(event) => openPresetMenu(p, event)}
                  >
                    <Show when={image}>
                      <img
                        class="poto-preset-row__bg"
                        src={image!}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <span class="poto-preset-row__scrim" aria-hidden="true" />
                    </Show>

                    <span class="poto-preset-row__main">
                      <span class="poto-preset-row__name">{p.name}</span>

                      <span class="poto-preset-row__pack">
                        <Show when={selectedPresetId() === p.id && presetEdited()}>
                          <span class="poto-preset-row__edited">edited</span>
                        </Show>

                        {p.packTitle}
                      </span>
                    </span>
                  </preset-item>
                );
              }}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={menu()}>{(state) => <ContextMenu state={state()} onClose={closeMenu} />}</Show>

      <Show when={mixer()}>
        {(state) => (
          <div class="poto-preset-mixer-backdrop" role="presentation">
            <section
              class="poto-preset-mixer"
              role="dialog"
              aria-modal="true"
              aria-label="Preset Mixer"
            >
              <span class="poto-preset-mixer__title">Preset Mixer</span>
              <span class="poto-preset-mixer__desc">
                Choose which preset to blend with the currently selected preset.
              </span>
              <section class="poto-preset-mixer__controls">
                <label class="poto-preset-mixer__range">
                  <span>Mix</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(state().mix * 100)}
                    onInput={(event) =>
                      updateMixer({ mix: Number(event.currentTarget.value) / 100 })
                    }
                    onChange={(event) =>
                      updateMixer({ mix: Number(event.currentTarget.value) / 100 }, true)
                    }
                  />
                  <strong>{Math.round(state().mix * 100)}%</strong>
                </label>
                <select
                  value={state().targetId}
                  onInput={(event) => updateMixer({ targetId: event.currentTarget.value }, true)}
                >
                  <option value={NO_PRESET_MIX_TARGET}>No Preset</option>
                  <For each={all()}>
                    {(preset) => <option value={preset.id}>{preset.name}</option>}
                  </For>
                </select>
              </section>
              <span class="poto-preset-mixer__tip">
                <strong>Tip:</strong> Mix with "No Preset" to adjust the strength of the current
                preset.
              </span>
              <div class="poto-preset-mixer__actions">
                <button class="poto-preset-mixer__button" type="button" onClick={cancelPresetMixer}>
                  Cancel
                </button>
                <button
                  class="poto-preset-mixer__button poto-preset-mixer__button--primary"
                  type="button"
                  disabled={state().mix <= 0}
                  onClick={applyPresetMixer}
                >
                  Apply
                </button>
              </div>
            </section>
          </div>
        )}
      </Show>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MIXED_LOOK_KEYS: Array<keyof LookState> = [
  "curve",
  "contrast",
  "balance",
  "scattering",
  "refraction",
  "saturation",
  "rgbMixer",
  "densityChroma",
  "radiance",
  "tone",
  "exposure",
  "shadowHighlight",
  "grain",
  "halation",
  "diffusion",
  "spotlight",
];

type CurvePointLike = { x: number; y: number };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function lerp(a: number, b: number, mix: number): number {
  return a + (b - a) * mix;
}

function lerpUnitHue(a: number, b: number, mix: number): number {
  const delta = ((((b - a) % 1) + 1.5) % 1) - 0.5;
  const value = a + delta * mix;
  return ((value % 1) + 1) % 1;
}

function lerpDegrees(a: number, b: number, mix: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * mix;
}

function isCurvePointArray(value: unknown): value is CurvePointLike[] {
  return (
    Array.isArray(value) &&
    value.every(
      (point) =>
        !!point &&
        typeof point === "object" &&
        typeof (point as CurvePointLike).x === "number" &&
        typeof (point as CurvePointLike).y === "number",
    )
  );
}

function sampleCurve(points: CurvePointLike[], x: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (!sorted.length) return 0.5;
  if (x <= sorted[0].x) return sorted[0].y;
  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index];
    const left = sorted[index - 1];
    if (x <= right.x) {
      const span = right.x - left.x || 1;
      return lerp(left.y, right.y, (x - left.x) / span);
    }
  }
  return sorted[sorted.length - 1].y;
}

function blendCurvePoints(
  base: CurvePointLike[],
  target: CurvePointLike[],
  mix: number,
): CurvePointLike[] {
  const xs = Array.from(new Set([...base, ...target].map((point) => point.x))).sort(
    (a, b) => a - b,
  );
  return xs.map((x) => ({
    x,
    y: lerp(sampleCurve(base, x), sampleCurve(target, x), mix),
  }));
}

function pathHas(path: string[], name: string): boolean {
  return path.some((part) => part.toLowerCase() === name.toLowerCase());
}

function shouldInterpolateHue(path: string[]): "unit" | "degrees" | false {
  const last = path[path.length - 1]?.toLowerCase() ?? "";
  if (pathHas(path, "mapVectors")) {
    const index = Number(last);
    return Number.isFinite(index) && index % 4 !== 1 && index % 4 !== 3 ? "degrees" : false;
  }
  return last.includes("hue") ? "unit" : false;
}

function blendValue(base: unknown, target: unknown, mix: number, path: string[]): unknown {
  if (typeof base === "number" && typeof target === "number") {
    const hueMode = shouldInterpolateHue(path);
    if (hueMode === "unit") return lerpUnitHue(base, target, mix);
    if (hueMode === "degrees") return lerpDegrees(base, target, mix);
    return lerp(base, target, mix);
  }

  if (isCurvePointArray(base) && isCurvePointArray(target)) {
    return blendCurvePoints(base, target, mix);
  }

  if (Array.isArray(base) && Array.isArray(target)) {
    return base.map((value, index) =>
      blendValue(value, target[index] ?? value, mix, [...path, String(index)]),
    );
  }

  if (base && target && typeof base === "object" && typeof target === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base as Record<string, unknown>)) {
      out[key] = blendValue(
        (base as Record<string, unknown>)[key],
        (target as Record<string, unknown>)[key] ?? (base as Record<string, unknown>)[key],
        mix,
        [...path, key],
      );
    }
    return out;
  }

  return clone(base);
}

function blendPresetLook(base: LookState, target: LookState, mix: number): LookState {
  const out = clone(base);
  const amount = Math.max(0, Math.min(1, mix));
  for (const key of MIXED_LOOK_KEYS) {
    (out as Record<keyof LookState, unknown>)[key] = blendValue(base[key], target[key], amount, [
      key,
    ]);
  }
  return out;
}
