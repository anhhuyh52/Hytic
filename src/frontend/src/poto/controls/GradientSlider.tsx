/**
 * GradientSlider.tsx — Flat minimal spotlight slider for Fx panels.
 *
 * Supports two visual modes without changing the existing interaction API:
 *
 * 1. Standard mode
 *    - dark groove
 *    - active gold/grey fill
 *    - dark thumb with a colored center dot
 *
 * 2. Gradient mode (`gradientStops`)
 *    - the entire track displays the supplied gradient
 *    - the complete thumb samples the gradient at the current value
 *    - active ticks sample the same gradient
 *
 * Double-click, Enter, or Space resets the slider to `default`.
 */

import { createSignal, Show } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";

const D = {
  groove: "#2a2a2a",
  grooveBorder: "#363636",

  thumb: "#262626",
  thumbBorder: "#3a3a3a",
  gradientThumbBorder: "rgba(255, 255, 255, 0.92)",

  tickIdle: "#333333",

  text: "#c8c8c8",
  muted: "#606060",

  focusRing: "#6a4a13",
  accent: "#f5a000",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,

  // Gold mode — spotlight/focus.
  goldFrom: "#b36800",
  goldTo: "#f5a000",
  goldDot: "#f5a000",
  goldTick: "#c97b00",

  // Neutral mode — pop/bias.
  greyFrom: "#484848",
  greyTo: "#777777",
  greyDot: "#666666",
  greyTick: "#666666",
} as const;

const TRACK_H = 5;
const THUMB_D = 18;
const NUM_TICKS = 7;

export interface SliderGradientStop {
  /** Normalized stop position from 0 to 1. */
  position: number;
  /** Any modern CSS color value. */
  color: string;
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  default: number;
  format: (v: number) => string;
  bipolar?: boolean;
  gold?: boolean;
  title?: string;

  activeFill?: string;
  activeDot?: string;
  activeTick?: string;

  /**
   * Enables the full gradient-track mode.
   * The thumb color is interpolated from these same stops.
   */
  gradientStops?: readonly SliderGradientStop[];

  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeGradientStops(
  stops: readonly SliderGradientStop[] | undefined,
): SliderGradientStop[] {
  if (!stops || stops.length < 2) return [];

  return [...stops]
    .map((stop) => ({
      position: clamp01(stop.position),
      color: stop.color,
    }))
    .sort((a, b) => a.position - b.position);
}

export function buildGradient(stops: readonly SliderGradientStop[]) {
  return `linear-gradient(90deg, ${stops
    .map((stop) => `${stop.color} ${stop.position * 100}%`)
    .join(", ")})`;
}

/**
 * Returns a CSS color that interpolates between the two stops surrounding `t`.
 * `color-mix()` lets callers use hex, rgb(), hsl(), named colors, etc.
 */
export function sampleGradient(stops: readonly SliderGradientStop[], t: number) {
  if (stops.length === 0) return D.thumb;

  const position = clamp01(t);
  const first = stops[0];
  const last = stops[stops.length - 1];

  if (position <= first.position) return first.color;
  if (position >= last.position) return last.color;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const left = stops[index];
    const right = stops[index + 1];

    if (position < left.position || position > right.position) continue;

    const span = right.position - left.position;
    if (span <= 0) return right.color;

    const local = clamp01((position - left.position) / span);
    const leftWeight = (1 - local) * 100;
    const rightWeight = local * 100;

    return `color-mix(in srgb, ${left.color} ${leftWeight}%, ${right.color} ${rightWeight}%)`;
  }

  return last.color;
}

export function GradientSlider(props: SliderProps) {
  let trackEl!: HTMLDivElement;

  let dragging = false;
  let trackRect: DOMRect | null = null;

  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf(`gradient-slider:${props.label}`);

  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const range = () => props.max - props.min || 1;
  const currentValue = () => liveValue() ?? props.value;
  const norm = () => clamp01((currentValue() - props.min) / range());
  const pct = () => `${norm() * 100}%`;

  const gradientStops = () => normalizeGradientStops(props.gradientStops);
  const usesGradientTrack = () => gradientStops().length >= 2;
  const trackGradient = () => buildGradient(gradientStops());
  const sampledColor = (position = norm()) =>
    sampleGradient(gradientStops(), position);

  function fromNorm(normalized: number) {
    return props.min + clamp01(normalized) * range();
  }

  function fromTrackX(clientX: number) {
    const { left, width } = trackRect ?? trackEl.getBoundingClientRect();
    if (width <= 0) return currentValue();
    return fromNorm((clientX - left) / width);
  }

  const onPointerDown = (event: PointerEvent) => {
    perf.begin();
    dragging = true;
    trackRect = trackEl.getBoundingClientRect();

    trackEl.setPointerCapture(event.pointerId);

    const value = fromTrackX(event.clientX);
    setLiveValue(value);
    props.onInput(value);

    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;

    perf.pointer();
    input.schedule(fromTrackX(event.clientX));
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

  const resetToDefault = () => {
    input.cancel();
    setLiveValue(props.default);
    props.onInput(props.default);
    props.onChange?.(props.default);
    setLiveValue(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const normalizedStep = event.shiftKey ? 0.1 : 0.01;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      input.schedule(fromNorm(norm() + normalizedStep));
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      input.schedule(fromNorm(norm() - normalizedStep));
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      input.schedule(props.min);
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      input.schedule(props.max);
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      resetToDefault();
    }
  };

  // Standard mode only:
  // Unipolar fills 0% → value; bipolar fills center → value.
  const fillLeft = () =>
    props.bipolar ? (norm() >= 0.5 ? "50%" : pct()) : "0%";

  const fillWidth = () =>
    props.bipolar ? `${Math.abs(norm() - 0.5) * 100}%` : pct();

  const fillBackground = () =>
    props.activeFill
      ? props.activeFill
      : props.gold
        ? `linear-gradient(to right, ${D.goldFrom}, ${D.goldTo})`
        : `linear-gradient(to right, ${D.greyFrom}, ${D.greyTo})`;

  const standardDotColor = () => props.activeDot || (props.gold ? D.goldDot : D.greyDot);
  const standardTickColor = () => props.activeTick || (props.gold ? D.goldTick : D.greyTick);

  const thumbColor = () =>
    usesGradientTrack() ? sampledColor() : D.thumb;

  const activeTickColor = (position: number) =>
    usesGradientTrack() ? sampledColor(position) : standardTickColor();

  const valueColor = () =>
    usesGradientTrack()
      ? sampledColor()
      : props.gold
        ? D.accent
        : props.activeDot || D.text;

  const focusRing = () =>
    usesGradientTrack()
      ? `color-mix(in srgb, ${sampledColor()} 45%, transparent)`
      : D.focusRing;

  const tickPositions = Array.from(
    { length: NUM_TICKS },
    (_, index) => index / (NUM_TICKS - 1),
  );

  return (
    <div
      title={props.title}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "4px",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "baseline",
          gap: "6px",
        }}
      >
        <span
          style={{
            "font-family": D.font,
            "font-size": "9px",
            "font-weight": "600",
            color: D.muted,
            "letter-spacing": "0.09em",
            "text-transform": "uppercase",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.label}
        </span>

        <span
          style={{
            "font-size": "10px",
            color: valueColor(),
            "flex-shrink": "0",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {props.format(currentValue())}
        </span>
      </div>

      <div
        ref={trackEl}
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
        onDblClick={resetToDefault}
        onKeyDown={onKeyDown}
        onFocus={() => {
          trackEl.style.outline = `1px solid ${focusRing()}`;
          trackEl.style.outlineOffset = "3px";
        }}
        onBlur={() => {
          trackEl.style.outline = "none";
          trackEl.style.outlineOffset = "0";
        }}
        style={{
          position: "relative",
          width: "100%",
          height: `${THUMB_D}px`,
          cursor: "ew-resize",
          "user-select": "none",
          "touch-action": "none",
          outline: "none",
          "border-radius": `${THUMB_D}px`,
        }}
      >
        {/* Groove or full gradient track. */}
        <div
          style={{
            position: "absolute",
            left: "0",
            right: "0",
            top: `${(THUMB_D - TRACK_H) / 2}px`,
            height: `${TRACK_H}px`,
            "border-radius": `${TRACK_H / 2}px`,
            background: usesGradientTrack() ? trackGradient() : D.groove,
            border: `1px solid ${D.grooveBorder}`,
            "box-sizing": "border-box",
            overflow: "hidden",
          }}
        />

        {/* Existing active-fill behavior remains for non-gradient sliders. */}
        <Show when={!usesGradientTrack()}>
          <div
            style={{
              position: "absolute",
              left: fillLeft(),
              width: fillWidth(),
              top: `${(THUMB_D - TRACK_H) / 2}px`,
              height: `${TRACK_H}px`,
              "border-radius": `${TRACK_H / 2}px`,
              background: fillBackground(),
              opacity: "0.95",
            }}
          />
        </Show>

        <Show when={props.bipolar}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              "margin-left": "-0.5px",
              top: `${(THUMB_D - TRACK_H) / 2 - 2}px`,
              width: "1px",
              height: `${TRACK_H + 4}px`,
              background: D.muted,
              opacity: "0.72",
            }}
          />
        </Show>

        <div
          style={{
            position: "absolute",
            left: pct(),
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: `${THUMB_D}px`,
            height: `${THUMB_D}px`,
            "border-radius": "50%",
            background: thumbColor(),
            border: usesGradientTrack()
              ? `2px solid ${D.gradientThumbBorder}`
              : `1px solid ${D.thumbBorder}`,
            "box-sizing": "border-box",
            "pointer-events": "none",
            transition: "background 40ms linear",
          }}
        >
          <Show when={!usesGradientTrack()}>
            <div
              style={{
                position: "absolute",
                "border-radius": "50%",
                width: `${THUMB_D * 0.3}px`,
                height: `${THUMB_D * 0.3}px`,
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: standardDotColor(),
              }}
            />
          </Show>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "8px",
        }}
      >
        {tickPositions.map((position) => (
          <div
            style={{
              position: "absolute",
              left: `${position * 100}%`,
              transform: "translateX(-50%)",
              top: "0",
              width: "1px",
              height: position === 0 || position === 1 ? "7px" : "4px",
              "border-radius": "1px",
              background:
                position <= norm()
                  ? activeTickColor(position)
                  : D.tickIdle,
              opacity: position === 0 || position === 1 ? "0.65" : "0.38",
            }}
          />
        ))}
      </div>
    </div>
  );
}