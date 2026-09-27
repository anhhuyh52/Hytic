import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { JSX } from "solid-js";
import { Popover } from "@kobalte/core/popover";
import { Select } from "@kobalte/core/select";
import { lookToPresetData } from "../spectraGenerator";
import { snapshotLook } from "../applyPreset";
import { closePresetEditor, presetEditorRequest } from "../presetEditorStore";
import {
  presetPackNames,
  savePresetFromEditor,
  type FlatPreset,
} from "../presetPacksStore";

const SELECT_PACK = "_: :_";
const CREATE_PACK = "_::+::_";

const CSS = `
  .poto-preset-editor {
    z-index: 96;
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: 8px;
    border: 1px solid #34343a;
    background: #222226;
    color: #d2d2d4;
    box-shadow: 0 12px 42px rgba(0, 0, 0, 0.44);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    outline: none;
  }

  .poto-preset-editor *,
  .poto-preset-editor *::before,
  .poto-preset-editor *::after {
    box-sizing: border-box;
  }

  .poto-preset-editor__header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e6e6e9;
    font-size: 14px;
    font-weight: 750;
  }

  .poto-preset-editor__header img {
    width: 20px;
    height: 20px;
    opacity: 0.76;
  }

  .poto-preset-editor__description {
    margin: 0;
    color: #a5a5aa;
    opacity: 0.72;
    font-size: 12px;
    line-height: 1.48;
  }

  .poto-preset-editor__field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .poto-preset-editor__label {
    color: #a5a5aa;
    opacity: 0.75;
    font-size: 11px;
    font-weight: 650;
  }

  .poto-preset-editor__input,
  .poto-preset-editor__select {
    width: 100%;
    min-height: 34px;
    border-radius: 7px;
    border: 1px solid #34343a;
    background: #29292e;
    color: #f4f4f5;
    padding: 0 9px;
    font: inherit;
    font-size: 12px;
    outline: none;
  }

  .poto-preset-editor__input:focus,
  .poto-preset-editor__select:focus {
    border-color: #4d4d54;
    outline: 1px solid #8a8a93;
    outline-offset: 1px;
  }

  .poto-preset-editor__input.error,
  .poto-preset-editor__select.error {
    border-color: #c96f63;
    outline-color: #c96f63;
  }

  .poto-preset-editor__actions {
    display: flex;
    justify-content: center;
    gap: 12px;
    padding-top: 6px;
  }

  .poto-preset-editor__button {
    min-height: 34px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid #34343a;
    background: #29292e;
    color: #d2d2d4;
    font: inherit;
    font-size: 12px;
    font-weight: 750;
    cursor: pointer;
  }

  .poto-preset-editor__button--primary {
    border-color: #4d4d54;
    background: #2b2b30;
    color: #e6e6e9;
  }

  .poto-preset-editor__button:disabled,
  .poto-preset-editor[aria-busy="true"] .poto-preset-editor__field {
    opacity: 0.55;
    cursor: wait;
  }

  .poto-preset-editor__button.loading::after {
    content: "";
    width: 11px;
    height: 11px;
    margin-left: 8px;
    display: inline-block;
    vertical-align: -1px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: poto-preset-editor-spin 800ms linear infinite;
  }

  @keyframes poto-preset-editor-spin {
    to { transform: rotate(360deg); }
  }

  .poto-preset-editor__select-content {
    background: #29292e;
    border: 1px solid #34343a;
    border-radius: 7px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.44);
    padding: 4px;
    z-index: 100;
  }
  .poto-preset-editor__select-listbox {
    outline: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .poto-preset-editor__select-item {
    padding: 6px 9px;
    color: #f4f4f5;
    font-size: 12px;
    border-radius: 4px;
    cursor: default;
    outline: none;
  }
  .poto-preset-editor__select-item[data-highlighted] {
    background: #3f3f46;
  }
  .poto-preset-editor__select-item[data-disabled] {
    opacity: 0.5;
  }
  .poto-preset-editor__select-trigger {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
`;

type FieldKey = "name" | "description" | "pack" | "newPack";
type Errors = Partial<Record<FieldKey, string>>;

function isFlatPreset(value: unknown): value is FlatPreset {
  return !!value && typeof value === "object" && "entry" in value && "packSlug" in value;
}

function nextCreateName(name: string): string {
  const source = name === "Custom" ? "Custom Preset" : name;
  return source.replace(/(\d*)$/, (_match, digits: string) =>
    digits ? String(Number.parseInt(digits, 10) + 1).padStart(digits.length, "0") : " 2",
  );
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function PresetEditor(): JSX.Element {
  return (
    <Show when={presetEditorRequest()}>
      {(request) => <PresetEditorDialog request={request()} />}
    </Show>
  );
}

function PresetEditorDialog(props: { request: NonNullable<ReturnType<typeof presetEditorRequest>> }) {
  const request = () => props.request;
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [pack, setPack] = createSignal(SELECT_PACK);
  const [newPack, setNewPack] = createSignal("");
  const [errors, setErrors] = createSignal<Errors>({});
  const [saving, setSaving] = createSignal(false);
  const [dialogStyle, setDialogStyle] = createSignal<Record<string, string>>({});
  const [positioned, setPositioned] = createSignal(false);
  const packNames = createMemo(() => presetPackNames());
  let dialog!: HTMLElement;
  let nameInput!: HTMLInputElement;

  createEffect(() => {
    const source = request().preset;
    setName(request().mode === "create" ? nextCreateName(source.name) : source.name);
    setDescription(source.meta?.description ?? "");
    setPack(request().mode === "update" && isFlatPreset(source) ? source.packSlug : SELECT_PACK);
    setNewPack("");
    setErrors({});
    setSaving(false);
  });

  function clearError(field: FieldKey) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validate(): boolean {
    const next: Errors = {};
    const cleanName = name().trim();
    const cleanDescription = description();
    const selectedPack = pack();
    const cleanNewPack = newPack().trim();
    const existingPackNames = packNames();

    if (!cleanName) next.name = "Name is required";
    else if (cleanName.length > 64) next.name = "Name is too long";
    if (cleanDescription.length > 96) next.description = "Description is too long";
    if (selectedPack === SELECT_PACK) next.pack = "Pack is required";
    if (selectedPack === CREATE_PACK) {
      if (!cleanNewPack) next.newPack = "Enter a pack name";
      else if (cleanNewPack.length > 32) next.newPack = "Pack name is too long";
      else if (existingPackNames.some((packName) => packName === cleanNewPack)) {
        next.newPack = "Pack name already exists";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (saving() || !validate()) return;
    setSaving(true);
    await frame();
    const selectedPack = pack();
    const targetPack = selectedPack === CREATE_PACK ? newPack().trim() : selectedPack;
    const source = request().preset;
    savePresetFromEditor({
      mode: request().mode,
      source: isFlatPreset(source) ? source : undefined,
      name: name(),
      description: description(),
      packName: targetPack,
      data: request().useActiveImageState ? lookToPresetData(snapshotLook()) : source.data,
      generated: source.meta?.generated,
    });
    closePresetEditor();
  }

  function cancel() {
    if (!saving()) closePresetEditor();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void save();
    }
  }

  function positionDialog() {
    const anchor = request().anchor;
    if (!anchor) {
      setDialogStyle({});
      setPositioned(true);
      return;
    }

    const rect = dialog.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (viewportWidth <= viewportHeight) {
      setDialogStyle({
        position: "absolute",
        left: `${Math.max(5, (viewportWidth - rect.width) / 2)}px`,
        top: `${Math.max(5, (viewportHeight - rect.height) / 2)}px`,
        "transform-origin": "center center",
      });
      setPositioned(true);
      return;
    }

    const opensRight = anchor.x + rect.width + 5 <= viewportWidth;
    const opensDown = anchor.y + rect.height + 5 <= viewportHeight;
    const left = opensRight ? anchor.x : anchor.x - rect.width;
    const top = opensDown ? anchor.y : anchor.y - rect.height;
    setDialogStyle({
      position: "absolute",
      left: `${Math.max(5, Math.min(left, viewportWidth - rect.width - 5))}px`,
      top: `${Math.max(5, Math.min(top, viewportHeight - rect.height - 5))}px`,
      "transform-origin": `${opensRight ? "left" : "right"} ${opensDown ? "top" : "bottom"}`,
    });
    setPositioned(true);
  }

  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", positionDialog);
    requestAnimationFrame(() => {
      positionDialog();
      nameInput.focus();
      nameInput.select();
    });
  });

  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", positionDialog);
  });

  type SelectOption = { value: string; label: string };

  const selectOptions = createMemo<SelectOption[]>(() => {
    return [
      { value: CREATE_PACK, label: "Create New Pack" },
      ...packNames().map((name) => ({ value: name, label: name })),
    ];
  });

  const selectedOption = createMemo(() => {
    const p = pack();
    return selectOptions().find((o) => o.value === p) || null;
  });

  return (
    <Popover open={true} onOpenChange={(isOpen) => !isOpen && cancel()}>
      <Popover.Portal>
        <style>{CSS}</style>
        <Popover.Content
          ref={(el) => (dialog = el as HTMLElement)}
          class="poto-preset-editor"
          aria-busy={saving() ? "true" : "false"}
          style={{ ...dialogStyle(), visibility: positioned() ? "visible" : "hidden" }}
        >
          <header class="poto-preset-editor__header">
            <img src="/assets/icons/presets_icon.svg" alt="" />
            <Popover.Title as="span">Save Preset</Popover.Title>
          </header>
          <Popover.Description class="poto-preset-editor__description">
            You can customize presets and save them in your local library on this device.
          </Popover.Description>

          <label class="poto-preset-editor__field">
            <span class="poto-preset-editor__label">{errors().name ?? "Name"}</span>
            <input
              ref={(el) => (nameInput = el)}
              class="poto-preset-editor__input"
              classList={{ error: !!errors().name }}
              data-setting="name"
              type="text"
              spellcheck={false}
              placeholder="New Preset"
              value={name()}
              disabled={saving()}
              onInput={(event) => {
                setName(event.currentTarget.value);
                clearError("name");
              }}
            />
          </label>

          <label class="poto-preset-editor__field">
            <span class="poto-preset-editor__label">
              {errors().description ?? "Description (optional)"}
            </span>
            <input
              class="poto-preset-editor__input"
              classList={{ error: !!errors().description }}
              data-setting="description"
              type="text"
              spellcheck={false}
              placeholder="What does it do?"
              value={description()}
              disabled={saving()}
              onInput={(event) => {
                setDescription(event.currentTarget.value);
                clearError("description");
              }}
            />
          </label>

          <div class="poto-preset-editor__field">
            <span class="poto-preset-editor__label">
              {errors().pack ?? errors().newPack ?? "Pack"}
            </span>
            <Select<SelectOption>
              options={selectOptions()}
              optionValue="value"
              optionTextValue="label"
              value={selectedOption()}
              onChange={(option) => {
                if (option) {
                  setPack(option.value);
                  clearError("pack");
                  clearError("newPack");
                }
              }}
              disabled={saving()}
              placeholder="Select Pack"
              itemComponent={(props) => (
                <Select.Item item={props.item} class="poto-preset-editor__select-item">
                  <Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
                </Select.Item>
              )}
            >
              <Select.Trigger
                class="poto-preset-editor__select poto-preset-editor__select-trigger"
                classList={{ error: !!errors().pack }}
              >
                <Select.Value<SelectOption>>
                  {(state) => state.selectedOption()?.label ?? "Select Pack"}
                </Select.Value>
                <Select.Icon>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                    <path d="M4 6h8l-4 4-4-4z" />
                  </svg>
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content class="poto-preset-editor__select-content">
                  <Select.Listbox class="poto-preset-editor__select-listbox" />
                </Select.Content>
              </Select.Portal>
            </Select>
            <Show when={pack() === CREATE_PACK}>
              <input
                class="poto-preset-editor__input"
                classList={{ error: !!errors().newPack }}
                data-setting="new-pack"
                type="text"
                spellcheck={false}
                placeholder="New Pack"
                value={newPack()}
                disabled={saving()}
                onInput={(event) => {
                  setNewPack(event.currentTarget.value);
                  clearError("newPack");
                }}
              />
            </Show>
          </div>

          <div class="poto-preset-editor__actions">
            <button
              class="poto-preset-editor__button"
              data-action="cancel"
              type="button"
              disabled={saving()}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              class="poto-preset-editor__button poto-preset-editor__button--primary"
              classList={{ loading: saving() }}
              data-action="save"
              type="button"
              disabled={saving()}
              onClick={() => void save()}
            >
              {request().mode === "create" ? "Save Preset" : "Update Preset"}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
