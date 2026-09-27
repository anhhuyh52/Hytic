import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import type { EditorOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import type { ViewerApi } from "../../ui/Viewer";
import { rotateDeltaToLocal } from "../../features/overlays/overlayMath";

type Handle = { id: string; x: -1 | 0 | 1; y: -1 | 0 | 1 };
const HANDLES: Handle[] = [
  { id: "nw", x: -1, y: -1 },
  { id: "n", x: 0, y: -1 },
  { id: "ne", x: 1, y: -1 },
  { id: "e", x: 1, y: 0 },
  { id: "se", x: 1, y: 1 },
  { id: "s", x: 0, y: 1 },
  { id: "sw", x: -1, y: 1 },
  { id: "w", x: -1, y: 0 },
];

type ResizeCursor = "ew-resize" | "ns-resize" | "nwse-resize" | "nesw-resize";

function cursorForRotatedHandle(handle: Handle, angleDegrees: number): ResizeCursor {
  const radians = angleDegrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  // Handle vectors are expressed in CSS screen coordinates (positive Y down),
  // matching the transform applied to overlay-transform-box.
  const rotatedX = handle.x * c - handle.y * s;
  const rotatedY = handle.x * s + handle.y * c;
  const direction = ((Math.atan2(rotatedY, rotatedX) * 180) / Math.PI + 180) % 180;
  if (direction < 22.5 || direction >= 157.5) return "ew-resize";
  if (direction < 67.5) return "nwse-resize";
  if (direction < 112.5) return "ns-resize";
  return "nesw-resize";
}

export function OverlayTransformOverlay(props: {
  layer: EditorOverlayLayer;
  viewerApi?: ViewerApi;
  viewportKey: string;
  onUpdate(patch: Partial<Pick<EditorOverlayLayer, "position" | "scale">>): void;
  onCommit(): void;
  onContextMenu(event: MouseEvent): void;
}) {
  let cleanupDrag: (() => void) | undefined;
  let readinessFrame: number | undefined;
  let canvasResizeObserver: ResizeObserver | undefined;
  let geometryObserversAttached = false;
  const [readinessTick, setReadinessTick] = createSignal(0);

  const refreshGeometry = () => setReadinessTick((tick) => tick + 1);

  function attachGeometryObservers(api: ViewerApi) {
    if (geometryObserversAttached) return;
    geometryObserversAttached = true;
    const canvas = api.getCanvasElement();
    if (canvas) {
      canvasResizeObserver = new ResizeObserver(refreshGeometry);
      canvasResizeObserver.observe(canvas);
    }
    window.addEventListener("resize", refreshGeometry);
    window.visualViewport?.addEventListener("resize", refreshGeometry);
    window.visualViewport?.addEventListener("scroll", refreshGeometry);
    refreshGeometry();
  }

  onMount(() => {
    // `viewerApi` is owned imperatively by PotoApp. If this layer mounts during
    // Viewer startup, retry locally rather than making the whole editor depend
    // on a Viewer-readiness signal.
    const waitForViewer = () => {
      if (props.viewerApi) {
        attachGeometryObservers(props.viewerApi);
        readinessFrame = undefined;
        return;
      }
      readinessFrame = requestAnimationFrame(waitForViewer);
    };
    if (!props.viewerApi) readinessFrame = requestAnimationFrame(waitForViewer);
  });

  onCleanup(() => {
    cleanupDrag?.();
    if (readinessFrame !== undefined) cancelAnimationFrame(readinessFrame);
    canvasResizeObserver?.disconnect();
    window.removeEventListener("resize", refreshGeometry);
    window.visualViewport?.removeEventListener("resize", refreshGeometry);
    window.visualViewport?.removeEventListener("scroll", refreshGeometry);
  });

  const geometry = createMemo(() => {
    readinessTick();
    // Reading the key keeps geometry in sync with viewport changes.
    if (!props.viewportKey) return null;
    const api = props.viewerApi;
    if (!api) return null;
    const center = api.imageUVToCanvasRelative(...props.layer.position);
    const xEdge = api.imageUVToCanvasRelative(
      props.layer.position[0] + Math.abs(props.layer.scale[0]) / 2,
      props.layer.position[1],
    );
    const yEdge = api.imageUVToCanvasRelative(
      props.layer.position[0],
      props.layer.position[1] + Math.abs(props.layer.scale[1]) / 2,
    );
    const canvasRect = api.getCanvasClientRect();
    if (!center || !xEdge || !yEdge || !canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
      return null;
    }
    return {
      // The controls are portalled to the document, so use client coordinates.
      // This avoids clipping and stacking contexts created by the viewport grid.
      x: canvasRect.left + center.x,
      y: canvasRect.top + center.y,
      width: Math.max(18, Math.hypot(xEdge.x - center.x, xEdge.y - center.y) * 2),
      height: Math.max(18, Math.hypot(yEdge.x - center.x, yEdge.y - center.y) * 2),
      clip: {
        top: Math.max(0, canvasRect.top),
        right: Math.max(0, window.innerWidth - canvasRect.right),
        bottom: Math.max(0, window.innerHeight - canvasRect.bottom),
        left: Math.max(0, canvasRect.left),
      },
    };
  });

  function beginMove(event: PointerEvent) {
    if (event.button !== 0 || !props.viewerApi) return;
    event.preventDefault();
    event.stopPropagation();
    const start = props.viewerApi.clientPointToImageUVUnclamped(event.clientX, event.clientY);
    if (!start) return;
    const initial: [number, number] = [...props.layer.position];
    startDrag((moveEvent) => {
      const point = props.viewerApi!.clientPointToImageUVUnclamped(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      if (!point) return;
      const nextU = initial[0] + point.u - start.u;
      const nextV = initial[1] + point.v - start.v;
      props.onUpdate({ position: [nextU, nextV] });
    });
  }

  function beginResize(handle: Handle, event: PointerEvent) {
    if (event.button !== 0 || !props.viewerApi) return;
    event.preventDefault();
    event.stopPropagation();
    const center = [...props.layer.position] as [number, number];
    const initial = [...props.layer.scale] as [number, number];
    const angle = props.layer.angle;
    startDrag((moveEvent) => {
      const point = props.viewerApi!.clientPointToImageUVUnclamped(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      if (!point) return;

      const [localX, localY] = rotateDeltaToLocal(
        point.u - center[0],
        point.v - center[1],
        -angle,
      );
      const requestedX = handle.x === 0 ? Math.abs(initial[0]) : Math.max(0.02, Math.abs(localX * 2));
      const requestedY = handle.y === 0 ? Math.abs(initial[1]) : Math.max(0.02, Math.abs(localY * 2));
      props.onUpdate({
        scale: [
          (initial[0] < 0 ? -1 : 1) * requestedX,
          (initial[1] < 0 ? -1 : 1) * requestedY,
        ],
      });
    });
  }

  function startDrag(onMove: (event: PointerEvent) => void) {
    cleanupDrag?.();
    props.viewerApi?.setInteractionLock(true);
    const finish = () => {
      cleanupDrag?.();
      cleanupDrag = undefined;
      props.viewerApi?.setInteractionLock(false);
      props.onCommit();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    cleanupDrag = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  return (
    <Portal>
      <div
        class="overlay-transform-layer"
        aria-hidden="true"
        style={{
          "clip-path": geometry()
            ? `inset(${geometry()!.clip.top}px ${geometry()!.clip.right}px ${geometry()!.clip.bottom}px ${geometry()!.clip.left}px)`
            : undefined,
        }}
      >
        {geometry() && (
          <div
            class="overlay-transform-box"
            style={{
              left: `${geometry()!.x}px`,
              top: `${geometry()!.y}px`,
              width: `${geometry()!.width}px`,
              height: `${geometry()!.height}px`,
              transform: `translate(-50%, -50%) rotate(${props.layer.angle}deg)`,
            }}
            onPointerDown={beginMove}
            onContextMenu={props.onContextMenu}
          >
            <For each={HANDLES}>
              {(handle) => (
                <button
                  type="button"
                  class={`overlay-transform-handle overlay-transform-handle--${handle.id}`}
                  style={{ cursor: cursorForRotatedHandle(handle, props.layer.angle) }}
                  onPointerDown={(event) => beginResize(handle, event)}
                  aria-label={`Resize overlay ${handle.id}`}
                />
              )}
            </For>
          </div>
        )}
      </div>
    </Portal>
  );
}
