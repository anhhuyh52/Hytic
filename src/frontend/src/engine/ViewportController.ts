import { OrthographicCamera, Vector2 } from "three";
import { VIEWER_FIT_PADDING, VIEWER_MAX_ZOOM, VIEWER_MIN_ZOOM } from "../config/viewerConstants";

// Event-boundary guard: the viewport must never zoom/pan when the wheel/pointer
// event originates inside a panel, popup, scrollable region, or any UI control —
// even if such an element is ever overlaid on the canvas (viewport-overlay docks,
// popovers, scopes window, crop modal). The handlers below bail when the event
// target matches one of these. (Wheel/pan are bound to the canvas, so a non-canvas
// target is only possible via overlap; this keeps that case correct too.)
const VIEWPORT_EVENT_BLOCKERS = [
  ".adjustment-panels",
  "control-panel",
  "control-panel-header",
  "value-slider",
  "knob-slider",
  "cardinal-slider",
  "numerical-slider",
  "rolling-slider",
  "hexagonal-slider",
  "curve-controls",
  "spline-interface",
  "color-wheel",
  "two-axis",
  "input",
  "select",
  "textarea",
  "button",
  "[role='slider']",
  "[data-scrollable='true']",
  ".overflow-y-auto",
  ".scrollable",
  ".poto-popover",
  "overlay-view",
  "viewport-overlay",
  "scopes-window",
  ".history-timeline",
  "top-bar",
].join(",");

export type ViewportTransform = {
  panX: number;
  panY: number;
  zoom: number;
  targetPanX: number;
  targetPanY: number;
  targetZoom: number;
  fitZoom: number;
  zoomMode: ViewerZoomMode;
};

export type ViewerZoomMode = "fit" | "manual";

export type ViewerFitState = {
  imageWidth: number;
  imageHeight: number;
  containerWidth: number;
  containerHeight: number;
  fitZoom: number;
  zoom: number;
  panX: number;
  panY: number;
  targetZoom: number;
  targetPanX: number;
  targetPanY: number;
  zoomMode: ViewerZoomMode;
};

export type RestoredViewport = {
  zoom: number;
  panX: number;
  panY: number;
};

export type ViewportState = {
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  devicePixelRatio: number;
  zoom: number;
  panX: number;
  panY: number;
  targetZoom: number;
  targetPanX: number;
  targetPanY: number;
  fitZoom: number;
  rotation: number;
};

type ViewportControllerOptions = {
  camera: OrthographicCamera;
  canvas: HTMLCanvasElement;
  onChange?(transform: ViewportTransform, meta: { commit: boolean }): void;
  onInteractionChange?(active: boolean): void;
};

type PanEventOverride = (
  pointerCanvasX: number,
  pointerCanvasY: number,
  canvasWidth: number,
  canvasHeight: number,
) => void;

const DEBUG_VIEWER_FIT = false;
const ZOOM_EASE = 0.22;
const LEGACY_MAX_ZOOM = 5;

export class ViewportController {
  private readonly camera: OrthographicCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange?: (transform: ViewportTransform, meta: { commit: boolean }) => void;
  private readonly onInteractionChange?: (active: boolean) => void;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private imageWidth = 1;
  private imageHeight = 1;
  private hasImage = false;
  private fitPadding = VIEWER_FIT_PADDING;
  private fitZoom = 1;
  private displayPanX = 0;
  private displayPanY = 0;
  private displayZoom = 1;
  private targetPanX = 0;
  private targetPanY = 0;
  private targetZoom = 1;
  private zoomMode: ViewerZoomMode = "fit";
  private isDragging = false;
  private panEnabled = true;
  private panEventOverride: PanEventOverride | null = null;
  private lastPointer = new Vector2();
  private readonly activePointers = new Map<number, Vector2>();
  private lastGestureCenter = new Vector2();
  private lastPinchDistance = 0;
  private animationFrame = 0;

  constructor(options: ViewportControllerOptions) {
    this.camera = options.camera;
    this.canvas = options.canvas;
    this.onChange = options.onChange;
    this.onInteractionChange = options.onInteractionChange;
    this.attachEvents();
    this.updateCamera();
  }

  setViewportSize(width: number, height: number) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.recomputeFitZoom();
    if (this.zoomMode === "fit") {
      this.snapView(this.fitZoom, 0, 0);
    } else {
      this.targetZoom = this.clampZoom(this.targetZoom);
      this.clampTargetPan();
      this.snapView(this.targetZoom, this.targetPanX, this.targetPanY);
    }
    this.updateCamera();
    this.emitChange(true);
  }

  setFitPadding(padding: number) {
    const next = Math.max(0.01, Math.min(1, padding));
    if (next === this.fitPadding) return;
    this.fitPadding = next;
    this.recomputeFitZoom();
    if (this.zoomMode === "fit") {
      this.snapView(this.fitZoom, 0, 0);
    } else {
      this.targetZoom = this.clampZoom(this.targetZoom);
      this.clampTargetPan();
      this.snapView(this.targetZoom, this.targetPanX, this.targetPanY);
    }
    this.updateCamera();
    this.emitChange(true);
  }

  fitToImage(width: number, height: number) {
    this.imageWidth = Math.max(1, width);
    this.imageHeight = Math.max(1, height);
    this.hasImage = true;
    this.zoomMode = "fit";
    this.recomputeFitZoom();
    this.snapView(this.fitZoom, 0, 0);
    this.camera.position.set(0, 0, 10);
    this.updateCamera();
    this.emitChange(true);
  }

  setImageSize(width: number, height: number) {
    if (!this.hasImage) {
      this.fitToImage(width, height);
      return;
    }

    const oldWidth = this.imageWidth;
    const oldHeight = this.imageHeight;
    const centerU =
      oldWidth > 0 ? 0.5 - this.targetPanX / Math.max(1, oldWidth * this.targetZoom) : 0.5;
    const centerV =
      oldHeight > 0 ? 0.5 - this.targetPanY / Math.max(1, oldHeight * this.targetZoom) : 0.5;

    this.imageWidth = Math.max(1, width);
    this.imageHeight = Math.max(1, height);
    this.recomputeFitZoom();
    if (this.zoomMode === "fit") {
      this.snapView(this.fitZoom, 0, 0);
    } else {
      this.targetZoom = this.clampZoom(this.targetZoom);
      this.targetPanX = (0.5 - centerU) * this.imageWidth * this.targetZoom;
      this.targetPanY = (0.5 - centerV) * this.imageHeight * this.targetZoom;
      this.clampTargetPan();
      this.snapView(this.targetZoom, this.targetPanX, this.targetPanY);
    }
    this.updateCamera();
    this.emitChange(true);
  }

  resetZoom() {
    this.zoomMode = "manual";
    this.snapView(this.clampZoom(1), 0, 0);
    this.updateCamera();
    this.emitChange(true);
  }

  fitToScreen(reason: "new-image" | "resize" | "manual-fit" = "manual-fit") {
    this.zoomMode = "fit";
    this.recomputeFitZoom();
    this.snapView(this.fitZoom, 0, 0);
    this.updateCamera();
    if (DEBUG_VIEWER_FIT) {
      console.table({
        reason,
        zoom: this.displayZoom,
        fitZoom: this.fitZoom,
        panX: this.displayPanX,
        panY: this.displayPanY,
        imageWidth: this.imageWidth,
        imageHeight: this.imageHeight,
        canvasWidth: this.viewportWidth,
        canvasHeight: this.viewportHeight,
        dpr: window.devicePixelRatio || 1,
      });
    }
    this.emitChange(true);
  }

  getState(): ViewerFitState {
    return {
      imageWidth: this.imageWidth,
      imageHeight: this.imageHeight,
      containerWidth: this.viewportWidth,
      containerHeight: this.viewportHeight,
      fitZoom: this.fitZoom,
      zoom: this.displayZoom,
      panX: this.displayPanX,
      panY: this.displayPanY,
      targetZoom: this.targetZoom,
      targetPanX: this.targetPanX,
      targetPanY: this.targetPanY,
      zoomMode: this.zoomMode,
    };
  }

  setPanEnabled(enabled: boolean) {
    this.panEnabled = enabled;
    if (!enabled) {
      this.setDragging(false);
      this.activePointers.clear();
      this.lastPinchDistance = 0;
    }
  }

  setPanEventOverride(override: PanEventOverride | null) {
    this.panEventOverride = override;
    this.setDragging(false);
    this.activePointers.clear();
    this.lastPinchDistance = 0;
    if (!override) {
      this.canvas.style.cursor = "grab";
      return;
    }
  }

  setZoomAtPoint(nextZoom: number, clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAroundCanvasPoint(clientX - rect.left, clientY - rect.top, nextZoom / this.targetZoom);
  }

  panBy(dx: number, dy: number): void {
    this.zoomMode = "manual";
    this.targetPanX += dx;
    this.targetPanY += dy;
    this.clampTargetPan();
    this.startAnimation();
  }

  resetView(): void {
    this.fitToScreen("manual-fit");
  }

  getImageToScreenMatrix(): DOMMatrix {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.viewportWidth;
    const scaleY = rect.height / this.viewportHeight;
    return new DOMMatrix()
      .translate(
        rect.width / 2 + this.displayPanX * scaleX,
        rect.height / 2 - this.displayPanY * scaleY,
      )
      .scale(this.displayZoom * scaleX, this.displayZoom * scaleY)
      .translate(-this.imageWidth / 2, -this.imageHeight / 2);
  }

  getScreenToImageMatrix(): DOMMatrix {
    return this.getImageToScreenMatrix().inverse();
  }

  canvasPointToImageUV(
    clientX: number,
    clientY: number,
    options: { clamp?: boolean; unclamped?: boolean } = {},
  ): { u: number; v: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const canvasX = (clientX - rect.left) * (this.viewportWidth / rect.width);
    const canvasY = (clientY - rect.top) * (this.viewportHeight / rect.height);
    const world = this.canvasPointToWorld(canvasX, canvasY);

    const planeWidth = this.imageWidth * this.displayZoom;
    const planeHeight = this.imageHeight * this.displayZoom;
    if (planeWidth <= 0 || planeHeight <= 0) {
      return null;
    }

    const u = (world.x - this.displayPanX) / planeWidth + 0.5;
    const v = (world.y - this.displayPanY) / planeHeight + 0.5;

    if (options.unclamped) {
      return { u, v };
    }

    if (u < 0 || u > 1 || v < 0 || v > 1) {
      if (options.clamp) {
        return { u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)) };
      }
      return null;
    }

    return { u, v };
  }

  clientXToImageU(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return 0.5;
    const canvasX = (clientX - rect.left) * (this.viewportWidth / rect.width);
    const worldX = canvasX - this.viewportWidth / 2;
    const planeWidth = this.imageWidth * this.displayZoom;
    if (planeWidth <= 0) return 0.5;
    const u = (worldX - this.displayPanX) / planeWidth + 0.5;
    return Math.max(0, Math.min(1, u));
  }

  imageUVToCanvasRelative(u: number, v: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const planeWidth = this.imageWidth * this.displayZoom;
    const planeHeight = this.imageHeight * this.displayZoom;

    const worldX = (u - 0.5) * planeWidth + this.displayPanX;
    const worldY = (v - 0.5) * planeHeight + this.displayPanY;

    const canvasX = worldX + this.viewportWidth / 2;
    const canvasY = this.viewportHeight / 2 - worldY;

    const cssScaleX = rect.width > 0 ? rect.width / this.viewportWidth : 1;
    const cssScaleY = rect.height > 0 ? rect.height / this.viewportHeight : 1;

    return { x: canvasX * cssScaleX, y: canvasY * cssScaleY };
  }

  dispose() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("touchstart", this.preventNativeTouch);
    this.canvas.removeEventListener("touchmove", this.preventNativeTouch);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
  }

  private attachEvents() {
    this.canvas.style.touchAction = "none";
    this.canvas.style.userSelect = "none";
    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.handlePointerDown, { passive: false });
    this.canvas.addEventListener("pointermove", this.handlePointerMove, { passive: false });
    this.canvas.addEventListener("touchstart", this.preventNativeTouch, { passive: false });
    this.canvas.addEventListener("touchmove", this.preventNativeTouch, { passive: false });
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
  }

  // True only when the event genuinely belongs to the viewport stage and not to
  // any panel / popup / scrollable / control overlaid on it.
  private shouldHandleViewportEvent(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return false;
    if (el.closest(VIEWPORT_EVENT_BLOCKERS)) return false;
    return el === this.canvas || this.canvas.contains(el);
  }

  private readonly handleWheel = (event: WheelEvent) => {
    if (!this.shouldHandleViewportEvent(event.target)) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const zoomFactor = Math.exp(-event.deltaY * 0.001);

    this.zoomAroundCanvasPoint(canvasX, canvasY, zoomFactor, true, true);
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (!this.panEnabled && !this.panEventOverride) {
      return;
    }
    // Don't start a viewport pan when the press began on a UI control overlaid on
    // the canvas (so e.g. dragging a control never pans the image).
    if (!this.shouldHandleViewportEvent(event.target)) {
      return;
    }
    if (this.activePointers.size >= 2) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.panEventOverride) {
      this.setDragging(true);
      this.canvas.style.cursor = "ew-resize";
      this.activePointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
      this.canvas.setPointerCapture(event.pointerId);
      this.runPanEventOverride(event);
      return;
    }
    if (!this.panEnabled) {
      return;
    }
    this.setDragging(true);
    this.canvas.style.cursor = "grabbing";
    this.activePointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    if (this.activePointers.size === 1) {
      this.lastPointer.set(event.clientX, event.clientY);
    } else {
      this.captureGestureBaseline();
    }
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.isDragging || !this.activePointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (this.panEventOverride) {
      if (this.activePointers.size !== 1) return;
      this.activePointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
      this.runPanEventOverride(event);
      return;
    }

    if (!this.panEnabled) {
      return;
    }

    if (this.activePointers.size === 1) {
      this.activePointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
      const deltaX = event.clientX - this.lastPointer.x;
      const deltaY = event.clientY - this.lastPointer.y;
      this.lastPointer.set(event.clientX, event.clientY);

      this.zoomMode = "manual";
      this.targetPanX += deltaX;
      this.targetPanY -= deltaY;
      this.clampTargetPan();
      this.applyImmediateView(false);
      return;
    }

    if (this.activePointers.size !== 2) {
      return;
    }

    this.activePointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    const gesture = this.readGesture();
    if (!gesture) return;

    this.zoomMode = "manual";
    this.targetPanX += gesture.center.x - this.lastGestureCenter.x;
    this.targetPanY -= gesture.center.y - this.lastGestureCenter.y;
    this.clampTargetPan();
    const factor =
      this.lastPinchDistance > 0 && gesture.distance > 0
        ? gesture.distance / this.lastPinchDistance
        : 1;
    if (factor !== 1) {
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAroundCanvasPoint(
        gesture.center.x - rect.left,
        gesture.center.y - rect.top,
        factor,
        true,
        false,
      );
    } else {
      this.applyImmediateView(false);
    }
    this.lastGestureCenter.copy(gesture.center);
    this.lastPinchDistance = gesture.distance;
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (!this.isDragging || !this.activePointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    this.activePointers.delete(event.pointerId);

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (this.activePointers.size === 0) {
      this.setDragging(false);
      this.lastPinchDistance = 0;
      this.canvas.style.cursor = "grab";
      this.emitChange(true);
      return;
    }

    if (this.activePointers.size === 1) {
      const next = this.activePointers.values().next().value;
      if (next) this.lastPointer.copy(next);
      this.lastPinchDistance = 0;
      return;
    }

    this.captureGestureBaseline();
  };

  private readonly preventNativeTouch = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
  };

  private setDragging(active: boolean): void {
    if (this.isDragging === active) return;
    this.isDragging = active;
    this.onInteractionChange?.(active);
  }

  private runPanEventOverride(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const canvasWidth = Math.max(1, this.canvas.width);
    const canvasHeight = Math.max(1, this.canvas.height);
    const pointerCanvasX = (event.clientX - rect.left) * (canvasWidth / rect.width);
    const pointerCanvasY = (event.clientY - rect.top) * (canvasHeight / rect.height);
    this.panEventOverride?.(pointerCanvasX, pointerCanvasY, canvasWidth, canvasHeight);
  }

  private zoomAroundCanvasPoint(
    canvasX: number,
    canvasY: number,
    factor: number,
    immediate = false,
    commit = false,
  ) {
    this.zoomMode = "manual";
    const nextZoom = this.clampZoom(this.targetZoom * factor);
    if (nextZoom === this.targetZoom) {
      if (immediate) this.applyImmediateView(commit);
      return;
    }

    const world = this.canvasPointToWorld(canvasX, canvasY);
    const before = this.canvasPointToImageWithState(
      canvasX,
      canvasY,
      this.targetZoom,
      this.targetPanX,
      this.targetPanY,
    );

    this.targetZoom = nextZoom;
    this.targetPanX = world.x - before.x * this.targetZoom;
    this.targetPanY = world.y - before.y * this.targetZoom;
    this.clampTargetPan();
    if (immediate) {
      this.applyImmediateView(commit);
      return;
    }
    this.startAnimation();
  }

  clearImage() {
    this.hasImage = false;
    this.imageWidth = 1;
    this.imageHeight = 1;
    this.zoomMode = "fit";
    this.fitZoom = 1;
    this.snapView(1, 0, 0);
    this.updateCamera();
    this.emitChange(true);
  }

  restoreViewport(viewport: RestoredViewport) {
    if (!this.hasImage) return;
    this.zoomMode = "manual";
    this.targetZoom = this.clampZoom(viewport.zoom);
    this.targetPanX = viewport.panX;
    this.targetPanY = viewport.panY;
    this.clampTargetPan();
    this.snapView(this.targetZoom, this.targetPanX, this.targetPanY);
    this.updateCamera();
    this.emitChange(true);
  }

  private canvasPointToWorld(canvasX: number, canvasY: number) {
    return new Vector2(canvasX - this.viewportWidth / 2, this.viewportHeight / 2 - canvasY);
  }

  private canvasPointToImageWithState(
    canvasX: number,
    canvasY: number,
    zoom: number,
    panX: number,
    panY: number,
  ) {
    const world = this.canvasPointToWorld(canvasX, canvasY);
    return new Vector2((world.x - panX) / zoom, (world.y - panY) / zoom);
  }

  private updateCamera() {
    const halfWidth = this.viewportWidth / 2;
    const halfHeight = this.viewportHeight / 2;

    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.near = 0.1;
    this.camera.far = 100;
    this.camera.updateProjectionMatrix();
  }

  private recomputeFitZoom() {
    if (
      !this.hasImage ||
      this.imageWidth <= 0 ||
      this.imageHeight <= 0 ||
      this.viewportWidth <= 0 ||
      this.viewportHeight <= 0
    ) {
      this.fitZoom = 1;
      if (this.zoomMode === "fit") {
        this.snapView(1, 0, 0);
      }
      return;
    }

    this.fitZoom = Math.min(
      1,
      Math.min(this.viewportWidth / this.imageWidth, this.viewportHeight / this.imageHeight) *
        this.fitPadding,
    );
  }

  private snapView(zoom: number, panX: number, panY: number) {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.targetZoom = zoom;
    this.targetPanX = panX;
    this.targetPanY = panY;
    this.displayZoom = zoom;
    this.displayPanX = panX;
    this.displayPanY = panY;
  }

  private applyImmediateView(commit: boolean) {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.displayZoom = this.targetZoom;
    this.displayPanX = this.targetPanX;
    this.displayPanY = this.targetPanY;
    this.clampDisplayPan();
    this.emitChange(commit);
  }

  private clampDisplayPan() {
    if (!this.hasImage) {
      this.displayPanX = 0;
      this.displayPanY = 0;
      return;
    }

    const planeWidth = this.imageWidth * this.displayZoom;
    const planeHeight = this.imageHeight * this.displayZoom;
    this.displayPanX = clampAxisPan(this.displayPanX, planeWidth, this.viewportWidth);
    this.displayPanY = clampAxisPan(this.displayPanY, planeHeight, this.viewportHeight);
  }

  private clampTargetPan() {
    if (!this.hasImage) {
      this.targetPanX = 0;
      this.targetPanY = 0;
      return;
    }

    const planeWidth = this.imageWidth * this.targetZoom;
    const planeHeight = this.imageHeight * this.targetZoom;
    this.targetPanX = clampAxisPan(this.targetPanX, planeWidth, this.viewportWidth);
    this.targetPanY = clampAxisPan(this.targetPanY, planeHeight, this.viewportHeight);
  }

  private clampZoom(zoom: number) {
    const minZoom = this.hasImage
      ? Math.max(VIEWER_MIN_ZOOM, this.fitZoom * 0.833)
      : VIEWER_MIN_ZOOM;
    return Math.min(Math.min(VIEWER_MAX_ZOOM, LEGACY_MAX_ZOOM), Math.max(minZoom, zoom));
  }

  private startAnimation() {
    if (this.animationFrame) return;
    this.animationFrame = requestAnimationFrame(this.stepAnimation);
  }

  private readonly stepAnimation = () => {
    const zoomDelta = this.targetZoom - this.displayZoom;
    const panXDelta = this.targetPanX - this.displayPanX;
    const panYDelta = this.targetPanY - this.displayPanY;

    if (Math.abs(zoomDelta) < 0.0002 && Math.abs(panXDelta) < 0.05 && Math.abs(panYDelta) < 0.05) {
      this.displayZoom = this.targetZoom;
      this.displayPanX = this.targetPanX;
      this.displayPanY = this.targetPanY;
      this.clampDisplayPan();
      this.animationFrame = 0;
      this.emitChange(true);
      return;
    }

    this.displayZoom += zoomDelta * ZOOM_EASE;
    this.displayPanX += panXDelta * ZOOM_EASE;
    this.displayPanY += panYDelta * ZOOM_EASE;
    this.clampDisplayPan();
    this.emitChange(false);
    this.animationFrame = requestAnimationFrame(this.stepAnimation);
  };

  private captureGestureBaseline(): void {
    const gesture = this.readGesture();
    if (!gesture) return;
    this.lastGestureCenter.copy(gesture.center);
    this.lastPinchDistance = gesture.distance;
  }

  private readGesture(): { center: Vector2; distance: number } | null {
    const points = Array.from(this.activePointers.values());
    if (points.length < 2) return null;
    const a = points[0];
    const b = points[1];
    return {
      center: new Vector2((a.x + b.x) * 0.5, (a.y + b.y) * 0.5),
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  private emitChange(commit = false) {
    if (DEBUG_VIEWER_FIT) {
      console.table({
        imageWidth: this.imageWidth,
        imageHeight: this.imageHeight,
        containerWidth: this.viewportWidth,
        containerHeight: this.viewportHeight,
        fitZoom: this.fitZoom,
        zoom: this.displayZoom,
        targetZoom: this.targetZoom,
        zoomMode: this.zoomMode,
        panX: this.displayPanX,
        panY: this.displayPanY,
        targetPanX: this.targetPanX,
        targetPanY: this.targetPanY,
        cameraLeft: this.camera.left,
        cameraRight: this.camera.right,
        cameraTop: this.camera.top,
        cameraBottom: this.camera.bottom,
      });
    }
    this.onChange?.(
      {
        panX: this.displayPanX,
        panY: this.displayPanY,
        zoom: this.displayZoom,
        targetPanX: this.targetPanX,
        targetPanY: this.targetPanY,
        targetZoom: this.targetZoom,
        fitZoom: this.fitZoom,
        zoomMode: this.zoomMode,
      },
      { commit },
    );
  }
}

function clampAxisPan(pan: number, contentSize: number, viewportSize: number): number {
  if (contentSize <= viewportSize) {
    return 0;
  }
  const limit = (contentSize - viewportSize) * 0.5;
  return Math.max(-limit, Math.min(limit, pan));
}
