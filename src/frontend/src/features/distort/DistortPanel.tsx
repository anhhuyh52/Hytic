import { batch } from "solid-js";
import { editState, setEditState } from "../../app/editor-store";
import type { EditState } from "../../engine/state/EditState";
import { DEFAULT_DISTORT_STATE, cloneDistortState } from "./distortDefaults";
import { calculateAutoCropForDistortion } from "./perspectiveMath";
import { DistortSliderGroup, type DistortSliderSpec } from "./DistortSliderGroup";

export function DistortPanel(props: {
  image?: { width: number; height: number };
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  clearPreviewPatch?: (reason?: string) => void;
}) {
  const sliders = (): DistortSliderSpec[] => [
    {
      key: "distortionAmount",
      label: "Lens Distortion",
      title: "Correct wide-angle or fisheye lens bending.",
      value: editState.distort.distortionAmount,
    },
    {
      key: "distortionHorizontal",
      label: "Horizontal",
      title: "Correct left/right perspective tilt.",
      value: editState.distort.distortionHorizontal,
    },
    {
      key: "distortionVertical",
      label: "Vertical",
      title: "Correct building or wall perspective tilt.",
      value: editState.distort.distortionVertical,
    },
  ];

  const preview = (next: EditState["distort"], reason: string) => {
    props.previewEditPatch?.({ distort: next }, reason);
  };

  const finishPreview = (reason: string) => {
    queueMicrotask(() => props.clearPreviewPatch?.(reason));
  };

  const setSlider = (key: DistortSliderSpec["key"], value: number, commit: boolean) => {
    const next = {
      ...editState.distort,
      enabled: true,
      [key]: value,
    };
    if (commit) {
      setEditState("distort", next);
      finishPreview("distort-slider");
      return;
    }
    preview(next, "distort-slider-drag");
  };

  const reset = () => {
    setEditState("distort", cloneDistortState(DEFAULT_DISTORT_STATE));
  };

  const applyAutoCrop = () => {
    const image = props.image;
    if (!image) return;
    const crop = calculateAutoCropForDistortion(
      editState.distort.distortionPoints,
      image.width,
      image.height,
    );
    batch(() => {
      setEditState("transform", {
        ...editState.transform,
        enabled: true,
        cropEnabled: true,
        cropX: crop.x,
        cropY: crop.y,
        cropWidth: crop.width,
        cropHeight: crop.height,
      });
      setEditState("distort", "autoCrop", true);
    });
  };

  return (
    <div class="poto-distort">
      <div class="poto-distort-actions">
        <button
          type="button"
          class="poto-distort-button"
          classList={{ "is-active": editState.distort.perspectiveMode }}
          title="Drag corners to manually straighten perspective."
          onClick={() =>
            setEditState("distort", {
              ...editState.distort,
              enabled: true,
              perspectiveMode: !editState.distort.perspectiveMode,
              showGrid: !editState.distort.perspectiveMode ? true : editState.distort.showGrid,
            })
          }
        >
          Perspective
        </button>
        <button type="button" class="poto-distort-button" onClick={reset}>
          Reset
        </button>
      </div>

      <DistortSliderGroup
        sliders={sliders()}
        onInput={(key, value) => setSlider(key, value, false)}
        onChange={(key, value) => setSlider(key, value, true)}
      />

      <div class="poto-distort-actions poto-distort-actions--bottom">
        <button
          type="button"
          class="poto-distort-toggle"
          classList={{ "is-active": editState.distort.autoCrop }}
          aria-pressed={editState.distort.autoCrop}
          onClick={() => {
            const next = !editState.distort.autoCrop;
            setEditState("distort", "autoCrop", next);
            if (next) applyAutoCrop();
          }}
        >
          Auto Crop
        </button>
        <button
          type="button"
          class="poto-distort-toggle"
          classList={{ "is-active": editState.distort.showGrid }}
          aria-pressed={editState.distort.showGrid}
          onClick={() => setEditState("distort", "showGrid", (show) => !show)}
        >
          Grid
        </button>
      </div>
    </div>
  );
}
