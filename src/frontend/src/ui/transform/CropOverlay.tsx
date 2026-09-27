import { createEffect, createSignal, For, onCleanup } from "solid-js";
import type { TransformState, AspectRatioPreset } from "../../engine/state/EditState";
import {
  aspectPresetToRatio,
  getTransformDisplayDimensions,
} from "../../engine/transform/transformGeometry";

export type CropGuideMode =
  | "thirds"
  | "center"
  | "grid"
  | "triangle"
  | "golden"
  | "fifth"
  | "diagonal";

type CropOverlayProps = {
  transform: TransformState;
  guideMode: CropGuideMode;
  imageWidth: number;
  imageHeight: number;
  /** Returns CSS px coords relative to canvas top-left for a given image UV. */
  imageUVToCSS(u: number, v: number): { x: number; y: number };
  /** Returns image UV for a client (screen) pointer event, or null if outside. */
  clientToUV(clientX: number, clientY: number): { u: number; v: number } | null;
  /** Called whenever the crop rect should update. Values are clamped to 0..1. */
  onCropChange(x: number, y: number, w: number, h: number): void;
  /** Canvas element bounds change triggers — bump to force re-render. */
  viewportRevision: number;
  /** True while the rotation slider is being dragged (legacy temporary grid). */
  rotateActive?: boolean;
};

type Handle = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br" | "body";

function getAspectUVRatio(
  ar: AspectRatioPreset,
  imageWidth: number,
  imageHeight: number,
  orientation: 0 | 90 | 180 | 270,
): number | null {
  const display = getTransformDisplayDimensions(imageWidth, imageHeight, {
    enabled: true,
    orientation,
  });
  const target = aspectPresetToRatio(ar, display.width, display.height);
  return target;

  // Display dimensions after orientation rotation
  const displayW = orientation === 90 || orientation === 270 ? imageHeight : imageWidth;
  const displayH = orientation === 90 || orientation === 270 ? imageWidth : imageHeight;

  // UV crop aspect = (presetW * displayH) / (presetH * displayW)
  // where presetW/presetH is the desired pixel ratio
  const uv = (pw: number, ph: number) =>
    displayH > 0 && displayW > 0 ? (pw * displayH) / (ph * displayW) : null;

  switch (ar) {
    case "free":
      return null;
    case "original":
      return 1; // UV rect 1:1 → full image aspect
    case "1:1":
      return uv(1, 1);
    case "4:3":
      return uv(4, 3);
    case "3:4":
      return uv(3, 4);
    case "5:4":
      return uv(5, 4);
    case "5:3":
      return uv(5, 3);
    case "4:5":
      return uv(4, 5);
    case "3:5":
      return uv(3, 5);
    case "16:9":
      return uv(16, 9);
    case "16:10":
      return uv(16, 10);
    case "21:9":
      return uv(21, 9);
    case "65:24":
      return uv(65, 24);
    case "9:16":
      return uv(9, 16);
    case "10:16":
      return uv(10, 16);
    case "9:21":
      return uv(9, 21);
    case "24:65":
      return uv(24, 65);
    case "3:2":
      return uv(3, 2);
    case "2:3":
      return uv(2, 3);
    case "1.85:1":
      return uv(1.85, 1);
    case "2.00:1":
      return uv(2, 1);
    case "2.35:1":
      return uv(2.35, 1);
    case "2.39:1":
      return uv(2.39, 1);
    case "2.40:1":
      return uv(2.4, 1);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Legacy "Grid" overlay stops — 12 divisions (11 lines each way). */
const TWELFTHS = Array.from({ length: 11 }, (_, i) => (i + 1) / 12);

export function CropOverlay(props: CropOverlayProps) {
  // Re-read on viewport change so computed positions update
  const _rev = () => props.viewportRevision;
  const [draftCrop, setDraftCrop] = createSignal<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  let pendingCrop: { x: number; y: number; w: number; h: number } | null = null;
  let cropFrame = 0;

  function currentCrop() {
    return (
      draftCrop() ?? {
        x: props.transform.cropX,
        y: props.transform.cropY,
        w: props.transform.cropWidth,
        h: props.transform.cropHeight,
      }
    );
  }

  function scheduleDraftCrop(x: number, y: number, w: number, h: number) {
    pendingCrop = { x, y, w, h };
    if (cropFrame) return;
    cropFrame = requestAnimationFrame(() => {
      cropFrame = 0;
      if (pendingCrop) setDraftCrop(pendingCrop);
    });
  }

  onCleanup(() => {
    if (cropFrame) cancelAnimationFrame(cropFrame);
  });

  // Compute canvas-relative CSS positions for each crop corner
  const pts = () => {
    _rev();
    const { x, y, w, h } = currentCrop();
    return {
      tl: props.imageUVToCSS(x, y + h),
      tr: props.imageUVToCSS(x + w, y + h),
      bl: props.imageUVToCSS(x, y),
      br: props.imageUVToCSS(x + w, y),
      tc: props.imageUVToCSS(x + w / 2, y + h),
      bc: props.imageUVToCSS(x + w / 2, y),
      ml: props.imageUVToCSS(x, y + h / 2),
      mr: props.imageUVToCSS(x + w, y + h / 2),
    };
  };

  // ----- drag state -----
  type DragState = {
    handle: Handle;
    startClient: { x: number; y: number };
    startPlane: { width: number; height: number };
    startCrop: { x: number; y: number; w: number; h: number };
  };
  const [drag, setDrag] = createSignal<DragState | null>(null);

  function imagePlaneCSSSize(): { width: number; height: number } {
    const a = props.imageUVToCSS(0, 0);
    const b = props.imageUVToCSS(1, 1);
    return {
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }

  function aspectPixelRatio(): number | null {
    return getAspectUVRatio(
      props.transform.aspectRatio,
      props.imageWidth,
      props.imageHeight,
      props.transform.orientation,
    );
  }

  function handleIndex(handle: Handle): number {
    switch (handle) {
      case "tl":
        return 0;
      case "tc":
        return 1;
      case "tr":
        return 2;
      case "mr":
        return 3;
      case "br":
        return 4;
      case "bc":
        return 5;
      case "bl":
        return 6;
      case "ml":
        return 7;
      case "body":
        return -1;
    }
  }

  function cropFromScreenRect(
    x: number,
    y: number,
    w: number,
    h: number,
  ): [number, number, number, number] {
    return [x, 1 - y - h, w, h];
  }

  function legacyClampResize(
    x: number,
    y: number,
    w: number,
    h: number,
  ): [number, number, number, number] {
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    return [x, y, w, h];
  }

  function onHandleDown(handle: Handle, e: PointerEvent) {
    e.stopPropagation();
    const uv = props.clientToUV(e.clientX, e.clientY);
    if (!uv) return;
    const { cropX: x, cropY: y, cropWidth: w, cropHeight: h } = props.transform;
    setDraftCrop({ x, y, w, h });
    pendingCrop = { x, y, w, h };
    setDrag({
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      startPlane: imagePlaneCSSSize(),
      startCrop: { x, y, w, h },
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag();
    if (!d) return;
    const { x: ox, y: oy, w: ow, h: oh } = d.startCrop;
    const planeW = d.startPlane.width;
    const planeH = d.startPlane.height;
    if (planeW <= 0 || planeH <= 0) return;

    const deltaX = e.clientX - d.startClient.x;
    const deltaY = e.clientY - d.startClient.y;
    const startX = ox * planeW;
    const startY = (1 - oy - oh) * planeH;
    const startW = ow * planeW;
    const startH = oh * planeH;

    let sx = startX;
    let sy = startY;
    let sw = startW;
    let sh = startH;
    const index = handleIndex(d.handle);

    switch (index) {
      case -1:
        sx = clamp(startX + deltaX, 0, planeW - startW);
        sy = clamp(startY + deltaY, 0, planeH - startH);
        {
          const [x, y, w, h] = cropFromScreenRect(sx / planeW, sy / planeH, ow, oh);
          scheduleDraftCrop(x, y, w, h);
        }
        return;
      case 0:
        sx = startX + deltaX;
        sy = startY + deltaY;
        sw = startW - deltaX;
        sh = startH - deltaY;
        break;
      case 1:
        sy = startY + deltaY;
        sh = startH - deltaY;
        break;
      case 2:
        sy = startY + deltaY;
        sw = startW + deltaX;
        sh = startH - deltaY;
        break;
      case 3:
        sw = startW + deltaX;
        break;
      case 4:
        sw = startW + deltaX;
        sh = startH + deltaY;
        break;
      case 5:
        sh = startH + deltaY;
        break;
      case 6:
        sx = startX + deltaX;
        sw = startW - deltaX;
        sh = startH + deltaY;
        break;
      case 7:
        sx = startX + deltaX;
        sw = startW - deltaX;
        break;
    }

    const ratio = aspectPixelRatio();
    if (ratio !== null && ratio > 0) {
      if (index === 3 || index === 7) {
        sh = sw / ratio;
        if (index === 7) sy = startY + startH - sh;
      } else if (index === 1 || index === 5) {
        sw = sh * ratio;
        sx = startX + (startW - sw) / 2;
      } else if (index === 2 || index === 4) {
        sh = sw / ratio;
        if (index === 2) sy = startY + startH - sh;
      } else if (index === 0 || index === 6) {
        sh = sw / ratio;
        sx = startX + startW - sw;
        if (index === 0) sy = startY + startH - sh;
      }

      if (sx < 0 || sy < 0 || sx + sw > planeW || sy + sh > planeH || sw < 100 || sh < 100) {
        return;
      }
    }

    if (sw < 100) {
      if (index === 0 || index === 6 || index === 7) sx = startX + startW - 100;
      sw = 100;
      if (sx < 0 || sx + sw > planeW) return;
    }
    if (sh < 100) {
      if (index === 0 || index === 1 || index === 2) sy = startY + startH - 100;
      sh = 100;
      if (sy < 0 || sy + sh > planeH) return;
    }

    if (e.altKey) {
      sx = startX + startW / 2 - sw / 2;
      sy = startY + startH / 2 - sh / 2;
      if (sx < 0 || sy < 0 || sx + sw > planeW || sy + sh > planeH) {
        return;
      }
    }

    [sx, sy, sw, sh] = legacyClampResize(sx / planeW, sy / planeH, sw / planeW, sh / planeH);
    const [x, y, w, h] = cropFromScreenRect(sx, sy, sw, sh);
    scheduleDraftCrop(x, y, w, h);
  }

  function onPointerUp() {
    const crop = pendingCrop ?? draftCrop();
    if (crop) props.onCropChange(crop.x, crop.y, crop.w, crop.h);
    pendingCrop = null;
    setDraftCrop(null);
    setDrag(null);
  }

  // Attach window-level move/up listeners while dragging
  createEffect(() => {
    if (!drag()) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    });
  });

  const p = () => pts();
  /** Corner-bracket / side-handle size in CSS px (legacy --pointSize). */
  const POINT = 40;

  function mixPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }

  function guideLine(
    key: string,
    a: { x: number; y: number },
    b: { x: number; y: number },
    opacity = 0.65,
  ) {
    void key;
    return (
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" stroke-width="3" opacity={opacity} />
    );
  }

  function verticalGuide(t: number, key: string, opacity: number) {
    const points = p();
    return guideLine(
      key,
      mixPoint(points.tl, points.tr, t),
      mixPoint(points.bl, points.br, t),
      opacity,
    );
  }

  function horizontalGuide(t: number, key: string, opacity: number) {
    const points = p();
    return guideLine(
      key,
      mixPoint(points.tl, points.bl, t),
      mixPoint(points.tr, points.br, t),
      opacity,
    );
  }

  function gridGuides(stops: number[], prefix: string, opacity: number) {
    return (
      <>
        <For each={stops}>{(stop) => verticalGuide(stop, `${prefix}-v-${stop}`, opacity)}</For>
        <For each={stops}>{(stop) => horizontalGuide(stop, `${prefix}-h-${stop}`, opacity)}</For>
      </>
    );
  }

  function screenRect() {
    const points = p();
    const left = Math.min(points.tl.x, points.tr.x, points.bl.x, points.br.x);
    const right = Math.max(points.tl.x, points.tr.x, points.bl.x, points.br.x);
    const top = Math.min(points.tl.y, points.tr.y, points.bl.y, points.br.y);
    const bottom = Math.max(points.tl.y, points.tr.y, points.bl.y, points.br.y);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  function guideOverlay() {
    const rect = screenRect();
    switch (props.guideMode) {
      case "center":
        return gridGuides([0.5], "center", 0.65);
      case "grid":
        return gridGuides(TWELFTHS, "grid", 0.35);
      case "triangle": {
        const w2 = rect.width * rect.width;
        const h2 = rect.height * rect.height;
        const denom = Math.max(1, w2 + h2);
        const hMix = h2 / denom;
        const wMix = w2 / denom;
        return (
          <>
            {guideLine(
              "triangle-main",
              { x: rect.left, y: rect.top },
              { x: rect.right, y: rect.bottom },
            )}
            {guideLine(
              "triangle-left",
              { x: rect.left, y: rect.bottom },
              { x: rect.left + hMix * rect.width, y: rect.top + hMix * rect.height },
            )}
            {guideLine(
              "triangle-right",
              { x: rect.right, y: rect.top },
              { x: rect.left + wMix * rect.width, y: rect.top + wMix * rect.height },
            )}
          </>
        );
      }
      case "golden": {
        const phi = (1 + Math.sqrt(5)) / 2;
        const stop = 1 / (phi + 1);
        return gridGuides([stop, 1 - stop], "golden", 0.65);
      }
      case "fifth":
        return gridGuides([0.2, 0.4, 0.6, 0.8], "fifth", 0.4);
      case "diagonal":
        return (
          <>
            {guideLine(
              "diagonal-a1",
              { x: rect.left, y: rect.top },
              { x: rect.right, y: rect.bottom - rect.height * 0.25 },
            )}
            {guideLine(
              "diagonal-a2",
              { x: rect.left, y: rect.top + rect.height * 0.25 },
              { x: rect.right, y: rect.bottom },
            )}
            {guideLine(
              "diagonal-b1",
              { x: rect.right, y: rect.top },
              { x: rect.left, y: rect.bottom - rect.height * 0.25 },
            )}
            {guideLine(
              "diagonal-b2",
              { x: rect.right, y: rect.top + rect.height * 0.25 },
              { x: rect.left, y: rect.bottom },
            )}
          </>
        );
      case "thirds":
      default:
        return gridGuides([1 / 3, 2 / 3], "thirds", 0.65);
    }
  }

  const polyPoints = () => {
    const q = p();
    return `${q.tl.x},${q.tl.y} ${q.tr.x},${q.tr.y} ${q.br.x},${q.br.y} ${q.bl.x},${q.bl.y}`;
  };

  return (
    <div
      class="crop-overlay"
      style={{ position: "absolute", inset: "0", overflow: "hidden", "pointer-events": "none" }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: "0", overflow: "visible" }}
      >
        <defs>
          <mask id="crop-hole-mask">
            <rect x="0" y="0" width="10000" height="10000" fill="white" />
            <polygon points={polyPoints()} fill="black" />
          </mask>
        </defs>

        {/* Dim outside crop (legacy: 70% black) */}
        <rect
          x="0"
          y="0"
          width="10000"
          height="10000"
          fill="rgba(0,0,0,0.7)"
          mask="url(#crop-hole-mask)"
        />

        {/* Composition overlay — shown only while interacting (legacy De flag).
            Handle drags show the selected guide; rotation shows the legacy
            temporary 12-division grid (setTemporaryOverlayMode(5)). */}
        {props.rotateActive ? gridGuides(TWELFTHS, "rot", 0.35) : guideOverlay()}

        {/* Crop border (legacy: 4px white) */}
        <polygon points={polyPoints()} fill="none" stroke="white" stroke-width="4" />
      </svg>

      {/* Draggable body (move crop). Uses min/abs so it survives the engine's
          inverted UV→screen Y mapping. */}
      <div
        class="crop-overlay__handle crop-overlay__handle--body"
        style={{
          position: "absolute",
          left: `${Math.min(p().tl.x, p().br.x)}px`,
          top: `${Math.min(p().tl.y, p().br.y)}px`,
          width: `${Math.abs(p().br.x - p().tl.x)}px`,
          height: `${Math.abs(p().br.y - p().tl.y)}px`,
          cursor: "move",
          "pointer-events": "auto",
          "touch-action": "none",
        }}
        onPointerDown={(e) => onHandleDown("body", e)}
      />

      {/* Corner L-bracket handles (legacy crop-edge). The drag handler stays bound
          to the UV corner, but the bracket's orientation/offset is derived from the
          point's actual SCREEN position so it's correct even though imageUVToCSS
          inverts the Y axis. */}
      <For each={["tl", "tr", "br", "bl"] as Handle[]}>
        {(handle) => {
        const m = () => {
          const q = p();
          const pt = q[handle as "tl" | "tr" | "br" | "bl"];
          const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4;
          const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4;
          const isLeft = pt.x <= cx;
          const isTop = pt.y <= cy;
          return {
            left: isLeft ? pt.x : pt.x - POINT,
            top: isTop ? pt.y : pt.y - POINT,
            rot: isTop ? (isLeft ? 180 : 270) : isLeft ? 90 : 0,
            cursor: isTop === isLeft ? "nwse-resize" : "nesw-resize",
          };
        };
        return (
          <img
            src="/assets/icons/crop_edge.svg"
            class="crop-overlay__corner"
            draggable={false}
            style={{
              position: "absolute",
              left: `${m().left}px`,
              top: `${m().top}px`,
              width: `${POINT}px`,
              height: `${POINT}px`,
              transform: `rotate(${m().rot}deg)`,
              cursor: m().cursor,
              "pointer-events": "auto",
              "touch-action": "none",
            }}
            onPointerDown={(e) => onHandleDown(handle, e)}
          />
        );
        }}
      </For>

      {/* Side line handles (legacy crop-side). Edge/border picked from screen
          position so the visible line sits on the correct edge after the Y flip. */}
      <For each={["tc", "bc", "ml", "mr"] as Handle[]}>
        {(handle) => {
        const m = () => {
          const q = p();
          const pt = q[handle as "tc" | "bc" | "ml" | "mr"];
          const cx = (q.tl.x + q.br.x) / 2;
          const cy = (q.tl.y + q.br.y) / 2;
          const horizontal = handle === "tc" || handle === "bc";
          if (horizontal) {
            const isTop = pt.y <= cy;
            return {
              left: pt.x - POINT / 2,
              top: isTop ? pt.y : pt.y - POINT,
              border: isTop ? "border-top" : "border-bottom",
              cursor: "ns-resize",
            };
          }
          const isLeft = pt.x <= cx;
          return {
            left: isLeft ? pt.x : pt.x - POINT,
            top: pt.y - POINT / 2,
            border: isLeft ? "border-left" : "border-right",
            cursor: "ew-resize",
          };
        };
        return (
          <div
            class="crop-overlay__side"
            style={{
              position: "absolute",
              left: `${m().left}px`,
              top: `${m().top}px`,
              width: `${POINT}px`,
              height: `${POINT}px`,
              [m().border]: "4px solid #fff",
              cursor: m().cursor,
              "pointer-events": "auto",
              "touch-action": "none",
            }}
            onPointerDown={(e) => onHandleDown(handle, e)}
          />
        );
        }}
      </For>
    </div>
  );
}
