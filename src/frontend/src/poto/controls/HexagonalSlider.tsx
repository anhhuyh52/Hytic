import { createSignal, For, onCleanup, onMount } from "solid-js";
import { createRafInput } from "./rafInput";
import { createControlPerf } from "./controlPerf";
import {
  CENTER,
  clamp,
  cloneHexagonalSliderPoints,
  CONTROL_SIZE,
  DISTANCE_RANGE,
  getHexagonalSliderGeometry,
  hexagonalSliderPointerToPoint,
  hexagonalSliderPointToXY,
  POINT_SIZE,
  VIEWBOX_SIZE,
  type HexagonalSliderDragBounds,
  type HexagonalSliderPoint,
} from "./hexagonalSliderGeometry";

type Point = HexagonalSliderPoint;

const DEFAULT_BACKGROUND =
  "conic-gradient(#f84e4e, #e0d462, #41b84d, #74bec4, #4b5ccc, #b03c96, #f84e4e)";

export function HexagonalSlider(props: {
  points: Point[];
  defaultPoints?: Point[];
  colors: string[];
  selected: number;
  background?: string;
  disabled?: boolean;
  onSelect: (index: number) => void;
  onInput?: (points: Point[]) => void;
  onChange: (points: Point[]) => void;
}) {
  let hostRef!: HTMLDivElement;
  let svgRef!: SVGSVGElement;
  let cleanupDrag: (() => void) | null = null;
  let finishDrag: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const [renderSize, setRenderSize] = createSignal(CONTROL_SIZE);
  const [livePoints, setLivePoints] = createSignal<Point[] | null>(null);
  const perf = createControlPerf("hexagonal-slider");
  const currentPoints = () => livePoints() ?? props.points;
  const input = createRafInput((points: Point[]) => {
    setLivePoints(points);
    (props.onInput ?? props.onChange)(points);
  });

  const pointXY = (index: number) =>
    hexagonalSliderPointToXY(
      currentPoints()[index],
      getHexagonalSliderGeometry(renderSize()).usableRadius,
    );
  const webPoints = () =>
    currentPoints()
      .map((_, index) => {
        const point = pointXY(index);
        return `${point.x},${point.y}`;
      })
      .join(" ");

  onMount(() => {
    const measure = () => {
      const rect = hostRef.getBoundingClientRect();
      if (rect.width > 0) setRenderSize(rect.width);
    };
    measure();
    resizeObserver = new ResizeObserver(() => {
      // Legacy resize handling ends an active drag before recomputing geometry.
      finishDrag?.();
      measure();
    });
    resizeObserver.observe(hostRef);
  });

  onCleanup(() => {
    cleanupDrag?.();
    input.cancel();
    resizeObserver?.disconnect();
  });

  function startDrag(index: number, event: PointerEvent) {
    if (props.disabled) return;
    cleanupDrag?.();
    event.preventDefault();
    event.stopPropagation();
    props.onSelect(index);
    perf.begin();

    const startPoints = cloneHexagonalSliderPoints(currentPoints());
    const initial = hexagonalSliderPointToXY(
      startPoints[index],
      getHexagonalSliderGeometry(renderSize()).usableRadius,
    );
    const startRect = svgRef.getBoundingClientRect();
    const initialClientX = startRect.left + (initial.x / VIEWBOX_SIZE) * startRect.width;
    const initialClientY = startRect.top + (initial.y / VIEWBOX_SIZE) * startRect.height;
    const grabOffsetX = event.clientX - initialClientX;
    const grabOffsetY = event.clientY - initialClientY;
    const previous = startPoints[(index + startPoints.length - 1) % startPoints.length][0];
    const next = startPoints[(index + 1) % startPoints.length][0];
    const initialRadius = Math.hypot(initial.x - CENTER, initial.y - CENTER);
    const bounds: HexagonalSliderDragBounds = {
      angle: startPoints[index][0],
      previous,
      next,
      initialRadius,
    };
    let latest = startPoints;
    let moved = false;

    const move = (moveEvent: PointerEvent) => {
      perf.pointer();
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const rect = svgRef.getBoundingClientRect();
      const x =
        ((moveEvent.clientX - grabOffsetX - rect.left) / rect.width) * VIEWBOX_SIZE - CENTER;
      const y =
        ((moveEvent.clientY - grabOffsetY - rect.top) / rect.height) * VIEWBOX_SIZE - CENTER;
      const point = hexagonalSliderPointerToPoint(
        x,
        y,
        getHexagonalSliderGeometry(rect.width).usableRadius,
        bounds,
        moveEvent.shiftKey,
        moveEvent.altKey,
      );
      if (!point) return;
      const nextPoints = cloneHexagonalSliderPoints(latest);
      nextPoints[index] = point;
      latest = nextPoints;
      moved = true;
      input.schedule(nextPoints);
    };

    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("pointerleave", leaveDocument);
      if (moved) {
        input.flush();
        if (props.onInput) props.onChange(latest);
      } else {
        input.cancel();
      }
      setLivePoints(null);
      cleanupDrag = null;
      finishDrag = null;
      perf.end();
    };

    const leaveDocument = (leaveEvent: PointerEvent) => {
      if (leaveEvent.target === leaveEvent.currentTarget) finish();
    };

    cleanupDrag = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("pointerleave", leaveDocument);
      input.cancel();
      setLivePoints(null);
      cleanupDrag = null;
      finishDrag = null;
      perf.end();
    };
    finishDrag = finish;
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    document.addEventListener("pointerleave", leaveDocument);
  }

  function resetPoint(index: number, event: MouseEvent) {
    if (props.disabled || !props.defaultPoints?.[index]) return;
    event.preventDefault();
    event.stopPropagation();
    const points = cloneHexagonalSliderPoints(currentPoints());
    const defaultPoint = props.defaultPoints[index];
    points[index] = [clamp(0, 359.999, defaultPoint[0]), clamp(0, DISTANCE_RANGE, defaultPoint[1])];
    setLivePoints(points);
    (props.onInput ?? props.onChange)(points);
    if (props.onInput) props.onChange(points);
    setLivePoints(null);
  }

  return (
    <div
      style={{
        position: "relative",
        display: "block",
        width: `min(${CONTROL_SIZE + POINT_SIZE}px, 100%)`,
        padding: `${POINT_SIZE / 2}px`,
        "box-sizing": "border-box",
        "flex-shrink": "0",
      }}
    >
      <div
        ref={hostRef}
        data-control="hexagonal-slider"
        aria-disabled={props.disabled ? "true" : undefined}
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          "aspect-ratio": "1",
          "border-radius": "50%",
          background: props.background ?? DEFAULT_BACKGROUND,
          opacity: props.disabled ? "0.5" : "1",
          "pointer-events": props.disabled ? "none" : "auto",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", overflow: "visible", "touch-action": "none" }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={getHexagonalSliderGeometry(renderSize()).inlayRadius}
            fill="#1e1e1e"
          />

          <polygon
            points={webPoints()}
            fill="none"
            stroke="#505052"
            stroke-width={Math.max(1, renderSize() * 0.01) * (VIEWBOX_SIZE / renderSize())}
            stroke-dasharray={`${4 * (VIEWBOX_SIZE / renderSize())} ${8 * (VIEWBOX_SIZE / renderSize())}`}
            stroke-linejoin="round"
          />
          {currentPoints().map((_, index) => {
            const point = pointXY(index);
            return (
              <line
                x1={CENTER}
                y1={CENTER}
                x2={point.x}
                y2={point.y}
                stroke="#505052"
                stroke-width={Math.max(1, renderSize() * 0.01) * (VIEWBOX_SIZE / renderSize())}
                stroke-dasharray={`${4 * (VIEWBOX_SIZE / renderSize())} ${8 * (VIEWBOX_SIZE / renderSize())}`}
              />
            );
          })}

          <For each={props.points}>
            {(_, index) => {
              const point = () => pointXY(index());
              const radius = () => getHexagonalSliderGeometry(renderSize()).pointRadius;
              // Legacy uses an 18px box with a rounded 1px transparent border.
              const paintedRadius = () => radius() * (8 / 9);
              const color = () => props.colors[index()] ?? "#fff";
              const selected = () => props.selected === index();
              return (
                <g
                  style={{ cursor: "pointer" }}
                  onPointerDown={(event) => startDrag(index(), event)}
                  onDblClick={(event) => resetPoint(index(), event)}
                >
                  <circle cx={point().x} cy={point().y} r={radius()} fill="transparent" />
                  <circle
                    cx={point().x}
                    cy={point().y}
                    r={paintedRadius()}
                    fill={selected() ? "#fff" : color()}
                  />
                  {selected() && (
                    <circle
                      cx={point().x}
                      cy={point().y}
                      r={paintedRadius() * 0.55}
                      fill={color()}
                    />
                  )}
                </g>
              );
            }}
          </For>
        </svg>
      </div>
    </div>
  );
}
