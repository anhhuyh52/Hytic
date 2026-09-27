import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { selectedMaskId, triggerOverlay } from "./maskingStore";
import { editState, setEditState } from "../../app/editor-store";
import type { ViewerApi } from "../../ui/Viewer";
import type { GradientMaskComponent } from "../../engine/state/EditState";

// ─── constants ────────────────────────────────────────────────────────────────

// ─── helpers ──────────────────────────────────────────────────────────────────

function isPrimary(e: PointerEvent): boolean {
  return e.isPrimary !== false && (e.pointerType !== "mouse" || e.button === 0);
}

type Handle = "start" | "end" | "center";

// ─── layout ───────────────────────────────────────────────────────────────────

interface Layout {
  p00: { x: number; y: number };
  p10: { x: number; y: number };
  p11: { x: number; y: number };
  p01: { x: number; y: number };

  startX: number;
  startY: number;
  endX: number;
  endY: number;
  midX: number;
  midY: number;

  px: number;
  py: number;
}

function computeLayout(api: ViewerApi, comp: GradientMaskComponent): Layout | null {
  const p00 = api.imageUVToCanvasRelative(0, 0);
  const p10 = api.imageUVToCanvasRelative(1, 0);
  const p11 = api.imageUVToCanvasRelative(1, 1);
  const p01 = api.imageUVToCanvasRelative(0, 1);

  if (!p00 || !p10 || !p11 || !p01) return null;

  const startPx = api.imageUVToCanvasRelative(comp.startPoint[0], comp.startPoint[1]);
  const endPx = api.imageUVToCanvasRelative(comp.endPoint[0], comp.endPoint[1]);
  
  if (!startPx || !endPx) return null;

  const midX = (startPx.x + endPx.x) / 2;
  const midY = (startPx.y + endPx.y) / 2;

  const dx = endPx.x - startPx.x;
  const dy = endPx.y - startPx.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.001) len = 0.001;
  
  const px = -dy / len;
  const py = dx / len;

  return { p00, p10, p11, p01, startX: startPx.x, startY: startPx.y, endX: endPx.x, endY: endPx.y, midX, midY, px, py };
}

// ─── drag state ───────────────────────────────────────────────────────────────

interface DragState {
  handle: Handle;
  pointerId: number;
  startComp: GradientMaskComponent;
  canvasOffsetX: number;
  canvasOffsetY: number;
  startCX: number;
  startCY: number;
  pxPerU: number;
  pxPerV: number;
}

// ─── component ────────────────────────────────────────────────────────────────

export function GradientMaskOverlay(props: {
  viewerApi?: ViewerApi;
  mask?: GradientMaskComponent | null;
  onUpdate?: (patch: Partial<GradientMaskComponent>) => void;
  onCommit?: () => void;
}) {
  let svgRef: SVGSVGElement | undefined;

  let livePatchRaf = 0;
  const [dragPatch, setDragPatch] = createSignal<Partial<GradientMaskComponent> | null>(null);
  const [drag, setDrag] = createSignal<DragState | null>(null);

  // ── reactive selectors ────────────────────────────────────────────────────

  const activeIdx = createMemo(() => {
    if (props.mask) return 0;
    const id = selectedMaskId();
    if (!id || !editState.localAdjustments) return -1;
    return editState.localAdjustments.findIndex((l) => l.id === id);
  });

  const activeComp = createMemo((): GradientMaskComponent | null => {
    if (props.mask?.type === "gradient") return props.mask;
    const idx = activeIdx();
    if (idx === -1) return null;
    const comp = editState.localAdjustments?.[idx]?.components?.[0];
    return comp?.type === "gradient" ? (comp as unknown as GradientMaskComponent) : null;
  });

  const liveComp = createMemo((): GradientMaskComponent | null => {
    const comp = activeComp();
    const patch = dragPatch();
    if (!comp) return null;
    if (patch) return { ...comp, ...patch };
    return comp;
  });

  // ── rAF layout tick ───────────────────────────────────────────────────────

  const [layout, setLayout] = createSignal<Layout | null>(null);
  let alignRaf = 0;

  function tickAlignment() {
    alignRaf = requestAnimationFrame(tickAlignment);
    const api = props.viewerApi;
    const comp = liveComp();
    if (!api || !comp) { setLayout(null); return; }
    setLayout(computeLayout(api, comp));
  }

  onMount(() => { alignRaf = requestAnimationFrame(tickAlignment); });
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

  function schedulePreviewUpdate(patch: Partial<GradientMaskComponent>) {
    setDragPatch(patch);
    if (livePatchRaf) return;
    livePatchRaf = requestAnimationFrame(() => {
      livePatchRaf = 0;
      const api = props.viewerApi;
      const lc = liveComp();
      if (api && lc) {
        api.setGradientMaskPreview({
          enabled: true,
          startPoint: lc.startPoint,
          endPoint: lc.endPoint,
          reflect: lc.reflect,
          invert: lc.invert,
          opacity: lc.opacity ?? 1,
          alpha: lc.alpha ?? 1,
          overlayColor: [1, 0, 0],
          overlayOpacity: 0.38,
        });
      }
    });
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
        startPoint: [comp.startPoint[0], comp.startPoint[1]],
        endPoint: [comp.endPoint[0], comp.endPoint[1]],
      },
      canvasOffsetX: canvasRect.left,
      canvasOffsetY: canvasRect.top,
      startCX,
      startCY,
      pxPerU,
      pxPerV,
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
    const idx = activeIdx();
    if (!d || idx < 0) return;

    const cx = e.clientX - d.canvasOffsetX;
    const cy = e.clientY - d.canvasOffsetY;

    const du = (cx - d.startCX) / d.pxPerU;
    const dv = (cy - d.startCY) / d.pxPerV;

    if (d.handle === "start") {
      if (d.startComp.reflect) {
        schedulePreviewUpdate({
          startPoint: [
            d.startComp.startPoint[0] + du,
            d.startComp.startPoint[1] + dv,
          ],
          endPoint: [
            d.startComp.endPoint[0] - du,
            d.startComp.endPoint[1] - dv,
          ],
        });
      } else {
        schedulePreviewUpdate({
          startPoint: [
            d.startComp.startPoint[0] + du,
            d.startComp.startPoint[1] + dv,
          ],
        });
      }
    } else if (d.handle === "end") {
      if (d.startComp.reflect) {
        schedulePreviewUpdate({
          startPoint: [
            d.startComp.startPoint[0] - du,
            d.startComp.startPoint[1] - dv,
          ],
          endPoint: [
            d.startComp.endPoint[0] + du,
            d.startComp.endPoint[1] + dv,
          ],
        });
      } else {
        schedulePreviewUpdate({
          endPoint: [
            d.startComp.endPoint[0] + du,
            d.startComp.endPoint[1] + dv,
          ],
        });
      }
    } else if (d.handle === "center") {
      schedulePreviewUpdate({
        startPoint: [
          d.startComp.startPoint[0] + du,
          d.startComp.startPoint[1] + dv,
        ],
        endPoint: [
          d.startComp.endPoint[0] + du,
          d.startComp.endPoint[1] + dv,
        ],
      });
    }
  }

  function onWindowPointerUp(_e: PointerEvent) {
    const d = drag();
    if (!d) return;

    if (livePatchRaf) { cancelAnimationFrame(livePatchRaf); livePatchRaf = 0; }
    
    const patch = dragPatch();
    
    setDrag(null);
    setDragPatch(null);
    
    props.viewerApi?.setInteractionLock(false);
    props.viewerApi?.setGradientMaskPreview(null);

    try { svgRef?.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }

    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);

    if (patch) {
      const idx = activeIdx();
      if (idx >= 0) {
        if (props.onUpdate) props.onUpdate(patch);
        else setEditState("localAdjustments", idx, "components", 0, (c: any) => ({ ...c, ...patch }));
        triggerOverlay();
        props.onCommit?.();
      }
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div class="radial-mask-overlay">
      <svg
        ref={svgRef}
        class="radial-mask-overlay__svg"
        style={{
          cursor: "default",
          "touch-action": "none",
        }}
      >
        <Show when={layout() && liveComp()} keyed>
          {(comp) => {
            const l = layout()!;
            const clipId = `grad-clip-${comp.id}`;
            return (
              <>
                <defs>
                  <clipPath id={clipId}>
                    <polygon points={`${l.p00.x},${l.p00.y} ${l.p10.x},${l.p10.y} ${l.p11.x},${l.p11.y} ${l.p01.x},${l.p01.y}`} />
                  </clipPath>
                </defs>

                {/* ── central axis line (between start and end points) ──────── */}
                <g clip-path={`url(#${clipId})`}>
                  <line x1={l.startX} y1={l.startY} x2={l.endX} y2={l.endY} class="radial-mask-overlay__outline-shadow" />
                  <line x1={l.startX} y1={l.startY} x2={l.endX} y2={l.endY} class="radial-mask-overlay__outline" stroke-dasharray="4 4" />
                </g>

                {/* ── perpendicular gradient lines ─────────────────────────────── */}
                <g clip-path={`url(#${clipId})`}>
                  {/* Start Line */}
                  <line x1={l.startX - l.px * 5000} y1={l.startY - l.py * 5000} x2={l.startX + l.px * 5000} y2={l.startY + l.py * 5000} class="radial-mask-overlay__outline-shadow" />
                  <line x1={l.startX - l.px * 5000} y1={l.startY - l.py * 5000} x2={l.startX + l.px * 5000} y2={l.startY + l.py * 5000} class="radial-mask-overlay__outline" />
                  
                  {/* End Line */}
                  <line x1={l.endX - l.px * 5000} y1={l.endY - l.py * 5000} x2={l.endX + l.px * 5000} y2={l.endY + l.py * 5000} class="radial-mask-overlay__outline-shadow" />
                  <line x1={l.endX - l.px * 5000} y1={l.endY - l.py * 5000} x2={l.endX + l.px * 5000} y2={l.endY + l.py * 5000} class="radial-mask-overlay__outline" />
                  
                  {/* Center Line */}
                  <line x1={l.midX - l.px * 5000} y1={l.midY - l.py * 5000} x2={l.midX + l.px * 5000} y2={l.midY + l.py * 5000} class="radial-mask-overlay__outline-shadow" />
                  <line x1={l.midX - l.px * 5000} y1={l.midY - l.py * 5000} x2={l.midX + l.px * 5000} y2={l.midY + l.py * 5000} class="radial-mask-overlay__outline" />
                </g>

                {/* ── thick invisible lines for easier grabbing ────────────── */}
                <g>
                  <line x1={l.startX - l.px * 5000} y1={l.startY - l.py * 5000} x2={l.startX + l.px * 5000} y2={l.startY + l.py * 5000} stroke="transparent" stroke-width="20" style={{ cursor: "move", "pointer-events": "all" }} onPointerDown={(e) => beginDrag(e, "start")} />
                  <line x1={l.endX - l.px * 5000} y1={l.endY - l.py * 5000} x2={l.endX + l.px * 5000} y2={l.endY + l.py * 5000} stroke="transparent" stroke-width="20" style={{ cursor: "move", "pointer-events": "all" }} onPointerDown={(e) => beginDrag(e, "end")} />
                  <line x1={l.midX - l.px * 5000} y1={l.midY - l.py * 5000} x2={l.midX + l.px * 5000} y2={l.midY + l.py * 5000} stroke="transparent" stroke-width="20" style={{ cursor: "move", "pointer-events": "all" }} onPointerDown={(e) => beginDrag(e, "center")} />
                </g>

                {/* ── visible dot handles ──────────────────────────────────── */}
                <circle class="radial-mask-overlay__handle" cx={l.startX} cy={l.startY} r={5} style={{ "pointer-events": "none" }} />
                <circle cx={l.startX} cy={l.startY} r={14} fill="transparent" stroke="none" style={{ cursor: "move", "pointer-events": "all" }} onPointerDown={(e) => beginDrag(e, "start")} />

                <circle class="radial-mask-overlay__handle" cx={l.endX} cy={l.endY} r={5} style={{ "pointer-events": "none" }} />
                <circle cx={l.endX} cy={l.endY} r={14} fill="transparent" stroke="none" style={{ cursor: "move", "pointer-events": "all" }} onPointerDown={(e) => beginDrag(e, "end")} />

                <circle class="radial-mask-overlay__center" cx={l.midX} cy={l.midY} r={4} style={{ "pointer-events": "none" }} />
                <circle cx={l.midX} cy={l.midY} r={14} fill="transparent" stroke="none" style={{ cursor: "move", "pointer-events": "all" }} onPointerDown={(e) => beginDrag(e, "center")} />
              </>
            );
          }}
        </Show>
      </svg>
    </div>
  );
}
