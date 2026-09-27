import { createSignal, onCleanup } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";

/**
 * Legacy `numerical-slider` (arrows="none" variant used by Refraction separation):
 * horizontal drag-to-scrub over the value, double-click to type a value. Range is
 * [min,max]; shift slows the scrub for fine control.
 */
export function NumericalSlider(props: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  disabled?: boolean;
  title?: string;
  onInput: (value: number) => void;
  onChange?: (value: number) => void;
}) {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 1;
  const step = () => props.step ?? 0.01;
  const decimals = () => props.decimals ?? 2;
  const [editing, setEditing] = createSignal(false);
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf("numerical-slider");
  let inputRef: HTMLInputElement | undefined;
  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const clamp = (v: number) => Math.max(min(), Math.min(max(), v));
  const currentValue = () => liveValue() ?? props.value;
  const display = () => currentValue().toFixed(decimals());

  onCleanup(input.cancel);

  function onPointerDown(e: PointerEvent) {
    if (props.disabled || editing()) return;
    perf.begin();
    e.preventDefault();
    let lastX = e.clientX;
    let scratchValue = currentValue();
    const span = max() - min();
    const move = (ev: PointerEvent) => {
      perf.pointer();
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      const speed = ((ev.shiftKey ? 0.25 : 1) * span) / 200; // 200px ≈ full range
      scratchValue = clamp(scratchValue + dx * speed);
      input.schedule(scratchValue);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      perf.end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function commitEdit() {
    if (!inputRef) return;
    const v = parseFloat(inputRef.value);
    if (Number.isFinite(v)) {
      const value = clamp(Math.round(v / step()) * step());
      input.cancel();
      props.onInput(value);
      props.onChange?.(value);
    }
    setEditing(false);
  }

  return (
    <span
      class="poto-numslider"
      classList={{ disabled: !!props.disabled }}
      title={props.title}
      onPointerDown={onPointerDown}
      onDblClick={() => {
        if (!props.disabled) {
          setEditing(true);
          queueMicrotask(() => inputRef?.select());
        }
      }}
    >
      {editing() ? (
        <input
          ref={inputRef}
          type="number"
          value={display()}
          min={min()}
          max={max()}
          step={step()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        display()
      )}
    </span>
  );
}
