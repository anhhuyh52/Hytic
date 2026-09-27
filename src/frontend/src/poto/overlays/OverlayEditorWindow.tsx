import {
  createMemo,
  createSignal,
  For,
  Show,
  onMount,
  onCleanup,
  type Accessor,
  type JSX,
} from "solid-js";

import { maskToolDefinitions } from "../../features/masking/maskToolRegistry";
import type {
  EditorOverlayBlendMode,
  EditorOverlayLayer,
  GradientOverlayLayer,
  ImageOverlayLayer,
} from "../../features/overlays/editorOverlayTypes";
import { EDITOR_OVERLAY_BLEND_MODES } from "../../features/overlays/editorOverlayTypes";
import {
  ContextMenu,
  openContextMenu,
  type ContextMenuState,
} from "../controls/ContextMenu";
import { overlayMaskLabel, type OverlayMaskType } from "./overlayMaskFactory";
import { GradientSlider } from "../controls/GradientSlider";
import { Select } from "@kobalte/core/select";
import { saveOverlayToLibrary } from "./overlayLibraryUtils";
import { listOverlayLibraryItems, deleteOverlayLibraryItem } from "../../project/indexedDbProjectStore";
import type { OverlayLibraryItem } from "../../project/ProjectTypes";

const OVERLAY_GREY_GRADIENT = [
  { position: 0, color: "#484848" },
  { position: 1, color: "#777777" },
] as const;

type OverlayPatch = Partial<
  Pick<
    EditorOverlayLayer,
    | "name"
    | "position"
    | "scale"
    | "angle"
    | "blendMode"
    | "opacity"
    | "fill"
    | "visible"
    | "mask"
    | "locked"
  >
>;

type OverlayMask = NonNullable<EditorOverlayLayer["mask"]>;

const resetTransform = (layer: EditorOverlayLayer): Pick<EditorOverlayLayer, "position" | "scale" | "angle"> => ({
  position: [0.5, 0.5],
  scale: layer.type === "gradient" ? [1, 1] : [0.5, 0.5],
  angle: 0,
});

export function OverlayEditorWindow(props: {
  layers: readonly EditorOverlayLayer[];
  selectedLayerId: string | null;
  onSelect(id: string): void;
  onImport(file: File): void;
  onUpdate(id: string, patch: OverlayPatch, commit?: boolean): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onAddMask?(id: string, type: OverlayMaskType): void;
  onEditMask?(id: string): void;
  onRemoveMask?(id: string): void;
  maskEditing?: boolean;
  onClose(): void;
  mode?: "dialog" | "panel";
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  let fileInput!: HTMLInputElement;
  let dragDepth = 0;

  const [menu, setMenu] = createSignal<ContextMenuState | null>(null);
  const [dragActive, setDragActive] = createSignal(false);
  const [libraryItems, setLibraryItems] = createSignal<OverlayLibraryItem[]>([]);

  onMount(() => {
    listOverlayLibraryItems().then(setLibraryItems);
  });

  const isPanel = () => props.mode === "panel";
  const selected = createMemo(() =>
    props.layers.find((layer) => layer.id === props.selectedLayerId),
  );
  const reversedLayers = createMemo(() => [...props.layers].reverse());



  const updateMask = (
    layer: EditorOverlayLayer,
    patch: Record<string, unknown>,
    commit = false,
  ) => {
    if (!layer.mask) return;
    props.onUpdate(
      layer.id,
      { mask: { ...layer.mask, ...patch } as EditorOverlayLayer["mask"] },
      commit,
    );
  };

  const chooseFile = () => {
    fileInput.value = "";
    fileInput.click();
  };

  const importFile = async (file: File | undefined) => {
    if (file && isImageFile(file)) {
      try {
        const item = await saveOverlayToLibrary(file);
        setLibraryItems((prev) => [item, ...prev]);
      } catch (e) {
        console.error("Failed to save overlay to library", e);
      }
      props.onImport(file);
    }
  };

  const handleDragEnter = (event: DragEvent) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragActive(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth = 0;
    setDragActive(false);
    importFile(event.dataTransfer?.files[0]);
  };

  function openMaskMenu(layer: EditorOverlayLayer, event: MouseEvent) {
    const options = maskToolDefinitions.map((tool) => ({
      ...tool,
      state: tool.availability(),
    }));

    const html = [
      "<context-title>Add mask</context-title>",
      ...options.map(({ type, label, state }) => {
        const reason = state.reason ? ` title="${escapeHtml(state.reason)}"` : "";
        return `<context-item data-action="${escapeHtml(String(type))}"${state.enabled ? "" : " disabled"
          }${reason}>${escapeHtml(label)}${state.loading ? " — Loading…" : ""}</context-item>`;
      }),
    ].join("");

    const actions = Object.fromEntries(
      options.map(({ type, state }) => [
        type,
        {
          action: () => {
            if (state.enabled) props.onAddMask?.(layer.id, type as OverlayMaskType);
          },
        },
      ]),
    );

    setMenu(openContextMenu(event, html, actions));
  }

  function openLayerMenu(layer: EditorOverlayLayer, event: MouseEvent) {
    event.preventDefault();

    setMenu(
      openContextMenu(
        event,
        `<context-title>${escapeHtml(layer.name)}</context-title>
         <context-item data-action="duplicate">Duplicate</context-item>
         <context-item data-action="visibility">${layer.visible ? "Hide" : "Show"}</context-item>
         <context-item data-action="lock">${layer.locked ? "Unlock" : "Lock"}</context-item>
         <context-separator></context-separator>
         <context-item data-action="flip-x">Flip horizontally</context-item>
         <context-item data-action="flip-y">Flip vertically</context-item>
         <context-item data-action="rotate-left">Rotate left</context-item>
         <context-item data-action="rotate-right">Rotate right</context-item>
         <context-item data-action="reset">Reset transform</context-item>
         <context-separator></context-separator>
         <context-item data-action="delete" class="danger">Delete</context-item>`,
        {
          duplicate: { action: () => props.onDuplicate(layer.id) },
          visibility: {
            action: () => props.onUpdate(layer.id, { visible: !layer.visible }, true),
          },
          lock: {
            action: () => props.onUpdate(layer.id, { locked: !layer.locked }, true),
          },
          "flip-x": {
            action: () =>
              props.onUpdate(layer.id, { scale: [-layer.scale[0], layer.scale[1]] }, true),
          },
          "flip-y": {
            action: () =>
              props.onUpdate(layer.id, { scale: [layer.scale[0], -layer.scale[1]] }, true),
          },
          "rotate-left": {
            action: () =>
              props.onUpdate(layer.id, { angle: normalizeAngle(layer.angle - 90) }, true),
          },
          "rotate-right": {
            action: () =>
              props.onUpdate(layer.id, { angle: normalizeAngle(layer.angle + 90) }, true),
          },
          reset: {
            action: () => props.onUpdate(layer.id, resetTransform(layer), true),
          },
          delete: { action: () => props.onDelete(layer.id) },
        },
      ),
    );
  }

  return (
    <section
      class="overlay-editor-window"
      classList={{
        "overlay-editor-window--panel": isPanel(),
        "overlay-editor-window--dragging": dragActive(),
      }}
      role={isPanel() ? "region" : "dialog"}
      aria-label="Overlay editor"
      aria-modal={isPanel() ? undefined : "true"}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Show when={!isPanel()}>
        <header class="overlay-editor-window__header">
          <div>
            <span class="overlay-editor-window__eyebrow">Editor overlay</span>
            <h2>Overlays</h2>
          </div>
          <div class="overlay-editor-window__header-actions">
            <IconButton label="Import image overlay" onClick={chooseFile}>
              <PlusIcon />
            </IconButton>
            <IconButton label="Close overlays" onClick={props.onClose}>
              <CloseIcon />
            </IconButton>
          </div>
        </header>
      </Show>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event: Event & { currentTarget: HTMLInputElement }) =>
          importFile(event.currentTarget.files?.[0])
        }
      />

      <Show
        when={selected()}
        fallback={
          <EmptyOverlayState
            hasLayers={props.layers.length > 0}
            dragActive={dragActive()}
            title={props.emptyTitle}
            description={props.emptyDescription}
            libraryItems={libraryItems()}
            onBrowse={chooseFile}
            onSelectLibraryItem={(item) => props.onImport(item.blob as File)}
            onDeleteLibraryItem={async (item) => {
              await deleteOverlayLibraryItem(item.id);
              setLibraryItems((prev) => prev.filter((i) => i.id !== item.id));
            }}
          />
        }
      >
        {(layer: Accessor<EditorOverlayLayer>) => (
          <div class="overlay-editor-window__body">
            <div class="overlay-editor-summary">
              <Show when={layer().type === "image"}>
                <img src={(layer() as ImageOverlayLayer).sourceDataUrl} alt="" />
              </Show>
              <Show when={layer().type === "gradient"}>
                <div class="overlay-editor-summary__gradient-preview" style={{ background: gradientPreview(layer() as GradientOverlayLayer) }} />
              </Show>
              <div class="overlay-editor-summary__copy">
                <strong title={layer().name}>{layer().name}</strong>
                <span>
                  {formatBlendMode(layer().blendMode)} · {formatPercent(layer().opacity)}
                </span>
              </div>
              <IconButton
                label={`Actions for ${layer().name}`}
                onClick={(event) => openLayerMenu(layer(), event)}
              >
                <MoreIcon />
              </IconButton>
            </div>

            <Show when={!props.maskEditing}>
              <RangeControl
                label="Opacity"
                value={layer().opacity}
                format={formatPercent}
                onInput={(value) => props.onUpdate(layer().id, { opacity: value })}
                onCommit={(value) => props.onUpdate(layer().id, { opacity: value }, true)}
              />

              <Show when={layer().type === "gradient"}>
                <RangeControl
                  label="Fill"
                  value={layer().fill}
                  format={formatPercent}
                  onInput={(value) => props.onUpdate(layer().id, { fill: value })}
                  onCommit={(value) => props.onUpdate(layer().id, { fill: value }, true)}
                />
              </Show>

              <label class="overlay-editor-control">
                <span>Blend mode</span>
                <Select<EditorOverlayBlendMode>
                  class="poto-space-select"
                  options={[...EDITOR_OVERLAY_BLEND_MODES]}
                  value={layer().blendMode}
                  onChange={(mode) => mode && props.onUpdate(layer().id, { blendMode: mode }, true)}
                  placement="bottom-end"
                  itemComponent={(itemProps) => (
                    <Select.Item class="poto-space-select__item" item={itemProps.item}>
                      <Select.ItemLabel>{formatBlendMode(itemProps.item.rawValue)}</Select.ItemLabel>
                      <Select.ItemIndicator class="poto-space-select__item-indicator">
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m3 8.2 3.1 3.1L13 4.8" />
                        </svg>
                      </Select.ItemIndicator>
                    </Select.Item>
                  )}
                >
                  <Select.HiddenSelect />
                  <Select.Trigger class="poto-space-select__trigger" style={{ flex: 1, padding: "0 6px", height: "24px", "min-height": "24px", "justify-content": "space-between" }}>
                    <Select.Value<EditorOverlayBlendMode> class="poto-space-select__value">
                      {(state) => formatBlendMode(state.selectedOption())}
                    </Select.Value>
                    <Select.Icon class="poto-space-select__icon">
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m4 6 4 4 4-4" />
                      </svg>
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content class="poto-space-select__content">
                      <Select.Listbox class="poto-space-select__listbox" />
                    </Select.Content>
                  </Select.Portal>
                </Select>
              </label>

              <div class="overlay-editor-mask-summary">
                <div>
                  <span>Mask</span>
                  <small>{overlayMaskLabel(layer().mask)}</small>
                </div>
                <Show
                  when={layer().mask}
                  fallback={
                    <button
                      type="button"
                      class="overlay-editor-link-btn"
                      onClick={(event: MouseEvent) => openMaskMenu(layer(), event)}
                    >
                      Add mask
                    </button>
                  }
                >
                  <div class="overlay-editor-inline-actions">
                    <button
                      type="button"
                      class="overlay-editor-link-btn"
                      onClick={() => props.onEditMask?.(layer().id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="overlay-editor-link-btn overlay-editor-link-btn--danger"
                      onClick={() => props.onRemoveMask?.(layer().id)}
                    >
                      Remove
                    </button>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={props.maskEditing && layer().mask ? layer().mask : null}>
              {(mask: Accessor<OverlayMask>) => (
                <MaskControls
                  mask={mask()}
                  onInput={(patch) => updateMask(layer(), patch)}
                  onCommit={(patch) => updateMask(layer(), patch, true)}
                />
              )}
            </Show>

            <Show when={!props.maskEditing}>
              <div class="overlay-editor-transform-summary">
                <span>Transform</span>
                <output>{Math.round(normalizeAngle(layer().angle))}°</output>
                <button
                  type="button"
                  class="overlay-editor-link-btn"
                  onClick={() => props.onUpdate(layer().id, resetTransform(layer()), true)}
                >
                  Reset
                </button>
              </div>
            </Show>
          </div>
        )}
      </Show>

      <Show when={props.layers.length > 0}>
        <section class="overlay-layer-list" aria-label="Overlay layers">
          <div class="overlay-layer-list__title">
            <span>
              Layers <small>{props.layers.length}</small>
            </span>
            <IconButton label="Import another overlay" onClick={chooseFile} compact>
              <PlusIcon />
            </IconButton>
          </div>

          <div class="overlay-layer-list__items" role="list">
            <For each={reversedLayers()}>
              {(layer) => (
                <div
                  class="overlay-layer-row"
                  classList={{
                    selected: layer.id === props.selectedLayerId,
                    "is-hidden": !layer.visible,
                  }}
                  role="listitem"
                  onContextMenu={(event: MouseEvent) => openLayerMenu(layer, event)}
                >
                  <button
                    type="button"
                    class="overlay-layer-row__select"
                    aria-current={layer.id === props.selectedLayerId ? "true" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onSelect(layer.id);
                    }}
                  >
                    <Show when={layer.type === "image"}>
                      <img src={(layer as ImageOverlayLayer).sourceDataUrl} alt="" />
                    </Show>
                    <Show when={layer.type === "gradient"}>
                      <div class="overlay-layer-row__gradient-preview" style={{ background: gradientPreview(layer as GradientOverlayLayer) }} />
                    </Show>
                    <span class="overlay-layer-row__copy">
                      <strong title={layer.name}>{layer.name}</strong>
                      <small>
                        {formatBlendMode(layer.blendMode)} · {formatPercent(layer.opacity)}
                      </small>
                    </span>
                  </button>

                  <IconButton
                    label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                    pressed={layer.visible}
                    compact
                    class="overlay-layer-row__visibility-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onUpdate(layer.id, { visible: !layer.visible }, true);
                    }}
                  >
                    {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
                  </IconButton>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={dragActive()}>
        <div class="overlay-editor-drop-indicator" aria-hidden="true">
          Drop image to import
        </div>
      </Show>

      <Show when={menu()}>
        {(state: Accessor<ContextMenuState>) => (
          <ContextMenu state={state()} onClose={() => setMenu(null)} />
        )}
      </Show>
    </section>
  );
}

function MaskControls(props: {
  mask: OverlayMask;
  onInput(patch: Record<string, unknown>): void;
  onCommit(patch: Record<string, unknown>): void;
}) {
  const mask = () => props.mask;

  return (
    <section class="overlay-mask-controls" aria-label={`${overlayMaskLabel(mask())} controls`}>
      <div class="overlay-mask-controls__header">
        <div>
          <span>Mask controls</span>
          <small>{overlayMaskLabel(mask())}</small>
        </div>
      </div>

      <Show
        when={mask().type !== "depth"}
        fallback={
          <p class="overlay-mask-controls__note">
            Depth masking is generated automatically from the current image.
          </p>
        }
      >
        <Show when={hasProperty(mask(), "target")}>
          <MaskRange
            label="Target"
            mask={mask()}
            property="target"
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
        </Show>

        <Show when={hasProperty(mask(), "range")}>
          <MaskRange
            label="Range"
            mask={mask()}
            property="range"
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
        </Show>

        <Show when={hasProperty(mask(), "smoothness")}>
          <MaskRange
            label="Smoothness"
            mask={mask()}
            property="smoothness"
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
        </Show>

        <Show when={mask().type === "radial" || mask().type === "color-pick"}>
          <MaskRange
            label="Feather"
            mask={mask()}
            property="feather"
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
        </Show>

        <Show when={mask().type === "color-pick"}>
          <MaskRange
            label="Threshold"
            mask={mask()}
            property="threshold"
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
        </Show>

        <Show when={mask().type === "brush"}>
          <MaskRange
            label="Brush size"
            mask={mask()}
            property="brush_radius"
            min={0.01}
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
          <MaskRange
            label="Flow"
            mask={mask()}
            property="brush_opacity"
            onInput={props.onInput}
            onCommit={props.onCommit}
          />
          <ToggleControl
            label="Erase"
            checked={readBoolean(mask(), "brush_erase")}
            onChange={(checked) => props.onCommit({ brush_erase: checked })}
          />
        </Show>

        <Show when={mask().type === "gradient"}>
          <ToggleControl
            label="Reflect"
            checked={readBoolean(mask(), "reflect")}
            onChange={(checked) => props.onCommit({ reflect: checked })}
          />
        </Show>

        <ToggleControl
          label="Invert mask"
          checked={readBoolean(mask(), "invert")}
          onChange={(checked) => props.onCommit({ invert: checked })}
        />
      </Show>
    </section>
  );
}

function MaskRange(props: {
  label: string;
  mask: OverlayMask;
  property: string;
  min?: number;
  max?: number;
  step?: number;
  onInput(patch: Record<string, unknown>): void;
  onCommit(patch: Record<string, unknown>): void;
}) {
  const value = () => readNumber(props.mask, props.property);

  return (
    <RangeControl
      label={props.label}
      value={value()}
      min={props.min}
      max={props.max}
      step={props.step}
      format={formatPercent}
      onInput={(next) => props.onInput({ [props.property]: next })}
      onCommit={(next) => props.onCommit({ [props.property]: next })}
    />
  );
}

function RangeControl(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?(value: number): string;
  onInput(value: number): void;
  onCommit(value: number): void;
}) {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 1;

  return (
    <div class="overlay-editor-control" style={{ display: "block" }}>
      <GradientSlider
        label={props.label}
        value={props.value}
        min={min()}
        max={max()}
        default={(min() + max()) / 2}
        format={props.format ?? formatDecimal}
        gradientStops={OVERLAY_GREY_GRADIENT}
        onInput={props.onInput}
        onChange={props.onCommit}
      />
    </div>
  );
}

function ToggleControl(props: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label class="overlay-editor-toggle">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event: Event & { currentTarget: HTMLInputElement }) =>
          props.onChange(event.currentTarget.checked)
        }
      />
    </label>
  );
}

function EmptyOverlayState(props: {
  hasLayers: boolean;
  dragActive: boolean;
  title?: string;
  description?: string;
  libraryItems: OverlayLibraryItem[];
  onBrowse(): void;
  onSelectLibraryItem(item: OverlayLibraryItem): void;
  onDeleteLibraryItem(item: OverlayLibraryItem): void;
}) {
  const title = () =>
    props.hasLayers ? "Select an overlay" : props.title ?? "No image overlays yet";
  const description = () =>
    props.hasLayers
      ? "Choose a layer below to edit its appearance."
      : props.description ?? "Drop an image here or browse from your device.";

  return (
    <div class="overlay-editor-empty-container">
      <Show when={props.libraryItems.length > 0}>
        <div class="overlay-editor-library-grid" style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(72px, 1fr))", gap: "8px", "margin-bottom": "16px", width: "100%" }}>
          <For each={props.libraryItems}>
            {(item) => {
              const url = URL.createObjectURL(item.thumbnailBlob);
              onCleanup(() => URL.revokeObjectURL(url));
              return (
                <div class="overlay-editor-library-item" style={{ position: "relative", "aspect-ratio": "1", "border-radius": "6px", overflow: "hidden", background: "var(--ui-bg-100)", border: "1px solid var(--ui-line-050)" }}>
                  <button type="button" onClick={() => props.onSelectLibraryItem(item)} title={item.name} style={{ display: "block", width: "100%", height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                    <img src={url} alt={item.name} style={{ display: "block", width: "100%", height: "100%", "object-fit": "cover" }} />
                  </button>
                  <button
                    type="button"
                    class="overlay-editor-library-item__delete"
                    title="Remove from library"
                    onClick={() => props.onDeleteLibraryItem(item)}
                    style={{ position: "absolute", top: "4px", right: "4px", width: "20px", height: "20px", padding: "3px", background: "rgba(0,0,0,0.6)", border: "none", "border-radius": "50%", color: "#fff", cursor: "pointer", display: "flex", "align-items": "center", "justify-content": "center" }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <div class="overlay-editor-empty-container__label">Your overlays</div>
      <button
        type="button"
        class="overlay-editor-empty-card"
        classList={{ "overlay-editor-empty-card--dragging": props.dragActive }}
        onClick={props.onBrowse}
      >
        <div class="overlay-editor-empty-card__icon" aria-hidden="true">
          <UploadIcon />
        </div>
        <h3>{title()}</h3>
        <p>{description()}</p>
        <Show when={!props.hasLayers}>
          <span class="editor-btn editor-btn--primary">Browse images</span>
        </Show>
      </button>
    </div>
  );
}

function IconButton(props: {
  label: string;
  onClick(event: MouseEvent): void;
  children: JSX.Element;
  pressed?: boolean;
  compact?: boolean;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={`editor-icon-btn${props.compact ? " editor-icon-btn--compact" : ""}${props.class ? ` ${props.class}` : ""
        }`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function formatBlendMode(mode: EditorOverlayBlendMode): string {
  return mode
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_match, _prefix, letter: string) => ` ${letter.toUpperCase()}`)
    .trim();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDecimal(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function normalizeAngle(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function hasProperty<T extends object>(value: T, property: PropertyKey): boolean {
  return property in value;
}

function readNumber(value: object, property: PropertyKey, fallback = 0): number {
  const result = Reflect.get(value, property);
  return typeof result === "number" && Number.isFinite(result) ? result : fallback;
}

function readBoolean(value: object, property: PropertyKey, fallback = false): boolean {
  const result = Reflect.get(value, property);
  return typeof result === "boolean" ? result : fallback;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5M12 3v12" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m3 3 18 18" />
      <path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-2.1 3.1M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function gradientPreview(layer: GradientOverlayLayer): string {
  const stops = [...layer.gradientConfig.stops]
    .sort((left, right) => left.position - right.position)
    .map((stop) => `rgba(${stop.color[0] * 255},${stop.color[1] * 255},${stop.color[2] * 255},${stop.color[3]}) ${stop.position * 100}%`)
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}
