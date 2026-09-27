import { createSignal, createMemo, For, Show, onCleanup, onMount, untrack } from "solid-js";
import { FeatherSlider } from "../controls/FeatherSlider";
import { HuePicker } from "../controls/HuePicker";
import {
  selectedMaskId,
  setSelectedMaskId,
  addColorMask,
  addRadialMask,
  addGradientMask,
  addBrushMask,
  addLuminanceMask,
  addDepthMask,
  overlayAlwaysOn,
  setOverlayAlwaysOn,
  triggerOverlay,
} from "./maskingStore";
import { editState, setEditState } from "../../app/editor-store";
import type { ViewerApi } from "../../ui/Viewer";
import {
  cloneColorState,
  DEFAULT_COLOR_STATE,
  type CurvePreviewInput,
  type LocalAdjustmentLayer,
  type EditState,
} from "../../engine/state/EditState";
import { PanelHeader, ActivePanel } from "../panels/PanelContainer";
import { PANELS, type PanelKey } from "../panels";
import { EditStateContext } from "../panels/EditStateContext";
import { isPanelEdited } from "../edited";
import { getPanelBypass, resetPanel, togglePanelBypass } from "../panelOps";
import type { SetStoreFunction } from "solid-js/store";
import { ContextMenu, openContextMenu, type ContextMenuState } from "../controls/ContextMenu";
import { maskToolDefinitions } from "../../features/masking/maskToolRegistry";
import { getDepthMaskCapability } from "../../features/masking/depthMaskCapability";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function MaskingPanel(props: {
  onBack: () => void;
  onBeginEdit: () => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
  viewerApi?: ViewerApi;
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  clearPreviewPatch?: (reason?: string) => void;
}) {
  const [openPanel, setOpenPanel] = createSignal<PanelKey | null>(null);
  const [helpPanel, setHelpPanel] = createSignal<PanelKey | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal(false);
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null);
  let overviewBackRef: HTMLElement | undefined;

  function closeMenu() {
    setMenu(null);
  }

  function openMaskMenu(mask: LocalAdjustmentLayer, event: MouseEvent) {
    setMenu(
      openContextMenu(
        event,
        [
          `<context-title>${escapeHtml(mask.name)}</context-title>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="delete">Delete</context-item>`,
        ].join(""),
        {
          delete: {
            action: () => {
              const idx = localAdjustments().findIndex((m) => m.id === mask.id);
              if (idx !== -1) {
                const wasSelected = selectedMaskId() === mask.id;
                if (!wasSelected) {
                  props.onBeginEdit();
                }

                setEditState("localAdjustments", (prev) => prev.filter((_, i) => i !== idx));
                publishCommittedLocalPreview();
                setPendingDelete(false);
                props.onApplyEdit();

                if (wasSelected) {
                  requestAnimationFrame(() => overviewBackRef?.focus());
                }
              }
            },
          },
        }
      )
    );
  }
  let cancelButtonRef: HTMLButtonElement | undefined;
  const localAdjustments = createMemo(() => editState.localAdjustments ?? []);
  const selectedMaskIdx = createMemo(() => {
    const id = selectedMaskId();
    if (!id) return -1;
    return localAdjustments().findIndex((m) => m.id === id);
  });
  const selectedMask = createMemo(() => {
    const idx = selectedMaskIdx();
    return idx === -1 ? null : localAdjustments()[idx] ?? null;
  });
  const selectedMaskComponent = createMemo(() => selectedMask()?.components[0] ?? null);

  const selectedMaskType = createMemo(() => selectedMaskComponent()?.type ?? "color-pick");
  const isRadialMask = () => selectedMaskType() === "radial";
  const isGradientMask = () => selectedMaskType() === "gradient";
  const isBrushMask = () => selectedMaskType() === "brush";
  const isLuminanceMask = () => selectedMaskType() === "luminance";
  const isDepthMask = () => selectedMaskType() === "depth";

  function addMask(type: "color" | "radial" | "gradient" | "brush" | "luminance" | "depth") {
    props.onBeginEdit();
    let id = "";
    switch (type) {
      case "color": id = addColorMask(props.viewerApi); break;
      case "radial": id = addRadialMask(props.viewerApi); break;
      case "gradient": id = addGradientMask(); break;
      case "brush": id = addBrushMask(); break;
      case "luminance": id = addLuminanceMask(); break;
      case "depth": id = addDepthMask(props.viewerApi); break;
    }
    if (!id) {
      props.onCancelEdit();
      return;
    }
    setPendingDelete(false);
    requestAnimationFrame(() => cancelButtonRef?.focus());
  }

  function editMask(id: string) {
    props.onBeginEdit();
    setPendingDelete(false);
    setSelectedMaskId(id);
    requestAnimationFrame(() => cancelButtonRef?.focus());
  }

  function applyEdit() {
    if (pendingDelete()) {
      const idx = selectedMaskIdx();
      if (idx !== -1) {
        setEditState("localAdjustments", (prev) => prev.filter((_, i) => i !== idx));
      }
    }
    setPendingDelete(false);
    props.onApplyEdit();
    requestAnimationFrame(() => overviewBackRef?.focus());
  }

  function cancelEdit() {
    setPendingDelete(false);
    props.onCancelEdit();
    requestAnimationFrame(() => overviewBackRef?.focus());
  }

  const selectedAdjustmentState = () =>
    (selectedMask()?.adjustments ?? cloneColorState(DEFAULT_COLOR_STATE)) as unknown as EditState;

  // The normal global edit state is a Solid store proxy, so panel controls can keep a
  // stable object reference and still read fresh values. A local mask adjustment is a
  // nested slice, not a top-level store, so returning a plain clone here makes the
  // masking accordion capture stale values. This proxy keeps the existing panel UI
  // unchanged while resolving each property from the currently selected mask.
  const selectedAdjustmentProxy = new Proxy({} as EditState, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      return (selectedAdjustmentState() as unknown as Record<string, unknown>)[prop];
    },
    has(_target, prop) {
      if (typeof prop === "symbol") return false;
      return prop in (selectedAdjustmentState() as unknown as Record<string, unknown>);
    },
    ownKeys() {
      return Reflect.ownKeys(selectedAdjustmentState() as unknown as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      const state = selectedAdjustmentState() as unknown as Record<string, unknown>;
      if (!(prop in state)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        value: state[prop],
      };
    },
  });

  function publishLocalPreview(nextLocalAdjustments: LocalAdjustmentLayer[], reason = "local-adjustment-preview") {
    props.previewEditPatch?.({ localAdjustments: nextLocalAdjustments }, reason);
  }

  function publishCommittedLocalPreview(reason = "local-adjustment-commit") {
    // Let Solid finish the nested setStore write before the engine receives the
    // localAdjustments snapshot. Without this, the accordion can send the previous
    // local layer to Engine.previewEditPatch and the visible preview appears unchanged.
    queueMicrotask(() => {
      untrack(() => publishLocalPreview([...(editState.localAdjustments ?? [])], reason));
    });
  }

  const setSelectedAdjustmentState: SetStoreFunction<EditState> = (...args: any[]) => {
    const idx = selectedMaskIdx();
    if (idx === -1) return;

    (setEditState as unknown as (...innerArgs: unknown[]) => void)(
      "localAdjustments",
      idx,
      "adjustments",
      ...args,
    );

    publishCommittedLocalPreview();
  };

  function previewSelectedAdjustmentPatch(patch: Partial<EditState>, reason = "local-adjustment-preview") {
    const idx = selectedMaskIdx();
    if (idx === -1) {
      props.previewEditPatch?.(patch, reason);
      return;
    }

    const current = editState.localAdjustments ?? [];
    const mask = current[idx];
    if (!mask) {
      props.previewEditPatch?.(patch, reason);
      return;
    }

    const adjustments = cloneColorState(mask.adjustments);
    for (const key of Object.keys(patch) as (keyof EditState)[]) {
      if (key === "localAdjustments") continue;
      (adjustments as unknown as Record<string, unknown>)[key as string] = (patch as Record<string, unknown>)[key as string];
    }

    const nextLocal = current.slice();
    nextLocal[idx] = { ...mask, adjustments };
    publishLocalPreview(nextLocal, reason);
  }

  function previewSelectedCurveInput(input: CurvePreviewInput) {
    const idx = selectedMaskIdx();
    if (idx === -1) return;

    const current = editState.localAdjustments ?? [];
    const mask = current[idx];
    if (!mask) return;

    const adjustments = cloneColorState(mask.adjustments);
    switch (input.key) {
      case "curve":
        adjustments.curve = { ...adjustments.curve, bypass: false, mode: input.mode, points: input.points };
        break;
      case "contrast":
        adjustments.contrast = {
          ...adjustments.contrast,
          bypass: false,
          curve: { ...adjustments.contrast.curve, mode: input.mode as any, points: input.points as any },
        };
        break;
      case "exposure":
        adjustments.exposure = {
          ...adjustments.exposure,
          bypass: false,
          curve: { ...adjustments.exposure.curve, mode: input.mode, points: input.points },
        };
        break;
      case "radiance":
        adjustments.radiance = {
          ...adjustments.radiance,
          bypass: false,
          curve: { ...adjustments.radiance.curve, mode: input.mode, points: input.points },
        };
        break;
      case "tone":
        adjustments.tone = {
          ...adjustments.tone,
          bypass: false,
          curve: { ...adjustments.tone.curve, mode: input.mode, points: input.points },
        };
        break;
      case "saturation":
        adjustments.saturation = {
          ...adjustments.saturation,
          bypass: false,
          curve: { ...adjustments.saturation.curve, mode: input.mode, points: input.points },
        };
        break;
      case "densityChroma.density":
        adjustments.densityChroma = {
          ...adjustments.densityChroma,
          bypass: false,
          density: { ...adjustments.densityChroma.density, mode: input.mode, points: input.points },
        };
        break;
      case "densityChroma.chroma":
        adjustments.densityChroma = {
          ...adjustments.densityChroma,
          bypass: false,
          chroma: { ...adjustments.densityChroma.chroma, mode: input.mode, points: input.points },
        };
        break;
    }

    const nextLocal = current.slice();
    nextLocal[idx] = { ...mask, adjustments };
    publishLocalPreview(nextLocal, `local-${input.key}-drag`);
  }

  function clearSelectedAdjustmentPreview(reason = "local-adjustment-preview-clear") {
    // Defer clearing so Viewer.committedEngineEditState can receive the committed
    // Solid editState first. Clearing too early restores Engine.committedEditState
    // from before the local accordion commit and makes the adjustment look like it
    // did nothing.
    window.setTimeout(() => untrack(() => props.clearPreviewPatch?.(reason)), 0);
  }

  const [viewportSize, setViewportSize] = createSignal({ width: 0, height: 0 });
  let railRef: HTMLElement | undefined;

  const railLayout = createMemo<"bottom" | "side">(() => {
    const { width, height } = viewportSize();
    if (width === 0 || height === 0) return "side";
    const shortLandscape = width > height && height <= 520;
    return width <= 900 && !shortLandscape ? "bottom" : "side";
  });

  const railStyle = createMemo(() => {
    const { width, height } = viewportSize();
    if (railLayout() !== "bottom") return undefined;

    const maxPanelHeight = width <= 640 ? 300 : 320;
    const panelHeight = Math.round(Math.min(maxPanelHeight, Math.max(198, height * 0.36)));
    const compactPanelHeight =
      height <= 620 ? Math.round(Math.min(228, Math.max(168, height * 0.33))) : panelHeight;

    return {
      "--aside-viewport-width": `${Math.round(width)}px`,
      "--aside-viewport-height": `${Math.round(height)}px`,
      "--aside-panel-height": `${compactPanelHeight}px`,
    };
  });

  onMount(() => {
    const rail = railRef;
    if (!rail) return;
    const appRoot = rail.closest("poto-app") as HTMLElement | null;

    const onWheel = (event: WheelEvent) => event.stopPropagation();
    const syncLayout = () => {
      const visualViewport = window.visualViewport;
      const nextSize = {
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      };
      const shortLandscape = nextSize.width > nextSize.height && nextSize.height <= 520;
      const nextLayout = nextSize.width <= 900 && !shortLandscape ? "bottom" : "side";
      const maxPanelHeight = nextSize.width <= 640 ? 300 : 320;
      const panelHeight = Math.round(
        Math.min(maxPanelHeight, Math.max(198, nextSize.height * 0.36)),
      );
      const compactPanelHeight =
        nextSize.height <= 620
          ? Math.round(Math.min(228, Math.max(168, nextSize.height * 0.33)))
          : panelHeight;

      setViewportSize(nextSize);
      appRoot?.setAttribute("data-aside-layout", nextLayout);
      if (nextLayout === "bottom") {
        appRoot?.style.setProperty("--aside-panel-height", `${compactPanelHeight}px`);
        appRoot?.style.setProperty("--aside-viewport-width", `${Math.round(nextSize.width)}px`);
        appRoot?.style.setProperty("--aside-viewport-height", `${Math.round(nextSize.height)}px`);
      } else {
        appRoot?.style.removeProperty("--aside-panel-height");
        appRoot?.style.removeProperty("--aside-viewport-width");
        appRoot?.style.removeProperty("--aside-viewport-height");
      }
    };

    syncLayout();
    rail.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("resize", syncLayout);
    window.addEventListener("orientationchange", syncLayout);
    window.visualViewport?.addEventListener("resize", syncLayout);
    window.visualViewport?.addEventListener("scroll", syncLayout);

    onCleanup(() => {
      rail.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("orientationchange", syncLayout);
      window.visualViewport?.removeEventListener("resize", syncLayout);
      window.visualViewport?.removeEventListener("scroll", syncLayout);
      appRoot?.removeAttribute("data-aside-layout");
      appRoot?.style.removeProperty("--aside-panel-height");
      appRoot?.style.removeProperty("--aside-viewport-width");
      appRoot?.style.removeProperty("--aside-viewport-height");
    });
  });

  return (
    <aside
      ref={railRef}
      class="adjustment-panels masking-panel"
      data-layout={railLayout()}
      data-empty={localAdjustments().length === 0 ? "true" : "false"}
      style={railStyle()}
    >
      {/* ── header ───────────────────────────────────────────────────── */}
      <Show
        when={!selectedMask()}
        fallback={
          <header class="masking-panel__header masking-panel__header--editing">
            <button ref={cancelButtonRef} type="button" class="masking-panel__cancel-btn" onClick={cancelEdit}>
              Cancel
            </button>
            <span class="masking-panel__editing-title">
              {pendingDelete() ? "Delete Mask" : "Mask Settings"}
            </span>
            <button type="button" class="action-button masking-panel__apply-btn" onClick={applyEdit}>
              Apply
            </button>
          </header>
        }
      >
        <header
          ref={overviewBackRef}
          class="masking-panel__header--editing"
          onClick={() => props.onBack()}
          role="button"
          tabindex="0"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onBack();
            }
          }}
        >
          <button ref={cancelButtonRef} type="button" class="masking-panel__cancel-btn" onClick={cancelEdit}>
            Cancel
          </button>
        </header>
      </Show>

      <Show when={!selectedMask()}>
        <section class="masking-panel__section" aria-label="Add mask">
          <div class="masking-panel__cta-row">
            <For each={maskToolDefinitions.filter((tool) => tool.type !== "eraser")}>
              {(tool) => {
                const availability = () => tool.availability();
                return (
                  <button
                    type="button"
                    class="action-button masking-panel__add-btn"
                    disabled={!availability().enabled}
                    title={availability().reason ?? undefined}
                    onClick={() => {
                      if (availability().enabled) addMask(tool.type as "color" | "radial" | "gradient" | "brush" | "luminance" | "depth");
                    }}
                  >
                    <span class="masking-panel__add-icon" aria-hidden="true">{tool.icon}</span>
                    <span>{tool.label}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </section>

        {/* ── mask list ────────────────────────────────────────────────── */}
        <Show when={localAdjustments().length > 0}>
          <section class="masking-panel__section" aria-label="Masks">
            <div class="masking-panel__section-head">
              <span class="masking-panel__section-title">Masks</span>
              <span class="masking-panel__section-count">{localAdjustments().length}</span>
            </div>
            <div class="masking-panel__masks">
              <For each={localAdjustments()}>
                {(mask) => {
                  const isSelected = () => selectedMaskId() === mask.id;
                  const maskType = () => mask.components[0]?.type ?? "color-pick";
                  const isRadial = () => maskType() === "radial";
                  const isGradient = () => maskType() === "gradient";
                  const isBrush = () => maskType() === "brush";
                  const isLuminance = () => maskType() === "luminance";
                  const isDepth = () => maskType() === "depth";
                  const swatch = () =>
                    isRadial() || isGradient() || isBrush() || isLuminance() || isDepth()
                      ? null
                      : (mask.components[0] as any)?.selectedColor ?? (mask.components[0] as any)?.sampledColor ?? null;
                  return (
                    <button
                      type="button"
                      class="masking-panel__mask-card"
                      classList={{ "is-selected": isSelected() }}
                      onClick={() => editMask(mask.id)}
                      onContextMenu={(e) => openMaskMenu(mask, e)}
                    >
                      <span
                        class="masking-panel__mask-swatch"
                        classList={{ "is-radial": isRadial() }}
                        style={
                          swatch()
                            ? { background: `rgb(${swatch()![0] * 255 | 0}, ${swatch()![1] * 255 | 0}, ${swatch()![2] * 255 | 0})` }
                            : undefined
                        }
                        aria-hidden="true"
                      >
                        {isRadial() && <span class="masking-panel__add-icon">◯</span>}
                        {isGradient() && <span class="masking-panel__add-icon">◩</span>}
                        {isBrush() && <span class="masking-panel__add-icon">⌁</span>}
                        {isLuminance() && <span class="masking-panel__add-icon">◐</span>}
                        {isDepth() && <span class="masking-panel__add-icon">▤</span>}
                      </span>
                      <span class="masking-panel__mask-name">{mask.name}</span>
                      <span
                        class="masking-panel__mask-status"
                        classList={{ "is-on": mask.enabled, "is-off": !mask.enabled }}
                      >
                        {mask.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </section>
        </Show>
      </Show>
      <Show when={selectedMask()}>
        {/* ── selected mask settings ────────────────────────────────── */}
        <section class="masking-panel__section" aria-label="Mask settings">
          <div class="masking-panel__section-head masking-panel__section-head--selected">
            <span class="masking-panel__section-title">Selected Mask</span>
          </div>
          <div class="masking-panel__settings">
            <div class="masking-panel__field">
              <label class="masking-panel__label" for="masking-mask-name">
                Name
              </label>
              <input
                id="masking-mask-name"
                type="text"
                class="editor-input masking-panel__name-input"
                value={selectedMask()?.name ?? ""}
                onInput={(e) => {
                  const idx = selectedMaskIdx();
                  if (idx !== -1) setEditState("localAdjustments", idx, "name", e.currentTarget.value);
                }}
              />
            </div>

            <div class="masking-panel__chip-row">
              <button
                type="button"
                class="masking-panel__chip"
                classList={{ "is-on": selectedMask()?.enabled ?? false }}
                aria-pressed={selectedMask()?.enabled ?? false}
                onClick={() => {
                  const idx = selectedMaskIdx();
                  if (idx !== -1) setEditState("localAdjustments", idx, "enabled", !localAdjustments()[idx].enabled);
                }}
              >
                <span
                  class="masking-panel__chip-dot"
                  classList={{ "is-on": selectedMask()?.enabled ?? false }}
                  aria-hidden="true"
                />
                <span>{selectedMask()?.enabled ? "Enabled" : "Disabled"}</span>
              </button>
              <button
                type="button"
                class="masking-panel__chip"
                classList={{ "is-on": overlayAlwaysOn() }}
                aria-pressed={overlayAlwaysOn()}
                onClick={() => {
                  const next = !overlayAlwaysOn();
                  setOverlayAlwaysOn(next);
                  if (!next) triggerOverlay();
                }}
              >
                <span
                  class="masking-panel__chip-dot"
                  classList={{ "is-on": overlayAlwaysOn() }}
                  aria-hidden="true"
                />
                <span>{overlayAlwaysOn() ? "Overlay On" : "Overlay Off"}</span>
              </button>
            </div>
          </div>
        </section>

        {/* ── color / threshold card  OR  radial feather+invert ────── */}
        <Show when={isRadialMask()}>
          <section class="masking-panel__section" aria-label="Radial mask settings">
            <div class="masking-panel__card">
              <div class="masking-panel__card-head">
                <span class="masking-panel__card-title">Radial Mask</span>
              </div>

              {/* Feather */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Feather</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.feather ?? 1) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={1}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.feather ?? 1}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, feather: v }));
                      triggerOverlay();
                    }
                  }}
                />
              </div>

              {/* Invert toggle */}
              <div class="masking-panel__toggle-row">
                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": selectedMask()?.components[0]?.invert ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={selectedMask()?.components[0]?.invert ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, "invert", e.currentTarget.checked);
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Invert</span>
                </label>
              </div>

              {/* Reset geometry */}
              <div class="masking-panel__chip-row">
                <button
                  type="button"
                  class="masking-panel__chip"
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      let defaultSize: [number, number] = [0.55, 0.55];
                      if (props.viewerApi) {
                        const origin = props.viewerApi.imageUVToCanvasRelative(0, 0);
                        const xEdge = props.viewerApi.imageUVToCanvasRelative(1, 0);
                        const yEdge = props.viewerApi.imageUVToCanvasRelative(0, 1);
                        if (origin && xEdge && yEdge) {
                          const width = Math.hypot(xEdge.x - origin.x, xEdge.y - origin.y);
                          const height = Math.hypot(yEdge.x - origin.x, yEdge.y - origin.y);
                          if (width > 0 && height > 0) {
                            const diameter = Math.min(width, height) * 0.55;
                            defaultSize = [diameter / width, diameter / height];
                          }
                        }
                      }
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        position: [0.5, 0.5],
                        size: defaultSize,
                        angle: 0,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span>Reset Shape</span>
                </button>
              </div>
            </div>
          </section>
        </Show>

        {/* ── brush mask settings ──────────────────────────── */}
        <Show when={isBrushMask()}>
          <section class="masking-panel__section" aria-label="Brush mask settings">
            <div class="masking-panel__card">
              <div class="masking-panel__card-head">
                <span class="masking-panel__card-title">Brush</span>
              </div>

              {/* Size */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Size</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.brush_radius ?? 0.15) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0.01}
                  max={1}
                  default={0.15}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.brush_radius ?? 0.15}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, brush_radius: v }));
                      triggerOverlay();
                    }
                  }}
                />
              </div>

              {/* Flow */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Flow</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.brush_opacity ?? 0.8) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0.01}
                  max={1}
                  default={0.8}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.brush_opacity ?? 0.8}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, brush_opacity: v }));
                      triggerOverlay();
                    }
                  }}
                />
              </div>

              {/* Hardness */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Hardness</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.brush_hardness ?? 0) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={0}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.brush_hardness ?? 0}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, brush_hardness: v }));
                      triggerOverlay();
                    }
                  }}
                />
              </div>

              {/* Edge Aware toggle */}
              <div class="masking-panel__chip-row">
                <button
                  type="button"
                  class="masking-panel__chip"
                  classList={{ "is-on": ((selectedMask()?.components[0] as any)?.brush_masking ?? 0) > 0 }}
                  aria-pressed={((selectedMask()?.components[0] as any)?.brush_masking ?? 0) > 0}
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      const current = (localAdjustments()[idx]?.components[0] as any)?.brush_masking ?? 0;
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        brush_masking: current > 0 ? 0 : 1,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span
                    class="masking-panel__chip-dot"
                    classList={{ "is-on": ((selectedMask()?.components[0] as any)?.brush_masking ?? 0) > 0 }}
                    aria-hidden="true"
                  />
                  <span>Edge Aware</span>
                </button>
              </div>

              {/* Paint / Erase mode toggle */}
              <div class="masking-panel__chip-row">
                <button
                  type="button"
                  class="masking-panel__chip"
                  classList={{ "is-on": !((selectedMask()?.components[0] as any)?.brush_erase ?? false) }}
                  aria-pressed={!((selectedMask()?.components[0] as any)?.brush_erase ?? false)}
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        brush_erase: false,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span
                    class="masking-panel__chip-dot"
                    classList={{ "is-on": !((selectedMask()?.components[0] as any)?.brush_erase ?? false) }}
                    aria-hidden="true"
                  />
                  <span>Paint</span>
                </button>
                <button
                  type="button"
                  class="masking-panel__chip"
                  classList={{ "is-on": ((selectedMask()?.components[0] as any)?.brush_erase ?? false) }}
                  aria-pressed={((selectedMask()?.components[0] as any)?.brush_erase ?? false)}
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        brush_erase: true,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span
                    class="masking-panel__chip-dot"
                    classList={{ "is-on": ((selectedMask()?.components[0] as any)?.brush_erase ?? false) }}
                    aria-hidden="true"
                  />
                  <span>Erase</span>
                </button>
              </div>

              {/* Invert */}
              <div class="masking-panel__toggle-row">
                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.invert ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.invert ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                          ...c,
                          invert: e.currentTarget.checked,
                        }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Invert</span>
                </label>
              </div>

              {/* Clear brush strokes */}
              <div class="masking-panel__chip-row">
                <button
                  type="button"
                  class="masking-panel__chip masking-panel__chip--danger"
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        brush: null,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span>Clear Brush</span>
                </button>
              </div>
            </div>
          </section>
        </Show>

        {/* ── gradient mask settings ────── */}
        <Show when={isGradientMask()}>
          <section class="masking-panel__section" aria-label="Gradient mask settings">
            <div class="masking-panel__card">
              <div class="masking-panel__card-head">
                <span class="masking-panel__card-title">Gradient Mask</span>
              </div>

              {/* Toggles */}
              <div class="masking-panel__toggle-row">
                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.reflect ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.reflect ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, reflect: e.currentTarget.checked }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Reflect</span>
                </label>

                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.invert ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.invert ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, invert: e.currentTarget.checked }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Invert</span>
                </label>
              </div>

              {/* Reset geometry */}
              <div class="masking-panel__chip-row">
                <button
                  type="button"
                  class="masking-panel__chip"
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        startPoint: [0.5, 0.75],
                        endPoint: [0.5, 0.25],
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span>Reset Shape</span>
                </button>
              </div>
            </div>
          </section>
        </Show>

        {/* ── luminance mask settings ────── */}
        <Show when={isLuminanceMask()}>
          <section class="masking-panel__section" aria-label="Luminance mask settings">
            <div class="masking-panel__card">
              <div class="masking-panel__card-head">
                <span class="masking-panel__card-title">Luminance Range</span>
              </div>


              {/* Target */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Target</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.target ?? 1) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={1}
                  trackGradient="linear-gradient(to right, #000000, #ffffff)"
                  thumbGradient={{ from: "#000000", to: "#ffffff" }}
                  value={(selectedMask()?.components[0] as any)?.target ?? 1}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, target: v, showOverlay: true }));
                      triggerOverlay();
                    }
                  }}
                  onChange={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, showOverlay: false }));
                    }
                  }}
                />
              </div>

              {/* Range */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Range</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.range ?? 0.7) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={0.7}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.range ?? 0.7}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, range: v, showOverlay: true }));
                      triggerOverlay();
                    }
                  }}
                  onChange={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, showOverlay: false }));
                    }
                  }}
                />
              </div>

              {/* Smoothness */}
              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Smoothness</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.smoothness ?? 1) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={1}
                  trackGradient="linear-gradient(90deg, #7f7f7f 0%, var(--accent-color, #3395ff) 100%)"
                  thumbGradient={{ from: "#7f7f7f", to: "var(--accent-color, #3395ff)" }}
                  value={(selectedMask()?.components[0] as any)?.smoothness ?? 1}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, smoothness: v, showOverlay: true }));
                      triggerOverlay();
                    }
                  }}
                  onChange={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, showOverlay: false }));
                    }
                  }}
                />
              </div>

              {/* Invert toggle */}
              <div class="masking-panel__toggle-row">
                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.invert ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.invert ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, invert: e.currentTarget.checked }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Invert</span>
                </label>
              </div>

              {/* Reset parameters — only resets shape fields per Polarr spec */}
              <div class="masking-panel__chip-row" style={{ "margin-top": "8px" }}>
                <button
                  type="button"
                  class="masking-panel__chip"
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        target: 1,
                        range: 0.7,
                        smoothness: 1,
                        invert: false,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span>Reset Parameters</span>
                </button>
              </div>
            </div>
          </section>
        </Show>

        {/* ── depth mask settings ────── */}
        <Show when={isDepthMask()}>
          <section class="masking-panel__section" aria-label="Depth mask settings">
            <Show when={!getDepthMaskCapability().available}>
              <button
                class="masking-panel__empty"
                role="status"
              // title={getDepthUnavailableMessage(getDepthMaskCapability().reason) ?? undefined}
              >
                <strong>Depth Mask unavailable</strong>
              </button>
            </Show>
            <div class="masking-panel__card" classList={{ "is-disabled": !getDepthMaskCapability().available }}>
              <div class="masking-panel__card-head">
                <span class="masking-panel__card-title">Depth Range</span>
              </div>

              <div class="masking-panel__depth-preview-bar" aria-hidden="true" />
              <div class="masking-panel__tone-labels" aria-hidden="true">
                <span>Near</span>
                <span>Middle</span>
                <span>Far</span>
              </div>

              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Target</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.target ?? 1) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={1}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.target ?? 1}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, target: v, showOverlay: true }));
                      triggerOverlay();
                    }
                  }}
                  onChange={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, showOverlay: false }));
                    }
                  }}
                />
              </div>

              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Range</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.range ?? 0.25) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0.01}
                  max={1}
                  default={0.25}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.range ?? 0.25}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, range: v, showOverlay: true }));
                      triggerOverlay();
                    }
                  }}
                  onChange={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, showOverlay: false }));
                    }
                  }}
                />
              </div>

              <div class="masking-panel__toggle-row">
                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.invert ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.invert ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, invert: e.currentTarget.checked }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Invert</span>
                </label>
              </div>

              <div class="masking-panel__chip-row">
                <button
                  type="button"
                  class="masking-panel__chip"
                  onClick={() => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                        ...c,
                        target: 1,
                        range: 0.25,
                        invert: false,
                      }));
                      triggerOverlay();
                    }
                  }}
                >
                  <span>Reset Parameters</span>
                </button>
              </div>
            </div>
          </section>
        </Show>

        {/* ── color / threshold card (color-pick masks only) ─────────── */}
        <Show when={!isRadialMask() && !isGradientMask() && !isBrushMask() && !isLuminanceMask() && !isDepthMask()}>
          <section class="masking-panel__section" aria-label="Mask color">
            <div class="masking-panel__card">
              <div class="masking-panel__card-head">
                <span class="masking-panel__card-title">Color Range</span>
              </div>

              <HuePicker
                color={(selectedMask()?.components[0] as any)?.selectedColor ?? (selectedMask()?.components[0] as any)?.sampledColor ?? null}
                onInteractionStart={() => triggerOverlay(60_000)}
                onInteractionEnd={() => triggerOverlay(1_500)}
                onColorChange={(color) => {
                  const idx = selectedMaskIdx();
                  if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                    setEditState("localAdjustments", idx, "components", 0, (c: any) => ({
                      ...c,
                      sampledColor: color,
                      selectedColor: color,
                      useSelectedColor: true,
                    }));
                    triggerOverlay();
                  }
                }}
              />

              <div class="masking-panel__threshold">
                <div class="masking-panel__threshold-head">
                  <span class="masking-panel__label">Threshold</span>
                  <span class="masking-panel__value">
                    {Math.round(((selectedMask()?.components[0] as any)?.threshold ?? 0) * 100)}%
                  </span>
                </div>
                <FeatherSlider
                  min={0}
                  max={1}
                  default={0.05}
                  thumbGradient={{ from: "#8a5a5a", to: "#e60000" }}
                  value={(selectedMask()?.components[0] as any)?.threshold ?? 0.05}
                  onInput={(v) => {
                    const idx = selectedMaskIdx();
                    if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                      setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, threshold: v }));
                      triggerOverlay();
                    }
                  }}
                />
              </div>

              <div class="masking-panel__toggle-row">
                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.useRadius ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.useRadius ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, useRadius: e.currentTarget.checked }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Use Radius</span>
                </label>

                <label
                  class="masking-panel__toggle"
                  classList={{ "is-on": (selectedMask()?.components[0] as any)?.invert ?? false }}
                >
                  <input
                    type="checkbox"
                    checked={(selectedMask()?.components[0] as any)?.invert ?? false}
                    onChange={(e) => {
                      const idx = selectedMaskIdx();
                      if (idx !== -1 && localAdjustments()[idx].components.length > 0) {
                        setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, invert: e.currentTarget.checked }));
                        triggerOverlay();
                      }
                    }}
                  />
                  <span class="masking-panel__toggle-track" aria-hidden="true">
                    <span class="masking-panel__toggle-thumb" />
                  </span>
                  <span class="masking-panel__toggle-label">Invert</span>
                </label>
              </div>
            </div>
          </section>
        </Show>

        {/* ── local adjustment panels (accordion) — shared by all mask types ── */}
        <section class="masking-panel__section" aria-label="Local adjustments">
          <div class="masking-panel__section-head">
            <span class="masking-panel__section-title">Adjustments</span>
          </div>
          <div class="masking-panel__card masking-panel__accordion">
            <EditStateContext.Provider
              value={{
                get state() {
                  return selectedAdjustmentProxy;
                },
                get setState() {
                  return setSelectedAdjustmentState;
                },
              }}
            >
              <For
                each={PANELS.filter((p) =>
                  [
                    "balance",
                    "exposure",
                    "contrast",
                    "scattering",
                    "refraction",
                    "radiance",
                    "rgb",
                    "density",
                    "chroma",
                    "saturation",
                  ].includes(p.key),
                )}
              >
                {(panel) => {
                  const state = selectedAdjustmentState;
                  const setLocalMaskState = setSelectedAdjustmentState;
                  const wrapPreviewEditPatch = previewSelectedAdjustmentPatch;
                  const wrapClearPreviewPatch = clearSelectedAdjustmentPreview;

                  return (
                    <>
                      <PanelHeader
                        panel={panel}
                        open={openPanel() === panel.key}
                        edited={isPanelEdited(panel.key, state())}
                        bypassed={getPanelBypass(panel.key, state())}
                        helpVisible={helpPanel() === panel.key}
                        onToggle={() => setOpenPanel((c) => (c === panel.key ? null : panel.key))}
                        onHelp={() => {
                          setHelpPanel((c) => (c === panel.key ? null : panel.key));
                          if (openPanel() !== panel.key) setOpenPanel(panel.key);
                        }}
                        onBypass={() => togglePanelBypass(panel.key, state(), setLocalMaskState)}
                        onReset={() => resetPanel(panel.key, setLocalMaskState)}
                      />
                      <Show when={openPanel() === panel.key}>
                        <ActivePanel
                          panel={panel}
                          bypassed={getPanelBypass(panel.key, state())}
                          helpVisible={helpPanel() === panel.key}
                          previewEditPatch={wrapPreviewEditPatch}
                          previewCurveInput={previewSelectedCurveInput}
                          clearPreviewPatch={wrapClearPreviewPatch}
                        />
                      </Show>
                    </>
                  );
                }}
              </For>
            </EditStateContext.Provider>
          </div>
        </section>
      </Show>
      <Show when={menu()}>{(state) => <ContextMenu state={state()} onClose={closeMenu} />}</Show>
    </aside>
  );
}
