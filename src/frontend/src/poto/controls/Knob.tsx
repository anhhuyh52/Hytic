/**
 * Knob.tsx — Neumorphic rotary knob for Fx panels (dark-first).
 *
 * Drop-in replacement for the existing Knob component.
 * API is identical:
 *   <Knob label="Halation" min={0} max={1} default={0} format={pct}
 *         value={...} onInput={(v) => ...} />
 *
 * Sizing: the knob face is 80 px — fits the poto-fx-left column.
 * Interaction: drag up/down to change value; double-click resets to `default`.
 */

import { createSignal } from "solid-js";
import { createControlPerf } from "./controlPerf";
import { createRafInput } from "./rafInput";

// ── neumorphic dark tokens (mirror ControlPanel.tsx) ─────────────────────
const D = {
  bg: "#1e1e1e",
  s1: "#111111", // dark shadow
  s2: "#2e2e2e", // light shadow
  knobHi: "#2c2c2c",
  knobLo: "#161616",
  inHi: "#272727",
  inLo: "#1c1c1c",
  trackIdle: "#333333",
  trackAct: "#E1DCC9",
  tickAct: "#555555",
  tickIdle: "#333333",
  text: "#c8c8c8",
  muted: "#606060",
  accent: "#E1DCC9",
  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
} as const;

// ── geometry ─────────────────────────────────────────────────────────────
const SIZE = 80; // outer SVG / container size
const CX = SIZE / 2;
const CY = SIZE / 2;
const TRACK_R = SIZE * 0.4;
const KNOB_D = SIZE * 0.64; // diameter of the raised disc
const KNOB_OFF = (SIZE - KNOB_D) / 2;
const DOT_R_ORBT = SIZE * 0.27; // orbit radius of indicator dot
const MIN_DEG = -135;
const MAX_DEG = 135;
const SPAN = MAX_DEG - MIN_DEG;
const NUM_TICKS = 9;

// Arc circumference fraction (270° of a full circle)
const ARC_LEN = 2 * Math.PI * TRACK_R * (SPAN / 360);

function polar(r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

// Fixed two-segment arc path (avoids SVG large-arc flip at 180°)
function buildArcPath(r: number) {
  const mid = (MIN_DEG + MAX_DEG) / 2; // 0° = top
  const s = polar(r, MIN_DEG);
  const m = polar(r, mid);
  const e = polar(r, MAX_DEG);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${m.x} ${m.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
}

const ARC_PATH = buildArcPath(TRACK_R);

const TICKS = Array.from({ length: NUM_TICKS }, (_, i) => {
  const t = i / (NUM_TICKS - 1);
  const deg = MIN_DEG + t * SPAN;
  return {
    outer: polar(TRACK_R + SIZE * 0.055, deg),
    inner: polar(TRACK_R - SIZE * 0.04, deg),
    major: i === 0 || i === NUM_TICKS - 1 || i === Math.floor(NUM_TICKS / 2),
    t,
  };
});

// ── component ─────────────────────────────────────────────────────────────
export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  default: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

export function Knob(props: KnobProps) {
  let bodyEl!: HTMLDivElement;
  let dragging = false;
  let lastY = 0;
  let dragNorm = 0;
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf(`knob:${props.label}`);
  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const currentValue = () => liveValue() ?? props.value;
  const norm = () => (currentValue() - props.min) / (props.max - props.min); // 0..1

  const dashOff = () => ARC_LEN * (1 - norm());
  const dot = () => polar(DOT_R_ORBT, MIN_DEG + norm() * SPAN);

  function fromNorm(n: number) {
    const clamped = Math.max(0, Math.min(1, n));
    return props.min + clamped * (props.max - props.min);
  }

  const onPointerDown = (e: PointerEvent) => {
    perf.begin();
    dragging = true;
    lastY = e.clientY;
    dragNorm = norm();
    bodyEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    perf.pointer();
    const dy = lastY - e.clientY;
    lastY = e.clientY;
    dragNorm = Math.max(0, Math.min(1, dragNorm + dy / 150));
    input.schedule(fromNorm(dragNorm));
  };
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    input.flush();
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

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "6px",
        "user-select": "none",
      }}
    >
      {/* ── SVG layer: track arcs + ticks + indicator dot ── */}
      <div style={{ position: "relative", width: `${SIZE}px`, height: `${SIZE}px` }}>
        <svg
          width={SIZE}
          height={SIZE}
          style={{ position: "absolute", inset: "0", overflow: "visible" }}
        >
          {/* idle track */}
          <path
            d={ARC_PATH}
            fill="none"
            stroke={D.trackIdle}
            stroke-width={SIZE * 0.03}
            stroke-linecap="round"
          />
          {/* active track — dashoffset reveal, never recomputes geometry */}
          <path
            d={ARC_PATH}
            fill="none"
            stroke={D.trackAct}
            stroke-width={SIZE * 0.038}
            stroke-linecap="round"
            stroke-dasharray={`${ARC_LEN}`}
            stroke-dashoffset={dashOff()}
            style={{ filter: `drop-shadow(0 0 3px ${D.accent}88)` }}
          />
          {/* tick marks */}
          {TICKS.map((tk) => (
            <line
              x1={tk.inner.x}
              y1={tk.inner.y}
              x2={tk.outer.x}
              y2={tk.outer.y}
              stroke={tk.t <= norm() ? D.tickAct : D.tickIdle}
              stroke-width={tk.major ? SIZE * 0.028 : SIZE * 0.018}
              stroke-linecap="round"
            />
          ))}
        </svg>

        {/* ── neumorphic knob body ── */}
        <div
          ref={bodyEl}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDblClick={onDblClick}
          style={{
            position: "absolute",
            top: `${KNOB_OFF}px`,
            left: `${KNOB_OFF}px`,
            width: `${KNOB_D}px`,
            height: `${KNOB_D}px`,
            "border-radius": "50%",
            cursor: "ns-resize",
            "touch-action": "none",
            background: `linear-gradient(145deg, ${D.knobHi}, ${D.knobLo})`,
            "box-shadow": [
              `${SIZE * 0.038}px ${SIZE * 0.038}px ${SIZE * 0.076}px ${D.s1}`,
              `-${SIZE * 0.026}px -${SIZE * 0.026}px ${SIZE * 0.058}px ${D.s2}`,
            ].join(", "),
          }}
        >
          {/* inner bevel */}
          <div
            style={{
              position: "absolute",
              inset: `${SIZE * 0.028}px`,
              "border-radius": "50%",
              background: `linear-gradient(145deg, ${D.inHi}, ${D.inLo})`,
              "box-shadow": `inset 2px 2px 5px ${D.s1}cc, inset -1px -1px 4px ${D.s2}`,
            }}
          />
        </div>

        {/* ── indicator dot (SVG on top, pointer-events none) ── */}
        <svg
          width={SIZE}
          height={SIZE}
          style={{ position: "absolute", inset: "0", "pointer-events": "none" }}
        >
          <circle
            cx={dot().x}
            cy={dot().y}
            r={SIZE * 0.058}
            fill={D.accent}
            style={{ filter: `drop-shadow(0 1px 4px ${D.accent}bb)` }}
          />
        </svg>
      </div>

      {/* ── label + formatted value ── */}
      <div style={{ "text-align": "center", "line-height": "1.3" }}>
        <div
          style={{
            "font-family": D.font,
            "font-size": "9px",
            "font-weight": "600",
            color: D.muted,
            "letter-spacing": "0.10em",
            "text-transform": "uppercase",
          }}
        >
          {props.label}
        </div>
        <div
          style={{
            "font-family": `'JetBrains Mono', 'Fira Code', monospace`,
            "font-size": "11px",
            color: D.text,
            "margin-top": "1px",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {props.format(currentValue())}
        </div>
      </div>
    </div>
  );
}
