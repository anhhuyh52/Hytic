import { createEffect, createSignal, For, onCleanup } from "solid-js";
import type { CurvePoint, ManualCurveMode } from "../../engine/state/EditState";
import { prepareCurveEvaluator } from "../../engine/curve/CurveEvaluator";
import { RollingSlider } from "./RollingSlider";
import { createControlPerf } from "./controlPerf";
import {
  constrainDraggedCurvePoint,
  cycleCurveInterpolation,
  defaultPointResetY,
  normalizeCurvePoints as normalizeCurveModelPoints,
  offsetCurveY,
  renderCurveLutData,
  resampleCurvePointCount,
} from "./curveEditorMath";

const LUT_SAMPLES = 512;
const LUT_STRIDE = 4;
const LUT_CHANNEL = 0;

const POINT_D = 12;
const POINT_HIT_D = 45;
const MIN_POINT_GAP_PX = 45;

const MIN_POINTS = 2;
const MAX_POINTS = 7;

const D = {
  bg: "#1e1e1e",

  surface: "#171719",
  surfaceBorder: "#2d2d33",

  gridLine: "rgba(255,255,255,0.045)",

  curveFallback: "#e9e7e2",

  point: "#ffffff",
  pointFace: "#ffffff",
  pointBorder: "rgba(0, 0, 0, 0.4)",
  pointRing: "rgba(255, 255, 255, 0.4)",

  btnBg: "#262626",
  btnBgActive: "#3a3a3f",
  btnBorder: "#34343a",
  btnBorderActive: "#5a5a64",
  btnText: "#c8c8c8",
  btnMuted: "#606068",

  smallBtnBg: "#242426",
  smallBtnBorder: "#34343a",
  smallBtnDisabled: "#3d3d44",

  accent: "#f4f1ea",
  focusRing: "rgba(244,241,234,0.3)",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

const INTERP_ICON: Record<ManualCurveMode, string> = {
  cubic: "/assets/icons/cubic_icon.svg",
  bezier: "/assets/icons/bezier_icon.svg",
  linear: "/assets/icons/linear_icon.svg",
};


function blurControl(el: HTMLElement) {
  el.style.outline = "none";
  el.style.outlineOffset = "0";
}

function CurveBtn(props: {
  title: string;
  label: string;
  children: any;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "5px",
      }}
    >
      <button
        type="button"
        title={props.title}
        onClick={props.onClick}
        onBlur={(e) => blurControl(e.currentTarget)}
        style={{
          width: "34px",
          height: "34px",
          "border-radius": "10px",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          cursor: "pointer",
          background: props.active ? D.btnBgActive : D.btnBg,
          border: `1px solid ${props.active ? D.btnBorderActive : D.btnBorder}`,
          color: D.btnText,
          padding: "0",
          margin: "0",
          appearance: "none",
          "box-sizing": "border-box",
          "user-select": "none",
          "touch-action": "manipulation",
          outline: "none",
          transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
        }}
      >
        {props.children}
      </button>

      <span
        style={{
          "font-family": D.font,
          "font-size": "9px",
          "font-weight": "600",
          color: props.active ? D.accent : D.btnMuted,
          "letter-spacing": "0.08em",
          "text-transform": "uppercase",
          transition: "color 0.15s ease",
        }}
      >
        {props.label}
      </span>
    </div>
  );
}

// function SmallPointButton(props: {
//   title: string;
//   label: string;
//   disabled?: boolean;
//   onClick: () => void;
// }) {
//   return (
//     <button
//       type="button"
//       title={props.title}
//       disabled={props.disabled}
//       onClick={(e) => {
//         e.preventDefault();
//         e.stopPropagation();

//         if (!props.disabled) {
//           props.onClick();
//         }
//       }}
//       onBlur={(e) => blurControl(e.currentTarget)}
//       style={{
//         width: "18px",
//         height: "18px",
//         "border-radius": "6px",
//         display: "inline-flex",
//         "align-items": "center",
//         "justify-content": "center",
//         padding: "0",
//         margin: "0",
//         appearance: "none",
//         border: `1px solid ${D.smallBtnBorder}`,
//         background: D.smallBtnBg,
//         color: props.disabled ? D.smallBtnDisabled : D.btnText,
//         cursor: props.disabled ? "default" : "pointer",

//         "font-size": "13px",
//         "font-weight": "700",
//         "line-height": "1",
//         "box-sizing": "border-box",
//         "user-select": "none",
//         "touch-action": "manipulation",
//         outline: "none",
//         opacity: props.disabled ? "0.45" : "1",
//         transition:
//           "background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease",
//       }}
//     >
//       {props.label}
//     </button>
//   );
// }

function PointsControl(props: { count: number; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        gap: "5px",
      }}
    >
      <div
        title="Change number of curve points"
        style={{
          height: "34px",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <select
          value={props.count}
          aria-label="Number of curve points"
          style={{
            appearance: "none",
            background: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23c8c8c8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='16 16 12 20 8 16'/%3e%3cpolyline points='8 8 12 4 16 8'/%3e%3c/svg%3e") no-repeat right 4px center / 14px 14px, ${D.smallBtnBg}`,
            border: `1px solid ${D.smallBtnBorder}`,
            "border-radius": "6px",
            color: D.btnText,
            "font-family": D.font,
            "font-size": "13px",
            "font-weight": "700",
            "font-variant-numeric": "tabular-nums",
            padding: "0 22px 0 6px",
            height: "26px",
            cursor: "pointer",
            "user-select": "none",
            outline: "none",
            "box-sizing": "border-box",
          }}
          onChange={(e) => {
            const next = Number(e.currentTarget.value);
            while (props.count < next) props.onIncrease();
            while (props.count > next) props.onDecrease();
          }}
        >
          {Array.from({ length: MAX_POINTS - MIN_POINTS + 1 }, (_, i) => i + MIN_POINTS).map((n) => (
            <option value={n}>{n}</option>
          ))}
        </select>
      </div>

      <span
        style={{
          "font-family": D.font,
          "font-size": "9px",
          "font-weight": "600",
          color: D.btnMuted,
          "letter-spacing": "0.08em",
          "text-transform": "uppercase",
        }}
      >
        Points
      </span>
    </div>
  );
}

export function SplineCurve(props: {
  points: CurvePoint[];
  defaultPoints?: CurvePoint[];
  mode: ManualCurveMode;
  yMin?: number;
  yMax?: number;
  colors?: string[];
  wrapAround?: boolean;
  pointResetY?: (x: number) => number;
  onRoll?: (value: number, previousValue: number) => CurvePoint[] | void;
  onRollStart?: () => void;
  onRollCommit?: () => void;
  onInput?: (points: CurvePoint[]) => void;
  onChange: (points: CurvePoint[]) => void;
  onModeChange: (mode: ManualCurveMode) => void;
  onReset: () => void;
  resetActive?: boolean;
}) {
  const yMin = () => props.yMin ?? -2;
  const yMax = () => props.yMax ?? 2;
  const spanY = () => yMax() - yMin() || 1;
  const modeLabel = () => props.mode[0].toUpperCase() + props.mode.slice(1);

  let hostRef!: HTMLElement;
  let canvasRef!: HTMLCanvasElement;
  const pointRefs: HTMLElement[] = [];
  let latestRollingPoints: CurvePoint[] | null = null;
  let rollingBasePoints: CurvePoint[] | null = null;
  let rollingBaseValue = 0.5;

  const [livePoints, setLivePoints] = createSignal<CurvePoint[] | null>(null);
  const [dragRollingValue, setDragRollingValue] = createSignal<number | null>(null);

  let isDraggingPoint = false;
  let isRollingCurve = false;
  let drawRaf = 0;
  let clearLivePointsTimer = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let curveGradient: CanvasGradient | null = null;
  let curveGradientKey = "";
  const curveLut = new Float32Array(LUT_SAMPLES * LUT_STRIDE);
  const pointDragPerf = createControlPerf("spline-curve-point");

  const normalizedY = (y: number) => clamp((y - yMin()) / spanY(), 0, 1);

  function activePoints() {
    return livePoints() ?? props.points;
  }

  const effectivePoints = (source: readonly CurvePoint[] = activePoints()) => {
    const pts = source.map((p) => ({ ...p }));

    if (props.wrapAround && pts.length > 1) {
      pts[pts.length - 1].y = pts[0].y;
    }

    return pts;
  };

  const rollingValue = () => {
    const pts = effectivePoints();

    if (!pts.length) return 0.5;

    return clamp(pts.reduce((sum, point) => sum + normalizedY(point.y), 0) / pts.length, 0, 1);
  };

  function scheduleDraw() {
    if (drawRaf) return;

    drawRaf = requestAnimationFrame(() => {
      drawRaf = 0;
      drawCurve();
    });
  }

  function cancelScheduledDraw() {
    if (!drawRaf) return;
    cancelAnimationFrame(drawRaf);
    drawRaf = 0;
  }

  function drawCurveNow(points: CurvePoint[]) {
    cancelScheduledDraw();
    drawCurve(points);
  }

  function clonePoints(points: CurvePoint[]) {
    return points.map((point) => ({ x: point.x, y: point.y }));
  }

  // Retained for the pointer-up / reset / commit call sites; there is no longer a
  // deferred preview frame to cancel (input is pushed synchronously below).
  function cancelPreviewInput() {
    return;
  }

  // Push curve points to the engine on the same pointermove. The handle/curve DOM
  // is already moved synchronously before this; the engine bakes a 256×1 curve
  // texture (cheap, in place) and its own requestRender coalesces the WebGL frame.
  // An outer RAF/timeout here would only delay the input by a frame.
  function emitInput(points: CurvePoint[]) {
    props.onInput?.(clonePoints(points));
  }

  function emitInputNow(points: CurvePoint[]) {
    props.onInput?.(clonePoints(points));
  }

  function clearLivePointsSoon() {
    if (clearLivePointsTimer) {
      window.clearTimeout(clearLivePointsTimer);
    }

    clearLivePointsTimer = window.setTimeout(() => {
      if (!isDraggingPoint) {
        setLivePoints(null);
        scheduleDraw();
      }
    }, 80);
  }

  function bakeLut(points = effectivePoints()) {
    const evaluate = prepareCurveEvaluator(props.mode, points);

    for (let i = 0; i < LUT_SAMPLES; i += 1) {
      const x = i / (LUT_SAMPLES - 1);
      curveLut[i * LUT_STRIDE + LUT_CHANNEL] = normalizedY(evaluate(x));
    }

    return curveLut;
  }

  function lutForResampling(points = effectivePoints()) {
    const evaluate = prepareCurveEvaluator(props.mode, points);

    return renderCurveLutData(
      points,
      (_pts, x) => normalizedY(evaluate(x)),
      LUT_SAMPLES,
      LUT_STRIDE,
      LUT_CHANNEL,
    );
  }

  function syncCanvasSize(rect = hostRef?.getBoundingClientRect()) {
    if (!canvasRef || !rect) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvasRef.width !== width || canvasRef.height !== height) {
      canvasRef.width = width;
      canvasRef.height = height;
      curveGradient = null;
      curveGradientKey = "";
    }

    canvasWidth = width;
    canvasHeight = height;
  }

  function drawCurve(points = effectivePoints()) {
    if (!canvasRef) return;

    if (!canvasWidth || !canvasHeight) syncCanvasSize();

    const width = canvasWidth;
    const height = canvasHeight;

    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);


    ctx.lineWidth = 0.5;

    // Draw the subtle background grid


    // Removed dashed diagonal to reduce visual clutter, matching legacy package.min.js


    const lut = bakeLut(points);
    const stops = props.colors?.length ? props.colors : [D.curveFallback];
    const nextGradientKey = `${width}:${stops.join("\u0000")}`;

    if (!curveGradient || curveGradientKey !== nextGradientKey) {
      curveGradient = ctx.createLinearGradient(0, 0, width, 0);
      curveGradientKey = nextGradientKey;
      const step = stops.length > 1 ? 1 / (stops.length - 1) : 1;

      stops.forEach((color, index) => {
        curveGradient?.addColorStop(index * step, color);
      });
    }

    ctx.lineWidth = clamp(0.01 * width * 0.75, 2.5, 6.5);
    ctx.strokeStyle = curveGradient;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();

    const sampleCount = Math.floor(lut.length / LUT_STRIDE);

    ctx.moveTo(0, (1 - lut[LUT_CHANNEL]) * height);

    for (let i = 0; i < sampleCount; i += 1) {
      ctx.lineTo(
        i * (width / Math.max(1, sampleCount - 1)),
        (1 - lut[i * LUT_STRIDE + LUT_CHANNEL]) * height,
      );
    }

    ctx.stroke();
  }

  createEffect(() => {
    for (const point of props.points) {
      void point.x;
      void point.y;
    }
    void props.mode;
    void props.colors?.join("\u0000");
    void yMin();
    void yMax();
    void props.wrapAround;
    void livePoints();

    if (isDraggingPoint || isRollingCurve) return;

    scheduleDraw();
  });

  createEffect(() => {
    if (!hostRef) return;

    const observer = new ResizeObserver(([entry]) => {
      syncCanvasSize(entry?.contentRect);
      scheduleDraw();
    });
    observer.observe(hostRef);

    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => {
    if (drawRaf) cancelAnimationFrame(drawRaf);
    cancelPreviewInput();
    if (clearLivePointsTimer) window.clearTimeout(clearLivePointsTimer);
  });

  function positionPoint(index: number, point: CurvePoint) {
    const element = pointRefs[index];
    if (!element) return;

    element.style.left = `${clamp(point.x, 0, 1) * 100}%`;
    element.style.top = `${(1 - normalizedY(point.y)) * 100}%`;
  }

  function positionDraggedPoints(points: CurvePoint[], index: number) {
    positionPoint(index, points[index]);

    if (props.wrapAround && points.length > 1 && (index === 0 || index === points.length - 1)) {
      positionPoint(
        index === 0 ? points.length - 1 : 0,
        points[index === 0 ? points.length - 1 : 0],
      );
    }
  }

  function positionAllPoints(points: CurvePoint[]) {
    for (let index = 0; index < points.length; index += 1) {
      positionPoint(index, points[index]);
    }
  }

  function dragPoint(index: number, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();

    const startPoints = normalizeCurvePoints(effectivePoints(), !!props.wrapAround);

    if (!startPoints[index]) return;
    pointDragPerf.begin();

    const lastIndex = startPoints.length - 1;
    const target = e.currentTarget as HTMLElement;
    const hostRect = hostRef.getBoundingClientRect();
    const widthPx = Math.max(1, hostRect.width);
    const targetRect = target.getBoundingClientRect();
    const grabOffsetX = e.clientX - (targetRect.left + targetRect.width / 2);
    const grabOffsetY = e.clientY - (targetRect.top + targetRect.height / 2);

    syncCanvasSize(hostRect);

    isDraggingPoint = true;
    setLivePoints(startPoints);
    drawCurveNow(startPoints);

    let moved = false;
    let latestPoints: CurvePoint[] | null = null;

    const toDataFromRect = (clientX: number, clientY: number) => ({
      x: clamp((clientX - grabOffsetX - hostRect.left) / Math.max(1, hostRect.width), 0, 1),
      y: clamp(
        yMin() +
        (1 - (clientY - grabOffsetY - hostRect.top) / Math.max(1, hostRect.height)) * spanY(),
        yMin(),
        yMax(),
      ),
    });

    const move = (ev: PointerEvent) => {
      pointDragPerf.pointer();
      ev.preventDefault();
      ev.stopPropagation();

      // Legacy parity: handle follows pointer immediately — no RAF, no pending-move
      // buffer. The GPU preview is coalesced separately by the render scheduler.
      const data = toDataFromRect(ev.clientX, ev.clientY);

      const next = constrainDraggedCurvePoint(latestPoints ?? startPoints, index, data, {
        lockX: ev.altKey,
        lockY: ev.shiftKey,
        wrapAround: !!props.wrapAround,
        pointSizePx: Math.max(MIN_POINT_GAP_PX, POINT_D),
        widthPx,
      });

      if (props.wrapAround && (index === 0 || index === lastIndex)) {
        next[0].x = 0;
        next[lastIndex].x = 1;
      }

      moved = true;
      latestPoints = next;

      setDragRollingValue(
        clamp(next.reduce((sum, p) => sum + normalizedY(p.y), 0) / next.length, 0, 1)
      );

      positionDraggedPoints(next, index);
      drawCurveNow(next);
      emitInput(next);
    };

    const up = (ev: PointerEvent) => {
      ev.preventDefault();
      ev.stopPropagation();

      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);

      isDraggingPoint = false;
      setDragRollingValue(null);

      if (moved && latestPoints) {
        cancelPreviewInput();
        setLivePoints(latestPoints);
        props.onChange(latestPoints);
      }

      clearLivePointsSoon();
      pointDragPerf.end();
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, { passive: false });
    window.addEventListener("pointercancel", up, { passive: false });
  }

  function resetPoint(index: number) {
    const next = effectivePoints();
    const defaults = props.defaultPoints ?? props.points;

    const target = props.pointResetY
      ? props.pointResetY(next[index].x)
      : defaultPointResetY(defaults, next[index].x);

    next[index].y = target;

    if (props.wrapAround && (index === 0 || index === next.length - 1)) {
      next[0].y = target;
      next[next.length - 1].y = target;
    }

    const normalized = normalizeCurvePoints(next, !!props.wrapAround);

    setLivePoints(normalized);
    emitInputNow(normalized);
    props.onChange(normalized);
    clearLivePointsSoon();
  }

  function offsetAll(normalizedDelta: number, sourcePoints = effectivePoints()) {
    const pts = sourcePoints;

    if (!pts.length) return pts;

    const next = offsetCurveY(
      pts.map((p) => ({ x: p.x, y: normalizedY(p.y) })),
      normalizedDelta,
      !!props.wrapAround,
    ).map((p) => ({
      x: p.x,
      y: yMin() + p.y * spanY(),
    }));

    latestRollingPoints = next;

    positionAllPoints(next);
    drawCurveNow(next);
    emitInput(next);
    return next;
  }

  function commitRollingOffset() {
    const next = latestRollingPoints ?? normalizeCurvePoints(effectivePoints(), !!props.wrapAround);

    latestRollingPoints = null;
    rollingBasePoints = null;
    cancelPreviewInput();

    props.onChange(normalizeCurvePoints(next, !!props.wrapAround));
    clearLivePointsSoon();
  }

  function startRolling() {
    isRollingCurve = true;
    latestRollingPoints = null;
    cancelScheduledDraw();

    if (!props.onRoll) {
      rollingBasePoints = effectivePoints();
      rollingBaseValue = rollingValue();
    }

    props.onRollStart?.();
  }

  function inputRolling(value: number, previousValue: number) {
    if (props.onRoll) {
      const preview = props.onRoll(value, previousValue);

      if (preview) {
        const normalized = normalizeCurvePoints(preview, !!props.wrapAround);

        latestRollingPoints = normalized;
        positionAllPoints(normalized);
        drawCurveNow(normalized);
        emitInput(normalized);
      }

      return value;
    }

    let nextPoints: CurvePoint[];

    if (rollingBasePoints) {
      nextPoints = offsetAll(value - rollingBaseValue, rollingBasePoints);
    } else {
      nextPoints = offsetAll(value - previousValue);
    }

    if (nextPoints && nextPoints.length > 0) {
      return clamp(nextPoints.reduce((sum, p) => sum + normalizedY(p.y), 0) / nextPoints.length, 0, 1);
    }

    return value;
  }

  function commitRolling() {
    if (props.onRoll) {
      cancelPreviewInput();
      props.onRollCommit?.();
      latestRollingPoints = null;
      rollingBasePoints = null;
      clearLivePointsSoon();
      return;
    }

    commitRollingOffset();
  }

  function stopRolling() {
    isRollingCurve = false;
  }

  function cycleMode() {
    props.onModeChange(cycleCurveInterpolation(props.mode));
  }

  function setCount(count: number) {
    const safeCount = clamp(count, MIN_POINTS, MAX_POINTS);

    if (safeCount === props.points.length) return;

    const pts = effectivePoints();
    const lut = lutForResampling(pts);

    const normalized = pts.map((point) => ({
      x: point.x,
      y: normalizedY(point.y),
    }));

    const next = resampleCurvePointCount(safeCount, normalized, lut, LUT_STRIDE, LUT_CHANNEL).map(
      (point) => ({
        x: point.x,
        y: yMin() + point.y * spanY(),
      }),
    );

    const normalizedNext = normalizeCurvePoints(next, !!props.wrapAround);

    setLivePoints(normalizedNext);
    emitInputNow(normalizedNext);
    props.onChange(normalizedNext);
    clearLivePointsSoon();
  }

  function decreaseCount() {
    setCount(props.points.length - 1);
  }

  function increaseCount() {
    setCount(props.points.length + 1);
  }

  return (
    <div
      class="poto-spline-curve"
      style={{
        display: "flex",
        gap: "0.5rem",
        "align-items": "stretch",
        width: "100%",
        "max-width": "100%",
        "min-width": "0",
        "min-height": "0",
        "box-sizing": "border-box",
      }}
    >
      <RollingSlider
        title={props.onRoll ? "Drag to modify contrast" : "Drag to move all points"}
        defaultValue={0.5}
        value={props.onRoll ? 0.5 : (dragRollingValue() ?? rollingValue())}
        numLines={17}
        orientation="vertical"
        onInputValue={inputRolling}
        onStart={startRolling}
        onStop={stopRolling}
        onCommit={commitRolling}
        resetTransitionMs={0}
      />

      <spline-interface
        ref={hostRef}
        class="poto-spline-curve__interface"
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          "max-height": "100%",
          "aspect-ratio": "16 / 10",
          border: "1px solid var(--theme-higher-200)",
          "border-radius": "10px",
          flex: "1 1 auto",
          "min-width": "0",
          "box-sizing": "border-box",
          overflow: "visible",
          isolation: "isolate",
          "touch-action": "none",
        }}
      >
        <canvas
          ref={canvasRef}
          class="poto-spline-curve__canvas"
          style={{
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            display: "block",
            "pointer-events": "none",
          }}
        />

        <For each={effectivePoints()}>
          {(point, index) => (
            <div
              ref={(element) => {
                pointRefs[index()] = element;
              }}
              onPointerDown={(e) => dragPoint(index(), e)}
              onDblClick={() => resetPoint(index())}
              style={{
                position: "absolute",
                left: `${clamp(point.x, 0, 1) * 100}%`,
                top: `${(1 - normalizedY(point.y)) * 100}%`,
                width: `${POINT_HIT_D}px`,
                height: `${POINT_HIT_D}px`,
                "border-radius": "50%",
                transform: "translate(-50%, -50%)",
                cursor: "grab",
                "box-sizing": "border-box",
                "touch-action": "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  "border-radius": "50%",
                  width: `${POINT_D}px`,
                  height: `${POINT_D}px`,
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  background: D.pointFace,
                  border: `1px solid ${D.pointBorder}`,
                  "box-shadow": `0 0 0 2px ${D.pointRing}`,
                  "box-sizing": "border-box",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    "border-radius": "50%",
                    width: `${POINT_D * 0.32}px`,
                    height: `${POINT_D * 0.32}px`,
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    background: D.point,
                  }}
                />
              </div>
            </div>
          )}
        </For>
      </spline-interface>

      <curve-controls class="poto-spline-curve__controls">
        <PointsControl
          count={props.points.length}
          onDecrease={decreaseCount}
          onIncrease={increaseCount}
        />

        <CurveBtn
          title="Click to change curve interpolation"
          label={modeLabel()}
          onClick={cycleMode}
        >
          <img
            src={INTERP_ICON[props.mode]}
            alt={modeLabel()}
            style={{
              width: "18px",
              height: "18px",
              opacity: "0.75",
            }}
          />
        </CurveBtn>

        <CurveBtn
          title="Click to reset curve"
          label="Reset"
          active={props.resetActive}
          onClick={props.onReset}
        >
          <img
            src="/assets/icons/reset_icon.svg"
            alt="Reset"
            style={{
              width: "16px",
              height: "16px",
              opacity: props.resetActive ? "0.9" : "0.55",
            }}
          />
        </CurveBtn>
      </curve-controls>
    </div>
  );
}

function normalizeCurvePoints(points: CurvePoint[], wrapAround: boolean) {
  return normalizeCurveModelPoints(points, wrapAround) as CurvePoint[];
}

function clamp(value: number, lo: number, hi: number) {
  return value < lo ? lo : value > hi ? hi : value;
}
