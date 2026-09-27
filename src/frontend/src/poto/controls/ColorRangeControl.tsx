import { createSignal, createMemo, Show, onMount, onCleanup } from "solid-js";

export type ColorRangeState = {
  hue: number; // 0..360
  hueRange: number; // 0..180
  hueFeather: number; // 0..100
  chromaRange: number; // 0..100
  chromaFeather: number; // 0..100
  lumL1: number; // 0..100 (min feather)
  lumL2: number; // 0..100 (min core)
  lumL3: number; // 0..100 (max core)
  lumL4: number; // 0..100 (max feather)
  isolateColorGrade: number; // 0..100
  compressTone: number; // 0..100
};

export const DEFAULT_COLOR_RANGE_STATE: ColorRangeState = {
  hue: 35,
  hueRange: 80,
  hueFeather: 20,
  chromaRange: 100,
  chromaFeather: 20,
  lumL1: 15,
  lumL2: 35,
  lumL3: 85,
  lumL4: 98,
  isolateColorGrade: 30,
  compressTone: 15,
};

export type ColorRangeControlProps = {
  title?: string;
  hasHelp?: boolean;
  state?: ColorRangeState;
  onChange?: (newState: ColorRangeState) => void;
  onReset?: () => void;
  onToggleBypass?: () => void;
  bypassed?: boolean;
};

/** Interactive Color Wheel Sector Picker */
function ColorWheelPicker(props: {
  hue: number;
  hueRange: number;
  chromaRange: number;
  onChange: (hue: number, chromaRange: number) => void;
}) {
  let wheelRef!: HTMLDivElement;

  function handlePointer(e: PointerEvent) {
    if (!wheelRef) return;
    const rect = wheelRef.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;

    // Angle in degrees 0..360 (top = 0/360 or standard trigonometric)
    const rad = Math.atan2(y, x);
    let deg = (rad * 180) / Math.PI;
    if (deg < 0) deg += 360;

    const dist = Math.hypot(x, y);
    const maxRadius = rect.width / 2;
    const normChroma = Math.min(100, Math.max(0, Math.round((dist / maxRadius) * 100)));

    props.onChange(Math.round(deg), normChroma);
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    wheelRef.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => handlePointer(ev);
    const onUp = (ev: PointerEvent) => {
      wheelRef.removeEventListener("pointermove", onMove);
      wheelRef.removeEventListener("pointerup", onUp);
      wheelRef.removeEventListener("pointercancel", onUp);
      try {
        wheelRef.releasePointerCapture(ev.pointerId);
      } catch {}
    };

    handlePointer(e);
    wheelRef.addEventListener("pointermove", onMove);
    wheelRef.addEventListener("pointerup", onUp);
    wheelRef.addEventListener("pointercancel", onUp);
  }

  // Calculate sector clip path / SVG arc
  const sectorPaths = createMemo(() => {
    const centerHue = props.hue;
    const halfRange = Math.max(5, props.hueRange / 2);
    const startDeg = (centerHue - halfRange + 360) % 360;
    const endDeg = (centerHue + halfRange) % 360;

    // Convert deg to SVG arc points
    const r = 90;
    const cx = 100;
    const cy = 100;

    const a1 = ((startDeg - 90) * Math.PI) / 180;
    const a2 = ((endDeg - 90) * Math.PI) / 180;

    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);

    const largeArc = props.hueRange > 180 ? 1 : 0;

    const pathData = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    // Handle position
    const handleAngle = ((centerHue - 90) * Math.PI) / 180;
    const handleDist = (Math.min(100, Math.max(20, props.chromaRange)) / 100) * r * 0.7;
    const hx = cx + handleDist * Math.cos(handleAngle);
    const hy = cy + handleDist * Math.sin(handleAngle);

    return { pathData, hx, hy };
  });

  return (
    <div
      ref={wheelRef}
      class="color-range__wheel-container"
      onPointerDown={onPointerDown}
    >
      <div class="color-range__wheel-disc" />
      <svg class="color-range__wheel-svg" viewBox="0 0 200 200">
        {/* Dark overlay for unselected sector */}
        <defs>
          <mask id="sector-mask">
            <rect width="200" height="200" fill="white" />
            <path d={sectorPaths().pathData} fill="black" />
          </mask>
        </defs>

        {/* Dim non-selected area */}
        <circle cx="100" cy="100" r="90" fill="rgba(10, 10, 12, 0.65)" mask="url(#sector-mask)" />

        {/* Highlight boundary lines */}
        <path d={sectorPaths().pathData} fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.4)" stroke-width="1.5" />

        {/* White ring handle */}
        <circle
          cx={sectorPaths().hx}
          cy={sectorPaths().hy}
          r="9"
          fill="none"
          stroke="#ffffff"
          stroke-width="2.5"
          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"
        />
      </svg>
    </div>
  );
}

/** 4-Point Luminance Trapezoid Range Bar */
function LuminanceRangeBar(props: {
  l1: number;
  l2: number;
  l3: number;
  l4: number;
  onChange: (l1: number, l2: number, l3: number, l4: number) => void;
}) {
  let barRef!: HTMLDivElement;

  function onHandleDrag(handleIndex: number, e: PointerEvent) {
    if (!barRef) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const rect = barRef.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, Math.round(((ev.clientX - rect.left) / rect.width) * 100)));

      let { l1, l2, l3, l4 } = props;

      if (handleIndex === 1) {
        l1 = Math.min(pct, l2);
      } else if (handleIndex === 2) {
        l2 = Math.max(l1, Math.min(pct, l3));
      } else if (handleIndex === 3) {
        l3 = Math.max(l2, Math.min(pct, l4));
      } else if (handleIndex === 4) {
        l4 = Math.max(l3, pct);
      }

      props.onChange(l1, l2, l3, l4);
    };

    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {}
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  return (
    <div ref={barRef} class="color-range__lum-bar">
      <div class="color-range__lum-gradient" />

      {/* SVG Trapezoid Overlay */}
      <svg class="color-range__lum-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Shaded active area */}
        <polygon
          points={`${props.l1},100 ${props.l2},0 ${props.l3},0 ${props.l4},100`}
          fill="rgba(255, 255, 255, 0.18)"
        />
        {/* Dashed trapezoid lines */}
        <polyline
          points={`${props.l1},100 ${props.l2},0 ${props.l3},0 ${props.l4},100`}
          fill="none"
          stroke="rgba(255, 255, 255, 0.75)"
          stroke-width="1.8"
          stroke-dasharray="3,3"
        />
      </svg>

      {/* 4 Handles */}
      <div
        class="color-range__lum-handle color-range__lum-handle--1"
        style={{ left: `${props.l1}%`, top: "100%" }}
        onPointerDown={(e) => onHandleDrag(1, e)}
      />
      <div
        class="color-range__lum-handle color-range__lum-handle--2"
        style={{ left: `${props.l2}%`, top: "0%" }}
        onPointerDown={(e) => onHandleDrag(2, e)}
      />
      <div
        class="color-range__lum-handle color-range__lum-handle--3"
        style={{ left: `${props.l3}%`, top: "0%" }}
        onPointerDown={(e) => onHandleDrag(3, e)}
      />
      <div
        class="color-range__lum-handle color-range__lum-handle--4"
        style={{ left: `${props.l4}%`, top: "100%" }}
        onPointerDown={(e) => onHandleDrag(4, e)}
      />
    </div>
  );
}

export function ColorRangeControl(props: ColorRangeControlProps) {
  const currentState = () => ({
    ...DEFAULT_COLOR_RANGE_STATE,
    ...props.state,
  });

  function update(patch: Partial<ColorRangeState>) {
    const next = { ...currentState(), ...patch };
    props.onChange?.(next);
  }

  return (
    <div class="color-range-mask-panel" classList={{ "is-bypassed": !!props.bypassed }}>
      {/* Header */}
      <div class="color-range__header">
        <div class="color-range__title-group">
          <span class="color-range__title">{props.title ?? "Color Range Mask"}</span>
          <Show when={props.hasHelp !== false}>
            <span class="color-range__help-icon" title="Learn about Color Range Mask">
              ?
            </span>
          </Show>
        </div>

        <div class="color-range__header-actions">
          <button
            type="button"
            class="color-range__btn color-range__btn--mask"
            classList={{ "is-active": !props.bypassed }}
            title="Toggle mask overlay"
            onClick={() => props.onToggleBypass?.()}
          >
            <svg viewBox="0 0 20 20" fill="currentColor">
              <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path d="M6 6h4v8H6z" />
              <path d="M10 6h4v8h-4z" opacity="0.4" />
            </svg>
          </button>
          <button
            type="button"
            class="color-range__btn"
            title="Reset panel"
            onClick={() => props.onReset?.()}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 10a6 6 0 1 0 1.8-4.2L4 7" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M4 3v4h4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main 2-Column Section (Color Wheel + H/C/L Controls) */}
      <div class="color-range__main-grid">
        {/* Left Column: Color Wheel */}
        <div class="color-range__left-col">
          <ColorWheelPicker
            hue={currentState().hue}
            hueRange={currentState().hueRange}
            chromaRange={currentState().chromaRange}
            onChange={(hue, chromaRange) => update({ hue, chromaRange })}
          />
        </div>

        {/* Right Column: H, C, L sliders */}
        <div class="color-range__right-col">
          {/* H (Hue) Row */}
          <div class="color-range__row">
            <span class="color-range__axis-label">H</span>
            <div class="color-range__slider-pair">
              <div class="color-range__slider-item">
                <span class="lbl">Range</span>
                <input
                  type="range"
                  min="0"
                  max="180"
                  value={currentState().hueRange}
                  onInput={(e) => update({ hueRange: Number(e.currentTarget.value) })}
                />
                <span class="val">{currentState().hueRange}</span>
              </div>
              <div class="color-range__slider-item">
                <span class="lbl">Feather</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={currentState().hueFeather}
                  onInput={(e) => update({ hueFeather: Number(e.currentTarget.value) })}
                />
                <span class="val">{currentState().hueFeather}</span>
              </div>
            </div>
          </div>

          {/* C (Chroma) Row */}
          <div class="color-range__row">
            <span class="color-range__axis-label">C</span>
            <div class="color-range__slider-pair">
              <div class="color-range__slider-item">
                <span class="lbl">Range</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={currentState().chromaRange}
                  onInput={(e) => update({ chromaRange: Number(e.currentTarget.value) })}
                />
                <span class="val">{currentState().chromaRange}</span>
              </div>
              <div class="color-range__slider-item">
                <span class="lbl">Feather</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={currentState().chromaFeather}
                  onInput={(e) => update({ chromaFeather: Number(e.currentTarget.value) })}
                />
                <span class="val">{currentState().chromaFeather}</span>
              </div>
            </div>
          </div>

          {/* L (Luminance) Row */}
          <div class="color-range__row">
            <span class="color-range__axis-label">L</span>
            <div class="color-range__lum-wrapper">
              <LuminanceRangeBar
                l1={currentState().lumL1}
                l2={currentState().lumL2}
                l3={currentState().lumL3}
                l4={currentState().lumL4}
                onChange={(l1, l2, l3, l4) => update({ lumL1: l1, lumL2: l2, lumL3: l3, lumL4: l4 })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Global Sliders */}
      <div class="color-range__bottom-sliders">
        <div class="color-range__global-slider">
          <span class="color-range__icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 3v14M3 10h14" />
            </svg>
          </span>
          <span class="lbl">Isolate Color Grade</span>
          <input
            type="range"
            min="0"
            max="100"
            value={currentState().isolateColorGrade}
            onInput={(e) => update({ isolateColorGrade: Number(e.currentTarget.value) })}
          />
          <span class="val">{currentState().isolateColorGrade}%</span>
        </div>

        <div class="color-range__global-slider">
          <span class="color-range__icon color-range__icon--dot" />
          <span class="lbl">Compress Tone</span>
          <input
            type="range"
            min="0"
            max="100"
            value={currentState().compressTone}
            onInput={(e) => update({ compressTone: Number(e.currentTarget.value) })}
          />
          <span class="val">{currentState().compressTone}%</span>
        </div>
      </div>
    </div>
  );
}
