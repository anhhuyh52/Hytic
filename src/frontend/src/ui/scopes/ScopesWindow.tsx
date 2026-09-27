import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { scopesState, setScopesState } from "../../app/editor-store";
import type { ScopeMode, ScopeReadback } from "../../engine/scopes/ScopeTypes";
import { IDT_MENU, ODT_MENU } from "../../engine/color/colorSpaceCatalog";

type Props = {
  readFrame: (sampleSize: number) => ScopeReadback | null;
  revision: () => number;
};

type ModeOption = { mode: ScopeMode; label: string };

const SCOPES_MODE_STORAGE_KEY = "scopes.mode";
const DEFAULT_CANVAS_WIDTH = 300;
const DEFAULT_CANVAS_HEIGHT = 230;

const modeGroups: Array<{ group: string; options: ModeOption[] }> = [
  {
    group: "Histograms",
    options: [
      { mode: "rgb", label: "RGB Histogram" },
      { mode: "hue", label: "Hue Distribution" },
      { mode: "sat", label: "Saturation Distribution" },
      { mode: "lum", label: "Luminance Distribution" },
    ],
  },
  {
    group: "Scopes",
    options: [
      { mode: "vec", label: "VectorScope" },
      { mode: "wvf", label: "RGB Waveform" },
      { mode: "prd", label: "RGB Parade" },
    ],
  },
  {
    group: "Analysis",
    options: [
      { mode: "ntg", label: "Neutral Grey Mask" },
      { mode: "skn", label: "Skin Tone Mask" },
      { mode: "exz", label: "Exposure Zones" },
      { mode: "clz", label: "Clipping Zones" },
      { mode: "tmp", label: "Temperature Map" },
      { mode: "fcl", label: "False Colors" },
    ],
  },
];

const validModes = new Set<ScopeMode>(
  modeGroups.flatMap((group) => group.options.map((option) => option.mode)),
);
const histogramModes = new Set<ScopeMode>(["rgb", "hue", "sat", "lum"]);
const inputColorSpaceLabels = buildMenuLabels(IDT_MENU);
const workingColorSpaceLabels = new Map([
  ["linear-srgb", "Linear sRGB"],
  ["acescg", "ACEScg"],
]);
const displayColorSpaceLabels = buildMenuLabels(ODT_MENU);
const viewTransformLabels = new Map([
  ["none", "None"],
  ["standard", "Standard"],
  ["filmic", "Filmic"],
  ["aces-like", "ACES-like"],
  ["soft-clip", "Soft Clip"],
]);

export function ScopesWindow(props: Props) {
  const [pos, setPos] = createSignal({ x: Math.max(16, window.innerWidth - 380), y: 80 });
  const [expanded, setExpanded] = createSignal(false);
  const [workerReady, setWorkerReady] = createSignal(false);
  const [workerSupported, setWorkerSupported] = createSignal(true);
  let windowRef: HTMLDivElement | undefined;
  let scopeCanvas: HTMLCanvasElement | undefined;
  let worker: Worker | undefined;
  let throttleTimer: ReturnType<typeof setTimeout> | undefined;
  let expandTimer: ReturnType<typeof setTimeout> | undefined;
  const [lastColorManagement, setLastColorManagement] =
    createSignal<ScopeReadback["colorManagement"]>();
  let lastRun = 0;
  let dragging = false;
  let dragOffset = { x: 0, y: 0 };

  function canvasPixelSize() {
    const rect = scopeCanvas?.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      width: Math.max(1, Math.round((rect?.width || DEFAULT_CANVAS_WIDTH) * dpr)),
      height: Math.max(1, Math.round((rect?.height || DEFAULT_CANVAS_HEIGHT) * dpr)),
    };
  }

  function resizeWorkerCanvas() {
    if (!worker || !scopeCanvas) return;
    const size = canvasPixelSize();
    worker.postMessage({ type: "resize", width: size.width, height: size.height });
  }

  function runAnalyze() {
    if (!worker || !workerReady()) return;
    const readback = props.readFrame(scopesState.sampleSize);
    if (!readback) return;
    setLastColorManagement(readback.colorManagement);
    worker.postMessage(
      {
        type: "draw",
        mode: scopesState.mode,
        pixels: readback.pixels.buffer,
        width: readback.width,
        height: readback.height,
        opacity: 1,
        showGrid: true,
      },
      [readback.pixels.buffer],
    );
  }

  function requestAnalyze(immediate = false) {
    if (!scopesState.visible || !scopesState.enabled) return;
    if (immediate) {
      if (throttleTimer !== undefined) {
        clearTimeout(throttleTimer);
        throttleTimer = undefined;
      }
      lastRun = performance.now();
      runAnalyze();
      return;
    }
    const interval = 1000 / Math.max(1, scopesState.refreshRate);
    const now = performance.now();
    const elapsed = now - lastRun;
    if (throttleTimer !== undefined) return;
    if (elapsed >= interval) {
      lastRun = now;
      runAnalyze();
    } else {
      throttleTimer = setTimeout(() => {
        throttleTimer = undefined;
        lastRun = performance.now();
        runAnalyze();
      }, interval - elapsed);
    }
  }

  function setMode(mode: ScopeMode) {
    setScopesState("mode", mode);
    try {
      localStorage.setItem(SCOPES_MODE_STORAGE_KEY, mode);
    } catch {
      // Non-fatal: localStorage may be unavailable.
    }
    requestAnimationFrame(() => {
      resizeWorkerCanvas();
      requestAnalyze(histogramModes.has(mode));
    });
  }

  function toggleExpanded() {
    setExpanded((value) => !value);
    if (expandTimer !== undefined) clearTimeout(expandTimer);
    expandTimer = setTimeout(() => {
      resizeWorkerCanvas();
      requestAnalyze();
    }, 200);
  }

  createEffect(() => {
    if (scopesState.visible) {
      void props.revision();
      requestAnalyze(histogramModes.has(scopesState.mode));
    }
  });

  createEffect(() => {
    if (scopesState.visible) {
      void scopesState.mode;
      requestAnalyze();
    }
  });

  createEffect(() => {
    if (!scopesState.visible || !scopeCanvas || worker) return;
    if (!("transferControlToOffscreen" in scopeCanvas)) {
      setWorkerSupported(false);
      return;
    }
    worker = new Worker(new URL("../../engine/scopes/ScopesWorker.ts", import.meta.url), {
      type: "module",
    });
    const size = canvasPixelSize();
    const offscreen = scopeCanvas.transferControlToOffscreen();
    worker.postMessage(
      { type: "init", canvas: offscreen, width: size.width, height: size.height },
      [offscreen],
    );
    setWorkerReady(true);
    requestAnalyze();
  });

  function positionAtToggleButton() {
    const button = document.querySelector('[data-action="toggle-scopes"]');
    if (!button || !windowRef) return;
    const btn = button.getBoundingClientRect();
    const win = windowRef.getBoundingClientRect();
    const gap = 12;
    // Prefer placing the window to the left of the button; flip to the right if
    // there isn't room, and bottom-align it with the button.
    let x = btn.left - win.width - gap;
    if (x < 8) x = Math.min(btn.right + gap, window.innerWidth - win.width - 8);
    let y = btn.bottom - win.height;
    y = Math.max(8, Math.min(y, window.innerHeight - win.height - 8));
    setPos({ x, y });
  }

  onMount(() => {
    try {
      const stored = localStorage.getItem(SCOPES_MODE_STORAGE_KEY) as ScopeMode | null;
      if (stored && validModes.has(stored)) {
        setScopesState("mode", stored);
      }
    } catch {
      // Non-fatal: localStorage may be unavailable.
    }
    positionAtToggleButton();
    const onResize = () => {
      resizeWorkerCanvas();
      requestAnalyze();
    };
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  onCleanup(() => {
    if (throttleTimer !== undefined) clearTimeout(throttleTimer);
    if (expandTimer !== undefined) clearTimeout(expandTimer);
    worker?.terminate();
  });

  function onDragDown(event: PointerEvent) {
    if ((event.target as HTMLElement).closest("select, button, img")) return;
    dragging = true;
    dragOffset = { x: event.clientX - pos().x, y: event.clientY - pos().y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDragMove(event: PointerEvent) {
    if (!dragging) return;
    const bounds = windowRef?.getBoundingClientRect();
    setPos({
      x: Math.max(
        0,
        Math.min(window.innerWidth - (bounds?.width ?? 80), event.clientX - dragOffset.x),
      ),
      y: Math.max(0, Math.min(window.innerHeight - 40, event.clientY - dragOffset.y)),
    });
  }

  function onDragUp(event: PointerEvent) {
    dragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      ref={windowRef}
      class="scopes-window"
      classList={{ expanded: expanded() }}
      data-mode={scopesState.mode}
      style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
    >
      <header
        class="scopes-window__header"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
      >
        <select
          data-mode
          class="scopes-window__select"
          value={scopesState.mode}
          onChange={(event) => setMode(event.currentTarget.value as ScopeMode)}
        >
          <For each={modeGroups}>
            {(group) => (
              <optgroup label={group.group}>
                <For each={group.options}>
                  {(option) => <option value={option.mode}>{option.label}</option>}
                </For>
              </optgroup>
            )}
          </For>
        </select>
        <button
          class="scopes-window__icon"
          type="button"
          data-expand
          title="Expand"
          onClick={toggleExpanded}
        >
          <img src="/assets/icons/expand_icon.svg" alt="Expand" />
        </button>
        <button
          class="scopes-window__close"
          type="button"
          data-close
          onClick={() => setScopesState("visible", false)}
        >
          Close
        </button>
      </header>
      <canvas
        ref={scopeCanvas}
        width={DEFAULT_CANVAS_WIDTH}
        height={DEFAULT_CANVAS_HEIGHT}
        class="scope-canvas scopes-cvs"
      />
      <Show when={lastColorManagement()}>
        {(cm) => (
          <div class="scopes-window__cm" aria-label="Scopes color management">
            <span>{labelFor(inputColorSpaceLabels, cm().inputColorSpaceId)}</span>
            <span>{labelFor(workingColorSpaceLabels, cm().workingColorSpaceId)}</span>
            <span>{labelFor(displayColorSpaceLabels, cm().displayColorSpaceId)}</span>
            <span>{labelFor(viewTransformLabels, cm().viewTransformId)}</span>
          </div>
        )}
      </Show>
      <Show when={!workerSupported()}>
        <div class="scopes-window__hint">
          Scopes require OffscreenCanvas support in this browser.
        </div>
      </Show>
    </div>
  );
}

function buildMenuLabels(menu: Array<{ options: { id: string; label: string }[] }>) {
  return new Map(
    menu.flatMap((group) => group.options.map((option) => [option.id, option.label] as const)),
  );
}

function labelFor(labels: Map<string, string>, id: string) {
  return labels.get(id) ?? id;
}
