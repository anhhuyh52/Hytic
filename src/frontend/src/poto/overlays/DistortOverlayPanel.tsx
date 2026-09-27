import {
  batch,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { editState, setEditState } from "../../app/editor-store";
import {
  DEFAULT_DISTORT_STATE,
  cloneDistortState,
} from "../../features/distort/distortDefaults";
import {
  calculateAutoCropForDistortion,
  isValidQuad,
  pointsEqualDefault,
} from "../../features/distort/perspectiveMath";
import { Slider } from "../controls/Slider";
import { DistortWindowPreview, type CropSourceData } from "../../features/distort/DistortWindowPreview";

export type DistortOverlayPanelProps = {
  image?: { width: number; height: number };
  imageName?: string;
  cropSourceData?: CropSourceData;
  onApply: () => void;
  onCancel: () => void;
  canSelectPrevious?: boolean;
  canSelectNext?: boolean;
  onSelectPreviousImage?: () => void;
  onSelectNextImage?: () => void;
};

export function DistortOverlayPanel(props: DistortOverlayPanelProps) {
  // 1. Draft state (replaces live mutations)
  const [draft, setDraft] = createSignal(cloneDistortState(editState.distort));
  const [gridSize, setGridSize] = createSignal<[number, number]>([0, 0]);

  // Keep original state for comparison bypass
  const original = cloneDistortState(editState.distort);
  const [compareActive, setCompareActive] = createSignal(false);
  
  let applying = false;

  // Grid management during interaction
  function handleInteractionStart() {
    setGridSize([9, 9]);
  }

  function handleInteractionEnd() {
    setGridSize([0, 0]);
  }

  function apply() {
    if (applying || !props.image) return;
    applying = true;

    const currentDraft = draft();
    const fallbackPoints = isValidQuad(original.distortionPoints)
      ? original.distortionPoints
      : DEFAULT_DISTORT_STATE.distortionPoints;
    const safePoints = isValidQuad(currentDraft.distortionPoints)
      ? [...currentDraft.distortionPoints] as typeof currentDraft.distortionPoints
      : [...fallbackPoints] as typeof currentDraft.distortionPoints;
    const mesh = currentDraft.distortionMesh;
    const safeDraft = {
      ...currentDraft,
      distortionAmount: clampSlider(currentDraft.distortionAmount),
      distortionHorizontal: clampSlider(currentDraft.distortionHorizontal),
      distortionVertical: clampSlider(currentDraft.distortionVertical),
      distortionPoints: safePoints,
      distortionMesh: mesh?.every(Number.isFinite) ? new Float32Array(mesh) : null,
    };

    batch(() => {
      // Commit distort state to main viewer
      setEditState("distort", safeDraft);

      // Apply auto crop if enabled
      if (
        safeDraft.autoCrop &&
        props.image &&
        !pointsEqualDefault(safeDraft.distortionPoints)
      ) {
        const crop = calculateAutoCropForDistortion(
          safePoints,
          props.image.width,
          props.image.height,
        );
        setEditState("transform", {
          ...editState.transform,
          enabled: true,
          cropEnabled: true,
          cropX: crop.x,
          cropY: crop.y,
          cropWidth: crop.width,
          cropHeight: crop.height,
        });
      }
    });

    // Notify PotoApp to push history once
    props.onApply();
  }

  function reset() {
    setDraft(cloneDistortState(DEFAULT_DISTORT_STATE));
  }

  function setSlider(
    key: "distortionAmount" | "distortionHorizontal" | "distortionVertical",
    value: number,
  ) {
    setDraft((prev) => ({ ...prev, enabled: true, [key]: clampSlider(value) }));
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !applying) {
        event.preventDefault();
        props.onCancel();
      } else if (props.image && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  const activeState = () => (compareActive() ? original : draft());

  return (
    <section
      class="editor-transform-window distort-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="Distort"
    >
      <Show
        when={props.image}
        fallback={<p class="editor-empty">Load an image to distort.</p>}
      >
        <header class="editor-transform-window__header">
          <button
            class="editor-btn editor-btn--small editor-transform-window__cancel"
            type="button"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            class="editor-btn editor-btn--small"
            type="button"
            onClick={reset}
          >
            Reset
          </button>
          <button
            class="editor-transform-window__done"
            type="button"
            title="Done"
            onClick={apply}
          >
            <img src="/assets/icons/check_icon_inverted.svg" alt="Done" />
          </button>
        </header>

        <div class="editor-transform-window__select-bar">
          <button
            class="editor-transform-window__icon-button"
            type="button"
            title="Select previous image in project"
            disabled={!props.canSelectPrevious}
            onClick={props.onSelectPreviousImage}
          >
            <img src="/assets/icons/chevron_back_icon.svg" alt="Previous" />
          </button>
          <span class="editor-transform-window__image-name" translate="no">
            {props.imageName || "......"}
          </span>
          <button
            class="editor-transform-window__icon-button editor-transform-window__icon-button--next"
            type="button"
            title="Select next image in project"
            disabled={!props.canSelectNext}
            onClick={props.onSelectNextImage}
          >
            <img src="/assets/icons/chevron_back_icon.svg" alt="Next" />
          </button>
        </div>

        <div class="editor-transform-window__stage">
          <DistortWindowPreview
            draft={activeState()}
            gridSize={gridSize()}
            sourceData={props.cropSourceData}
            onInput={(next) => setDraft((prev) => ({ ...prev, ...next }))}
            onDragStart={handleInteractionStart}
            onDragEnd={handleInteractionEnd}
            interactionDisabled={compareActive()}
          />
        </div>

        <div class="editor-transform-window__toolbar distort-fullscreen__controls">
          <nav class="distort-editor__tabs" role="tablist">
           
          </nav>

          <div class="distort-editor__body">
              <section id="distort-panel-lens" class="distort-editor__section" role="tabpanel">
                <div class="distort-editor__control">
                  <div class="distort-editor__control-head">
                    <span>Lens Distortion</span>
                    <strong>{Math.round(draft().distortionAmount)}</strong>
                  </div>
                  <Slider
                    label=""
                    value={draft().distortionAmount}
                    min={-100}
                    max={100}
                    step={1}
                    default={0}
                    bipolar
                    title="Correct wide-angle or fisheye lens bending."
                    format={(v) => `${Math.round(v)}`}
                    onInput={(v) => {
                      handleInteractionStart();
                      setSlider("distortionAmount", v);
                    }}
                    onChange={(v) => {
                      handleInteractionEnd();
                      setSlider("distortionAmount", v);
                    }}
                  />
                </div>

                <div class="distort-editor__control">
                  <div class="distort-editor__control-head">
                    <span>Horizontal</span>
                    <strong>{Math.round(draft().distortionHorizontal)}</strong>
                  </div>
                  <Slider
                    label=""
                    value={draft().distortionHorizontal}
                    min={-100}
                    max={100}
                    step={1}
                    default={0}
                    bipolar
                    title="Correct left/right perspective tilt."
                    format={(v) => `${Math.round(v)}`}
                    onInput={(v) => {
                      handleInteractionStart();
                      setSlider("distortionHorizontal", v);
                    }}
                    onChange={(v) => {
                      handleInteractionEnd();
                      setSlider("distortionHorizontal", v);
                    }}
                  />
                </div>

                <div class="distort-editor__control">
                  <div class="distort-editor__control-head">
                    <span>Vertical</span>
                    <strong>{Math.round(draft().distortionVertical)}</strong>
                  </div>
                  <Slider
                    label=""
                    value={draft().distortionVertical}
                    min={-100}
                    max={100}
                    step={1}
                    default={0}
                    bipolar
                    title="Correct building or wall perspective tilt."
                    format={(v) => `${Math.round(v)}`}
                    onInput={(v) => {
                      handleInteractionStart();
                      setSlider("distortionVertical", v);
                    }}
                    onChange={(v) => {
                      handleInteractionEnd();
                      setSlider("distortionVertical", v);
                    }}
                  />
                </div>
              </section>

              <section id="distort-panel-perspective" class="distort-editor__section" role="tabpanel">
                <div class="distort-editor__toggle-row">
                  <span>Show Grid</span>
                  <button
                    class="distort-editor__chip-btn"
                    classList={{ "is-active": gridSize()[0] > 0 || draft().showGrid }}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, showGrid: !prev.showGrid }))}
                  >
                    {gridSize()[0] > 0 || draft().showGrid ? "On" : "Off"}
                  </button>
                </div>

                <div class="distort-editor__divider" />

                <div class="distort-editor__toggle-row">
                  <span>Auto Crop</span>
                  <button
                    class="distort-editor__chip-btn"
                    classList={{ "is-active": draft().autoCrop }}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, autoCrop: !prev.autoCrop }))}
                  >
                    {draft().autoCrop ? "On" : "Off"}
                  </button>
                </div>
              </section>
          </div>

          <button
            class="distort-editor__bypass-btn"
            type="button"
            onPointerDown={() => setCompareActive(true)}
            onPointerUp={() => setCompareActive(false)}
            onPointerCancel={() => setCompareActive(false)}
            onPointerLeave={() => setCompareActive(false)}
            onBlur={() => setCompareActive(false)}
          >
            Before
          </button>
        </div>
      </Show>
    </section>
  );
}

function clampSlider(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, value));
}
