import { createSignal } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";

const T = {
  s1: "#111111",
  s2: "#2e2e2e",
  surface: "#1a1a1c",
  cross: "rgba(255,255,255,0.07)",
  inlay: "var(--theme-lower-000)",
} as const;

const POINT_D = 14;
const CROSS_W = 1;
const INLAY_PADDING = 4;

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function CardinalSlider(props: {
  x: number;
  y: number;
  circular?: boolean;
  pointColor?: string;
  background?: string;
  resetX?: number;
  resetY?: number;
  onInput?: (x: number, y: number) => void;
  onChange: (x: number, y: number) => void;
}) {
  let ref!: HTMLElement;
  let dragRect: DOMRect | null = null;
  const [livePoint, setLivePoint] = createSignal<[number, number] | null>(null);
  const perf = createControlPerf("cardinal-slider");
  const currentX = () => livePoint()?.[0] ?? props.x;
  const currentY = () => livePoint()?.[1] ?? props.y;
  const change = createRafInput((x: number, y: number) => {
    setLivePoint([x, y]);
    (props.onInput ?? props.onChange)(x, y);
  });

  function clampPoint(x: number, y: number): [number, number] {
    if (!props.circular) return [clamp01(x), clamp01(y)];
    let dx = x - 0.5;
    let dy = y - 0.5;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.5) {
      dx *= 0.5 / dist;
      dy *= 0.5 / dist;
    }
    return [0.5 + dx, 0.5 + dy];
  }

  function onPointerDown(e: PointerEvent) {
    perf.begin();
    e.preventDefault();
    ref.setPointerCapture(e.pointerId);
    dragRect = ref.getBoundingClientRect();
    const startX = currentX();
    const startY = currentY();

    function apply(ev: PointerEvent, immediate = false) {
      if (!immediate) perf.pointer();
      const r = dragRect ?? ref.getBoundingClientRect();
      let nx = (ev.clientX - r.left) / r.width;
      let ny = 1 - (ev.clientY - r.top) / r.height;
      if (ev.altKey) ny = startY;
      if (ev.shiftKey) nx = startX;
      const [x, y] = clampPoint(nx, ny);
      if (immediate) {
        setLivePoint([x, y]);
        (props.onInput ?? props.onChange)(x, y);
      } else change.schedule(x, y);
    }

    const stop = (ev: PointerEvent) => {
      ref.removeEventListener("pointermove", apply);
      ref.removeEventListener("pointerup", stop);
      ref.removeEventListener("pointercancel", stop);
      change.flush();
      if (props.onInput) props.onChange(currentX(), currentY());
      setLivePoint(null);
      perf.end();
      dragRect = null;
      ref.releasePointerCapture?.(ev.pointerId);
    };

    apply(e, true);
    ref.addEventListener("pointermove", apply);
    ref.addEventListener("pointerup", stop);
    ref.addEventListener("pointercancel", stop);
  }

  const dotColor = () => props.pointColor ?? "#ffffff";
  const pointLeft = () => `${currentX() * 100}%`;
  const pointTop = () => `${(1 - currentY()) * 100}%`;

  return (
    <cardinal-slider
      ref={ref}
      onPointerDown={onPointerDown}
      onDblClick={() => {
        change.cancel();
        const x = props.resetX ?? 0.5;
        const y = props.resetY ?? 0.5;
        setLivePoint([x, y]);
        (props.onInput ?? props.onChange)(x, y);
        if (props.onInput) props.onChange(x, y);
        setLivePoint(null);
      }}
      role="slider"
      aria-valuetext={`${currentX().toFixed(2)}, ${currentY().toFixed(2)}`}
      style={{
        "--point-color": dotColor(),
        "--line-color": T.cross,
        "--inlay-color": T.inlay,
        "--inlay-padding": `${INLAY_PADDING}px`,
        position: "relative",
        display: "block",
        width: "min(var(--poto-cardinal-size, 160px), 100%)",
        "aspect-ratio": "1 / 1",
        "border-radius": props.circular ? "50%" : "10px",
        cursor: "crosshair",
        "touch-action": "none",
        "user-select": "none",
        "flex-shrink": "0",
        background: props.background ?? T.surface,
        "box-shadow": `inset 0 1px 0 rgba(255,255,255,0.04)`,
        outline: `1px solid ${T.s1}bb`,
      }}
    >
      <cardinal-slider-inlay
        class="pos-abs flex-row center"
        style={{
          position: "absolute",
          inset: "var(--inlay-padding)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          background: "var(--inlay-color)",
          "border-radius": "inherit",
          "pointer-events": "none",
        }}
      >
        <cardinal-slider-line
          axis="x"
          style={{
            position: "absolute",
            left: "0",
            right: "0",
            top: "50%",
            height: `${CROSS_W}px`,
            "margin-top": `-${CROSS_W / 2}px`,
            background: "var(--line-color)",
            "pointer-events": "none",
          }}
        />
        <cardinal-slider-line
          axis="y"
          style={{
            position: "absolute",
            top: "0",
            bottom: "0",
            left: "50%",
            width: `${CROSS_W}px`,
            "margin-left": `-${CROSS_W / 2}px`,
            background: "var(--line-color)",
            "pointer-events": "none",
          }}
        />
      </cardinal-slider-inlay>

      <div
        style={{
          position: "absolute",
          left: pointLeft(),
          top: pointTop(),
          transform: "translate(-50%, -50%)",
          width: `${POINT_D + 4}px`, // match GradientSlider thumb size (18px)
          height: `${POINT_D + 4}px`,
          "border-radius": "50%",
          "pointer-events": "none",
          "z-index": "2",
          background: props.pointColor ?? "#ffffff",
          border: `2px solid #ffffff`,
          "box-sizing": "border-box",
          "box-shadow": "0 1px 4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.2)",
        }}
      />
    </cardinal-slider>
  );
}

export function cardinalAngle(x: number, y: number): number {
  const a = (Math.atan2(2 * y - 1, 2 * x - 1) * 180) / Math.PI;
  return (a + 360) % 360;
}

export function cardinalDistance(x: number, y: number): number {
  return Math.min(1, Math.hypot(2 * x - 1, 2 * y - 1));
}
