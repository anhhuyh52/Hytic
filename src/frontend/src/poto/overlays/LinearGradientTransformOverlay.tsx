import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { GradientOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import type { ViewerApi } from "../../ui/Viewer";
import {
  imageAspectFromViewer,
  linearEndpointUv,
  resizeLinearFromEndpoint,
} from "./gradientTransformGeometry";

export function LinearGradientTransformOverlay(props: {
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
    if (!aspect || !rect) return null;
    const westUv = linearEndpointUv(props.layer, "w", aspect);
    const eastUv = linearEndpointUv(props.layer, "e", aspect);
    const west = api.imageUVToCanvasRelative(...westUv);
    const east = api.imageUVToCanvasRelative(...eastUv);
    if (!west || !east) return null;
    return {
      aspect,
      west: { x: rect.left + west.x, y: rect.top + west.y },
      east: { x: rect.left + east.x, y: rect.top + east.y },
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
      update({
        position: [initial[0] + point.u - start.u, initial[1] + point.v - start.v],
      });
    });
  }

  function beginResize(handle: "e" | "w", event: PointerEvent) {
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
      update(resizeLinearFromEndpoint(
        initial,
        handle,
        [point.u, point.v],
        currentGeometry.aspect,
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
            aria-label="Linear gradient transform"
            style={{ position: "fixed", inset: "0", width: "100vw", height: "100vh", "z-index": "82", "pointer-events": "none" }}
          >
            <defs>
              <clipPath id={`linear-gradient-clip-${props.layer.id}`}>
                <rect x={layout().clip.x} y={layout().clip.y} width={layout().clip.width} height={layout().clip.height} />
              </clipPath>
            </defs>
            <g clip-path={`url(#linear-gradient-clip-${props.layer.id})`}>
              <line x1={layout().west.x} y1={layout().west.y} x2={layout().east.x} y2={layout().east.y} stroke="rgba(0,0,0,.72)" stroke-width="3" />
              <line x1={layout().west.x} y1={layout().west.y} x2={layout().east.x} y2={layout().east.y} stroke="white" stroke-width="1" />
              <line
                x1={layout().west.x}
                y1={layout().west.y}
                x2={layout().east.x}
                y2={layout().east.y}
                stroke="transparent"
                stroke-width="24"
                style={{ "pointer-events": "stroke", cursor: "move" }}
                onPointerDown={beginMove}
                onDblClick={reset}
                onContextMenu={props.onContextMenu}
              />
              <For each={(["w", "e"] as const)}>
                {(handle) => {
                  const point = () => layout()[handle === "w" ? "west" : "east"];
                  return (
                  <g
                    style={{ "pointer-events": "all", cursor: "grab" }}
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
