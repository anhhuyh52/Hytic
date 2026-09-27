/**
 * BrushMaskOverlay
 *
 * Handles pointer input for brush painting, shows a circular cursor,
 * and commits completed strokes into the selected brush mask component.
 *
 * Key design decisions:
 * - Pointer events are captured on the overlay <div> so moves/ups are never lost.
 * - Coordinate conversion goes through viewerApi.clientPointToImageUVClamped
 *   so the UV is always relative to the image, not the page.
 * - Coalesced pointer samples are batched into one Engine preview update.
 * - Store writes happen ONLY on pointerup (one stroke = one state change).
 * - Cursor alignment is scheduled only when pointer, size, or viewport changes.
 * - Window-level [ / ] keyboard listener adjusts brush size live; only
 *   active while this overlay is mounted, so it never collides with
 *   global shortcuts. Shift modifier narrows the step.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  selectedMaskId,
} from "./maskingStore";
import { editState, setEditState } from "../../app/editor-store";
import type { ViewerApi } from "../../ui/Viewer";
import type {
  BrushMaskComponent,
  BrushPoint,
  BrushStroke,
  ColorPickMaskComponent,
  DepthMaskComponent,
  GradientMaskComponent,
  LuminanceMaskComponent,
} from "../../engine/state/EditState";

// Discriminated union of all mask component shapes — used as the
// parameter type for setEditState callbacks in this file.
type AnyMaskComponent =
  | BrushMaskComponent
  | ColorPickMaskComponent
  | GradientMaskComponent
  | LuminanceMaskComponent
  | DepthMaskComponent;

// ─── helpers ──────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Polarr-style pressure normalisation: maps raw pointer pressure to 0.25..0.75
 * so a stylus at 0 never produces zero contribution and full pressure is capped.
 */
function normalizePressure(pressure?: number): number {
  const p = pressure && pressure > 0 ? pressure : 0.5;
  return Math.max(0, Math.min(1, p / 2 + 0.25));
}

/**
 * Inserts interpolated points between the last committed point and the new one
 * based on the stroke's spacing setting (fraction of radius).
 * Mutates only the in-progress stroke and reports whether points were appended.
 */
function appendInterpolatedPoints(
  stroke: BrushStroke,
  next: BrushPoint,
  aspect: number,
): boolean {
  const last = stroke.points[stroke.points.length - 1];
  if (!last) {
    stroke.points.push(next);
    return true;
  }

  const radius   = Math.max(0.001, stroke.radius);
  const spacing  = Math.max(0.001, stroke.spacing);
  const spacingUv = radius * spacing;

  const dx   = next.x - last.x;
  const dy   = next.y - last.y;
  const dist = Math.hypot(dx, dy * aspect);

  if (dist < spacingUv) return false;

  const steps  = Math.max(1, Math.floor(dist / spacingUv));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stroke.points.push({
      x:        last.x + dx * t,
      y:        last.y + dy * t,
      pressure: last.pressure + (next.pressure - last.pressure) * t,
      time:     next.time,
    });
  }

  return true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type BrushMaskOverlayProps = {
  viewerApi?: ViewerApi;
  mask?: BrushMaskComponent | null;
  onUpdate?: (patch: Partial<BrushMaskComponent>) => void;
  onCommit?: () => void;
};

// ─── component ────────────────────────────────────────────────────────────────

// Bounds + steps for the [ / ] keyboard size adjustment.
const BRUSH_KEY_MIN = 0.01;
const BRUSH_KEY_MAX = 1;
const BRUSH_KEY_COARSE = 0.05; // no-Shift press (matches FeatherSlider's coarse step)
const BRUSH_KEY_FINE = 0.01;   // Shift-press

export function BrushMaskOverlay(props: BrushMaskOverlayProps) {
  let overlayRef: HTMLDivElement | undefined;
  let cursorRef: HTMLDivElement | undefined;

  const [painting, setPainting] = createSignal(false);
  let liveStroke: BrushStroke | null = null;
  let strokeAspect = 1;

  // ── reactive selectors ────────────────────────────────────────────────────

  const activeMaskIdx = createMemo(() => {
    if (props.mask) return 0;
    const id = selectedMaskId();
    if (!id || !editState.localAdjustments) return -1;
    return editState.localAdjustments.findIndex((l) => l.id === id);
  });

  const activeBrushComp = createMemo((): BrushMaskComponent | null => {
    if (props.mask?.type === "brush") return props.mask;
    const idx = activeMaskIdx();
    if (idx === -1) return null;
    const comp = editState.localAdjustments?.[idx]?.components?.[0];
    return comp?.type === "brush" ? (comp as BrushMaskComponent) : null;
  });

  // ── rAF cursor loop ───────────────────────────────────────────────────────

  let cursorX = -9999;
  let cursorY = -9999;
  let alignRaf = 0;

  function alignCursor() {
    alignRaf = 0;
    const api   = props.viewerApi;
    const comp  = activeBrushComp();
    const el    = cursorRef;
    if (!api || !comp || !el) return;

    // Size: map brush radius UV → canvas CSS pixels.
    // imageUVToCanvasRelative returns canvas-relative px, so the difference between
    // a point at UV (radius, 0) and the origin (0, 0) gives the radius in px.
    const p0 = api.imageUVToCanvasRelative(0, 0);
    const p1 = api.imageUVToCanvasRelative(comp.brush_radius, 0);
    const radiusPx = p0 && p1
      ? Math.max(2, Math.hypot(p1.x - p0.x, p1.y - p0.y))
      : 10;
    const diameter = radiusPx * 2;

    el.style.setProperty("--brush-size", `${diameter}px`);
    el.style.width  = `${diameter}px`;
    el.style.height = `${diameter}px`;
    el.style.left   = `${cursorX}px`;
    el.style.top    = `${cursorY}px`;
  }

  function scheduleCursorAlign() {
    if (alignRaf !== 0) return;
    alignRaf = requestAnimationFrame(alignCursor);
  }

  function updateCursorPos(e: PointerEvent) {
    const overlay = overlayRef;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    cursorY = e.clientY - rect.top;
    scheduleCursorAlign();
  }

  function getImageAspect(): number {
    const api = props.viewerApi;
    if (!api) return 1;

    const origin = api.imageUVToCanvasRelative(0, 0);
    const xEdge = api.imageUVToCanvasRelative(1, 0);
    const yEdge = api.imageUVToCanvasRelative(0, 1);
    if (!origin || !xEdge || !yEdge) return 1;

    const width = Math.hypot(xEdge.x - origin.x, xEdge.y - origin.y);
    const height = Math.hypot(yEdge.x - origin.x, yEdge.y - origin.y);
    return width > 0 ? height / width : 1;
  }

  // ── keyboard: [ / ] grow / shrink brush size ──────────────────────────────
  // Standard painting-app shortcuts. Hold Shift for the fine ±0.01 step
  // (matches FeatherSlider's arrow-key behavior). Listener uses capture
  // phase and is removed on unmount.

  function onBrushSizeKey(e: KeyboardEvent) {
    if (e.key !== "[" && e.key !== "]") return;

    // Skip when typing in a text/number input or contenteditable element.
    const t = e.target as HTMLElement | null;
    if (t) {
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) {
        return;
      }
    }
    // Skip when a modifier we don't want is held (Ctrl/Cmd/Alt — let
    // those flow to other shortcuts).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const idx = activeMaskIdx();
    if (idx === -1) return;
    const comp = activeBrushComp();
    if (!comp || comp.type !== "brush") return;

    const step = e.shiftKey ? BRUSH_KEY_FINE : BRUSH_KEY_COARSE;
    const delta = e.key === "]" ? step : -step;
    const next = Math.max(
      BRUSH_KEY_MIN,
      Math.min(BRUSH_KEY_MAX, comp.brush_radius + delta),
    );
    if (next === comp.brush_radius) return;

    e.preventDefault();
    e.stopPropagation();

    if (props.onUpdate) props.onUpdate({ brush_radius: next });
    else setEditState(
      "localAdjustments", idx, "components", 0,
      (c: AnyMaskComponent) => c.type === "brush" ? { ...c, brush_radius: next } : c,
    );
    // The reactive cursor update picks up the new radius on the next rAF and resizes the
    // on-canvas cursor circle — no extra work needed.
  }

  onMount(() => {
    scheduleCursorAlign();
    window.addEventListener("keydown", onBrushSizeKey, true);
    window.addEventListener("resize", scheduleCursorAlign);
  });

  onCleanup(() => {
    cancelAnimationFrame(alignRaf);
    window.removeEventListener("keydown", onBrushSizeKey, true);
    window.removeEventListener("resize", scheduleCursorAlign);
    // Release any lingering preview on unmount.
    props.viewerApi?.setBrushMaskPreview(null);
    if (painting()) {
      props.viewerApi?.setInteractionLock(false);
    }
  });

  // ── UV helpers ────────────────────────────────────────────────────────────

  function getImageUV(clientX: number, clientY: number): { u: number; v: number } | null {
    const api = props.viewerApi;
    if (!api) return null;
    const uv = api.clientPointToImageUVClamped(clientX, clientY);
    if (!uv) return null;
    return { u: clamp01(uv.u), v: clamp01(uv.v) };
  }

  // ── preview request ───────────────────────────────────────────────────────

  function pushPreview(stroke: BrushStroke | null) {
    const api  = props.viewerApi;
    const comp = activeBrushComp();
    const id   = props.mask?.id ?? selectedMaskId();
    if (!api || !comp || !id) return;

    api.setBrushMaskPreview({
      enabled:        true,
      maskId:         id,
      component:      comp,
      liveStroke:     stroke,
      overlayColor:   [1, 0, 0],
      overlayOpacity: 0.8,
    });
  }

  // ── pointer handlers ──────────────────────────────────────────────────────

  createEffect(() => {
    void activeBrushComp()?.brush_radius;
    scheduleCursorAlign();
  });

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const comp = activeBrushComp();
    const api  = props.viewerApi;
    if (!comp || !api) return;

    const uv = getImageUV(e.clientX, e.clientY);
    if (!uv) return;

    e.preventDefault();
    e.stopPropagation();

    const pressure = normalizePressure(e.pressure);
    const erasing  = activeBrushComp()?.brush_erase ?? false;

    const stroke: BrushStroke = {
      id:          `stroke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mode:        erasing ? "erase" : "mask",
      points:      [{ x: uv.u, y: uv.v, pressure, time: performance.now() }],
      radius:      comp.brush_radius,
      opacity:     comp.brush_opacity,
      hardness:    comp.brush_hardness,
      masking:     comp.brush_masking > 0 ? 1 : 0,
      spacing:     0.25,
      interpolate: true,
      randomize:   0,
    };

    liveStroke = stroke;
    strokeAspect = getImageAspect();
    setPainting(true);

    api.setInteractionLock(true);
    try { overlayRef?.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    pushPreview(stroke);
  }

  function onPointerMove(e: PointerEvent) {
    updateCursorPos(e);

    if (!painting()) return;

    const stroke = liveStroke;
    if (!stroke) return;

    const coalescedEvents = e.getCoalescedEvents?.();
    const events = coalescedEvents?.length ? coalescedEvents : [e];
    let changed = false;
    for (const pointEvent of events) {
      const uv = getImageUV(pointEvent.clientX, pointEvent.clientY);
      if (!uv) continue;

      changed = appendInterpolatedPoints(
        stroke,
        {
          x:        uv.u,
          y:        uv.v,
          pressure: normalizePressure(pointEvent.pressure),
          time:     performance.now(),
        },
        strokeAspect,
      ) || changed;
    }

    if (changed) pushPreview(stroke);
  }

  function onPointerUp(e: PointerEvent) {
    if (!painting()) return;

    const stroke = liveStroke;
    const idx    = activeMaskIdx();

    setPainting(false);
    liveStroke = null;

    props.viewerApi?.setInteractionLock(false);
    props.viewerApi?.setBrushMaskPreview(null);

    try { overlayRef?.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (!stroke || idx === -1 || stroke.points.length < 1) return;

    // Commit the stroke — ONE store write per pointer gesture.
    const nextBrush = [...(activeBrushComp()?.brush ?? []), stroke];
    if (props.onUpdate) props.onUpdate({ brush: nextBrush });
    else setEditState(
      "localAdjustments", idx, "components", 0,
      (c: AnyMaskComponent) => c.type === "brush" ? { ...c, brush: nextBrush } : c,
    );
    props.onCommit?.();

  }

  function onPointerCancel(e: PointerEvent) {
    if (!painting()) return;
    setPainting(false);
    liveStroke = null;
    props.viewerApi?.setInteractionLock(false);
    props.viewerApi?.setBrushMaskPreview(null);
    try { overlayRef?.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const erasing = () => activeBrushComp()?.brush_erase ?? false;

  return (
    <div
      ref={overlayRef}
      class="brush-mask-overlay"
      classList={{ "brush-mask-overlay--painting": painting() }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onWheel={scheduleCursorAlign}
    >
      {/* Brush cursor circle — positioned by scheduled rAF updates */}
      <Show when={activeBrushComp()}>
        <div
          ref={cursorRef}
          class="brush-mask-overlay__cursor"
          classList={{
            "brush-mask-overlay__cursor--erase":      erasing(),
            "brush-mask-overlay__cursor--edge-aware": (activeBrushComp()?.brush_masking ?? 0) > 0.01,
          }}
          aria-hidden="true"
        />
      </Show>
    </div>
  );
}
