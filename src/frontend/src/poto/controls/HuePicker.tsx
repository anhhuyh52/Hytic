import { createMemo } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";

export interface HuePickerProps {
  color: [number, number, number] | null;
  onColorChange: (color: [number, number, number]) => void;
  onSwatchClick?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d) % 6; break;
    case g: h = (b - r) / d + 2; break;
    case b: h = (r - g) / d + 4; break;
  }
  h /= 6;
  return h < 0 ? h + 1 : h;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (h * 6) % 6;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function rgbToCss(color: [number, number, number]): string {
  const r = Math.round(clamp(color[0], 0, 1) * 255);
  const g = Math.round(clamp(color[1], 0, 1) * 255);
  const b = Math.round(clamp(color[2], 0, 1) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function HuePicker(props: HuePickerProps) {
  let trackEl!: HTMLDivElement;
  let dragging = false;
  let trackRect: DOMRect | null = null;
  const perf = createControlPerf(`hue-picker`);

  // Hue is the source of truth (0..1 → 0°..360°). Read from the incoming color
  // when available, otherwise 0.
  const hue = createMemo(() => {
    if (!props.color) return 0;
    return rgbToHue(props.color[0], props.color[1], props.color[2]);
  });

  const hueDegrees = () => hue() * 360;
  const thumbColor = () => `hsl(${hueDegrees()}, 100%, 50%)`;
  const swatchColor = () => {
    if (!props.color) return thumbColor();
    return rgbToCss(props.color);
  };

  // When the user drags the slider we always emit a fully-saturated spectral
  // color so the mask overlay changes color visibly as the hue changes.
  const input = createRafInput((newHue: number) => {
    const clamped = clamp(newHue, 0, 1);
    const rgb = hslToRgb(clamped, 1, 0.5);
    props.onColorChange(rgb);
  });

  function fromTrackX(clientX: number) {
    const { left, width } = trackRect ?? trackEl.getBoundingClientRect();
    if (width <= 0) return 0;
    return clamp((clientX - left) / width, 0, 1);
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    perf.begin();
    props.onInteractionStart?.();
    dragging = true;
    trackRect = trackEl.getBoundingClientRect();
    trackEl.setPointerCapture(e.pointerId);
    input.schedule(fromTrackX(e.clientX));
    input.flush();
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
    perf.end();
    props.onInteractionEnd?.();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      input.schedule(clamp(hueDegrees() + step, 0, 360) / 360);
      input.flush();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      input.schedule(clamp(hueDegrees() - step, 0, 360) / 360);
      input.flush();
      return;
    }
  };

  const iconColor = createMemo(() => {
    if (!props.color) return "#000";
    const r = props.color[0] <= 0.03928 ? props.color[0] / 12.92 : Math.pow((props.color[0] + 0.055) / 1.055, 2.4);
    const g = props.color[1] <= 0.03928 ? props.color[1] / 12.92 : Math.pow((props.color[1] + 0.055) / 1.055, 2.4);
    const b = props.color[2] <= 0.03928 ? props.color[2] / 12.92 : Math.pow((props.color[2] + 0.055) / 1.055, 2.4);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.179 ? "#000" : "#fff";
  });

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px", width: "100%", padding: "4px 0" }}>
      <div
        style={{
          width: "28px",
          height: "28px",
          "border-radius": "6px",
          background: swatchColor(),
          border: "2px solid #111",
          "flex-shrink": 0,
          position: "relative",
          cursor: "pointer",
          "box-sizing": "border-box",
        }}
        onClick={() => props.onSwatchClick?.()}
      >
        <svg
          style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "16px", height: "16px" }}
          viewBox="0 0 24 24"
          fill="none"
          stroke={iconColor()}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 4H6a2 2 0 0 0-2 2v2" />
          <path d="M4 16v2a2 2 0 0 0 2 2h2" />
          <path d="M16 4h2a2 2 0 0 1 2 2v2" />
          <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
          <circle cx="12" cy="12" r="1.5" fill={iconColor()} stroke="none" />
        </svg>
      </div>

      <div
        ref={trackEl}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hueDegrees())}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onFocus={() => {
          trackEl.style.outline = `1px solid #555`;
          trackEl.style.outlineOffset = "3px";
        }}
        onBlur={() => {
          trackEl.style.outline = "none";
          trackEl.style.outlineOffset = "0";
        }}
        style={{
          position: "relative",
          flex: "1 1 auto",
          height: "18px",
          "border-radius": "999px",
          background:
            "linear-gradient(90deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))",
          cursor: "ew-resize",
          "user-select": "none",
          "touch-action": "none",
          outline: "none",
          border: "1px solid rgba(255,255,255,0.14)",
          "box-sizing": "border-box",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${hue() * 100}%`,
            top: "50%",
            width: "20px",
            height: "20px",
            transform: "translate(-50%, -50%)",
            "border-radius": "50%",
            background: thumbColor(),
            border: "3px solid white",
            "box-shadow":
              "0 0 0 1px rgba(0,0,0,0.35), 0 2px 5px rgba(0,0,0,0.4)",
            "pointer-events": "none",
            "box-sizing": "border-box",
          }}
        />
      </div>
    </div>
  );
}