import { createSignal } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";

const D = {
  // Surface: very subtle translucent gradient over near-black
  surface: "linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))",
  // Handle surface: white dot
  dot: "#ffffff",
  // Guide lines: mid-opacity white
  guide: "rgba(255,255,255,.25)",
  // Handle glow (on hover)
  glow: "rgba(255,255,255,.14)",
  // Border: hairline white
  border: "rgba(255,255,255,.08)",
  // Grid dots: subtle white
  dotGrid: "rgba(255,255,255,.12)",
} as const;

// ── sizes (px) ───────────────────────────────────────────────────
const PAD_SIZE = 116;
const HANDLE_D = 12;
const GUIDE_W = 1;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── component ─────────────────────────────────────────────────────────────
export function TwoAxisPad(props: {
  xValue: number;
  yValue: number;
  min?: number;
  max?: number;
  background?: string;
  xLabel?: string;
  yLabel?: string;
  onInput?: (x: number, y: number) => void;
  onChange: (x: number, y: number) => void;
}) {
  const min = () => props.min ?? -1;
  const max = () => props.max ?? 1;
  const span = () => max() - min();

  let fieldRef!: HTMLDivElement;
  let dragRect: DOMRect | null = null;
  const [livePoint, setLivePoint] = createSignal<[number, number] | null>(null);
  const perf = createControlPerf("two-axis-pad");
  const currentX = () => livePoint()?.[0] ?? props.xValue;
  const currentY = () => livePoint()?.[1] ?? props.yValue;
  const px = () => ((currentX() - min()) / span()) * 100;
  const py = () => (1 - (currentY() - min()) / span()) * 100;
  const change = createRafInput((x: number, y: number) => {
    setLivePoint([x, y]);
    (props.onInput ?? props.onChange)(x, y);
  });

  function onPointerDown(e: PointerEvent) {
    perf.begin();
    e.preventDefault();
    dragRect = fieldRef.getBoundingClientRect();
    fieldRef.setPointerCapture(e.pointerId);
    apply(e, true);
  }

  function apply(e: PointerEvent, immediate = false) {
    const r = dragRect ?? fieldRef.getBoundingClientRect();
    const x = clamp(min() + ((e.clientX - r.left) / r.width) * span(), min(), max());
    const y = clamp(min() + (1 - (e.clientY - r.top) / r.height) * span(), min(), max());
    if (immediate) {
      setLivePoint([x, y]);
      (props.onInput ?? props.onChange)(x, y);
    } else change.schedule(x, y);
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons === 0) return;
    perf.pointer();
    apply(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    change.flush();
    if (props.onInput) props.onChange(currentX(), currentY());
    setLivePoint(null);
    perf.end();
    dragRect = null;
    fieldRef.releasePointerCapture?.(e.pointerId);
  };

  const onDblClick = () => {
    change.cancel();
    setLivePoint([0, 0]);
    (props.onInput ?? props.onChange)(0, 0);
    if (props.onInput) props.onChange(0, 0);
    setLivePoint(null);
  };

  const padSize = `var(--poto-two-axis-size, ${PAD_SIZE}px)`;

  return (
    <div
      class="poto-two-axis-pad"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "5px",
        "min-height": "0",
        "user-select": "none",
      }}
    >
      {/* ── field ── */}
      <div
        ref={fieldRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDblClick={onDblClick}
        role="slider"
        aria-label={`${props.xLabel ?? "X"} / ${props.yLabel ?? "Y"}`}
        aria-valuetext={`${currentX().toFixed(2)}, ${currentY().toFixed(2)}`}
        style={{
          position: "relative",
          width: '100%',
          height: padSize,
          "aspect-ratio": "1 / 1",
          "flex-shrink": "0",
          "border-radius": "16px",
          cursor: "crosshair",
          "touch-action": "none",
          // Flat translucent surface with subtle border
          background: props.background ?? D.surface,
          border: `1px solid ${D.border}`,
          overflow: "hidden",
        }}
      >
        {/* ── dotted grid (behind everything) ── */}
        <div
          style={{
            position: "absolute",
            inset: "0",
            "pointer-events": "none",
            "background-image": `radial-gradient(${D.dotGrid} 1px, transparent 1px)`,
            "background-size": "14px 14px",
          }}
        />

        {/* ── guide lines that follow the handle ── */}
        <div
          style={{
            position: "absolute",
            left: `${px()}%`,
            top: "0",
            bottom: "0",
            width: `${GUIDE_W}px`,
            "margin-left": `-${GUIDE_W / 2}px`,
            background: D.guide,
            "pointer-events": "none",
            "z-index": "2",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: `${py()}%`,
            left: "0",
            right: "0",
            height: `${GUIDE_W}px`,
            "margin-top": `-${GUIDE_W / 2}px`,
            background: D.guide,
            "pointer-events": "none",
            "z-index": "2",
          }}
        />

        {/* ── handle ── */}
        <div
          style={{
            position: "absolute",
            left: `${px()}%`,
            top: `${py()}%`,
            transform: "translate(-50%, -50%)",
            width: `${HANDLE_D}px`,
            height: `${HANDLE_D}px`,
            "border-radius": "50%",
            "pointer-events": "all",
            "z-index": "10",
          }}
        >
          {/* soft glow — only visible on hover via CSS */}
          <div
            style={{
              position: "absolute",
              inset: "-7px",
              "border-radius": "50%",
              background: D.glow,
              filter: "blur(8px)",
              opacity: "0",
              transition: "opacity .2s",
              "pointer-events": "none",
            }}
            class="poto-two-axis-pad__glow"
          />
          {/* white dot */}
          <div
            style={{
              position: "absolute",
              inset: "0",
              "border-radius": "50%",
              background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,.95), rgba(255,255,255,.72))`,
              "box-shadow": "0 2px 8px rgba(0,0,0,.45)",
              transition: "transform .12s ease",
            }}
            class="poto-two-axis-pad__dot"
          />
        </div>
      </div>
    </div>
  );
}
