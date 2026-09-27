/**
 * RadialMaskOverlay
 *
 * Renders an interactive SVG ellipse overlay for radial masks.
 *
 * Key design decisions
 * ─────────────────────
 * • The outer <div> is position:absolute inset:0 (see CSS) and always
 *   rendered; pointer-events are controlled per-element so non-radial
 *   masks don't block the viewer.
 * • pointermove / pointerup handlers are attached to `window` during a
 *   drag so events are never lost regardless of where the pointer travels.
 *   setPointerCapture on the SVG is also set as a belt-and-suspenders.
 * • ALL coordinate math goes through imageUVToCanvasRelative so the SVG
 *   and the WebGL pass always agree.
 * • rAF-coalesced writes keep the Solid store update rate at ≤60 fps.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { selectedMaskId, triggerOverlay } from "./maskingStore";
import { editState, setEditState } from "../../app/editor-store";
import type { ViewerApi } from "../../ui/Viewer";
import type { ColorPickMaskComponent } from "../../engine/state/EditState";

// ─── constants ────────────────────────────────────────────────────────────────

const MIN_SIZE_UV = 0.04; // minimum diameter in UV space
const DEFAULT_POSITION: [number, number] = [0.5, 0.5];
const DEFAULT_SIZE: [number, number] = [0.55, 0.55];
const DEFAULT_ANGLE = 0;

function defaultCircleSize(api?: ViewerApi): [number, number] {
  if (!api) return [...DEFAULT_SIZE];
  const origin = api.imageUVToCanvasRelative(0, 0);
  const xEdge = api.imageUVToCanvasRelative(1, 0);
  const yEdge = api.imageUVToCanvasRelative(0, 1);
  if (!origin || !xEdge || !yEdge) return [...DEFAULT_SIZE];

  const width = Math.hypot(xEdge.x - origin.x, xEdge.y - origin.y);
  const height = Math.hypot(yEdge.x - origin.x, yEdge.y - origin.y);
  if (width <= 0 || height <= 0) return [...DEFAULT_SIZE];

  const diameter = Math.min(width, height) * DEFAULT_SIZE[0];
  return [diameter / width, diameter / height];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function resizeCursor(rad: number): string {
  const deg = ((((rad * 180) / Math.PI) % 180) + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return "ew-resize";
  if (deg < 67.5) return "nwse-resize";
  if (deg < 112.5) return "ns-resize";
  return "nesw-resize";
}

function isPrimary(e: PointerEvent): boolean {
  return e.isPrimary !== false && (e.pointerType !== "mouse" || e.button === 0);
}

type Handle = "body" | "left" | "right" | "top" | "bottom";

function angleFromHandle(handle: Handle, pointerAngle: number): number {
  switch (handle) {
    case "right": return normalizeAngle(-pointerAngle);
    case "left": return normalizeAngle(Math.PI - pointerAngle);
    case "bottom": return normalizeAngle(Math.PI / 2 - pointerAngle);
    case "top": return normalizeAngle(-Math.PI / 2 - pointerAngle);
    default: return 0;
  }
}

function cursorForHandle(handle: Handle | null, angle: number): string {
  if (!handle) return "default";
  if (handle === "body") return "move";
  if (handle === "left" || handle === "right") return resizeCursor(-angle);
  return resizeCursor(Math.PI / 2 - angle);
}

// ─── layout ───────────────────────────────────────────────────────────────────

interface Layout {
  cx: number; cy: number;    // canvas-relative px (from imageUVToCanvasRelative)
  rx: number; ry: number;    // half-axes in canvas px
  angleDeg: number;          // rotation for SVG transform
}

function computeLayout(api: ViewerApi, comp: ColorPickMaskComponent): Layout | null {
  const center = api.imageUVToCanvasRelative(comp.position[0], comp.position[1]);
  const rightEdge = api.imageUVToCanvasRelative(comp.position[0] + comp.size[0] * 0.5, comp.position[1]);
  const bottomEdge = api.imageUVToCanvasRelative(comp.position[0], comp.position[1] + comp.size[1] * 0.5);

  if (!center || !rightEdge || !bottomEdge) return null;

  return {
    cx: center.x,
    cy: center.y,
    // Measure full canvas-space distance rather than one axis. Axis-only
    // subtraction turns a default circle into an ellipse after image rotation.
    rx: Math.max(4, Math.hypot(rightEdge.x - center.x, rightEdge.y - center.y)),
    ry: Math.max(4, Math.hypot(bottomEdge.x - center.x, bottomEdge.y - center.y)),
    angleDeg: (-(comp.angle ?? 0) * 180) / Math.PI,
  };
}

// ─── drag state ───────────────────────────────────────────────────────────────

interface DragState {
  handle: Handle;
  pointerId: number;
  startComp: ColorPickMaskComponent;
  /** canvasRect.left / .top at drag start — stable for the whole drag */
  canvasOffsetX: number;
  canvasOffsetY: number;
  /** canvas-relative pointer position at drag start */
  startCX: number;
  startCY: number;
  /** px-per-UV at drag start (stable) */
  pxPerU: number;
  pxPerV: number;
  aspectLocked: boolean;
}

// ─── component ────────────────────────────────────────────────────────────────

export function RadialMaskOverlay(props: {
  viewerApi?: ViewerApi;
  mask?: ColorPickMaskComponent | null;
  onUpdate?: (patch: Partial<ColorPickMaskComponent>) => void;
  onCommit?: () => void;
}) {
  let svgRef: SVGSVGElement | undefined;

  // rAF-coalesced store writes
  let livePatchRaf = 0;
  let pendingPatch: Partial<ColorPickMaskComponent> | null = null;
  let pendingIdx = -1;

  const [drag, setDrag] = createSignal<DragState | null>(null);

  // ── reactive selectors ────────────────────────────────────────────────────

  const activeIdx = createMemo(() => {
    if (props.mask) return 0;
    const id = selectedMaskId();
    if (!id || !editState.localAdjustments) return -1;
    return editState.localAdjustments.findIndex((l) => l.id === id);
  });

  const activeComp = createMemo((): ColorPickMaskComponent | null => {
    if (props.mask?.type === "radial") return props.mask;
    const idx = activeIdx();
    if (idx === -1) return null;
    const comp = editState.localAdjustments?.[idx]?.components?.[0];
    return comp?.type === "radial" ? comp : null;
  });

  // ── rAF layout tick ───────────────────────────────────────────────────────

  const [layout, setLayout] = createSignal<Layout | null>(null);
  let alignRaf = 0;

  function tickAlignment() {
    alignRaf = requestAnimationFrame(tickAlignment);
    const api = props.viewerApi;
    const comp = activeComp();
    if (!api || !comp) { setLayout(null); return; }
    const next = computeLayout(api, comp);
    setLayout((current) =>
      current && next &&
      current.cx === next.cx && current.cy === next.cy &&
      current.rx === next.rx && current.ry === next.ry &&
      current.angleDeg === next.angleDeg
        ? current
        : next,
    );
  }

  onMount(() => {
    alignRaf = requestAnimationFrame(tickAlignment);
  });
  onCleanup(() => {
    cancelAnimationFrame(alignRaf);
    cancelAnimationFrame(livePatchRaf);
    if (drag()) {
      props.viewerApi?.setInteractionLock(false);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    }
  });

  // ── patch helpers ─────────────────────────────────────────────────────────

  function applyPatchNow(idx: number, patch: Partial<ColorPickMaskComponent>) {
    if (idx < 0) return;
    if (props.onUpdate) {
      props.onUpdate(patch);
      triggerOverlay();
      return;
    }
    setEditState(
      "localAdjustments", idx, "components", 0,
      (c: any) => ({ ...c, ...patch }),
    );
    triggerOverlay();
  }

  function schedulePatch(idx: number, patch: Partial<ColorPickMaskComponent>) {
    pendingIdx = idx;
    pendingPatch = { ...(pendingPatch ?? {}), ...patch };
    if (livePatchRaf) return;
    livePatchRaf = requestAnimationFrame(() => {
      livePatchRaf = 0;
      if (pendingPatch !== null && pendingIdx >= 0) {
        applyPatchNow(pendingIdx, pendingPatch);
      }
      pendingPatch = null;
      pendingIdx = -1;
    });
  }

  function flushPatch() {
    if (livePatchRaf) { cancelAnimationFrame(livePatchRaf); livePatchRaf = 0; }
    if (pendingPatch !== null && pendingIdx >= 0) applyPatchNow(pendingIdx, pendingPatch);
    pendingPatch = null;
    pendingIdx = -1;
  }

  // ── pointer handlers ──────────────────────────────────────────────────────

  function beginDrag(e: PointerEvent, handle: Handle) {
    if (!isPrimary(e)) return;

    const api = props.viewerApi;
    const comp = activeComp();
    if (!api || !comp) return;

    e.stopPropagation();
    e.preventDefault();

    const canvasRect = api.getCanvasClientRect();
    if (!canvasRect) return;

    /**
     * Use signed UV scale.
     *
     * Important:
     * - Body drag needs signed pxPerV.
     * - If imageUVToCanvasRelative has flipped Y, pxPerV will be negative.
     * - That fixes the bug where dragging down moves the mask up.
     */
    const p00 = api.imageUVToCanvasRelative(0, 0);
    const p10 = api.imageUVToCanvasRelative(1, 0);
    const p01 = api.imageUVToCanvasRelative(0, 1);

    if (!p00 || !p10 || !p01) return;

    const pxPerU = p10.x - p00.x;
    const pxPerV = p01.y - p00.y;

    if (Math.abs(pxPerU) < 1 || Math.abs(pxPerV) < 1) return;

    const startCX = e.clientX - canvasRect.left;
    const startCY = e.clientY - canvasRect.top;

    setDrag({
      handle,
      pointerId: e.pointerId,
      startComp: {
        ...comp,
        position: [comp.position[0], comp.position[1]],
        size: [comp.size[0], comp.size[1]],
      },
      canvasOffsetX: canvasRect.left,
      canvasOffsetY: canvasRect.top,
      startCX,
      startCY,
      pxPerU,
      pxPerV,
      aspectLocked: e.shiftKey,
    });

    api.setInteractionLock(true);

    if (svgRef) {
      try {
        svgRef.setPointerCapture(e.pointerId);
      } catch (_) {
        // ignore
      }
    }

    window.addEventListener("pointermove", onWindowPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
  }

  function onWindowPointerMove(e: PointerEvent) {
    const d = drag();
    const api = props.viewerApi;
    const idx = activeIdx();
    if (!d || e.pointerId !== d.pointerId || !api || idx < 0) return;

    // Use the canvas offset captured at drag-start so the reference stays stable
    // even if the browser scrolls or resizes during the drag.
    const cx = e.clientX - d.canvasOffsetX;
    const cy = e.clientY - d.canvasOffsetY;

    if (d.handle === "body") {
      const du = (cx - d.startCX) / d.pxPerU;
      const dv = (cy - d.startCY) / d.pxPerV;

      schedulePatch(idx, {
        position: [
          Math.max(0, Math.min(1, d.startComp.position[0] + du)),
          Math.max(0, Math.min(1, d.startComp.position[1] + dv)),
        ],
      });
      return;
    }

    // Resize — measure from the *live* centre (tracks pending patch).
    const liveComp = activeComp();
    const centerUV = liveComp?.position ?? d.startComp.position;
    const center = api.imageUVToCanvasRelative(centerUV[0], centerUV[1]);
    if (!center) return;

    const dx = cx - center.x;
    const dy = cy - center.y;
    const distPx = Math.max(8, Math.hypot(dx, dy));
    const pointerAngle = Math.atan2(dy, dx);
    const nextAngle = angleFromHandle(d.handle, pointerAngle);

    // Important:
    // Move uses signed pxPerU / pxPerV.
    // Resize must use absolute pixel scale.
    const scaleU = Math.abs(d.pxPerU);
    const scaleV = Math.abs(d.pxPerV);

    let nextSizeX = d.startComp.size[0];
    let nextSizeY = d.startComp.size[1];

    if (d.handle === "left" || d.handle === "right") {
      nextSizeX = Math.max(MIN_SIZE_UV, (distPx / scaleU) * 2);

      if (d.aspectLocked || e.shiftKey) {
        nextSizeY =
          nextSizeX *
          (d.startComp.size[1] / Math.max(0.0001, d.startComp.size[0]));
      }
    } else {
      nextSizeY = Math.max(MIN_SIZE_UV, (distPx / scaleV) * 2);

      if (d.aspectLocked || e.shiftKey) {
        nextSizeX =
          nextSizeY *
          (d.startComp.size[0] / Math.max(0.0001, d.startComp.size[1]));
      }
    }

    schedulePatch(idx, {
      angle: nextAngle,
      size: [nextSizeX, nextSizeY],
    });
  }

  function onWindowPointerUp(e: PointerEvent) {
    const d = drag();
    if (!d || e.pointerId !== d.pointerId) return;

    flushPatch();
    setDrag(null);
    props.viewerApi?.setInteractionLock(false);

    try { svgRef?.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }

    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
    props.onCommit?.();
  }

  function onDoubleClick(e: MouseEvent) {
    e.stopPropagation();
    const idx = activeIdx();
    if (idx < 0) return;
    applyPatchNow(idx, {
      position: [DEFAULT_POSITION[0], DEFAULT_POSITION[1]],
      size: defaultCircleSize(props.viewerApi),
      angle: DEFAULT_ANGLE,
    });
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div
      class="radial-mask-overlay"
    // The CSS sets pointer-events:none on the container; interactive SVG
    // elements opt in with pointer-events:all so the viewer canvas remains
    // fully hit-testable through the non-interactive parts of the overlay.
    >
      <svg
        ref={svgRef}
        class="radial-mask-overlay__svg"
        style={{
          cursor: activeComp()
            ? cursorForHandle(drag()?.handle ?? null, activeComp()?.angle ?? 0)
            : "default",
          "touch-action": "none",
          // SVG pointer-events controlled by CSS (.radial-mask-overlay__svg = none,
          // individual hit elements = all)
        }}
      >
        <Show when={layout()} keyed>
          {(l) => {
            const comp = activeComp();
            if (!comp) return null;
            const { cx, cy, rx, ry, angleDeg } = l;
            const angleRad = comp.angle ?? 0;
            const isCircle = Math.abs(rx - ry) < 0.5;

            // Pre-compute rotated handle positions in canvas-space
            const cosA = Math.cos(-angleRad);
            const sinA = Math.sin(-angleRad);

            const handles: { id: Handle; lx: number; ly: number }[] = [
              { id: "top", lx: 0, ly: -ry },
              { id: "bottom", lx: 0, ly: ry },
              { id: "right", lx: rx, ly: 0 },
              { id: "left", lx: -rx, ly: 0 },
            ];

            const rotated = handles.map(({ id, lx, ly }) => ({
              id,
              sx: cx + lx * cosA - ly * sinA,
              sy: cy + lx * sinA + ly * cosA,
            }));

            return (
              <>
              {/* Use a real SVG circle for the default equal-radius shape. Once
                  either axis is resized independently, switch to an ellipse. */}
              <g transform={`translate(${cx} ${cy}) rotate(${angleDeg})`}>
                {isCircle ? (
                  <>
                    <circle class="radial-mask-overlay__outline-shadow" r={rx} />
                    <circle class="radial-mask-overlay__outline" r={rx} />
                    <circle
                      class="radial-mask-overlay__hit"
                      r={rx}
                      fill="transparent"
                      stroke="transparent"
                      style={{ "pointer-events": "all", cursor: "move" }}
                      onPointerDown={(e: PointerEvent) => beginDrag(e, "body")}
                      onDblClick={onDoubleClick}
                    />
                  </>
                ) : (
                  <>
                    <ellipse class="radial-mask-overlay__outline-shadow" rx={rx} ry={ry} />
                    <ellipse class="radial-mask-overlay__outline" rx={rx} ry={ry} />
                    <ellipse
                      class="radial-mask-overlay__hit"
                      rx={rx}
                      ry={ry}
                      fill="transparent"
                      stroke="transparent"
                      style={{ "pointer-events": "all", cursor: "move" }}
                      onPointerDown={(e: PointerEvent) => beginDrag(e, "body")}
                      onDblClick={onDoubleClick}
                    />
                  </>
                )}
              </g>

              {/* ── centre dot ────────────────────────────────────────── */}
              <circle
                class="radial-mask-overlay__center"
                cx={cx} cy={cy} r={4}
                style={{ "pointer-events": "none" }}
              />
              <circle
                cx={cx} cy={cy} r={14}
                fill="transparent"
                stroke="none"
                style={{ "pointer-events": "all", cursor: "move" }}
                onPointerDown={(e: PointerEvent) => beginDrag(e, "body")}
                onDblClick={onDoubleClick}
              />

              {/* ── edge handles ──────────────────────────────────────── */}
              <For each={rotated}>
                {(handle) => (
                  <>
                    {/* Visible white dot */}
                    <circle
                      class="radial-mask-overlay__handle"
                      cx={handle.sx} cy={handle.sy} r={5}
                      style={{ "pointer-events": "none" }}
                    />
                    {/* Large transparent hit disc */}
                    <circle
                      cx={handle.sx} cy={handle.sy} r={14}
                      fill="transparent"
                      stroke="none"
                      style={{ cursor: cursorForHandle(handle.id, angleRad), "pointer-events": "all" }}
                      onPointerDown={(e: PointerEvent) => beginDrag(e, handle.id)}
                      onDblClick={onDoubleClick}
                    />
                  </>
                )}
              </For>
            </>
          );
        }}
        </Show>
      </svg>
    </div>
  );
}
