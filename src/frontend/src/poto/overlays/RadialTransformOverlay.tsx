import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { GradientOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import type { ViewerApi } from "../../ui/Viewer";
import {
  imageAspectFromViewer,
  radialHandleUv,
  resizeRadialFromHandle,
  type GradientHandle,
} from "./gradientTransformGeometry";

const HANDLES: readonly GradientHandle[] = ["n", "e", "s", "w"];

export function RadialTransformOverlay(props: {
  layer: GradientOverlayLayer;
  viewerApi?: ViewerApi;
  viewportKey: string;
  onUpdate(patch: Partial<Pick<GradientOverlayLayer, "position" | "scale" | "angle">>): void;
  onCommit(): void;
  onContextMenu(event: MouseEvent): void;
}) {
  let cleanupDrag: (() => void) | undefined;
  let readinessFrame: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const [geometryTick, setGeometryTick] = createSignal(0);
  const refresh = () => setGeometryTick((value) => value + 1);

  onMount(() => {
    const waitForViewer = () => {
      const canvas = props.viewerApi?.getCanvasElement();
      if (!canvas) {
        readinessFrame = requestAnimationFrame(waitForViewer);
        return;
      }
      resizeObserver = new ResizeObserver(refresh);
      resizeObserver.observe(canvas);
      readinessFrame = undefined;
      refresh();
    };
    waitForViewer();
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
  });

  onCleanup(() => {
    cleanupDrag?.();
    if (readinessFrame !== undefined) cancelAnimationFrame(readinessFrame);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", refresh);
    window.visualViewport?.removeEventListener("resize", refresh);
    window.visualViewport?.removeEventListener("scroll", refresh);
  });

  const geometry = createMemo(() => {
    geometryTick();
    const viewportKey = props.viewportKey;
    if (!viewportKey) return null;
    const api = props.viewerApi;
    if (!api) return null;
    const aspect = imageAspectFromViewer(api);
    const rect = api.getCanvasClientRect();
    const centerRelative = api.imageUVToCanvasRelative(...props.layer.position);
    if (!aspect || !rect || !centerRelative) return null;
    const center = { x: rect.left + centerRelative.x, y: rect.top + centerRelative.y };
    const handles = Object.fromEntries(HANDLES.map((handle) => {
      const point = api.imageUVToCanvasRelative(...radialHandleUv(props.layer, handle, aspect));
      return [handle, point ? { x: rect.left + point.x, y: rect.top + point.y } : null];
    })) as Record<GradientHandle, { x: number; y: number } | null>;
    if (HANDLES.some((handle) => !handles[handle])) return null;
    const east = handles.e!;
    const south = handles.s!;
    return {
      aspect,
      center,
      handles: handles as Record<GradientHandle, { x: number; y: number }>,
      radiusX: Math.max(1, Math.hypot(east.x - center.x, east.y - center.y)),
      radiusY: Math.max(1, Math.hypot(south.x - center.x, south.y - center.y)),
      screenAngle: Math.atan2(east.y - center.y, east.x - center.x) * 180 / Math.PI,
      clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    };
  });

  function beginMove(event: PointerEvent) {
    const api = props.viewerApi;
    if (event.button !== 0 || !api) return;
    const start = api.clientPointToImageUVUnclamped(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const initial: [number, number] = [...props.layer.position];
    const update = props.onUpdate;
    startDrag((moveEvent) => {
      const point = api.clientPointToImageUVUnclamped(moveEvent.clientX, moveEvent.clientY);
      if (!point) return;
      update({ position: [initial[0] + point.u - start.u, initial[1] + point.v - start.v] });
    });
  }

  function beginResize(handle: GradientHandle, event: PointerEvent) {
    const api = props.viewerApi;
    const currentGeometry = geometry();
    if (event.button !== 0 || !api || !currentGeometry) return;
    event.preventDefault();
    event.stopPropagation();
    const initial: GradientOverlayLayer = {
      ...props.layer,
      position: [...props.layer.position],
      scale: [...props.layer.scale],
    };
    const update = props.onUpdate;
    startDrag((moveEvent) => {
      const point = api.clientPointToImageUVUnclamped(moveEvent.clientX, moveEvent.clientY);
      if (!point) return;
      update(resizeRadialFromHandle(
        initial,
        handle,
        [point.u, point.v],
        currentGeometry.aspect,
        {
          alt: moveEvent.altKey,
          shift: moveEvent.shiftKey,
          constrainRotation: moveEvent.ctrlKey || moveEvent.metaKey,
        },
      ));
    });
  }

  function reset(event: MouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    props.onUpdate({ position: [0.5, 0.5], scale: [1, 1], angle: 0 });
    props.onCommit();
  }

  function startDrag(onMove: (event: PointerEvent) => void) {
    cleanupDrag?.();
    const api = props.viewerApi;
    const commit = props.onCommit;
    api?.setInteractionLock(true);
    let finished = false;
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      cleanupDrag = undefined;
      api?.setInteractionLock(false);
      commit();
    };
    cleanupDrag = () => {
      if (finished) return;
      finished = true;
      cleanup();
      api?.setInteractionLock(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  }

  return (
    <Portal>
      <Show when={geometry()}>
        {(layout) => (
          <svg
            aria-label="Radial gradient transform"
            style={{ position: "fixed", inset: "0", width: "100vw", height: "100vh", "z-index": "82", "pointer-events": "none" }}
          >
            <defs>
              <clipPath id={`radial-gradient-clip-${props.layer.id}`}>
                <rect x={layout().clip.x} y={layout().clip.y} width={layout().clip.width} height={layout().clip.height} />
              </clipPath>
            </defs>
            <g clip-path={`url(#radial-gradient-clip-${props.layer.id})`}>
              <ellipse
                cx={layout().center.x}
                cy={layout().center.y}
                rx={layout().radiusX}
                ry={layout().radiusY}
                transform={`rotate(${layout().screenAngle} ${layout().center.x} ${layout().center.y})`}
                fill="none"
                stroke="rgba(0,0,0,.72)"
                stroke-width="3"
              />
              <ellipse
                cx={layout().center.x}
                cy={layout().center.y}
                rx={layout().radiusX}
                ry={layout().radiusY}
                transform={`rotate(${layout().screenAngle} ${layout().center.x} ${layout().center.y})`}
                fill="none"
                stroke="white"
                stroke-width="1"
              />
              <ellipse
                cx={layout().center.x}
                cy={layout().center.y}
                rx={layout().radiusX}
                ry={layout().radiusY}
                transform={`rotate(${layout().screenAngle} ${layout().center.x} ${layout().center.y})`}
                fill="transparent"
                stroke="transparent"
                stroke-width="24"
                style={{ "pointer-events": "all", cursor: "move" }}
                onPointerDown={beginMove}
                onDblClick={reset}
                onContextMenu={props.onContextMenu}
              />
              <circle cx={layout().center.x} cy={layout().center.y} r="4" fill="white" stroke="rgba(0,0,0,.72)" stroke-width="2" style={{ "pointer-events": "none" }} />
              <For each={HANDLES}>
                {(handle) => {
                  const point = () => layout().handles[handle];
                  return (
                    <g
                      style={{ "pointer-events": "all", cursor: handle === "e" || handle === "w" ? "ew-resize" : "ns-resize" }}
                      onPointerDown={(event) => beginResize(handle, event)}
                      onDblClick={reset}
                      onContextMenu={props.onContextMenu}
                    >
                      <circle cx={point().x} cy={point().y} r="12" fill="transparent" />
                      <circle cx={point().x} cy={point().y} r="8" fill="white" stroke="rgba(0,0,0,.72)" stroke-width="2" />
                    </g>
                  );
                }}
              </For>
            </g>
          </svg>
        )}
      </Show>
    </Portal>
  );
}
