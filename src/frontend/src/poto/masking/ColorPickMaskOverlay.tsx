import { createSignal, onCleanup, onMount } from "solid-js";
import { selectedMaskId, triggerOverlay } from "./maskingStore";
import { editState, setEditState } from "../../app/editor-store";
import type { ViewerApi } from "../../ui/Viewer";
import type {
  ColorPickMaskComponent,
  LocalAdjustmentLayer,
} from "../../engine/state/EditState";

const HANDLE_HIT_RADIUS_PX = 24;
const MIN_RADIUS_PX = 8;
const RING_HIT_WIDTH_PX = 12;

type RGBTuple = [number, number, number];
type UVTuple = [number, number];

const DEFAULT_SAMPLE_COLOR: RGBTuple = [1, 0, 0];

function toRgbTuple(color: number[] | RGBTuple | null | undefined): RGBTuple {
  if (!color || color.length < 3) return DEFAULT_SAMPLE_COLOR;

  const max = Math.max(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
  const scale = max > 1 ? 1 / 255 : 1;

  return [
    Math.max(0, Math.min(1, (color[0] ?? DEFAULT_SAMPLE_COLOR[0]) * scale)),
    Math.max(0, Math.min(1, (color[1] ?? DEFAULT_SAMPLE_COLOR[1]) * scale)),
    Math.max(0, Math.min(1, (color[2] ?? DEFAULT_SAMPLE_COLOR[2]) * scale)),
  ];
}

function toUvTuple(u: number, v: number): UVTuple {
  return [u, v];
}

function isPrimaryPointer(e: PointerEvent) {
  return e.isPrimary !== false && (e.pointerType !== "mouse" || e.button === 0);
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function sampledColorToCss(color: number[] | undefined | null) {
  if (!color || color.length < 3) return "transparent";

  const max = Math.max(color[0], color[1], color[2]);
  const scale = max <= 1 ? 255 : 1;

  const r = Math.round(Math.max(0, Math.min(255, color[0] * scale)));
  const g = Math.round(Math.max(0, Math.min(255, color[1] * scale)));
  const b = Math.round(Math.max(0, Math.min(255, color[2] * scale)));

  return `rgb(${r}, ${g}, ${b})`;
}

function resizeCursorForAxisAngle(angleRad: number) {
  const deg = ((((angleRad * 180) / Math.PI) % 180) + 180) % 180;

  if (deg < 22.5 || deg >= 157.5) return "ew-resize";
  if (deg < 67.5) return "nwse-resize";
  if (deg < 112.5) return "ns-resize";
  return "nesw-resize";
}

function getImagePixelScale(api: ViewerApi) {
  const p00 = api.imageUVToCanvasRelative(0, 0);
  const p10 = api.imageUVToCanvasRelative(1, 0);
  const p01 = api.imageUVToCanvasRelative(0, 1);

  if (!p00 || !p10 || !p01) return null;

  return {
    pxPerU: Math.abs(p10.x - p00.x),
    pxPerV: Math.abs(p01.y - p00.y),
  };
}

function getClientPointForUv(api: ViewerApi, u: number, v: number) {
  const canvasRect = api.getCanvasClientRect();
  const point = api.imageUVToCanvasRelative(u, v);

  if (!canvasRect || !point) return null;

  return {
    x: canvasRect.left + point.x,
    y: canvasRect.top + point.y,
  };
}

type RadiusHandle = "sample" | "body" | "left" | "right" | "top" | "bottom";

type RadiusDragState = {
  handle: RadiusHandle;
  pointerId: number;
  startDraft: ColorPickMaskComponent;
  startUv: { u: number; v: number } | null;
};

type EllipseHit = RadiusHandle | null;

function angleFromHandle(handle: RadiusHandle, pointerAngle: number) {
  switch (handle) {
    case "right":
      return normalizeAngle(-pointerAngle);

    case "left":
      return normalizeAngle(Math.PI - pointerAngle);

    case "bottom":
      return normalizeAngle(Math.PI / 2 - pointerAngle);

    case "top":
      return normalizeAngle(-Math.PI / 2 - pointerAngle);

    default:
      return 0;
  }
}

function cursorForHit(hit: EllipseHit, angle = 0) {
  switch (hit) {
    case "body":
      return "move";

    case "left":
    case "right":
      return resizeCursorForAxisAngle(-angle);

    case "top":
    case "bottom":
      return resizeCursorForAxisAngle(Math.PI / 2 - angle);

    default:
      return "default";
  }
}

export function ColorPickMaskOverlay(props: {
  viewerApi?: ViewerApi;
  mask?: ColorPickMaskComponent | null;
  onUpdate?: (patch: Partial<ColorPickMaskComponent>) => void;
  onCommit?: () => void;
}) {
  let overlayRef!: HTMLDivElement;
  let pointRef!: HTMLDivElement;
  let ellipseRef!: HTMLDivElement;

  let alignmentRaf = 0;
  let livePatchRaf = 0;
  let pendingLivePatch: Partial<ColorPickMaskComponent> | null = null;
  let pendingLiveMaskIndex = -1;
  let lastPixelSampleAt = -Infinity;
  let lastPixelSample: RGBTuple | null = null;

  // Pixel reads temporarily composite a clean frame and then restore the mask
  // preview. Pointer devices can dispatch much faster than the display refresh,
  // so cap this expensive operation while keeping geometry updates at rAF speed.
  const PIXEL_SAMPLE_INTERVAL_MS = 1000 / 30;

  const [radiusDrag, setRadiusDrag] = createSignal<RadiusDragState | null>(null);
  const [hoverHandle, setHoverHandle] = createSignal<EllipseHit>(null);

  const activeMaskIdx = () => {
    if (props.mask) return 0;
    const id = selectedMaskId();
    if (!id || !editState.localAdjustments) return -1;

    return editState.localAdjustments.findIndex((layer) => layer.id === id);
  };

  const activeMaskLayer = (): LocalAdjustmentLayer | null => {
    const idx = activeMaskIdx();
    if (idx === -1) return null;

    return editState.localAdjustments[idx] ?? null;
  };

  const activeMaskComp = (): ColorPickMaskComponent | null => {
    if (props.mask?.type === "color-pick") return props.mask;
    const layer = activeMaskLayer();
    const component = layer?.components?.[0];

    return component?.type === "color-pick" ? component : null;
  };

  function patchSelectedComponentNow(
    idx: number,
    patch: Partial<ColorPickMaskComponent>,
  ) {
    if (idx < 0) return;

    if (props.onUpdate) props.onUpdate(patch);
    else setEditState(
      "localAdjustments", idx, "components", 0,
      (component: any) => ({ ...component, ...patch }),
    );

    // Keep overlay visible and request engine-side mask preview every frame during drag.
    triggerOverlay();
  }

  function scheduleLiveComponentPatch(
    idx: number,
    patch: Partial<ColorPickMaskComponent>,
  ) {
    if (idx < 0) return;

    pendingLiveMaskIndex = idx;
    pendingLivePatch = {
      ...(pendingLivePatch ?? {}),
      ...patch,
    };

    if (livePatchRaf) return;

    livePatchRaf = requestAnimationFrame(() => {
      livePatchRaf = 0;

      if (!pendingLivePatch || pendingLiveMaskIndex < 0) return;

      const patchToApply = pendingLivePatch;
      const idxToApply = pendingLiveMaskIndex;

      pendingLivePatch = null;
      pendingLiveMaskIndex = -1;

      patchSelectedComponentNow(idxToApply, patchToApply);
    });
  }

  function flushLiveComponentPatch() {
    if (livePatchRaf) {
      cancelAnimationFrame(livePatchRaf);
      livePatchRaf = 0;
    }

    if (!pendingLivePatch || pendingLiveMaskIndex < 0) return;

    const patchToApply = pendingLivePatch;
    const idxToApply = pendingLiveMaskIndex;

    pendingLivePatch = null;
    pendingLiveMaskIndex = -1;

    patchSelectedComponentNow(idxToApply, patchToApply);
  }

  function readSampleColorAtClient(
    api: ViewerApi,
    clientX: number,
    clientY: number,
    fallback: RGBTuple | null | undefined,
  ): RGBTuple {
    const now = performance.now();
    if (lastPixelSample && now - lastPixelSampleAt < PIXEL_SAMPLE_INTERVAL_MS) {
      return lastPixelSample;
    }

    const sampled = api.readDisplayPixelAtClient(clientX, clientY);
    lastPixelSample = toRgbTuple(sampled || fallback);
    lastPixelSampleAt = now;
    return lastPixelSample;
  }

  function readSampleColorAtUv(
    api: ViewerApi,
    u: number,
    v: number,
    fallback: RGBTuple | null | undefined,
  ): RGBTuple {
    const clientPoint = getClientPointForUv(api, u, v);
    if (!clientPoint) return toRgbTuple(fallback);
    return readSampleColorAtClient(api, clientPoint.x, clientPoint.y, fallback);
  }

  function getEllipseLocalPoint(clientX: number, clientY: number) {
    const draft = activeMaskComp();
    const api = props.viewerApi;

    if (!draft || !draft.useRadius || !api || !ellipseRef) return null;

    const canvasRect = api.getCanvasClientRect();
    const center = api.imageUVToCanvasRelative(draft.position[0], draft.position[1]);
    const right = api.imageUVToCanvasRelative(
      draft.position[0] + draft.size[0],
      draft.position[1],
    );
    const top = api.imageUVToCanvasRelative(
      draft.position[0],
      draft.position[1] + draft.size[1],
    );

    if (!canvasRect || !center || !right || !top) return null;

    const cx = canvasRect.left + center.x;
    const cy = canvasRect.top + center.y;

    const rx = Math.max(MIN_RADIUS_PX, Math.abs(right.x - center.x));
    const ry = Math.max(MIN_RADIUS_PX, Math.abs(top.y - center.y));

    const dx = clientX - cx;
    const dy = clientY - cy;

    // Visual ellipse is rotated with CSS rotate(-angle).
    // Convert pointer back to ellipse-local space with +angle.
    const angle = draft.angle || 0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    const localX = dx * c - dy * s;
    const localY = dx * s + dy * c;

    return {
      localX,
      localY,
      rx,
      ry,
      centerScreen: { x: cx, y: cy },
    };
  }

  function hitTestEllipse(clientX: number, clientY: number): EllipseHit {
    const p = getEllipseLocalPoint(clientX, clientY);
    if (!p) return null;

    const { localX, localY, rx, ry } = p;

    if (Math.hypot(localX, localY + ry) <= HANDLE_HIT_RADIUS_PX) return "top";
    if (Math.hypot(localX, localY - ry) <= HANDLE_HIT_RADIUS_PX) return "bottom";
    if (Math.hypot(localX - rx, localY) <= HANDLE_HIT_RADIUS_PX) return "right";
    if (Math.hypot(localX + rx, localY) <= HANDLE_HIT_RADIUS_PX) return "left";

    const nx = localX / rx;
    const ny = localY / ry;
    const normalizedDistance = Math.sqrt(nx * nx + ny * ny);
    const ringDistancePx = Math.abs(normalizedDistance - 1) * Math.min(rx, ry);

    if (normalizedDistance <= 1 || ringDistancePx <= RING_HIT_WIDTH_PX) {
      return "body";
    }

    return null;
  }

  function getViewerCoords(
    clientX: number,
    clientY: number,
    mode: "strict" | "clamped" | "unclamped" = "strict",
  ): { u: number; v: number } | null {
    const api = props.viewerApi;
    if (!api) return null;

    if (mode === "unclamped" && api.clientPointToImageUVUnclamped) {
      return api.clientPointToImageUVUnclamped(clientX, clientY);
    }

    if (mode === "clamped" && api.clientPointToImageUVClamped) {
      return api.clientPointToImageUVClamped(clientX, clientY);
    }

    const uv = api.clientPointToImageUV(clientX, clientY);
    if (!uv) return null;

    return {
      u: Math.max(0, Math.min(1, uv.u)),
      v: Math.max(0, Math.min(1, uv.v)),
    };
  }

  function positionSamplePoint(
    overlayRect: DOMRect,
    x: number,
    y: number,
    sampledColor: number[] | undefined | null,
  ) {
    if (!pointRef) return;

    pointRef.style.display = "block";
    pointRef.style.position = "absolute";
    pointRef.style.left = `${x - overlayRect.left}px`;
    pointRef.style.top = `${y - overlayRect.top}px`;
    pointRef.style.setProperty(
      "--color-mask-sample-color",
      sampledColorToCss(sampledColor),
    );
  }

  function positionSamplePointAtUv(
    u: number,
    v: number,
    sampledColor: number[] | undefined | null,
  ) {
    const api = props.viewerApi;
    if (!api || !overlayRef || !pointRef) return;

    const overlayRect = overlayRef.getBoundingClientRect();
    const canvasRect = api.getCanvasClientRect();
    const p = api.imageUVToCanvasRelative(u, v);

    if (!canvasRect || !p) return;

    positionSamplePoint(
      overlayRect,
      canvasRect.left + p.x,
      canvasRect.top + p.y,
      sampledColor,
    );
  }

  function beginRadiusDrag(e: PointerEvent, handle: RadiusHandle) {
    if (!isPrimaryPointer(e)) return;

    const api = props.viewerApi;
    const draft = activeMaskComp();

    if (!api || !draft) return;

    const uv = getViewerCoords(
      e.clientX,
      e.clientY,
      handle === "sample" ? "clamped" : "unclamped",
    );

    lastPixelSampleAt = -Infinity;
    lastPixelSample = null;

    setRadiusDrag({
      handle,
      pointerId: e.pointerId,
      startDraft: {
        ...draft,
        position: [...draft.position],
        size: [...draft.size],
        sampledColor: toRgbTuple(draft.sampledColor),
        selectedColor: toRgbTuple(draft.selectedColor ?? draft.sampledColor),
      },
      startUv: uv,
    });

    api.setInteractionLock(true);

    if (overlayRef && typeof overlayRef.setPointerCapture === "function") {
      overlayRef.setPointerCapture(e.pointerId);
    }
  }

  function handleEllipsePointerDown(e: PointerEvent) {
    if (!props.viewerApi || !isPrimaryPointer(e)) return;

    const hit = hitTestEllipse(e.clientX, e.clientY);
    if (!hit) return;

    e.stopPropagation();
    e.preventDefault();

    beginRadiusDrag(e, hit);
  }

  function handlePointerMove(e: PointerEvent) {
    const draft = activeMaskComp();
    const drag = radiusDrag();
    const api = props.viewerApi;
    const idx = activeMaskIdx();

    if (!drag) {
      if (draft?.useRadius) {
        setHoverHandle(hitTestEllipse(e.clientX, e.clientY));
      } else {
        setHoverHandle(null);
      }

      return;
    }

    if (!draft || !api || idx === -1) return;

    const uv = getViewerCoords(
      e.clientX,
      e.clientY,
      drag.handle === "sample" ? "clamped" : "unclamped",
    );

    if (drag.handle === "sample") {
      if (!uv) return;

      const sampledColor = readSampleColorAtClient(
        api,
        e.clientX,
        e.clientY,
        draft.sampledColor,
      );

      // Immediate visual motion. Do not wait for Solid store or engine render.
      positionSamplePointAtUv(uv.u, uv.v, sampledColor);

      // Live mask preview update, throttled to once per animation frame.
      scheduleLiveComponentPatch(idx, {
        sampleX: uv.u,
        sampleY: uv.v,
        position: toUvTuple(uv.u, uv.v),
        sampledColor,
        selectedColor: sampledColor,
        useSelectedColor: true,
      });

      return;
    }

    if (drag.handle === "body") {
      if (!uv || !drag.startUv) return;

      const du = uv.u - drag.startUv.u;
      const dv = uv.v - drag.startUv.v;

      const nextPosition = toUvTuple(
        drag.startDraft.position[0] + du,
        drag.startDraft.position[1] + dv,
      );

      const sampledColor = readSampleColorAtUv(
        api,
        nextPosition[0],
        nextPosition[1],
        draft.sampledColor,
      );

      // Immediate center point motion while the radius body moves.
      positionSamplePointAtUv(nextPosition[0], nextPosition[1], sampledColor);

      scheduleLiveComponentPatch(idx, {
        position: nextPosition,
        sampleX: nextPosition[0],
        sampleY: nextPosition[1],
        sampledColor,
        selectedColor: sampledColor,
        useSelectedColor: true,
      });

      return;
    }

    const scale = getImagePixelScale(api);
    const canvasRect = api.getCanvasClientRect();
    const center = api.imageUVToCanvasRelative(
      drag.startDraft.position[0],
      drag.startDraft.position[1],
    );

    if (!scale || !canvasRect || !center) return;

    const centerX = canvasRect.left + center.x;
    const centerY = canvasRect.top + center.y;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const radiusPx = Math.max(MIN_RADIUS_PX, Math.hypot(dx, dy));
    const pointerAngle = Math.atan2(dy, dx);
    const nextAngle = angleFromHandle(drag.handle, pointerAngle);

    let nextSizeX = drag.startDraft.size[0];
    let nextSizeY = drag.startDraft.size[1];

    if (drag.handle === "left" || drag.handle === "right") {
      nextSizeX = radiusPx / scale.pxPerU;
    }

    if (drag.handle === "top" || drag.handle === "bottom") {
      nextSizeY = radiusPx / scale.pxPerV;
    }

    scheduleLiveComponentPatch(idx, {
      angle: nextAngle,
      size: toUvTuple(
        Math.max(0.005, nextSizeX),
        Math.max(0.005, nextSizeY),
      ),
    });
  }

  const handlePointerUp = (e: PointerEvent) => {
    if (!radiusDrag()) return;

    // Apply final pending sample/radius update immediately.
    flushLiveComponentPatch();

    setRadiusDrag(null);
    props.viewerApi?.setInteractionLock(false);

    if (
      overlayRef &&
      typeof overlayRef.hasPointerCapture === "function" &&
      overlayRef.hasPointerCapture(e.pointerId)
    ) {
      overlayRef.releasePointerCapture(e.pointerId);
    }
    props.onCommit?.();
  };

  function updateAlignment() {
    alignmentRaf = requestAnimationFrame(updateAlignment);

    const api = props.viewerApi;
    if (!api || !overlayRef) return;

    const draft = activeMaskComp();

    if (!draft) {
      if (pointRef) pointRef.style.display = "none";
      if (ellipseRef) ellipseRef.style.display = "none";
      return;
    }

    const overlayRect = overlayRef.getBoundingClientRect();
    const canvasRect = api.getCanvasClientRect();

    if (!canvasRect) {
      if (pointRef) pointRef.style.display = "none";
      if (ellipseRef) ellipseRef.style.display = "none";
      return;
    }

    const displayColor = draft.selectedColor ?? draft.sampledColor;

    if (!draft.useRadius) {
      if (ellipseRef) ellipseRef.style.display = "none";

      if (radiusDrag()?.handle === "sample") {
        pointRef?.style.setProperty(
          "--color-mask-sample-color",
          sampledColorToCss(displayColor),
        );
        return;
      }

      const samplePos = api.imageUVToCanvasRelative(draft.sampleX, draft.sampleY);

      if (!samplePos) {
        if (pointRef) pointRef.style.display = "none";
        return;
      }

      positionSamplePoint(
        overlayRect,
        canvasRect.left + samplePos.x,
        canvasRect.top + samplePos.y,
        displayColor,
      );

      return;
    }

    if (!ellipseRef) return;

    const center = api.imageUVToCanvasRelative(draft.position[0], draft.position[1]);
    const rightEdge = api.imageUVToCanvasRelative(
      draft.position[0] + draft.size[0],
      draft.position[1],
    );
    const topEdge = api.imageUVToCanvasRelative(
      draft.position[0],
      draft.position[1] + draft.size[1],
    );

    if (!center || !rightEdge || !topEdge) {
      if (pointRef) pointRef.style.display = "none";
      ellipseRef.style.display = "none";
      return;
    }

    const rx = Math.max(MIN_RADIUS_PX, Math.abs(rightEdge.x - center.x));
    const ry = Math.max(MIN_RADIUS_PX, Math.abs(topEdge.y - center.y));

    const centerViewportX = canvasRect.left + center.x;
    const centerViewportY = canvasRect.top + center.y;

    if (radiusDrag()?.handle !== "sample" && radiusDrag()?.handle !== "body") {
      positionSamplePoint(
        overlayRect,
        centerViewportX,
        centerViewportY,
        displayColor,
      );
    } else {
      pointRef?.style.setProperty(
        "--color-mask-sample-color",
        sampledColorToCss(displayColor),
      );
    }

    ellipseRef.style.display = "block";
    ellipseRef.style.position = "absolute";
    ellipseRef.style.left = `${centerViewportX - overlayRect.left - rx}px`;
    ellipseRef.style.top = `${centerViewportY - overlayRect.top - ry}px`;
    ellipseRef.style.width = `${rx * 2}px`;
    ellipseRef.style.height = `${ry * 2}px`;
    ellipseRef.style.transformOrigin = "center center";
    ellipseRef.style.transform = `rotate(${-(draft.angle || 0)}rad)`;
  }

  onMount(() => {
    alignmentRaf = requestAnimationFrame(updateAlignment);
  });

  onCleanup(() => {
    if (radiusDrag()) props.viewerApi?.setInteractionLock(false);

    if (alignmentRaf) cancelAnimationFrame(alignmentRaf);
    if (livePatchRaf) cancelAnimationFrame(livePatchRaf);

    alignmentRaf = 0;
    livePatchRaf = 0;
    pendingLivePatch = null;
    pendingLiveMaskIndex = -1;
  });

  return (
    <div
      ref={overlayRef}
      class="color-mask-overlay"
      classList={{
        "is-editing": activeMaskComp() !== null,
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        cursor: cursorForHit(
          radiusDrag()?.handle || hoverHandle(),
          activeMaskComp()?.angle || 0,
        ),
        "pointer-events": activeMaskComp() !== null ? "auto" : "none",
      }}
    >
      <div
        ref={pointRef}
        class="color-mask-overlay__point"
        classList={{
          "is-dragging": radiusDrag()?.handle === "sample",
          "is-radius-center": !!activeMaskComp()?.useRadius,
        }}
        style={{ display: "none" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          beginRadiusDrag(e, "sample");
        }}
      />

      <div
        ref={ellipseRef}
        class="color-mask-overlay__ellipse"
        style={{ display: "none" }}
        onPointerDown={handleEllipsePointerDown}
      >
        <div class="handle handle--top" data-index="0.0" />
        <div class="handle handle--bottom" data-index="0.1" />
        <div class="handle handle--right" data-index="0.2" />
        <div class="handle handle--left" data-index="0.3" />
      </div>
    </div>
  );
}
