import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";

import { EDITOR_GRADIENT_OVERLAY_PRESETS } from "../../features/overlays/editorGradientOverlays";
import type { EditorOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import { OverlayEditorWindow } from "./OverlayEditorWindow";
import type { OverlayMaskType } from "./overlayMaskFactory";

type CustomTab = {
  id: string;
  label: string;
};

type PanelLayout = "bottom" | "side";

const CUSTOM_TABS_STORAGE_KEY = "poto-overlay-custom-tabs";
const BREAKPOINT_WIDTH = 900;
const SHORT_LANDSCAPE_HEIGHT = 520;
const MAX_PANEL_HEIGHT_LARGE = 320;
const MAX_PANEL_HEIGHT_COMPACT = 300;
const MIN_PANEL_HEIGHT = 198;
const COMPACT_HEIGHT_THRESHOLD = 620;
const COMPACT_MIN_PANEL_HEIGHT = 168;
const COMPACT_MAX_PANEL_HEIGHT = 228;
const MAX_CUSTOM_TAB_LABEL_LENGTH = 28;

function computeLayout(width: number, height: number): PanelLayout {
  if (width === 0 || height === 0) return "side";
  const shortLandscape = width > height && height <= SHORT_LANDSCAPE_HEIGHT;
  return width <= BREAKPOINT_WIDTH && !shortLandscape ? "bottom" : "side";
}

function computePanelHeight(width: number, height: number): number {
  const maxPanelHeight = width <= 640 ? MAX_PANEL_HEIGHT_COMPACT : MAX_PANEL_HEIGHT_LARGE;
  const baseHeight = Math.round(
    Math.min(maxPanelHeight, Math.max(MIN_PANEL_HEIGHT, height * 0.36)),
  );

  if (height <= COMPACT_HEIGHT_THRESHOLD) {
    return Math.round(
      Math.min(COMPACT_MAX_PANEL_HEIGHT, Math.max(COMPACT_MIN_PANEL_HEIGHT, height * 0.33)),
    );
  }

  return baseHeight;
}

export function OverlayPanel(props: {
  layers: readonly EditorOverlayLayer[];
  selectedLayerId: string | null;
  draftActive: boolean;
  onSelect(id: string): void;
  onImport(file: File, categoryId?: string): void;
  onUpdate(id: string, patch: Partial<EditorOverlayLayer>, commit?: boolean): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onAddGradient(presetId: string): void;
  onAddMask(id: string, type: OverlayMaskType): void;
  onEditMask(id: string): void;
  onRemoveMask(id: string): void;
  maskEditing: boolean;
  onConfirmMask(): void;
  onApply(): void;
  onCancel(): void;
  onBack(): void;
}) {
  let railRef: HTMLElement | undefined;

  const [activeCategory, setActiveCategory] = createSignal("custom");
  const [customTabs, setCustomTabs] = createSignal<CustomTab[]>([]);
  const [viewportSize, setViewportSize] = createSignal({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });

  const availableCategoryIds = createMemo(() => [
    "custom",
    "gradients",
    ...customTabs().map((tab) => tab.id),
  ]);

  const railLayout = createMemo<PanelLayout>(() => {
    const { width, height } = viewportSize();
    return computeLayout(width, height);
  });

  const railStyle = createMemo(() => {
    const { width, height } = viewportSize();
    if (railLayout() !== "bottom") return undefined;

    return {
      "--aside-viewport-width": `${Math.round(width)}px`,
      "--aside-viewport-height": `${Math.round(height)}px`,
      "--aside-panel-height": `${computePanelHeight(width, height)}px`,
    };
  });

  const activeTabLayers = createMemo(() => layersForCategory(props.layers, activeCategory()));

  const activeTabLabel = createMemo(() => {
    if (activeCategory() === "custom") return "Image overlays";
    if (activeCategory() === "gradients") return "Gradients";
    return customTabs().find((tab) => tab.id === activeCategory())?.label ?? "Overlay folder";
  });

  const activeTabDomId = createMemo(() => `overlay-source-tab-${activeCategory()}`);

  const editingTitle = createMemo(() => {
    if (props.maskEditing) return "Edit mask";
    return (
      props.layers.find((layer) => layer.id === props.selectedLayerId)?.name ??
      "Overlay settings"
    );
  });

  const importCategoryId = createMemo(() => {
    if (props.draftActive) {
      const selected = props.layers.find((layer) => layer.id === props.selectedLayerId);
      return selected?.categoryId && selected.categoryId !== "custom"
        ? selected.categoryId
        : undefined;
    }

    return activeCategory() === "custom" ? undefined : activeCategory();
  });

  onMount(() => {
    setCustomTabs(readCustomTabs());
  });

  onMount(() => {
    const rail = railRef;
    if (!rail) return;

    const appRoot = rail.closest("poto-app") as HTMLElement | null;

    const syncLayout = () => {
      const visualViewport = window.visualViewport;
      const nextSize = {
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      };
      const nextLayout = computeLayout(nextSize.width, nextSize.height);

      setViewportSize(nextSize);
      appRoot?.setAttribute("data-aside-layout", nextLayout);

      if (nextLayout === "bottom") {
        appRoot?.style.setProperty(
          "--aside-panel-height",
          `${computePanelHeight(nextSize.width, nextSize.height)}px`,
        );
      } else {
        appRoot?.style.removeProperty("--aside-panel-height");
      }
    };

    syncLayout();
    window.addEventListener("resize", syncLayout);
    window.addEventListener("orientationchange", syncLayout);
    window.visualViewport?.addEventListener("resize", syncLayout);

    onCleanup(() => {
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("orientationchange", syncLayout);
      window.visualViewport?.removeEventListener("resize", syncLayout);
      appRoot?.removeAttribute("data-aside-layout");
      appRoot?.style.removeProperty("--aside-panel-height");
    });
  });

  const selectCategory = (categoryId: string) => {
    setActiveCategory(categoryId);

    const firstLayer = layersForCategory(props.layers, categoryId)[0];
    if (firstLayer) props.onSelect(firstLayer.id);
  };

  const handleCategoryKeyDown = (event: KeyboardEvent) => {
    const ids = availableCategoryIds();
    const currentIndex = ids.indexOf(activeCategory());
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % ids.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = ids.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextId = ids[nextIndex];
    selectCategory(nextId);

    queueMicrotask(() => {
      railRef
        ?.querySelector<HTMLButtonElement>(`[data-category-id="${nextId}"]`)
        ?.focus();
    });
  };

  const handleCreateTab = () => {
    const requestedName = window.prompt("Name this overlay folder:");
    const label = requestedName?.trim().slice(0, MAX_CUSTOM_TAB_LABEL_LENGTH);
    if (!label) return;

    const existing = customTabs().find(
      (tab) => tab.label.localeCompare(label, undefined, { sensitivity: "accent" }) === 0,
    );

    if (existing) {
      selectCategory(existing.id);
      return;
    }

    const nextTab = {
      id: `custom_${Date.now().toString(36)}`,
      label,
    };
    const nextTabs = [...customTabs(), nextTab];

    setCustomTabs(nextTabs);
    writeCustomTabs(nextTabs);
    selectCategory(nextTab.id);
  };

  const removeTab = (tab: CustomTab, event: MouseEvent) => {
    event.stopPropagation();

    const layerCount = props.layers.filter((layer) => layer.categoryId === tab.id).length;
    const message =
      layerCount > 0
        ? `Remove “${tab.label}”? Its ${layerCount} layer${layerCount === 1 ? "" : "s"} will move to Image overlays.`
        : `Remove “${tab.label}”?`;

    if (!window.confirm(message)) return;

    for (const layer of props.layers) {
      if (layer.categoryId === tab.id) {
        props.onUpdate(layer.id, { categoryId: "custom" }, true);
      }
    }

    const nextTabs = customTabs().filter((item) => item.id !== tab.id);
    setCustomTabs(nextTabs);
    writeCustomTabs(nextTabs);

    if (activeCategory() === tab.id) selectCategory("custom");
  };

  const addGradient = (presetId: string) => {
    props.onAddGradient(presetId);
    setActiveCategory("custom");
  };

  return (
    <aside
      ref={railRef}
      class="adjustment-panels overlay-panel"
      data-layout={railLayout()}
      style={railStyle()}
    >
      <Show
        when={props.draftActive}
        fallback={
          <header class="masking-panel__header masking-panel__header--editing overlay-panel__header overlay-panel__header--browse">
            <button
              type="button"
              class="masking-panel__cancel-btn"
              aria-label="Back from overlays"
              onClick={props.onBack}
            >
              Back
            </button>
            <span class="masking-panel__editing-title">Overlays</span>
            <span class="overlay-panel__header-spacer" aria-hidden="true" />
          </header>
        }
      >
        <header class="masking-panel__header masking-panel__header--editing overlay-panel__header">
          <button type="button" class="masking-panel__cancel-btn" onClick={props.onCancel}>
            Cancel
          </button>
          <span class="masking-panel__editing-title" title={editingTitle()}>
            {editingTitle()}
          </span>
          <button
            type="button"
            class="action-button masking-panel__apply-btn"
            onClick={props.maskEditing ? props.onConfirmMask : props.onApply}
          >
            {props.maskEditing ? "Done" : "Apply"}
          </button>
        </header>
      </Show>

      <Show when={!props.draftActive}>
        <section
          class="masking-panel__section overlay-panel__section overlay-panel__source-section"
          aria-label="Overlay sources"
        >
          <div class="overlay-panel__section-title overlay-panel__section-title--actions">
            <button
              type="button"
              class="overlay-panel__add-tab-btn"
              aria-label="Create overlay folder"
              title="Create overlay folder"
              onClick={handleCreateTab}
            >
              <PlusIcon />
            </button>
          </div>

          <div class="overlay-panel__category-grid" role="tablist" aria-label="Overlay sources">
            <CategoryTab
              id="custom"
              label="Custom"
              active={activeCategory() === "custom"}
              onClick={() => selectCategory("custom")}
              onKeyDown={handleCategoryKeyDown}
            >
              <ImageIcon />
            </CategoryTab>

            <CategoryTab
              id="gradients"
              label="Gradients"
              active={activeCategory() === "gradients"}
              onClick={() => selectCategory("gradients")}
              onKeyDown={handleCategoryKeyDown}
            >
              <span class="overlay-panel__gradient-swatch" />
            </CategoryTab>

            <For each={customTabs()}>
              {(tab) => (
                <div class="overlay-category-wrap" role="presentation">
                  <CategoryTab
                    id={tab.id}
                    label={tab.label}
                    active={activeCategory() === tab.id}
                    onClick={() => selectCategory(tab.id)}
                    onKeyDown={handleCategoryKeyDown}
                  >
                    <FolderIcon />
                  </CategoryTab>
                  <button
                    type="button"
                    class="overlay-category-remove-btn"
                    aria-label={`Remove ${tab.label} folder`}
                    title={`Remove ${tab.label}`}
                    onClick={(event: MouseEvent) => removeTab(tab, event)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <div
        id="overlay-panel-content"
        class="overlay-panel__content"
        role="tabpanel"
        aria-labelledby={props.draftActive ? undefined : activeTabDomId()}
        aria-label={props.draftActive ? "Overlay settings" : undefined}
      >
        <Show when={!props.draftActive && activeCategory() === "gradients"}>
          <section class="masking-panel__section overlay-panel__section">
            <div class="masking-panel__section-head overlay-panel__preset-header">
              <div>
                <span class="masking-panel__section-title">Gradient overlays</span>
                <span class="masking-panel__section-count">
                  {EDITOR_GRADIENT_OVERLAY_PRESETS.length}
                </span>
              </div>
            </div>

            <p class="overlay-panel__section-hint">
              Choose a gradient, then position it and adjust its strength before applying.
            </p>

            <div class="overlay-panel__preset-grid">
              <For each={EDITOR_GRADIENT_OVERLAY_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="overlay-panel__preset-card"
                    title={`Add ${preset.name}`}
                    onClick={() => addGradient(preset.id)}
                  >
                    <span
                      class="overlay-panel__preset-preview"
                      style={{ background: preset.preview }}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.draftActive || activeCategory() !== "gradients"}>
          <OverlayEditorWindow
            layers={props.draftActive ? props.layers : activeTabLayers()}
            selectedLayerId={props.selectedLayerId}
            emptyTitle={activeCategory() === "custom" ? undefined : `${activeTabLabel()} is empty`}
            emptyDescription={
              activeCategory() === "custom"
                ? undefined
                : "Drop an image here or browse to add it to this folder."
            }
            onSelect={props.onSelect}
            onImport={(file) => props.onImport(file, importCategoryId())}
            onUpdate={props.onUpdate}
            onDelete={props.onDelete}
            onDuplicate={props.onDuplicate}
            onAddMask={props.onAddMask}
            onEditMask={props.onEditMask}
            onRemoveMask={props.onRemoveMask}
            maskEditing={props.maskEditing}
            onClose={props.onBack}
            mode="panel"
          />
        </Show>
      </div>
    </aside>
  );
}

function CategoryTab(props: {
  id: string;
  label: string;
  active: boolean;
  children: JSX.Element;
  onClick(): void;
  onKeyDown(event: KeyboardEvent): void;
}) {
  return (
    <button
      id={`overlay-source-tab-${props.id}`}
      type="button"
      role="tab"
      data-category-id={props.id}
      class="overlay-category-btn"
      classList={{ "overlay-category--active": props.active }}
      aria-selected={props.active}
      aria-controls="overlay-panel-content"
      tabIndex={props.active ? 0 : -1}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
    >
      <span class="overlay-panel__category-label" title={props.label}>
        {props.label}
      </span>
    </button>
  );
}

function layersForCategory(
  layers: readonly EditorOverlayLayer[],
  categoryId: string,
): EditorOverlayLayer[] {
  if (categoryId === "gradients") return [];

  if (categoryId === "custom") {
    return layers.filter((layer) => !layer.categoryId || layer.categoryId === "custom");
  }

  return layers.filter((layer) => layer.categoryId === categoryId);
}

function readCustomTabs(): CustomTab[] {
  try {
    const stored = localStorage.getItem(CUSTOM_TABS_STORAGE_KEY);
    if (!stored) return [];

    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return [];

    return value.filter(isCustomTab).map((tab) => ({
      id: tab.id,
      label: tab.label.slice(0, MAX_CUSTOM_TAB_LABEL_LENGTH),
    }));
  } catch {
    return [];
  }
}

function writeCustomTabs(tabs: readonly CustomTab[]): void {
  try {
    localStorage.setItem(CUSTOM_TABS_STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // The UI remains usable when storage is unavailable.
  }
}

function isCustomTab(value: unknown): value is CustomTab {
  if (!value || typeof value !== "object") return false;

  const id = Reflect.get(value, "id");
  const label = Reflect.get(value, "label");

  return (
    typeof id === "string" &&
    /^custom_[a-z0-9]+$/i.test(id) &&
    typeof label === "string" &&
    label.trim().length > 0
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}