import { createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { editState, setEditState } from "../../app/editor-store";
import { Slider } from "../controls/Slider";
import { BYPASS_REFERENCE_ID, DEFAULT_MATCH_STATE } from "../../engine/state/MatchTypes";
import { consumeContextMenuEvent } from "../contextMenuGuards";
import { ContextMenu, openContextMenu, type ContextMenuState } from "../controls/ContextMenu";
import {
  deleteAllMatchReferences,
  deleteMatchReference,
  listMatchReferences,
  MATCH_REFERENCES_CHANGED,
  saveMatchReferenceFile,
} from "../../project/matchReferenceStore";
import type { MatchReferenceRecord } from "../../project/ProjectTypes";
import type { EditState } from "../../engine/state/EditState";
import { isFeatureAvailable, featureUnavailableMessage } from "../../features/editorCapabilities";
import {
  getUnsupportedReferenceImageMessage,
  isSupportedReferenceImageFile,
  REFERENCE_IMAGE_ACCEPT,
} from "../../engine/io/CodecRegistry";

// Inline Color Match panel, faithful to the legacy match-panel: import + bypass
// tiles, then custom references and the built-in reference set. Selecting a
// reference or changing a slider generates a baked 16^3 LUT.

type MatchSourceMetadata = {
  sourceId: string;
  sourceIdt: string;
  sourceSignature: string;
};

export type MatchApi = {
  /** Reactive: whether a source image is open. */
  hasImage: () => boolean;
  /** Snapshots the grade + runs the match for a reference image; returns the LUT. */
  generate: (reference: HTMLImageElement, colorMix: number, lumaMix: number) => Promise<number[]>;
  getSourceMetadata?: () => MatchSourceMetadata;
  onError: (message: string) => void;
};

type Ref = { id: string; name: string; url: string };

const BUILTIN_REF_NAMES = [
  "Alpine Red Hotel",
  "Storybook Green Room",
  "Neon Motel",
  "Orange Future Haze",
  "Paris Cafe Greens",
  "Soft Future Apartment",
  "Blue Shore Night",
  "Planetarium Dance",
  "Desert Chase",
  "Red Lantern Hall",
  "Saturated Palace",
  "Sea Lab Primary",
  "Teal Water Room",
  "Green Code Alley",
  "Red Bathhouse",
  "Primary Horror Stage",
  "Amber Arrival",
  "Spice Dune",
  "Green Orange Stair",
  "Pastel Court",
  "Red Leaves Duel",
  "Bamboo Green",
  "White Floral Daylight",
  "Yellow Revenge",
  "Spinning Table",
  "Icy Frontier",
  "Beach Memory",
  "Swan Contrast",
  "Emerald Road",
  "Red Stage Ballet",
  "Match Reference 31",
  "Match Reference 32",
] as const;

const BUILTIN_REFS: Ref[] = BUILTIN_REF_NAMES.map((name, i) => {
  const n = i + 1;
  return {
    id: `match_ref_${n}.webp`,
    name,
    url: `/assets/img/match_refs/match_ref_${n}.webp`,
  };
});

export function MatchPanel(
  props: MatchApi & {
    previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
    clearPreviewPatch?: (reason?: string) => void;
  },
) {
  const m = () => editState.match;
  const [customRefs, setCustomRefs] = createSignal<Ref[]>([]);
  const [refsLoaded, setRefsLoaded] = createSignal(false);
  const [manualUnlinked, setManualUnlinked] = createSignal(false);
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null);
  let fileInput: HTMLInputElement | undefined;
  let selectedImg: HTMLImageElement | undefined;
  let disposed = false;
  let matchRequestId = 0;
  const referenceImages = new Map<string, HTMLImageElement>();

  const isSelected = (id: string) => m().referenceId === id && !m().bypass;
  const hasAppliedMatch = () =>
    !m().bypass && (!!m().lut || m().referenceId !== BYPASS_REFERENCE_ID);
  const linked = () => colorMix() === lumaMix() && !manualUnlinked();
  const hasReference = (id: string) =>
    BUILTIN_REFS.some((ref) => ref.id === id) || customRefs().some((ref) => ref.id === id);
  const missingReference = createMemo(() => {
    const state = m();
    if (
      !refsLoaded() ||
      state.bypass ||
      state.referenceId === BYPASS_REFERENCE_ID ||
      hasReference(state.referenceId)
    ) {
      return null;
    }
    return {
      id: state.referenceId,
      name: state.referenceName || state.referenceId,
    };
  });

  const panelState = createMemo((): "info" | "progress" | "active" => {
    const state = m();
    if (state.status === "analyzing") return "progress";
    if (hasAppliedMatch()) return "active";
    return "info";
  });

  function revokeRefUrls(refs: Ref[]) {
    for (const ref of refs) {
      if (ref.url.startsWith("blob:")) URL.revokeObjectURL(ref.url);
    }
  }

  function refFromRecord(record: MatchReferenceRecord): Ref {
    return {
      id: record.id,
      name: record.name,
      url: URL.createObjectURL(record.blob),
    };
  }

  function loadCustomReferences() {
    void listMatchReferences()
      .then((records) => {
        const refs = records.map(refFromRecord);
        if (disposed) {
          revokeRefUrls(refs);
          return;
        }
        setCustomRefs((prev) => {
          revokeRefUrls(prev);
          return refs;
        });
      })
      .catch(() => {
        untrack(() => props.onError("Unable to load imported Color Match references."));
      })
      .finally(() => {
        if (!disposed) setRefsLoaded(true);
      });
  }

  onMount(() => {
    loadCustomReferences();
    const onReferencesChanged = () => loadCustomReferences();
    window.addEventListener(MATCH_REFERENCES_CHANGED, onReferencesChanged);
    onCleanup(() => window.removeEventListener(MATCH_REFERENCES_CHANGED, onReferencesChanged));
  });

  onCleanup(() => {
    disposed = true;
    revokeRefUrls(customRefs());
    referenceImages.clear();
  });

  async function runMatch(reference: HTMLImageElement, id: string, name: string) {
    if (!props.hasImage()) {
      props.onError("Open an image before matching.");
      return;
    }
    selectedImg = reference;
    const colorMix = m().colorMix;
    const lumaMix = m().lumaMix;
    const source = props.getSourceMetadata?.() ?? {
      sourceId: "",
      sourceIdt: m().sourceIdt,
      sourceSignature: "",
    };
    const requestId = ++matchRequestId;
    setEditState("match", {
      ...m(),
      referenceId: id,
      referenceName: name,
      bypass: false,
      status: "analyzing",
      error: undefined,
    });
    try {
      if (!reference.complete) await reference.decode();
      const lut = await props.generate(reference, colorMix, lumaMix);
      const currentSource = props.getSourceMetadata?.();
      if (
        disposed ||
        requestId !== matchRequestId ||
        (currentSource && currentSource.sourceSignature !== source.sourceSignature)
      ) {
        return;
      }
      setEditState("match", {
        referenceId: id,
        referenceName: name,
        sourceId: source.sourceId,
        sourceIdt: source.sourceIdt,
        sourceSignature: source.sourceSignature,
        colorMix,
        lumaMix,
        lut,
        generatedAt: Date.now(),
        bypass: false,
        status: "active",
        error: undefined,
      });
    } catch (err) {
      const currentSource = props.getSourceMetadata?.();
      if (
        disposed ||
        requestId !== matchRequestId ||
        (currentSource && currentSource.sourceSignature !== source.sourceSignature)
      ) {
        return;
      }
      const message = err instanceof Error ? err.message : "Color match failed";
      setEditState("match", "status", "error");
      setEditState("match", "error", message);
      props.onError(message);
    }
  }

  function requireColorMatchAccess(): boolean {
    if (isFeatureAvailable("color_match")) return true;
    props.onError(featureUnavailableMessage("color_match"));
    return false;
  }

  function selectReference(ref: Ref, event: MouseEvent) {
    if (!requireColorMatchAccess()) return;
    const img = (event.currentTarget as HTMLElement).querySelector("img");
    if (img) void runMatch(img as HTMLImageElement, ref.id, ref.name);
  }

  function contextReference(ref: Ref, event: MouseEvent) {
    const isCustom = customRefs().some((item) => item.id === ref.id);
    setMenu(
      openContextMenu(
        event,
        [
          `<context-title>${escapeHtml(ref.name)}</context-title>`,
          `<context-item data-action="preview">Preview</context-item>`,
          `<context-separator></context-separator>`,
          `<context-item data-action="delete">Delete</context-item>`,
          `<context-item data-action="deleteAll">Delete All</context-item>`,
        ].join(""),
        {
          preview: { action: () => window.open(ref.url, "_blank", "noopener,noreferrer") },
          delete: {
            disabled: () => !isCustom,
            action: () => void removeReference(ref.id),
          },
          deleteAll: {
            disabled: () => customRefs().length === 0,
            action: () => void removeAllReferences(),
          },
        },
      ),
    );
  }

  async function removeReference(id: string) {
    try {
      await deleteMatchReference(id);
      setCustomRefs((prev) => {
        const removed = prev.find((ref) => ref.id === id);
        if (removed?.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
        referenceImages.delete(id);
        return prev.filter((ref) => ref.id !== id);
      });
      if (m().referenceId === id) selectBypass();
    } catch {
      props.onError("Unable to delete Color Match reference.");
    }
  }

  async function removeAllReferences() {
    try {
      const removesSelected = customRefs().some((ref) => ref.id === m().referenceId);
      await deleteAllMatchReferences();
      setCustomRefs((prev) => {
        revokeRefUrls(prev);
        for (const ref of prev) referenceImages.delete(ref.id);
        return [];
      });
      if (removesSelected) selectBypass();
    } catch {
      props.onError("Unable to delete Color Match references.");
    }
  }

  function selectBypass() {
    selectedImg = undefined;
    setManualUnlinked(false);
    setEditState("match", { ...DEFAULT_MATCH_STATE, lut: null });
  }

  async function importReferenceFile(file: File) {
    if (!file) return;
    if (!isSupportedReferenceImageFile(file)) {
      props.onError(getUnsupportedReferenceImageMessage());
      return;
    }
    let record: MatchReferenceRecord;
    try {
      record = await saveMatchReferenceFile(file);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : "Unable to save reference image.");
      return;
    }
    const url = URL.createObjectURL(record.blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      props.onError("Could not load that reference image.");
      URL.revokeObjectURL(url);
      return;
    }
    setCustomRefs((prev) => {
      for (const ref of prev) {
        if (ref.id === record.id && ref.url.startsWith("blob:")) {
          URL.revokeObjectURL(ref.url);
        }
      }
      return [
        { id: record.id, name: record.name, url },
        ...prev.filter((ref) => ref.id !== record.id),
      ];
    });
    void runMatch(img, record.id, record.name);
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) await importReferenceFile(file);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    void importReferenceFile(files[0]);
  }

  function reMatch() {
    const refImg = selectedImg ?? referenceImages.get(m().referenceId);
    if (refImg && m().referenceId !== BYPASS_REFERENCE_ID) {
      void runMatch(refImg, m().referenceId, m().referenceName ?? "");
    }
  }

  const [liveColorMix, setLiveColorMix] = createSignal<number | null>(null);
  const [liveLumaMix, setLiveLumaMix] = createSignal<number | null>(null);
  const colorMix = () => liveColorMix() ?? m().colorMix;
  const lumaMix = () => liveLumaMix() ?? m().lumaMix;

  function setColor(v: number) {
    const wasLinked = linked();
    setLiveColorMix(v);
    if (wasLinked) {
      setLiveLumaMix(v);
      setManualUnlinked(false);
    } else {
      setManualUnlinked(v !== lumaMix());
    }
    props.previewEditPatch?.(
      {
        match: {
          ...m(),
          colorMix: v,
          lumaMix: wasLinked ? v : lumaMix(),
        },
      },
      "match-color-drag",
    );
  }

  function setTone(v: number) {
    const wasLinked = linked();
    setLiveLumaMix(v);
    if (wasLinked) {
      setLiveColorMix(v);
      setManualUnlinked(false);
    } else {
      setManualUnlinked(v !== colorMix());
    }
    props.previewEditPatch?.(
      {
        match: {
          ...m(),
          colorMix: wasLinked ? v : colorMix(),
          lumaMix: v,
        },
      },
      "match-tone-drag",
    );
  }

  function commitMixes() {
    setEditState("match", {
      ...m(),
      colorMix: colorMix(),
      lumaMix: lumaMix(),
    });
    setLiveColorMix(null);
    setLiveLumaMix(null);
    queueMicrotask(() => {
      untrack(() => {
        props.clearPreviewPatch?.("match-mix-commit");
        reMatch();
      });
    });
  }

  function toggleLink() {
    if (linked()) {
      setManualUnlinked(true);
      return;
    }
    setManualUnlinked(false);
    setEditState("match", "lumaMix", m().colorMix);
    reMatch();
  }

  return (
    <match-panel
      class="poto-match"
      attr:state={panelState()}
      data-state={panelState()}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <scroll-list class="poto-match__list">
        <button
          class="poto-match__tile poto-match__tile--action"
          type="button"
          title="Import your own reference images to match"
          onClick={() => {
            if (requireColorMatchAccess()) fileInput?.click();
          }}
          onContextMenu={consumeContextMenuEvent}
        >
          <img
            class="poto-match__import-icon"
            src="/assets/icons/folder.svg"
            alt="Import reference"
            selectable="false"
            loading="lazy"
          />
        </button>
        <button
          class="poto-match__tile poto-match__tile--action"
          classList={{
            "is-selected": m().referenceId === BYPASS_REFERENCE_ID && !hasAppliedMatch(),
          }}
          type="button"
          title="Bypass - no color match"
          onClick={selectBypass}
          onContextMenu={consumeContextMenuEvent}
        >
          <img src="/assets/icons/bypass_icon.svg" alt="Bypass" selectable="false" loading="lazy" />
        </button>
        <Show when={missingReference()}>
          {(ref) => (
            <button
              class="poto-match__tile poto-match__tile--action is-selected is-missing"
              type="button"
              title={`Missing reference: ${ref().name}`}
              disabled
              onContextMenu={consumeContextMenuEvent}
            >
              <img
                src="/assets/icons/missing_image_icon.svg"
                alt="Missing reference"
                selectable="false"
                loading="lazy"
              />
            </button>
          )}
        </Show>
        <For each={customRefs()}>
          {(ref) => (
            <button
              class="poto-match__tile"
              classList={{ "is-selected": isSelected(ref.id) }}
              type="button"
              title={ref.name}
              onClick={(e) => selectReference(ref, e)}
              onContextMenu={consumeContextMenuEvent}
            >
              <img
                ref={(img) => {
                  referenceImages.set(ref.id, img);
                }}
                src={ref.url}
                alt={ref.name}
                loading="lazy"
                onContextMenu={(event) => contextReference(ref, event)}
              />
            </button>
          )}
        </For>
        <For each={BUILTIN_REFS}>
          {(ref) => (
            <button
              class="poto-match__tile"
              classList={{ "is-selected": isSelected(ref.id) }}
              type="button"
              title={ref.name}
              onClick={(e) => selectReference(ref, e)}
              onContextMenu={consumeContextMenuEvent}
            >
              <img
                ref={(img) => {
                  referenceImages.set(ref.id, img);
                }}
                src={ref.url}
                alt={ref.name}
                loading="lazy"
                onContextMenu={(event) => contextReference(ref, event)}
              />
            </button>
          )}
        </For>
      </scroll-list>

      <match-controls class="poto-match__controls">
        <Show when={panelState() === "info"}>
          <info-box class="poto-match__info">
            <img src="/assets/icons/sprinkle_icon.svg" alt="" />
            <span>
              Select a reference above to match its color and tone, or{" "}
              <button type="button" onClick={() => fileInput?.click()}>
                import your own
              </button>
              . Then refine the result with the controls below.
            </span>
          </info-box>
        </Show>

        <Show when={panelState() === "progress"}>
          <progress-bar class="poto-match__progress is-visible" />
        </Show>

        <Show when={panelState() !== "info"}>
          <slider-controls
            class="poto-match__sliders"
            classList={{
              "is-visible": panelState() === "active",
              "is-progress": panelState() === "progress",
            }}
          >
            <Slider
              label="Color"
              value={colorMix()}
              min={0}
              max={1}
              step={0.001}
              default={1}
              variant="match-color"
              format={(v) => `${Math.round(v * 100)}%`}
              onInput={setColor}
              onChange={commitMixes}
            />
            <button
              class="poto-match__link"
              classList={{ "is-linked": linked() }}
              type="button"
              title={linked() ? "Color and Tone linked" : "Link Color and Tone"}
              onClick={toggleLink}
            >
              <Show
                when={linked()}
                fallback={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
                    <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
                    <line x1="8" x2="8" y1="2" y2="5" />
                    <line x1="2" x2="5" y1="8" y2="8" />
                    <line x1="16" x2="16" y1="19" y2="22" />
                    <line x1="19" x2="22" y1="16" y2="16" />
                  </svg>
                }
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
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </Show>
            </button>
            <Slider
              label="Tone"
              value={lumaMix()}
              min={0}
              max={1}
              step={0.001}
              default={1}
              variant="match-tone"
              format={(v) => `${Math.round(v * 100)}%`}
              onInput={setTone}
              onChange={commitMixes}
            />
          </slider-controls>
        </Show>

        <Show when={m().status === "error" && m().error}>
          <div class="poto-match__status poto-match__status--error">{m().error}</div>
        </Show>
      </match-controls>

      <input
        ref={(el) => (fileInput = el)}
        hidden
        type="file"
        accept={REFERENCE_IMAGE_ACCEPT}
        onChange={onImportFile}
      />
      <Show when={menu()}>
        {(state) => <ContextMenu state={state()} onClose={() => setMenu(null)} />}
      </Show>
    </match-panel>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
