/**
 * Slider.tsx â€” Flat minimal horizontal slider for Fx panels.
 *
 * Drop-in replacement for the existing Slider component.
 *
 * API:
 *   <Slider
 *     label="Light Spill"
 *     min={0}
 *     max={1}
 *     default={0.5}
 *     format={dec2}
 *     title="..."
 *     bipolar
 *     value={...}
 *     onInput={(v) => ...}
 *   />
 *
 * Variants:
 *   "default"     â†’ orange active fill
 *   "match-color" â†’ color-match gradient fill
 *   "match-tone"  â†’ tone-match gradient fill
 *
 * Visual style:
 * - flat dark groove
 * - flat thumb with 1px border
 * - no neumorphic shadow
 * - no glow
 * - no bevel
 */

import { createSignal, Show } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";
import { consumeContextMenuEvent } from "../contextMenuGuards";

// â”€â”€ flat dark tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const D = {
  bg: "#1e1e1e",

  groove: "#2a2a2a",
  grooveMatch: "#242426",
  grooveBorder: "#363636",
  grooveBorderMatch: "#38383d",

  fill: "#E1DCC9",

  thumb: "#262626",
  thumbBorder: "#3a3a3a",
  thumbDot: "#E1DCC9",
  thumbDotNeutral: "#66666c",

  tickAct: "#E1DCC9",
  tickIdle: "#333333",

  text: "#c8c8c8",
  muted: "#606060",

  matchLabel: "#7f7e86",
  matchValue: "#8f8e96",

  accent: "#E1DCC9",
  focusRing: "#6a2d16",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
  mono: "'JetBrains Mono', 'Fira Code', monospace",

  matchColorGradient:
    "linear-gradient(90deg, #57575a 0%, #4b5f5c 20%, #1f7472 43%, #286f3b 62%, #6f6917 80%, #8d2f1f 100%)",

  matchToneGradient: "linear-gradient(90deg, #171719 0%, #303034 36%, #626268 70%, #888891 100%)",
} as const;

// â”€â”€ geometry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TRACK_H = 5;
const MATCH_TRACK_H = 6;

const THUMB_D = 18;
const MATCH_THUMB_D = 22;

const NUM_TICKS = 7;

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  default: number;
  format: (v: number) => string;
  bipolar?: boolean;
  title?: string;
  hideValue?: boolean;
  variant?: "default" | "match-color" | "match-tone";
  onInput: (v: number) => void;
  onChange?: (value: number) => void;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function Slider(props: SliderProps) {
  let trackEl!: HTMLDivElement;

  let dragging = false;
  let trackRect: DOMRect | null = null;
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf(`slider:${props.label}`);

  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const isMatch = () => props.variant === "match-color" || props.variant === "match-tone";

  const range = () => props.max - props.min || 1;

  const currentValue = () => liveValue() ?? props.value;
  const norm = () => clamp01((currentValue() - props.min) / range());

  const pct = () => `${norm() * 100}%`;

  const trackHeight = () => (isMatch() ? MATCH_TRACK_H : TRACK_H);

  const thumbSize = () => (isMatch() ? MATCH_THUMB_D : THUMB_D);

  const rowHeight = () => (isMatch() ? 24 : THUMB_D);

  const trackTop = () => `${(rowHeight() - trackHeight()) / 2}px`;

  function snapValue(raw: number) {
    if (!props.step) {
      return clamp(raw, props.min, props.max);
    }

    const snapped = props.min + Math.round((raw - props.min) / props.step) * props.step;

    return clamp(snapped, props.min, props.max);
  }

  function fromNorm(n: number) {
    return snapValue(props.min + clamp01(n) * range());
  }

  function fromTrackX(clientX: number) {
    const { left, width } = trackRect ?? trackEl.getBoundingClientRect();
    return fromNorm((clientX - left) / width);
  }

  const onPointerDown = (e: PointerEvent) => {
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
    const value = currentValue();
    props.onChange?.(value);
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
    const fallbackStep = range() * (e.shiftKey ? 0.1 : 0.01);
    const step = props.step ?? fallbackStep;

    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      input.schedule(snapValue(props.value + step));
      input.flush();
      props.onChange?.(currentValue());
      setLiveValue(null);
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      input.schedule(snapValue(props.value - step));
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

  // â”€â”€ fill geometry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Unipolar: fill spans 0% â†’ value.
  // Bipolar: fill spans center 50% â†’ value.
  const fillLeft = () => (props.bipolar ? (norm() >= 0.5 ? "50%" : pct()) : "0%");

  const fillWidth = () => (props.bipolar ? `${Math.abs(norm() - 0.5) * 100}%` : pct());

  const trackBackground = () => {
    if (props.variant === "match-color") return D.matchColorGradient;
    if (props.variant === "match-tone") return D.matchToneGradient;
    return D.fill;
  };

  const grooveColor = () => (isMatch() ? D.grooveMatch : D.groove);

  const grooveBorder = () => (isMatch() ? D.grooveBorderMatch : D.grooveBorder);

  const labelColor = () => (isMatch() ? D.matchLabel : D.muted);

  const valueColor = () => (isMatch() ? D.matchValue : D.accent);

  const labelFontSize = () => (isMatch() ? "14px" : "9px");

  const valueFontSize = () => (isMatch() ? "14px" : "10px");

  const labelWeight = () => (isMatch() ? "700" : "600");

  const valueWeight = () => (isMatch() ? "700" : undefined);

  const labelTransform = () => (isMatch() ? "none" : "uppercase");

  const labelLetterSpacing = () => (isMatch() ? "0" : "0.09em");

  const dotColor = () => (isMatch() ? D.thumbDotNeutral : D.thumbDot);

  const tickPositions = Array.from({ length: NUM_TICKS }, (_, i) => i / (NUM_TICKS - 1));

  return (
    <div
      title={props.title}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: isMatch() ? "8px" : "4px",
        width: "100%",
      }}
    >
      {/* label + value */}
      <Show when={props.label || !props.hideValue}>
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
            "font-size": labelFontSize(),
            "font-weight": labelWeight(),
            color: labelColor(),
            "letter-spacing": labelLetterSpacing(),
            "text-transform": labelTransform(),
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.label}
        </span>

        <span
          style={{
            "font-family": isMatch() ? D.font : D.mono,
            "font-size": valueFontSize(),
            color: valueColor(),
            "font-weight": valueWeight(),
            "flex-shrink": "0",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {props.format(currentValue())}
        </span>
      </div>
      </Show>

      {/* track + thumb row */}
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
        onDblClick={onDblClick}
        onKeyDown={onKeyDown}
        onContextMenu={consumeContextMenuEvent}
        onFocus={() => {
          trackEl.style.outline = `1px solid ${D.focusRing}`;
          trackEl.style.outlineOffset = "3px";
        }}
        onBlur={() => {
          trackEl.style.outline = "none";
          trackEl.style.outlineOffset = "0";
        }}
        style={{
          position: "relative",
          width: "100%",
          height: `${rowHeight()}px`,
          cursor: "ew-resize",
          "user-select": "none",
          "touch-action": "none",
          outline: "none",
          "border-radius": `${thumbSize()}px`,
        }}
      >
        {/* flat groove */}
        <div
          style={{
            position: "absolute",
            left: "0",
            right: "0",
            top: trackTop(),
            height: `${trackHeight()}px`,
            "border-radius": "999px",
            background: grooveColor(),
            border: `1px solid ${grooveBorder()}`,
            "box-sizing": "border-box",
          }}
        />

        {/* active fill */}
        <div
          style={{
            position: "absolute",
            left: fillLeft(),
            width: fillWidth(),
            top: trackTop(),
            height: `${trackHeight()}px`,
            "border-radius": "999px",
            background: trackBackground(),
            opacity: isMatch() ? "0.9" : "0.95",
          }}
        />

        {/* bipolar center mark */}
        <Show when={props.bipolar}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              "margin-left": "-0.5px",
              top: `${(rowHeight() - trackHeight()) / 2 - 2}px`,
              width: "1px",
              height: `${trackHeight() + 4}px`,
              background: D.muted,
              opacity: "0.55",
            }}
          />
        </Show>

        {/* flat thumb */}
        <div
          style={{
            position: "absolute",
            left: pct(),
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: `${thumbSize()}px`,
            height: `${thumbSize()}px`,
            "border-radius": "50%",
            background: D.thumb,
            border: `1px solid ${D.thumbBorder}`,
            "box-sizing": "border-box",
            "flex-shrink": "0",
            "pointer-events": "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              "border-radius": "50%",
              width: isMatch() ? "6px" : `${THUMB_D * 0.3}px`,
              height: isMatch() ? "6px" : `${THUMB_D * 0.3}px`,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: dotColor(),
            }}
          />
        </div>
      </div>

      {/* tick marks */}
      <Show when={!isMatch()}>
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "8px",
          }}
        >
          {tickPositions.map((t) => (
            <div
              style={{
                position: "absolute",
                left: `${t * 100}%`,
                transform: "translateX(-50%)",
                top: "0",
                width: "1px",
                height: t === 0 || t === 1 ? "7px" : "4px",
                "border-radius": "1px",
                background: t <= norm() ? D.tickAct : D.tickIdle,
                opacity: t === 0 || t === 1 ? "0.65" : "0.38",
              }}
            />
          ))}
        </div>
      </Show>
    </div>
  );
}
