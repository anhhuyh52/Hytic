import { createSignal, For, Show } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";
import { buildGradient, sampleGradient, type SliderGradientStop } from "./GradientSlider";

const CHANNELS = ["R", "G", "B"] as const;

// ── tokens ────────────────────────────────────────────────────────────────
const T = {
  bg: "#1e1e1e",

  card: "#222226",
  cardBdr: "#2e2e34",

  grooveBorder: "#36363a",

  thumb: "#262626",
  thumbBorder: "#3a3a3a",
  thumbDot: "#777777",

  text: "#c8c8c8",
  muted: "#606060",
  accent: "#E1DCC9",

  dash: "#404048",

  buttonBg: "#262626",
  buttonBgActive: "#2b211d",
  buttonBdr: "#34343a",
  buttonBdrActive: "#6a2d16",

  focusRing: "#5a392b",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

const TRACK_H = 4;
const THUMB_D = 16;

// per-channel accent colours for label + active state
const CH_COLOR: Record<string, string> = {
  R: "#cc4444",
  G: "#44aa66",
  B: "#4466cc",
};

// ── helpers ───────────────────────────────────────────────────────────────
function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

// ── flat channel slider ───────────────────────────────────────────────────
function ChannelSlider(props: {
  channel: "R" | "G" | "B";
  value: number; // 0..1, 0.5 = neutral
  gradient: readonly SliderGradientStop[]; // full-width CSS gradient
  onInput: (v: number) => void;
  onChange: (v: number) => void;
  onDblClick: () => void;
}) {
  let trackEl!: HTMLDivElement;

  let dragging = false;
  let trackRect: DOMRect | null = null;
  const [liveValue, setLiveValue] = createSignal<number | null>(null);
  const perf = createControlPerf(`shadow-highlight:${props.channel}`);

  const input = createRafInput((value: number) => {
    setLiveValue(value);
    props.onInput(value);
  });

  const norm = () => clamp01(liveValue() ?? props.value);

  const pct = () => `${norm() * 100}%`;

  const display = () => (norm() * 2 - 1).toFixed(2);

  const col = CH_COLOR[props.channel];

  function fromTrackX(clientX: number) {
    const { left, width } = trackRect ?? trackEl.getBoundingClientRect();
    return clamp01((clientX - left) / width);
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
    props.onChange(norm());
    setLiveValue(null);
    perf.end();
  };

  const onDblClick = () => {
    input.cancel();
    props.onDblClick();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;

    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      input.schedule(clamp01(norm() + step));
      input.flush();
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      input.schedule(clamp01(norm() - step));
      input.flush();
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      input.schedule(0);
      input.flush();
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      input.schedule(1);
      input.flush();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.cancel();
      props.onDblClick();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "4px",
      }}
    >
      {/* label row */}
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "baseline",
        }}
      >
        <span
          style={{
            "font-family": T.font,
            "font-size": "10px",
            "font-weight": "700",
            color: col,
            "letter-spacing": "0.04em",
            width: "12px",
          }}
        >
          {props.channel}
        </span>

        <span
          style={{
            "font-family": T.mono,
            "font-size": "10px",
            color: T.muted,
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {display()}
        </span>
      </div>

      {/* track + thumb */}
      <div
        ref={trackEl}
        role="slider"
        tabIndex={0}
        aria-label={`${props.channel} channel`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={norm()}
        aria-valuetext={display()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        onKeyDown={onKeyDown}
        onFocus={() => {
          trackEl.style.outline = `1px solid ${T.focusRing}`;
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
        {/* full-width gradient track */}
        <div
          style={{
            position: "absolute",
            left: "0",
            right: "0",
            top: `${(THUMB_D - TRACK_H) / 2}px`,
            height: `${TRACK_H}px`,
            "border-radius": `${TRACK_H / 2}px`,
            background: buildGradient(props.gradient),
            border: `1px solid ${T.grooveBorder}`,
            "box-sizing": "border-box",
            opacity: "0.92",
          }}
        />

        {/* centre neutral hairline */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            "margin-left": "-0.5px",
            top: `${(THUMB_D - TRACK_H) / 2 - 3}px`,
            width: "1px",
            height: `${TRACK_H + 6}px`,
            background: "rgba(255,255,255,0.13)",
            "pointer-events": "none",
          }}
        />

        {/* flat thumb */}
        <div
          style={{
            position: "absolute",
            left: pct(),
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: `${THUMB_D}px`,
            height: `${THUMB_D}px`,
            "border-radius": "50%",
            background: sampleGradient(props.gradient, norm()),
            border: `2px solid rgba(255, 255, 255, 0.92)`,
            "box-sizing": "border-box",
            "pointer-events": "none",
            transition: "background 40ms linear",
          }}
        />
      </div>
    </div>
  );
}

// ── ShadowHighlightColumn ─────────────────────────────────────────────────
export function ShadowHighlightColumn(props: {
  icon: string;
  label?: string;
  values: readonly [number, number, number];
  linked: boolean;
  gradients: readonly [
    readonly SliderGradientStop[],
    readonly SliderGradientStop[],
    readonly SliderGradientStop[],
  ];
  onValuesInput: (values: [number, number, number]) => void;
  onValuesChange: (values: [number, number, number]) => void;
  onToggleLink: (linked: boolean, average: boolean) => void;
}) {
  const [liveValues, setLiveValues] = createSignal<[number, number, number] | null>(null);
  const values = () => liveValues() ?? props.values;

  const updateChannel = (index: number, value: number) => {
    const current = values();
    if (!props.linked) {
      const next = [...current] as [number, number, number];
      next[index] = value;
      return next;
    }
    const delta = value - current[index];
    return current.map((channel, channelIndex) =>
      channelIndex === index ? value : clamp01(channel + delta),
    ) as [number, number, number];
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "10px",
        flex: "1",
        "min-width": "0",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
        }}
      >
        {/* flat icon button */}
        <div
          style={{
            width: "28px",
            height: "28px",
            "border-radius": "50%",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            background: T.buttonBg,
            border: `1px solid ${T.buttonBdr}`,
            "box-sizing": "border-box",
            "flex-shrink": "0",
          }}
        >
          <img
            src={props.icon}
            alt=""
            draggable={false}
            style={{
              width: "13px",
              height: "13px",
              opacity: "0.68",
            }}
          />
        </div>

        <Show when={props.label}>
          <span
            style={{
              "font-family": T.font,
              "font-size": "10px",
              "font-weight": "600",
              "text-transform": "uppercase",
              color: T.muted,
              "margin-left": "2px",
            }}
          >
            {props.label}
          </span>
        </Show>

        <div style={{ "flex-grow": "1" }} />

        {/* link toggle */}
        <button
          type="button"
          title="Link channels (hold Ctrl/Cmd to average)"
          aria-pressed={props.linked}
          onClick={(e) => props.onToggleLink(!props.linked, e.ctrlKey || e.metaKey)}
          style={{
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
            padding: "2px 8px",
            "border-radius": "12px",
            border: `1px solid ${props.linked ? T.buttonBdrActive : T.buttonBdr}`,
            cursor: "pointer",
            "font-family": T.font,
            "font-size": "9px",
            "font-weight": "600",
            "letter-spacing": "0.08em",
            "text-transform": "uppercase",
            "user-select": "none",
            "flex-shrink": "0",
            color: props.linked ? T.accent : T.muted,
            background: props.linked ? T.buttonBgActive : T.buttonBg,
            transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
          }}
        >
          {props.linked ? "Linked" : "Link"}
        </button>
      </div>

      {/* card with R/G/B sliders */}
      <div
        style={{
          background: T.card,
          "border-radius": "10px",
          border: `1px solid ${T.cardBdr}`,
          padding: "12px 10px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
        }}
      >
        <For each={CHANNELS}>
          {(ch, i) => (
            <ChannelSlider
              channel={ch}
              value={values()[i()]}
              gradient={props.gradients[i()]}
              onInput={(v) => {
                const next = updateChannel(i(), v);
                setLiveValues(next);
                props.onValuesInput(next);
              }}
              onChange={(v) => {
                const next = updateChannel(i(), v);
                props.onValuesChange(next);
                setLiveValues(null);
              }}
              onDblClick={() => {
                const next = updateChannel(i(), 0.5);
                props.onValuesChange(next);
                setLiveValues(null);
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}
