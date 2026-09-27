import { createSignal, For } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";

export interface FeatherSliderProps {
  value: number;
  min: number;
  max: number;
  default: number;
  title?: string;
  trackGradient?: string;
  thumbColor?: string;
  thumbBorder?: string;
  thumbDot?: string;
  thumbGradient?: { from: string; to: string };
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function FeatherSlider(props: FeatherSliderProps) {
  let trackEl!: HTMLDivElement;
  let dragging = false;
  let trackRect: DOMRect | null = null;
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf(`feather-slider`);

  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const range = () => props.max - props.min || 1;
  const currentValue = () => liveValue() ?? props.value;
  const norm = () => clamp01((currentValue() - props.min) / range());
  const pct = () => `${norm() * 100}%`;
  const tickPositions = Array.from({ length: 7 }, (_, index) => index / 6);

  function fromNorm(n: number) {
    return props.min + clamp01(n) * range();
  }

  function fromTrackX(clientX: number) {
    const { left, width } = trackRect ?? trackEl.getBoundingClientRect();
    return fromNorm((clientX - left) / width);
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    perf.begin();
    dragging = true;
    trackRect = trackEl.getBoundingClientRect();

    trackEl.setPointerCapture(e.pointerId);
    const value = fromTrackX(e.clientX);
    setLiveValue(value);
    props.onInput(value);

    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    perf.pointer();
    input.schedule(fromTrackX(e.clientX));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    input.flush();
    trackRect = null;
    props.onChange?.(currentValue());
    setLiveValue(null);
    perf.end();
  };

  const onDblClick = () => {
    input.cancel();
    setLiveValue(props.default);
    props.onInput(props.default);
    props.onChange?.(props.default);
    setLiveValue(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;

    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      input.schedule(fromNorm(norm() + step));
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      input.schedule(fromNorm(norm() - step));
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      input.schedule(props.min);
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      input.schedule(props.max);
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.cancel();
      setLiveValue(props.default);
      props.onInput(props.default);
      props.onChange?.(props.default);
      setLiveValue(null);
    }
  };

  return (
    <div
      title={props.title}
      style={{ display: "flex", "flex-direction": "column", gap: "4px", width: "100%" }}
    >
      <div
        ref={trackEl}
        role="slider"
        tabIndex={0}
        aria-label="Feather"
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        aria-valuenow={currentValue()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        onKeyDown={onKeyDown}
        onFocus={() => {
          trackEl.style.outline = "1px solid #555";
          trackEl.style.outlineOffset = "3px";
        }}
        onBlur={() => {
          trackEl.style.outline = "none";
          trackEl.style.outlineOffset = "0";
        }}
        style={{
          position: "relative",
          width: "100%",
          height: "18px",
          cursor: "ew-resize",
          "user-select": "none",
          "touch-action": "none",
          outline: "none",
          "border-radius": "18px",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "6.5px",
            height: "5px",
            "border-radius": "2.5px",
            background: props.trackGradient ?? "linear-gradient(to right, #8a5a5a, #e60000)",
            border: "1px solid #363636",
            "box-sizing": "border-box",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: pct(),
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: "18px",
            height: "18px",
            "border-radius": "50%",
            background:
              props.thumbColor ??
              (props.thumbGradient
                ? `color-mix(in srgb, ${props.thumbGradient.from} ${norm() * 100}%, ${props.thumbGradient.to})`
                : "#262626"),
            border: `1px solid ${props.thumbBorder ?? "#3a3a3a"}`,
            "box-sizing": "border-box",
            "pointer-events": "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "5px",
              height: "5px",
              transform: "translate(-50%, -50%)",
              "border-radius": "50%",
              background:
                props.thumbDot ??
                (props.thumbGradient
                  ? `color-mix(in srgb, ${props.thumbGradient.from} ${norm() * 100}%, ${props.thumbGradient.to})`
                  : "#e60000"),
            }}
          />
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", height: "8px" }}>
        <For each={tickPositions}>
          {(position) => (
            <div
              style={{
                position: "absolute",
                left: `${position * 100}%`,
                transform: "translateX(-50%)",
                top: 0,
                width: "1px",
                height: position === 0 || position === 1 ? "7px" : "4px",
                background: position <= norm() ? "#8a5a5a" : "#333333",
                opacity: position === 0 || position === 1 ? 0.65 : 0.38,
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}
