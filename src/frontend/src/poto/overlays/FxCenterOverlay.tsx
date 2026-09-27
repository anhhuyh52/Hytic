import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import type { ViewerApi } from "../../ui/Viewer";

type Center = { x: number; y: number };

export function FxCenterOverlay(props: {
  label: string;
  viewerApi: () => ViewerApi | undefined;
  viewportKey: string;
  centerX: number;
  centerY: number;
  onInput(x: number, y: number): void;
  onChange(x: number, y: number): void;
}) {
  const [layoutTick, setLayoutTick] = createSignal(0);
  const [liveCenter, setLiveCenter] = createSignal<Center | null>(null);
  let resizeObserver: ResizeObserver | undefined;
  let readinessFrame = 0;
  let activePointerId: number | null = null;
  let dragOrigin: { pointerX: number; pointerY: number; center: Center } | null = null;

  const refreshLayout = () => setLayoutTick((tick) => tick + 1);
  const canvasElement = () =>
    props.viewerApi()?.getCanvasElement() ??
    document.querySelector<HTMLCanvasElement>(".viewer__canvas");
  const canvasRect = () =>
    props.viewerApi()?.getCanvasClientRect() ?? canvasElement()?.getBoundingClientRect() ?? null;

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
    window.visualViewport?.addEventListener("resize", refreshLayout);
    window.visualViewport?.addEventListener("scroll", refreshLayout);
  });

  onCleanup(() => {
    cancelAnimationFrame(readinessFrame);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", refreshLayout);
    window.visualViewport?.removeEventListener("resize", refreshLayout);
    window.visualViewport?.removeEventListener("scroll", refreshLayout);
    props.viewerApi()?.setInteractionLock(false);
    if (activePointerId !== null) {
      const value = liveCenter() ?? { x: props.centerX, y: props.centerY };
      props.onChange(value.x, value.y);
    }
  });

  const center = () => liveCenter() ?? { x: props.centerX, y: props.centerY };
  const point = createMemo(() => {
    layoutTick();
    void props.viewportKey;
    const api = props.viewerApi();
    const value = center();
    const rect = canvasRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const relative = api?.imageUVToCanvasRelative(value.x, value.y);
    return relative
      ? { x: rect.left + relative.x, y: rect.top + relative.y }
      : {
          x: rect.left + rect.width * value.x,
          y: rect.top + rect.height * (1 - value.y),
        };
  });

  function pointerToUv(event: PointerEvent): { u: number; v: number } | null {
    const fromViewer = props.viewerApi()?.clientPointToImageUVUnclamped(
      event.clientX,
      event.clientY,
    );
    if (fromViewer) return fromViewer;
    const rect = canvasRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      u: (event.clientX - rect.left) / rect.width,
      v: 1 - (event.clientY - rect.top) / rect.height,
    };
  }

  function updateFromPointer(event: PointerEvent): Center | null {
    const uv = pointerToUv(event);
    if (!uv || !dragOrigin) return null;
    const next = {
      x: Math.max(0, Math.min(1, dragOrigin.center.x + uv.u - dragOrigin.pointerX)),
      y: Math.max(0, Math.min(1, dragOrigin.center.y + uv.v - dragOrigin.pointerY)),
    };
    setLiveCenter(next);
    props.onInput(next.x, next.y);
    return next;
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const uv = pointerToUv(event);
    if (!uv) return;
    activePointerId = event.pointerId;
    dragOrigin = { pointerX: uv.u, pointerY: uv.v, center: center() };
    (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);
    props.viewerApi()?.setInteractionLock(true);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    updateFromPointer(event);
    event.preventDefault();
    event.stopPropagation();
  }

  function finishPointer(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    const finalCenter = updateFromPointer(event) ?? center();
    activePointerId = null;
    dragOrigin = null;
    props.viewerApi()?.setInteractionLock(false);
    props.onChange(finalCenter.x, finalCenter.y);
    setLiveCenter(null);
    event.preventDefault();
    event.stopPropagation();
  }

  function finishLostCapture(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    const finalCenter = center();
    activePointerId = null;
    dragOrigin = null;
    props.viewerApi()?.setInteractionLock(false);
    props.onChange(finalCenter.x, finalCenter.y);
    setLiveCenter(null);
  }

  function setCenter(x: number, y: number) {
    const next = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
    props.onChange(next.x, next.y);
  }

  function onKeyDown(event: KeyboardEvent) {
    const value = center();
    const step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "ArrowLeft") setCenter(value.x - step, value.y);
    else if (event.key === "ArrowRight") setCenter(value.x + step, value.y);
    else if (event.key === "ArrowUp") setCenter(value.x, value.y - step);
    else if (event.key === "ArrowDown") setCenter(value.x, value.y + step);
    else if (event.key === "Home" || event.key === "Enter" || event.key === " ") {
      setCenter(0.5, 0.5);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const displayPoint = () =>
    point() ?? { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };

  return (
    <Portal>
      <svg
        class="fx-center-overlay"
        width="100%"
        height="100%"
        style={{
          position: "fixed",
          inset: "0",
          "z-index": 9999,
          "pointer-events": "none",
          overflow: "visible",
        }}
      >
        <g
          class="fx-center-overlay__handle"
          role="slider"
          tabindex="0"
          aria-label={`${props.label} position`}
          aria-valuetext={`${Math.round(center().x * 100)}%, ${Math.round(center().y * 100)}%`}
          transform={`translate(${displayPoint().x} ${displayPoint().y})`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onLostPointerCapture={finishLostCapture}
          onDblClick={(event) => {
            setCenter(0.5, 0.5);
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={onKeyDown}
        >
          <circle fill="transparent" stroke="none" pointer-events="all" r="28" />
          <circle
            fill="rgba(255,255,255,0.28)"
            stroke="#fff"
            stroke-width="2.5"
            r="12"
          />
        </g>
      </svg>
    </Portal>
  );
}
