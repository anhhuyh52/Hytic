import { createSignal } from "solid-js";
import { createControlPerf } from "./controlPerf";
import { createRafInput } from "./rafInput";

const D = {
  shell: "#18181b",
  shellBorder: "#303035",
  grainDot: "rgba(255,255,255,0.045)",
  fillDot: "rgba(255,255,255,0.08)",
  thumb: "#a9a9ad",
  thumbBorder: "#c3c3c7",
  thumbLine: "rgba(20,20,22,0.42)",
  text: "#d7d7d9",
  muted: "#747478",
  focus: "#6d6d72",
  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
} as const;

const SLIDER_W = 54;
const SLIDER_MIN_H = 116;
const THUMB_INSET = 6;
const THUMB_H = 14;

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export interface FxVerticalKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  default: number;
  format: (v: number) => string;
  perfId: string;
  gradient: readonly string[];
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

function gradientStops(colors: readonly string[]) {
  if (colors.length <= 1) return colors[0] ?? "#3a3a3f";

  return colors
    .map((color, index) => {
      const stop = (index / (colors.length - 1)) * 100;
      return `${color} ${stop}%`;
    })
    .join(", ");
}

export function FxVerticalKnob(props: FxVerticalKnobProps) {
  let sliderEl!: HTMLDivElement;
  let dragging = false;
  let sliderRect: DOMRect | null = null;
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf(props.perfId);

  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const range = () => props.max - props.min || 1;
  const currentValue = () => liveValue() ?? props.value;
  const norm = () => clamp01((currentValue() - props.min) / range());
  const revealTop = () => `${100 - norm() * 100}%`;
  const fillGradient = () => `linear-gradient(to top, ${gradientStops(props.gradient)})`;
  const thumbTop = () => {
    const inverted = 1 - norm();
    return `calc(${THUMB_H / 2}px + ${inverted * 100}% - ${inverted * THUMB_H}px)`;
  };

  function fromNorm(n: number) {
    return props.min + clamp01(n) * range();
  }

  function fromPointerY(clientY: number) {
    const { top, height } = sliderRect ?? sliderEl.getBoundingClientRect();
    return fromNorm(1 - (clientY - top) / height);
  }

  function commit() {
    input.flush();
    props.onChange?.(currentValue());
    setLiveValue(null);
  }

  const onPointerDown = (e: PointerEvent) => {
    perf.begin();
    dragging = true;
    sliderRect = sliderEl.getBoundingClientRect();
    sliderEl.setPointerCapture(e.pointerId);

    const value = fromPointerY(e.clientY);
    setLiveValue(value);
    props.onInput(value);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    perf.pointer();
    input.schedule(fromPointerY(e.clientY));
  };

  const onPointerUp = () => {
    if (!dragging) return;

    dragging = false;
    sliderRect = null;
    commit();
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

    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      input.schedule(fromNorm(norm() + step));
      commit();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      input.schedule(fromNorm(norm() - step));
      commit();
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      input.schedule(props.min);
      commit();
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      input.schedule(props.max);
      commit();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onDblClick();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "5px",
        height: "100%",
        "min-height": `${SLIDER_MIN_H + 34}px`,
        "user-select": "none",
      }}
    >
      <div
        style={{
          "font-family": D.font,
          "font-size": "9px",
          "font-weight": "600",
          color: D.muted,
          "letter-spacing": "0.06em",
          "line-height": "12px",
          "text-transform": "uppercase",
          "white-space": "nowrap",
        }}
      >
        {props.label}
      </div>

      <div
        ref={sliderEl}
        role="slider"
        tabIndex={0}
        aria-label={props.label}
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        aria-valuenow={currentValue()}
        aria-valuetext={props.format(currentValue())}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        onKeyDown={onKeyDown}
        onFocus={() => {
          sliderEl.style.outline = `1px solid ${D.focus}`;
          sliderEl.style.outlineOffset = "3px";
        }}
        onBlur={() => {
          sliderEl.style.outline = "none";
          sliderEl.style.outlineOffset = "0";
        }}
        style={{
          position: "relative",
          width: `${SLIDER_W}px`,
          height: "100%",
          "min-height": `${SLIDER_MIN_H}px`,
          flex: "1 1 auto",
          "border-radius": "18px",
          overflow: "hidden",
          cursor: "ns-resize",
          "touch-action": "none",
          outline: "none",
          isolation: "isolate",
          background:
            `linear-gradient(rgba(24,24,27,0.7), rgba(24,24,27,0.7)), ` +
            `radial-gradient(circle, ${D.grainDot} 1px, transparent 1.5px), ${fillGradient()}`,
          "background-size": "100% 100%, 7px 7px, 100% 100%",
          border: `1px solid ${D.shellBorder}`,
          "box-shadow": "none",
          "box-sizing": "border-box",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "3px",
            right: "3px",
            top: "3px",
            bottom: "3px",
            "pointer-events": "none",
            "border-radius": "15px",
            background: `radial-gradient(circle, ${D.fillDot} 1px, transparent 1.5px), ${fillGradient()}`,
            "background-size": "5px 5px, 100% 100%",
            "clip-path": `inset(${revealTop()} 0 0 0 round 15px)`,
            "box-shadow": "none",
            "z-index": "2",
          }}
        />

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${THUMB_INSET}px`,
            right: `${THUMB_INSET}px`,
            top: thumbTop(),
            height: `${THUMB_H}px`,
            "border-radius": "999px",
            "pointer-events": "none",
            "z-index": "5",
            transform: `translateY(-${THUMB_H / 2}px)`,
            background: D.thumb,
            border: `1px solid ${D.thumbBorder}`,
            "box-shadow": "none",
            "box-sizing": "border-box",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "8px",
              right: "8px",
              top: "50%",
              height: "1px",
              transform: "translateY(-50%)",
              background: D.thumbLine,
            }}
          />
        </div>
      </div>

      <div
        style={{
          "font-size": "11px",
          color: D.text,
          "font-variant-numeric": "tabular-nums",
          "line-height": "12px",
        }}
      >
        {props.format(currentValue())}
      </div>
    </div>
  );
}
