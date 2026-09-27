import { createSignal, onCleanup, Show } from "solid-js";
import type { DepthMaskComponent } from "../../engine/state/EditState";
import type { ViewerApi } from "../../ui/Viewer";

export function OverlayDepthMaskToolbar(props: {
  mask: DepthMaskComponent;
  viewerApi?: ViewerApi;
  onUpdate(patch: Partial<DepthMaskComponent>): void;
  onCommit(): void;
  available?: boolean;
  unavailableReason?: string | null;
}) {
  const [picking, setPicking] = createSignal(false);
  let pointerId: number | null = null;

  const sample = (event: PointerEvent) => {
    if (!picking() || (pointerId !== null && event.pointerId !== pointerId)) return;
    const target = props.viewerApi?.readDepthPixelAtClient(event.clientX, event.clientY);
    if (target === null || target === undefined) return;
    event.preventDefault();
    props.onUpdate({ target, showOverlay: true });
  };

  const finishPicking = (event?: PointerEvent) => {
    if (!picking() || (event && pointerId !== null && event.pointerId !== pointerId)) return;
    setPicking(false);
    pointerId = null;
    window.removeEventListener("pointermove", sample);
    window.removeEventListener("pointerup", finishPicking);
    window.removeEventListener("pointercancel", finishPicking);
    props.viewerApi?.setInteractionLock(false);
    props.onUpdate({ showOverlay: false });
    props.onCommit();
  };

  const activatePicker = () => {
    setPicking(true);
    props.viewerApi?.setInteractionLock(true);
    props.onUpdate({ showOverlay: true });
  };

  const beginSample = (event: PointerEvent) => {
    pointerId = event.pointerId;
    sample(event);
    window.addEventListener("pointermove", sample, { passive: false });
    window.addEventListener("pointerup", finishPicking);
    window.addEventListener("pointercancel", finishPicking);
  };

  onCleanup(() => {
    window.removeEventListener("pointermove", sample);
    window.removeEventListener("pointerup", finishPicking);
    window.removeEventListener("pointercancel", finishPicking);
    props.viewerApi?.setInteractionLock(false);
  });

  const slider = (
    name: "target" | "range",
    label: string,
    icon: string,
  ) => (
    <label class="overlay-depth-toolbar__control overlay-depth-toolbar__slider" title={`${label}: ${Math.round(props.mask[name] * 100)}%`}>
      <span aria-hidden="true">{icon}</span>
      <input
        type="range"
        min={name === "range" ? "0.01" : "0"}
        max="1"
        step="0.01"
        value={props.mask[name]}
        aria-label={label}
        disabled={props.available === false}
        onPointerDown={() => props.onUpdate({ showOverlay: true })}
        onInput={(event) => props.onUpdate({ [name]: event.currentTarget.valueAsNumber, showOverlay: true })}
        onChange={() => { props.onUpdate({ showOverlay: false }); props.onCommit(); }}
      />
      <i style={{ height: `${Math.round(props.mask[name] * 100)}%` }} />
    </label>
  );

  return (
    <>
      <Show when={picking()}>
        <div class="overlay-depth-picker-surface" onPointerDown={beginSample} aria-label="Choose depth from photo" />
      </Show>
      <div class="overlay-depth-toolbar" role="toolbar" aria-label="Depth mask controls" style={{ width: "176px" }}>
        <button
          type="button"
          class="overlay-depth-toolbar__control"
          classList={{ active: picking() }}
          data-panelid="picker"
          data-name="picker"
          title={props.available === false ? (props.unavailableReason ?? "Depth Mask unavailable") : "Pick depth from photo"}
          disabled={props.available === false}
          onClick={activatePicker}
        >
          <span aria-hidden="true">⌖</span><span class="sr-only">Picker</span>
        </button>
        {slider("target", "Depth target", "◉")}
        {slider("range", "Depth range", "◌")}
        <button
          type="button"
          class="overlay-depth-toolbar__control"
          classList={{ active: props.mask.invert }}
          data-panelid="invert"
          data-name="invert"
          title={props.available === false ? (props.unavailableReason ?? "Depth Mask unavailable") : "Invert depth mask"}
          disabled={props.available === false}
          onClick={() => {
            props.onUpdate({ invert: !props.mask.invert, showOverlay: true });
            window.setTimeout(() => props.onUpdate({ showOverlay: false }), 450);
            props.onCommit();
          }}
        >
          <span aria-hidden="true">◐</span><span class="sr-only">Invert</span>
        </button>
      </div>
    </>
  );
}
