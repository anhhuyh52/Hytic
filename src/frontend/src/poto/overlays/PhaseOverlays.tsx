import { createEffect, createSignal, For, Match, Show, Switch, untrack } from "solid-js";
import {
  editState,
  scopesState,
  setEditState,
  setScopesState,
  type ImageInfo,
} from "../../app/editor-store";
import { allPresets } from "../../engine/presets/CustomPresetStore";
import {
  ASPECT_RATIO_PRESETS,
  DEFAULT_PRESET_STATE,
  DEFAULT_TRANSFORM_STATE,
  type AspectRatioPreset,
} from "../../engine/state/EditState";
import type { ScopeMode } from "../../engine/scopes/ScopeTypes";
import type { SavedProjectSummary } from "../../project/ProjectTypes";
import type { CropGuideMode } from "../../ui/transform/CropOverlay";
import { applyAspectPresetToTransform } from "../../engine/transform/transformGeometry";

export type Phase8OverlayKind = "projects" | "presets" | "crop" | "scopes" | "export";

type ExportSize = 17 | 33 | 64;
type ExportKind = "png" | "cube" | "clf";

type EditorOverlaysProps = {
  active: Phase8OverlayKind | null;
  image?: ImageInfo;
  projectName: string;
  currentProjectId: string | null;
  isDirty: boolean;
  isSaving: boolean;
  isCropEditing: boolean;
  isCropApplying: boolean;
  imageName: string;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  exportTitle: string;
  lutIs8Bit: boolean;
  onClose(): void;
  onProjectNameChange(name: string): void;
  onSaveProject(forceNew: boolean): Promise<void>;
  onOpenProject(projectId: string): Promise<void>;
  onDeleteProject(projectId: string): Promise<void>;
  listProjects(): Promise<SavedProjectSummary[]>;
  onEnterCropEdit(): void;
  onExitCropEdit(): void;
  cropGuideMode: CropGuideMode;
  onCropGuideModeChange(mode: CropGuideMode): void;
  onApplyCropEdit(): void;
  onCancelCropEdit(): void;
  onSelectPreviousCropImage(): void;
  onSelectNextCropImage(): void;
  onExportPng(bitDepth: 8 | 16): Promise<void>;
  onExportCube(options: { title: string; size: ExportSize }): Promise<void>;
  onExportCLF(options: { title: string; size: ExportSize }): Promise<void>;
};

const ASPECT_RATIOS: AspectRatioPreset[] = [...ASPECT_RATIO_PRESETS];

const CROP_GUIDES: Array<{ value: CropGuideMode; label: string }> = [
  { value: "thirds", label: "Rule of Thirds" },
  { value: "center", label: "Center" },
  { value: "grid", label: "Grid" },
  { value: "triangle", label: "Triangle" },
  { value: "golden", label: "Golden Ratio" },
  { value: "fifth", label: "Fifth" },
  { value: "diagonal", label: "Diagonal" },
];

const SCOPE_GROUPS: Array<{ label: string; modes: Array<{ id: ScopeMode; label: string }> }> = [
  {
    label: "Histograms",
    modes: [
      { id: "rgb", label: "RGB" },
      { id: "hue", label: "Hue" },
      { id: "sat", label: "Sat" },
      { id: "lum", label: "Luma" },
    ],
  },
  {
    label: "Scopes",
    modes: [
      { id: "vec", label: "Vector" },
      { id: "wvf", label: "Waveform" },
      { id: "prd", label: "Parade" },
    ],
  },
  {
    label: "Analysis",
    modes: [
      { id: "ntg", label: "Grey" },
      { id: "skn", label: "Skin" },
      { id: "exz", label: "Zones" },
      { id: "clz", label: "Clip" },
      { id: "tmp", label: "Temp" },
      { id: "fcl", label: "False" },
    ],
  },
];

const EXPORT_SIZES: ExportSize[] = [17, 33, 64];

export function EditorOverlays(props: EditorOverlaysProps) {
  return (
    <Switch>
      <Match when={props.active === "projects"}>
        <div class="phase8-overlay" data-overlay="projects">
          <OverlayBackdrop onClose={props.onClose} />
          <OverlayDialog title="Projects" onClose={props.onClose}>
            <ProjectOverlay {...props} />
          </OverlayDialog>
        </div>
      </Match>
      <Match when={props.active === "presets"}>
        <div class="phase8-overlay" data-overlay="presets">
          <OverlayBackdrop onClose={props.onClose} />
          <OverlayDialog title="Preset Library" onClose={props.onClose}>
            <PresetLibraryOverlay />
          </OverlayDialog>
        </div>
      </Match>
      <Match when={props.active === "crop"}>
        <div class="phase8-overlay phase8-overlay--tools" data-overlay="crop">
          <OverlayDialog title="Crop & Rotate" onClose={props.onClose} compact>
            <CropOverlayPanel {...props} />
          </OverlayDialog>
        </div>
      </Match>
      <Match when={props.active === "scopes"}>
        <div class="phase8-overlay phase8-overlay--tools" data-overlay="scopes">
          <OverlayDialog title="Scopes" onClose={props.onClose} compact>
            <ScopesOverlay hasImage={!!props.image} />
          </OverlayDialog>
        </div>
      </Match>
      <Match when={props.active === "export"}>
        <div class="phase8-overlay" data-overlay="export">
          <OverlayBackdrop onClose={props.onClose} />
          <OverlayDialog title="Export" onClose={props.onClose}>
            <ExportOverlay {...props} />
          </OverlayDialog>
        </div>
      </Match>
    </Switch>
  );
}

function OverlayBackdrop(props: { onClose(): void }) {
  return (
    <button
      class="phase8-backdrop"
      type="button"
      aria-label="Close overlay"
      onClick={() => props.onClose()}
    />
  );
}

function OverlayDialog(props: {
  title: string;
  compact?: boolean;
  onClose(): void;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <section
      classList={{
        "phase8-dialog": true,
        "phase8-dialog--compact": !!props.compact,
      }}
      role="dialog"
      aria-modal={props.compact ? "false" : "true"}
      aria-label={props.title}
    >
      <header class="phase8-dialog__header">
        <h2>{props.title}</h2>
        <button class="phase8-icon-btn" type="button" title="Close" onClick={() => props.onClose()}>
          <img src="/assets/icons/close_icon.svg" alt="Close" />
        </button>
      </header>
      <div class="phase8-dialog__body">{props.children}</div>
    </section>
  );
}

function ProjectOverlay(props: EditorOverlaysProps) {
  const [projects, setProjects] = createSignal<SavedProjectSummary[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setProjects(await props.listProjects());
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    void refresh();
  });

  async function save(forceNew: boolean) {
    await props.onSaveProject(forceNew);
    await refresh();
  }

  async function open(projectId: string) {
    await props.onOpenProject(projectId);
    props.onClose();
  }

  async function remove(projectId: string) {
    if (confirmDeleteId() !== projectId) {
      setConfirmDeleteId(projectId);
      return;
    }
    setConfirmDeleteId(null);
    await props.onDeleteProject(projectId);
    await refresh();
  }

  return (
    <div class="phase8-stack">
      <div class="phase8-form-row">
        <label for="phase8-project-name">Name</label>
        <input
          id="phase8-project-name"
          class="phase8-input"
          value={props.projectName}
          placeholder="Hytic"
          onInput={(event) => props.onProjectNameChange(event.currentTarget.value)}
        />
      </div>

      <div class="phase8-actions">
        <button
          class="phase8-btn phase8-btn--primary"
          type="button"
          disabled={!props.image || props.isSaving}
          onClick={() => void save(false)}
        >
          {props.isSaving ? "Saving..." : props.currentProjectId ? "Save" : "Save Project"}
        </button>
        <button
          class="phase8-btn"
          type="button"
          disabled={!props.image || props.isSaving}
          onClick={() => void save(true)}
        >
          Save As New
        </button>
        <button
          class="phase8-btn"
          type="button"
          disabled={loading()}
          onClick={() => void refresh()}
        >
          {loading() ? "Refreshing..." : "Refresh"}
        </button>
        <Show when={props.isDirty && props.image}>
          <span class="phase8-status phase8-status--warn">Unsaved changes</span>
        </Show>
      </div>

      <div class="phase8-list">
        <Show
          when={projects().length > 0}
          fallback={<p class="phase8-empty">No saved projects yet.</p>}
        >
          <For each={projects()}>
            {(project) => (
              <article
                classList={{
                  "phase8-list-item": true,
                  "is-active": project.id === props.currentProjectId,
                }}
              >
                <div>
                  <strong>{project.name}</strong>
                  <span>
                    {project.fileName} | {project.width}x{project.height} |{" "}
                    {formatDate(project.updatedAt)}
                  </span>
                </div>
                <div class="phase8-row-actions">
                  <button
                    class="phase8-btn phase8-btn--small"
                    type="button"
                    onClick={() => void open(project.id)}
                  >
                    Open
                  </button>
                  <button
                    classList={{
                      "phase8-btn": true,
                      "phase8-btn--small": true,
                      "phase8-btn--danger": confirmDeleteId() === project.id,
                    }}
                    type="button"
                    onClick={() => void remove(project.id)}
                  >
                    {confirmDeleteId() === project.id ? "Confirm" : "Delete"}
                  </button>
                </div>
              </article>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function PresetLibraryOverlay() {
  const selectedId = () => editState.preset.selectedPresetId;

  function applyPreset(id: string) {
    setEditState("preset", "enabled", true);
    setEditState("preset", "bypass", false);
    setEditState("preset", "selectedPresetId", id);
  }

  return (
    <div class="phase8-stack">
      <div class="phase8-actions">
        <button
          classList={{ "phase8-btn": true, "is-active": editState.preset.preserveUserAdjustments }}
          type="button"
          onClick={() =>
            setEditState(
              "preset",
              "preserveUserAdjustments",
              !editState.preset.preserveUserAdjustments,
            )
          }
        >
          Preserve User Adjustments
        </button>
        <button
          classList={{ "phase8-btn": true, "is-active": editState.preset.bypass }}
          type="button"
          onClick={() => setEditState("preset", "bypass", !editState.preset.bypass)}
        >
          Bypass
        </button>
        <button
          class="phase8-btn phase8-btn--danger"
          type="button"
          onClick={() => setEditState("preset", { ...DEFAULT_PRESET_STATE })}
        >
          Reset
        </button>
      </div>

      <label class="phase8-range">
        <span>Strength</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={editState.preset.strength}
          onInput={(event) => setEditState("preset", "strength", Number(event.currentTarget.value))}
        />
        <strong>{Math.round(editState.preset.strength * 100)}%</strong>
      </label>

      <div class="phase8-grid">
        <For each={allPresets()}>
          {(preset) => (
            <button
              classList={{
                "phase8-preset-card": true,
                "is-active": selectedId() === preset.id,
              }}
              type="button"
              onClick={() => applyPreset(preset.id)}
            >
              <span>{preset.name}</span>
              <small>{preset.category ?? "Custom"}</small>
              <p>{preset.description ?? "Custom preset look."}</p>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function CropOverlayPanel(props: EditorOverlaysProps) {
  const t = () => editState.transform;
  const fmt = (value: number) => (value >= 0 ? `+${value.toFixed(1)}` : value.toFixed(1));

  function setCropEnabled(enabled: boolean) {
    setEditState("transform", "cropEnabled", enabled);
    if (enabled) props.onEnterCropEdit();
    else props.onExitCropEdit();
  }

  function rotate(delta: -90 | 90) {
    const next = ((t().orientation + delta + 360) % 360) as 0 | 90 | 180 | 270;
    const transform = { ...t(), orientation: next };
    setEditState(
      "transform",
      props.image
        ? applyAspectPresetToTransform(
            transform,
            transform.aspectRatio,
            props.image.width,
            props.image.height,
          )
        : transform,
    );
  }

  function reset() {
    setEditState("transform", { ...DEFAULT_TRANSFORM_STATE });
    props.onExitCropEdit();
  }

  return (
    <div class="phase8-stack">
      <Show
        when={props.image}
        fallback={<p class="phase8-empty">Load an image to crop and rotate.</p>}
      >
        <div class="phase8-actions">
          <button class="phase8-btn" type="button" onClick={() => props.onCancelCropEdit()}>
            Cancel
          </button>
          <button
            class="phase8-btn phase8-btn--primary"
            type="button"
            onClick={() => props.onApplyCropEdit()}
          >
            Done
          </button>
        </div>

        <div class="phase8-actions">
          <button
            classList={{
              "phase8-btn": true,
              "phase8-btn--primary": true,
              "is-active": t().cropEnabled,
            }}
            type="button"
            onClick={() => setCropEnabled(!t().cropEnabled)}
          >
            {t().cropEnabled ? "Disable Crop" : "Enable Crop"}
          </button>
          <button
            class="phase8-btn"
            type="button"
            disabled={!t().cropEnabled}
            onClick={() => props.onEnterCropEdit()}
          >
            Edit Handles
          </button>
          <button
            class="phase8-btn"
            type="button"
            onClick={() => props.onExitCropEdit()}
            disabled={!props.isCropEditing}
          >
            Done Handles
          </button>
          <button class="phase8-btn phase8-btn--danger" type="button" onClick={reset}>
            Reset
          </button>
        </div>

        <div class="phase8-form-row">
          <label for="phase8-aspect">Aspect</label>
          <select
            id="phase8-aspect"
            class="phase8-input"
            value={t().aspectRatio}
            onChange={(event) =>
              setEditState(
                "transform",
                "aspectRatio",
                event.currentTarget.value as AspectRatioPreset,
              )
            }
          >
            <For each={ASPECT_RATIOS}>{(ratio) => <option value={ratio}>{ratio}</option>}</For>
          </select>
        </div>

        <div class="phase8-form-row">
          <label for="phase8-crop-guide">Overlay</label>
          <select
            id="phase8-crop-guide"
            class="phase8-input"
            value={props.cropGuideMode}
            onChange={(event) =>
              props.onCropGuideModeChange(event.currentTarget.value as CropGuideMode)
            }
          >
            <For each={CROP_GUIDES}>
              {(guide) => <option value={guide.value}>{guide.label}</option>}
            </For>
          </select>
        </div>

        <div class="phase8-actions">
          <button class="phase8-btn" type="button" onClick={() => rotate(-90)}>
            Rotate Left
          </button>
          <button class="phase8-btn" type="button" onClick={() => rotate(90)}>
            Rotate Right
          </button>
          <button
            classList={{ "phase8-btn": true, "is-active": t().flipX }}
            type="button"
            onClick={() => setEditState("transform", "flipX", !t().flipX)}
          >
            Flip H
          </button>
          <button
            classList={{ "phase8-btn": true, "is-active": t().flipY }}
            type="button"
            onClick={() => setEditState("transform", "flipY", !t().flipY)}
          >
            Flip V
          </button>
        </div>

        <label class="phase8-range">
          <span>Straighten</span>
          <input
            type="range"
            min="-45"
            max="45"
            step="0.1"
            value={t().straighten}
            onInput={(event) =>
              setEditState("transform", "straighten", Number(event.currentTarget.value))
            }
          />
          <strong>{fmt(t().straighten)}</strong>
        </label>
      </Show>
    </div>
  );
}

function ScopesOverlay(props: { hasImage: boolean }) {
  return (
    <div class="phase8-stack">
      <Show
        when={props.hasImage}
        fallback={<p class="phase8-empty">Load an image to enable scopes.</p>}
      >
        <div class="phase8-actions">
          <button
            classList={{
              "phase8-btn": true,
              "phase8-btn--primary": true,
              "is-active": scopesState.visible,
            }}
            type="button"
            onClick={() => setScopesState("visible", !scopesState.visible)}
          >
            {scopesState.visible ? "Hide Live Scopes" : "Show Live Scopes"}
          </button>
          <button
            classList={{ "phase8-btn": true, "is-active": scopesState.enabled }}
            type="button"
            onClick={() => setScopesState("enabled", !scopesState.enabled)}
          >
            {scopesState.enabled ? "Live" : "Paused"}
          </button>
          <button
            classList={{ "phase8-btn": true, "is-active": scopesState.showGrid }}
            type="button"
            onClick={() => setScopesState("showGrid", !scopesState.showGrid)}
          >
            Grid
          </button>
        </div>

        <For each={SCOPE_GROUPS}>
          {(group) => (
            <div class="phase8-scope-group">
              <span>{group.label}</span>
              <div class="phase8-actions">
                <For each={group.modes}>
                  {(mode) => (
                    <button
                      classList={{ "phase8-btn": true, "is-active": scopesState.mode === mode.id }}
                      type="button"
                      onClick={() => setScopesState("mode", mode.id)}
                    >
                      {mode.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>

        <label class="phase8-range">
          <span>Opacity</span>
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={scopesState.opacity}
            onInput={(event) => setScopesState("opacity", Number(event.currentTarget.value))}
          />
          <strong>{Math.round(scopesState.opacity * 100)}%</strong>
        </label>

        <div class="phase8-actions">
          <button
            classList={{ "phase8-btn": true, "is-active": scopesState.sampleSize === 128 }}
            type="button"
            onClick={() => setScopesState("sampleSize", 128)}
          >
            128 sample
          </button>
          <button
            classList={{ "phase8-btn": true, "is-active": scopesState.sampleSize === 256 }}
            type="button"
            onClick={() => setScopesState("sampleSize", 256)}
          >
            256 sample
          </button>
        </div>
      </Show>
    </div>
  );
}

function ExportOverlay(props: EditorOverlaysProps) {
  const [title, setTitle] = createSignal(untrack(() => props.exportTitle));
  const [size, setSize] = createSignal<ExportSize>(64);
  const [exporting, setExporting] = createSignal<ExportKind | null>(null);
  const [bit16, setBit16] = createSignal(false);

  async function run(kind: ExportKind) {
    if (!props.image || exporting()) return;
    setExporting(kind);
    try {
      if (kind === "png") await props.onExportPng(bit16() ? 16 : 8);
      else if (kind === "cube")
        await props.onExportCube({ title: title().trim() || props.exportTitle, size: size() });
      else await props.onExportCLF({ title: title().trim() || props.exportTitle, size: size() });
    } finally {
      setExporting(null);
    }
  }

  return (
    <div class="phase8-stack">
      <Show
        when={props.image}
        fallback={<p class="phase8-empty">Load an image before exporting.</p>}
      >
        <div class="phase8-form-row">
          <label for="phase8-export-title">Title</label>
          <input
            id="phase8-export-title"
            class="phase8-input"
            value={title()}
            placeholder={props.exportTitle}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </div>

        <div class="phase8-export-actions">
          <button
            class="phase8-btn phase8-btn--primary"
            type="button"
            disabled={!!exporting()}
            onClick={() => void run("png")}
          >
            {exporting() === "png"
              ? "Exporting..."
              : bit16()
                ? "Export PNG (16-bit)"
                : "Export PNG"}
          </button>
          <label
            class="phase8-checkbox"
            title="Render the export through a half-float pipeline and write a 16-bit PNG (no 8-bit banding)."
          >
            <input
              type="checkbox"
              checked={bit16()}
              onChange={(e) => setBit16(e.currentTarget.checked)}
            />
            <span>16-bit PNG</span>
          </label>
          <div class="phase8-size-group">
            <For each={EXPORT_SIZES}>
              {(option) => (
                <button
                  classList={{ "phase8-btn": true, "is-active": size() === option }}
                  type="button"
                  onClick={() => setSize(option)}
                >
                  {option}^3
                </button>
              )}
            </For>
          </div>
          <button
            class="phase8-btn"
            type="button"
            disabled={!!exporting()}
            onClick={() => void run("cube")}
          >
            {exporting() === "cube" ? "Exporting..." : "Export .cube"}
          </button>
          <button
            class="phase8-btn"
            type="button"
            disabled={!!exporting()}
            onClick={() => void run("clf")}
          >
            {exporting() === "clf" ? "Exporting..." : "Export .clf"}
          </button>
        </div>

        <p class="phase8-hint">
          LUT exports include global color only. Crop, scopes, image-space FX, masks, and project
          state are not included.
          {props.lutIs8Bit
            ? " This GPU reports 8-bit LUT readback, so LUT values may be quantized."
            : ""}
        </p>
      </Show>
    </div>
  );
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
