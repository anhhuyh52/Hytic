import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ViewerApi } from "../../ui/Viewer";
import {
  clientDistance,
  ellipseBoundaryPoint,
  moveRetouchSpot,
  pinchRetouchSpot,
  resizeRotateRetouchSpot,
  type RetouchPoint,
} from "./retouchOverlayGeometry";
import {
  hoveredSpot,
  panMode,
  selectedSpot,
  setHoveredSpot,
  setPanMode,
  setSelectedSpot,
} from "./retouchStore";
import { cloneRetouchSpot, type RetouchSpot } from "./retouchTypes";

type EllipseLayout = {
  center: RetouchPoint;
  radiusX: number;
  radiusY: number;
  rotation: number;
  transform: string;
  right: RetouchPoint;
};

type SpotLayout = {
  destination: EllipseLayout;
  source: EllipseLayout;
  connector: { start: RetouchPoint; end: RetouchPoint };
};

type DragAction = "destination" | "source" | "resize" | "pinch";

type DragSession = {
  primaryPointerId: number;
  index: number;
  action: DragAction;
  startPointer: RetouchPoint;
  startSpot: RetouchSpot;
  startDistance: number;
  startAngle: number;
  pinchStartDistance: number;
  changed: boolean;
  pointers: Map<number, RetouchPoint>;
  captures: Map<number, Element>;
};

export function SpotRetouchOverlay(props: {
  spots: readonly RetouchSpot[];
  viewerApi: () => ViewerApi | undefined;
  viewportKey: string;
  imageWidth: number;
  imageHeight: number;
  onInput(spots: RetouchSpot[]): void;
  onChange(spots: RetouchSpot[], historyKey: "spot_removal_position" | "spot_removal_size"): void;
  onDelete(index: number): void;
}) {
  const [layoutTick, setLayoutTick] = createSignal(0);
  const [liveSpots, setLiveSpots] = createSignal<RetouchSpot[] | null>(null);
  const [draggingIndex, setDraggingIndex] = createSignal<number | null>(null);
  let drag: DragSession | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let readinessFrame = 0;

  const spots = () => liveSpots() ?? props.spots;
  const canvasElement = () =>
    props.viewerApi()?.getCanvasElement() ??
    document.querySelector<HTMLCanvasElement>(".viewer__canvas");
  const canvasRect = () =>
    props.viewerApi()?.getCanvasClientRect() ?? canvasElement()?.getBoundingClientRect() ?? null;
  const refreshLayout = () => setLayoutTick((value) => value + 1);

  onMount(() => {
    const attach = () => {
      const canvas = canvasElement();
      if (!canvas) {
        readinessFrame = requestAnimationFrame(attach);
        return;
      }
      resizeObserver = new ResizeObserver(refreshLayout);
      resizeObserver.observe(canvas);
      refreshLayout();
    };
    attach();
    window.addEventListener("resize", refreshLayout);
    window.addEventListener("blur", completeDrag);
    window.visualViewport?.addEventListener("resize", refreshLayout);
    window.visualViewport?.addEventListener("scroll", refreshLayout);
  });

  onCleanup(() => {
    completeDrag();
    cancelAnimationFrame(readinessFrame);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", refreshLayout);
    window.removeEventListener("blur", completeDrag);
    window.visualViewport?.removeEventListener("resize", refreshLayout);
    window.visualViewport?.removeEventListener("scroll", refreshLayout);
    props.viewerApi()?.setInteractionLock(false);
  });

  function mapUv(u: number, v: number): RetouchPoint | null {
    const rect = canvasRect();
    if (!rect) return null;
    const relative = props.viewerApi()?.imageUVToCanvasRelative(u, v);
    return relative
      ? { x: rect.left + relative.x, y: rect.top + relative.y }
      : { x: rect.left + rect.width * u, y: rect.top + rect.height * (1 - v) };
  }

  function ellipseLayout(
    centerUv: RetouchPoint,
    size: readonly [number, number],
    angle: number,
  ): EllipseLayout {
    const radians = (angle * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const center = mapUv(centerUv.x, centerUv.y) ?? { x: 0, y: 0 };
    const right =
      mapUv(centerUv.x + cosine * size[0] * 0.5, centerUv.y + sine * size[1] * 0.5) ?? center;
    const top =
      mapUv(centerUv.x - sine * size[0] * 0.5, centerUv.y + cosine * size[1] * 0.5) ?? center;
    const axisX = { x: right.x - center.x, y: right.y - center.y };
    const axisY = { x: top.x - center.x, y: top.y - center.y };
    return {
      center,
      radiusX: Math.max(2, Math.hypot(axisX.x, axisX.y)),
      radiusY: Math.max(2, Math.hypot(axisY.x, axisY.y)),
      rotation: (Math.atan2(axisX.y, axisX.x) * 180) / Math.PI,
      transform: `matrix(${axisX.x} ${axisX.y} ${axisY.x} ${axisY.y} ${center.x} ${center.y})`,
      right,
    };
  }

  const layouts = createMemo<SpotLayout[]>(() => {
    layoutTick();
    void props.viewportKey;
    return spots().map((spot) => {
      const destination = ellipseLayout(
        { x: spot.position[0] + 0.5, y: spot.position[1] + 0.5 },
        spot.size,
        spot.angle,
      );
      const source = ellipseLayout(
        { x: spot.sourcePosition[0] + 0.5, y: spot.sourcePosition[1] + 0.5 },
        spot.size,
        spot.angle,
      );
      return {
        destination,
        source,
        connector: {
          start: ellipseBoundaryPoint(
            source.center,
            source.radiusX,
            source.radiusY,
            source.rotation,
            destination.center,
          ),
          end: ellipseBoundaryPoint(
            destination.center,
            destination.radiusX,
            destination.radiusY,
            destination.rotation,
            source.center,
          ),
        },
      };
    });
  });

  function pointerToUv(event: PointerEvent): RetouchPoint | null {
    const mapped = props.viewerApi()?.clientPointToImageUVUnclamped(event.clientX, event.clientY);
    if (mapped) return { x: mapped.u, y: mapped.v };
    const rect = canvasRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: 1 - (event.clientY - rect.top) / rect.height,
    };
  }

  function resizeMeasurement(pointer: RetouchPoint, spot: RetouchSpot) {
    const centerX = spot.sourcePosition[0] + 0.5;
    const centerY = spot.sourcePosition[1] + 0.5;
    const textureAspect = Math.max(1, props.imageWidth) / Math.max(1, props.imageHeight);
    const correctedX = (pointer.x - centerX) * textureAspect;
    const deltaY = pointer.y - centerY;
    return {
      distance: Math.max(0.0001, 2 * Math.hypot(correctedX, deltaY)),
      angle: (Math.atan2(deltaY, correctedX) * 180) / Math.PI,
    };
  }

  function capturePointer(event: PointerEvent, session: DragSession) {
    const target = event.currentTarget as Element;
    session.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    session.captures.set(event.pointerId, target);
    if ("setPointerCapture" in target) {
      (target as SVGElement).setPointerCapture(event.pointerId);
    }
  }

  function beginDrag(event: PointerEvent, index: number, action: Exclude<DragAction, "pinch">) {
    if (panMode() || (event.pointerType === "mouse" && event.button !== 0)) return;

    if (drag) {
      if (
        event.pointerType !== "touch" ||
        drag.index !== index ||
        drag.pointers.has(event.pointerId)
      ) {
        return;
      }
      capturePointer(event, drag);
      if (drag.pointers.size >= 2) {
        const pointers = [...drag.pointers.values()];
        drag.action = "pinch";
        drag.startSpot = cloneRetouchSpot(spots()[index]);
        drag.pinchStartDistance = Math.max(1, clientDistance(pointers[0], pointers[1]));
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const pointer = pointerToUv(event);
    const spot = spots()[index];
    if (!pointer || !spot || spot.disabled) return;
    const measurement = resizeMeasurement(pointer, spot);
    drag = {
      primaryPointerId: event.pointerId,
      index,
      action,
      startPointer: pointer,
      startSpot: cloneRetouchSpot(spot),
      startDistance: measurement.distance,
      startAngle: measurement.angle,
      pinchStartDistance: 1,
      changed: false,
      pointers: new Map(),
      captures: new Map(),
    };
    capturePointer(event, drag);
    setSelectedSpot(index);
    setDraggingIndex(index);
    props.viewerApi()?.setInteractionLock(true);
    event.preventDefault();
    event.stopPropagation();
  }

  function updateDrag(event: PointerEvent): RetouchSpot[] | null {
    const session = drag;
    if (!session || !session.pointers.has(event.pointerId)) return null;
    session.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    let spot: RetouchSpot;
    if (session.action === "pinch") {
      const pointers = [...session.pointers.values()];
      if (pointers.length < 2) return null;
      const distance = clientDistance(pointers[0], pointers[1]);
      const scale = distance / session.pinchStartDistance;
      session.changed ||= Math.abs(scale - 1) > 0.001;
      spot = pinchRetouchSpot(session.startSpot, scale);
    } else {
      if (event.pointerId !== session.primaryPointerId) return null;
      const pointer = pointerToUv(event);
      if (!pointer) return null;
      session.changed ||=
        Math.hypot(pointer.x - session.startPointer.x, pointer.y - session.startPointer.y) >
        0.00001;
      if (session.action === "destination" || session.action === "source") {
        spot = moveRetouchSpot(session.startSpot, session.startPointer, pointer, session.action);
      } else {
        const measurement = resizeMeasurement(pointer, session.startSpot);
        spot = resizeRotateRetouchSpot(
          session.startSpot,
          session.startDistance,
          session.startAngle,
          measurement.distance,
          measurement.angle,
        );
      }
    }

    if (!session.changed) return null;
    const next = props.spots.map(cloneRetouchSpot);
    next[session.index] = spot;
    setLiveSpots(next);
    props.onInput(next);
    return next;
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag?.pointers.has(event.pointerId)) return;
    updateDrag(event);
    event.preventDefault();
    event.stopPropagation();
  }

  function finishDrag(event: PointerEvent) {
    if (!drag?.pointers.has(event.pointerId)) return;
    updateDrag(event);
    completeDrag();
    event.preventDefault();
    event.stopPropagation();
  }

  function completeDrag() {
    const session = drag;
    if (!session) return;
    const next = liveSpots()?.map(cloneRetouchSpot) ?? props.spots.map(cloneRetouchSpot);
    drag = null;
    setDraggingIndex(null);
    props.viewerApi()?.setInteractionLock(false);
    for (const [pointerId, target] of session.captures) {
      try {
        if ("hasPointerCapture" in target && (target as SVGElement).hasPointerCapture(pointerId)) {
          (target as SVGElement).releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture can already be released by the browser on cancellation.
      }
    }
    if (session.changed) {
      props.onChange(
        next,
        session.action === "resize" || session.action === "pinch"
          ? "spot_removal_size"
          : "spot_removal_position",
      );
    }
    setLiveSpots(null);
  }

  function selectedIndex() {
    const index = selectedSpot();
    return index != null && props.spots[index] ? index : null;
  }

  return (
    <Portal>
      <svg
        class="spot-retouch-overlay"
        classList={{ "is-pan": panMode() }}
        width="100%"
        height="100%"
        aria-label="Spot removal controls"
      >
        <defs>
          <marker
            id="spot-retouch-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 9 4.5 L 0 9 z" fill="#fff" />
          </marker>
        </defs>
        <For each={layouts()}>
          {(layout, index) => {
            const spot = () => spots()[index()];
            const selected = () => selectedIndex() === index();
            return (
              <g
                classList={{
                  "spot-retouch-overlay__spot": true,
                  "is-selected": selected(),
                  "is-hovered": hoveredSpot() === index(),
                  "is-dragging": draggingIndex() === index(),
                  "is-disabled": Boolean(spot().disabled),
                }}
                onPointerEnter={() => setHoveredSpot(index())}
                onPointerLeave={() => setHoveredSpot(null)}
              >
                <Show when={selected()}>
                  <line
                    class="spot-retouch-overlay__connector-shadow"
                    x1={layout.connector.start.x}
                    y1={layout.connector.start.y}
                    x2={layout.connector.end.x}
                    y2={layout.connector.end.y}
                  />
                  <line
                    class="spot-retouch-overlay__connector"
                    x1={layout.connector.start.x}
                    y1={layout.connector.start.y}
                    x2={layout.connector.end.x}
                    y2={layout.connector.end.y}
                    marker-end="url(#spot-retouch-arrow)"
                  />
                  <g
                    class="spot-retouch-overlay__source"
                    transform={layout.source.transform}
                    onPointerDown={(event) => beginDrag(event, index(), "source")}
                    onPointerMove={onPointerMove}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                  >
                    <circle
                      class="spot-retouch-overlay__outline-shadow"
                      r="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle
                      class="spot-retouch-overlay__outline"
                      r="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle class="spot-retouch-overlay__hit" r="1" />
                  </g>
                  <g
                    transform={`translate(${layout.source.right.x} ${layout.source.right.y})`}
                    onPointerDown={(event) => beginDrag(event, index(), "resize")}
                    onPointerMove={onPointerMove}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                  >
                    <circle class="spot-retouch-overlay__handle-shadow" r="9" />
                    <circle class="spot-retouch-overlay__handle" r="8" />
                    <circle class="spot-retouch-overlay__handle-hit" r="24" />
                  </g>
                </Show>

                <g
                  class="spot-retouch-overlay__destination"
                  transform={layout.destination.transform}
                  onPointerDown={(event) => beginDrag(event, index(), "destination")}
                  onPointerMove={onPointerMove}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onClick={() => setSelectedSpot(index())}
                >
                  <circle
                    class="spot-retouch-overlay__outline-shadow"
                    r="1"
                    vector-effect="non-scaling-stroke"
                  />
                  <circle
                    class="spot-retouch-overlay__outline"
                    r="1"
                    vector-effect="non-scaling-stroke"
                  />
                  <circle class="spot-retouch-overlay__hit" r="1" />
                </g>
              </g>
            );
          }}
        </For>
      </svg>
      <div class="spot-retouch-toolbar" role="toolbar" aria-label="Spot removal overlay controls">
        <button
          type="button"
          classList={{ active: panMode() }}
          onClick={() => {
            completeDrag();
            setPanMode((value) => !value);
          }}
          title="Pan"
        >
          Pan
        </button>
        <button
          type="button"
          disabled={selectedIndex() === null}
          onClick={() => {
            completeDrag();
            const index = selectedIndex();
            if (index !== null) props.onDelete(index);
          }}
          title="Delete selected spot"
        >
          Delete
        </button>
      </div>
    </Portal>
  );
}
