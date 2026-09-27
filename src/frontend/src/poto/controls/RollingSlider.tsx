import { createEffect, createMemo, createSignal } from "solid-js";
import { createControlPerf } from "./controlPerf";

const D = {
  surface: "#1a1a1c",
  surfaceBorder: "#2e2e34",

  tick: "rgba(255,255,255,0.13)",

  marker: "#E1DCC9",

} as const;

export const ROLLING_SLIDER_STRIP_W = 28;

export function RollingSlider(props: {
  numLines?: number;
  title?: string;
  defaultValue?: number;
  value?: number;
  orientation?: "vertical" | "horizontal";
  onInputValue?: (value: number, prev: number) => number | void;
  onStart?: () => void;
  onStop?: () => void;
  onCommit?: () => void;
  resetTransitionMs?: number;
}) {
  let ref!: HTMLDivElement;
  const perf = createControlPerf("rolling-slider");

  const [dragging, setDragging] = createSignal(false);
  const [displayValue, setDisplayValue] = createSignal(clamp01(props.value ?? 0.5));

  let lastClickTime = 0;

  const vertical = () => props.orientation !== "horizontal";
  const defaultValue = () => clamp01(props.defaultValue ?? 0.5);
  const value = createMemo(() => clamp01(props.value ?? 0.5));

  createEffect(() => {
    if (!dragging()) {
      setDisplayValue(value());
    }
  });

  // Vertical visual is inverted:
  // value 1 = top, value 0 = bottom.
  const markerPct = createMemo(() =>
    vertical() ? (1 - displayValue()) * 100 : displayValue() * 100,
  );

  const tickPositions = () => {
    const n = props.numLines ?? 5;
    const gap = 100 / (n + 1);

    return Array.from({ length: n }, (_, i) => (i + 1) * gap);
  };

  function emitValue(nextValue: number, prevValue: number, commit = false) {
    const next = clamp01(nextValue);
    const prev = clamp01(prevValue);

    setDisplayValue(next);
    props.onInputValue?.(next, prev);

    if (commit && next !== prev) {
      props.onCommit?.();
    }
  }

  function resetToDefault() {
    const previous = displayValue();
    const next = defaultValue();

    if (next === previous) return;

    emitValue(next, previous, true);
  }

  function onPointerDown(e: PointerEvent) {
    perf.begin();
    e.preventDefault();
    e.stopPropagation();

    const rect = ref.getBoundingClientRect();
    const size = vertical() ? rect.height || 1 : rect.width || 1;

    const startPointer = vertical() ? e.clientY : e.clientX;
    const startValue = displayValue();

    let previousValue = startValue;
    let moved = false;

    setDragging(true);
    props.onStart?.();

    ref.setPointerCapture?.(e.pointerId);

    const move = (ev: PointerEvent) => {
      perf.pointer();
      ev.preventDefault();
      ev.stopPropagation();

      const pointer = vertical() ? ev.clientY : ev.clientX;

      const delta = vertical() ? (startPointer - pointer) / size : (pointer - startPointer) / size;

      const nextValue = clamp01(startValue + delta);

      if (nextValue !== previousValue) {
        moved = true;
        const accepted = props.onInputValue?.(nextValue, previousValue);
        setDisplayValue(typeof accepted === "number" ? accepted : nextValue);
        previousValue = nextValue;
      }
    };

    const finish = (ev: PointerEvent) => {
      ev.preventDefault();
      ev.stopPropagation();

      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);

      if (ref.hasPointerCapture?.(ev.pointerId)) {
        ref.releasePointerCapture(ev.pointerId);
      }

      setDragging(false);

      if (moved) {
        if (previousValue !== startValue) {
          props.onCommit?.();
        }

        setDisplayValue(value());
      } else {
        const now = Date.now();
        const elapsed = now - lastClickTime;

        if (elapsed > 0 && elapsed < 500) {
          resetToDefault();
          lastClickTime = 1000;
        } else {
          lastClickTime = now;
        }
      }

      props.onStop?.();
      perf.end();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const previous = displayValue();

    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      emitValue(previous + step, previous, true);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      emitValue(previous - step, previous, true);
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      emitValue(0, previous, true);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      emitValue(1, previous, true);
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      resetToDefault();
    }
  }

  return (
    <div
      ref={ref}
      title={props.title}
      role="slider"
      tabIndex={0}
      aria-label={props.title ?? "Curve offset"}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={displayValue()}
      aria-orientation={vertical() ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onFocus={() => {
        ref.style.outlineOffset = "3px";
      }}
      onBlur={() => {
        ref.style.outline = "none";
        ref.style.outlineOffset = "0";
      }}
      style={{
        position: "relative",
        width: vertical() ? `${ROLLING_SLIDER_STRIP_W}px` : "100%",
        height: vertical() ? "auto" : `${ROLLING_SLIDER_STRIP_W}px`,
        "min-height": vertical() ? "0" : undefined,
        "align-self": vertical() ? "stretch" : undefined,
        cursor: vertical() ? "ns-resize" : "ew-resize",
        "user-select": "none",
        "touch-action": "none",
        "flex-shrink": "0",
        outline: "none",
      }}
    >
      {/* static ticks */}
      <div
        style={{
          position: "absolute",
          inset: "0",
          "pointer-events": "none",
        }}
      >
        {tickPositions().map((pct) => (
          <div
            style={{
              position: "absolute",
              background: D.tick,
              ...(vertical()
                ? {
                    left: "18%",
                    right: "18%",
                    top: `${pct}%`,
                    height: "1px",
                  }
                : {
                    top: "18%",
                    bottom: "18%",
                    left: `${pct}%`,
                    width: "1px",
                  }),
            }}
          />
        ))}
      </div>

      {/* active drag wash */}
      {dragging() && (
        <div
          style={{
            position: "absolute",
            inset: "0",
            "pointer-events": "none",
          }}
        />
      )}

      {/* moving marker */}
      <div
        style={{
          position: "absolute",
          background: D.marker,
          "pointer-events": "none",
          transition: dragging()
            ? "none"
            : `top ${props.resetTransitionMs ?? 100}ms, left ${props.resetTransitionMs ?? 100}ms`,
          ...(vertical()
            ? {
                left: "12%",
                right: "12%",
                top: `${markerPct()}%`,
                height: "2px",
                "margin-top": "-1px",
                "border-radius": "1px",
              }
            : {
                top: "12%",
                bottom: "12%",
                left: `${markerPct()}%`,
                width: "2px",
                "margin-left": "-1px",
                "border-radius": "1px",
              }),
        }}
      />

      {/* active nearest tick guide */}
      <div
        style={{
          position: "absolute",
          "pointer-events": "none",
          ...(vertical()
            ? {
                left: "0",
                right: "0",
                top: `${markerPct()}%`,
                height: "1px",
                "margin-top": "-0.5px",
              }
            : {
                top: "0",
                bottom: "0",
                left: `${markerPct()}%`,
                width: "1px",
                "margin-left": "-0.5px",
              }),
        }}
      />
    </div>
  );
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
