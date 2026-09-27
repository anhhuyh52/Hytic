import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { editState, setEditState, type ImageInfo } from "../../app/editor-store";
import { PRESENTATION_BORDER_PRESETS, getPresentationBorderPreset } from "../../features/presentation/border/borderPresets";
import {
  clonePresentationBorder,
  DEFAULT_PRESENTATION_BORDER,
  hexToRgb,
  normalizePresentationBorder,
  rgbToHex,
  type PresentationBorderAspectRatio,
  type PresentationBorderFrameImage,
  type PresentationBorderPreset,
  type PresentationBorderSettings,
  type PresentationFrameImageRotation,
} from "../../features/presentation/border/borderTypes";
import { readPresentationFrameImage } from "../../features/presentation/border/frameImage";
import type { CropSourceData } from "../cropSourceTypes";
import { Slider } from "../controls/Slider";

type BorderEditorTab = "frame" | "ratio";

type Props = {
  anchor?: HTMLElement | null;
  image?: ImageInfo;
  imageName: string;
  cropSourceData?: CropSourceData;
  previewPresentationBorder(border: PresentationBorderSettings): void;
  onClose(): void;
};

const BORDER_RATIO_CHIPS: Array<{ value: PresentationBorderAspectRatio; label: string }> = [
  { value: "original", label: "Original" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "2.39:1", label: "2.39" },
];

const BORDER_EDITOR_TABS: Array<{ id: BorderEditorTab; label: string }> = [
  { id: "frame", label: "Frame" },
  { id: "ratio", label: "Ratio" },
];

const FRAME_IMAGE_SELECT_VALUE = "__frame-image__";
const FRAME_IMAGE_ROTATIONS: PresentationFrameImageRotation[] = [0, 90, 180, 270];

const pct1 = (value: number) => `${Math.round(value * 1000) / 10}%`;

const BORDER_RATIO_PRESET_VALUES = new Set<PresentationBorderAspectRatio>(
  BORDER_RATIO_CHIPS.map((option) => option.value),
);

function RatioOptionIcon(props: { ratio?: PresentationBorderAspectRatio; custom?: boolean }) {
  const dimensions = createMemo(() => {
    if (props.custom) return { width: 24, height: 18 };
    const value = props.ratio === "original" ? 4 / 3 : Number(props.ratio?.split(":")[0]) / Number(props.ratio?.split(":")[1]);
    const safe = Number.isFinite(value) && value > 0 ? value : 4 / 3;
    return safe >= 1
      ? { width: 24, height: Math.max(8, 24 / safe) }
      : { width: Math.max(8, 24 * safe), height: 24 };
  });
  return (
    <svg class="border-gallery__ratio-icon" viewBox="0 0 30 30" aria-hidden={true}>
      <rect
        x={(30 - dimensions().width) / 2}
        y={(30 - dimensions().height) / 2}
        width={dimensions().width}
        height={dimensions().height}
        rx="2"
        classList={{ "is-custom": props.custom }}
      />
      <Show when={props.custom}>
        <path d="M8 21 22 9M17 9h5v5M8 16v5h5" />
      </Show>
    </svg>
  );
}

function extractImagePalette(source: CropSourceData | undefined, count = 8): string[] {
  if (!source) return [];
  const pixels = new Uint8ClampedArray(source.buffer);
  const total = Math.floor(pixels.length / 4);
  if (total <= 0) return [];
  const step = Math.max(1, Math.floor(total / 5000));
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (pixels[o + 3] < 24) continue;
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(key);
    if (entry) {
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number])
    .sort(
      (a, b) =>
        0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2] -
        (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]),
    )
    .map((rgb) => rgbToHex(rgb));
}

export function BorderEditorWindow(props: Props) {
  const original = normalizePresentationBorder(clonePresentationBorder(editState.presentationBorder));
  const [draft, setDraft] = createSignal<PresentationBorderSettings>(
    normalizePresentationBorder(clonePresentationBorder(editState.presentationBorder)),
  );
  const [customRatioWidth, setCustomRatioWidth] = createSignal(7);
  const [customRatioHeight, setCustomRatioHeight] = createSignal(5);
  const [compareActive, setCompareActive] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<BorderEditorTab>("frame");
  const [pos, setPos] = createSignal({ x: Math.max(16, window.innerWidth - 430), y: 80 });
  let windowRef: HTMLElement | undefined;
  let frameImageInputRef: HTMLInputElement | undefined;
  let applyingBorder = false;
  let dragging = false;
  let dragOffset = { x: 0, y: 0 };

  createEffect(() => {
    props.previewPresentationBorder(compareActive() ? DEFAULT_PRESENTATION_BORDER : draft());
  });

  onCleanup(() => {
    props.previewPresentationBorder(applyingBorder ? editState.presentationBorder : original);
  });

  const imagePalette = createMemo(() => {
    const source = props.cropSourceData;
    void source?.token;
    return extractImagePalette(source);
  });
  const activeColorHex = createMemo(() => rgbToHex(draft().color).toLowerCase());
  const frameSelectValue = createMemo(() =>
    draft().backgroundMode === "image" && draft().frameImage?.dataUrl
      ? FRAME_IMAGE_SELECT_VALUE
      : draft().preset,
  );

  function clampToViewport(x: number, y: number) {
    const bounds = windowRef?.getBoundingClientRect();
    const w = bounds?.width ?? 408;
    const h = bounds?.height ?? 520;
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
    };
  }

  function positionAtAnchor() {
    const anchor = props.anchor;
    if (!anchor || !windowRef) return;
    const btn = anchor.getBoundingClientRect();
    const win = windowRef.getBoundingClientRect();
    const gap = 12;
    let x = btn.left - win.width - gap;
    if (x < 8) x = Math.min(btn.right + gap, window.innerWidth - win.width - 8);
    let y = btn.bottom - win.height;
    y = Math.max(8, Math.min(y, window.innerHeight - win.height - 8));
    setPos({ x, y });
  }

  function updateDraft(patch: Partial<PresentationBorderSettings>) {
    setDraft((prev) => {
      const next = { ...clonePresentationBorder(prev), ...patch };
      next.color = patch.color ? [patch.color[0], patch.color[1], patch.color[2]] : next.color;
      if (patch.size !== undefined && next.linked) {
        next.top = patch.size;
        next.right = patch.size;
        next.bottom = patch.size;
        next.left = patch.size;
      }
      if (
        patch.top !== undefined ||
        patch.right !== undefined ||
        patch.bottom !== undefined ||
        patch.left !== undefined
      ) {
        next.size = Math.max(next.top, next.right, next.bottom, next.left);
      }
      next.enabled =
        next.enabled ||
        next.aspectRatio !== "original" ||
        next.imageScale < 0.999 ||
        next.imageRadius > 0 ||
        next.frameRadius > 0 ||
        next.imageShadow > 0 ||
        next.imageInnerShadow > 0 ||
        next.size > 0 ||
        next.top > 0 ||
        next.right > 0 ||
        next.bottom > 0 ||
        next.left > 0;
      return normalizePresentationBorder(next);
    });
  }

  const hasSelectedRatio = createMemo(() => draft().aspectRatio !== "original");
  const isCustomRatio = createMemo(() => !BORDER_RATIO_PRESET_VALUES.has(draft().aspectRatio));

  function applyCustomRatio(width = customRatioWidth(), height = customRatioHeight()) {
    const safeWidth = Math.max(1, Math.min(99, Math.round(width || 1)));
    const safeHeight = Math.max(1, Math.min(99, Math.round(height || 1)));
    setCustomRatioWidth(safeWidth);
    setCustomRatioHeight(safeHeight);
    updateDraft({ aspectRatio: `${safeWidth}:${safeHeight}` });
  }

  function choosePreset(id: PresentationBorderPreset) {
    setDraft(clonePresentationBorder(getPresentationBorderPreset(id).settings));
  }

  function openFrameImagePicker() {
    if (!frameImageInputRef) return;
    frameImageInputRef.value = "";
    frameImageInputRef.click();
  }

  async function chooseFrameImage(file: File | null | undefined) {
    if (!file) return;
    try {
      const frameImage = await readPresentationFrameImage(file);
      const current = draft();
      updateDraft({
        backgroundMode: "image",
        frameImage,
        opacity: 0,
        enabled: true,
        imageScale: current.imageScale < 0.999 ? current.imageScale : 0.94,
        size: current.size > 0 ? current.size : 0.08,
      });
    } catch (error) {
      console.warn("[Border] Unable to use frame image", error);
    }
  }

  function clearFrameImage() {
    updateDraft({ backgroundMode: "solid", frameImage: undefined, opacity: 1 });
  }

  function rotateFrameImage() {
    const frameImage = draft().frameImage;
    if (!frameImage) return;
    const current = frameImage.rotationDegrees ?? 0;
    const index = FRAME_IMAGE_ROTATIONS.indexOf(current);
    const rotationDegrees = FRAME_IMAGE_ROTATIONS[(index + 1) % FRAME_IMAGE_ROTATIONS.length];
    updateDraft({
      backgroundMode: "image",
      frameImage: { ...frameImage, rotationDegrees } satisfies PresentationBorderFrameImage,
      enabled: true,
    });
  }

  function resetDraft() {
    setDraft(clonePresentationBorder(DEFAULT_PRESENTATION_BORDER));
  }

  function cancel() {
    setDraft(clonePresentationBorder(original));
    props.onClose();
  }

  function apply() {
    const next = normalizePresentationBorder(clonePresentationBorder(draft()));
    applyingBorder = true;
    setEditState("presentationBorder", next);
    props.onClose();
  }

  function onDragDown(event: PointerEvent) {
    if ((event.target as HTMLElement).closest("button, input, select, label")) return;
    dragging = true;
    dragOffset = { x: event.clientX - pos().x, y: event.clientY - pos().y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDragMove(event: PointerEvent) {
    if (!dragging) return;
    setPos(clampToViewport(event.clientX - dragOffset.x, event.clientY - dragOffset.y));
  }

  function onDragUp(event: PointerEvent) {
    dragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  createEffect(() => {
    activeTab();
    requestAnimationFrame(() => setPos((current) => clampToViewport(current.x, current.y)));
  });

  onMount(() => {
    positionAtAnchor();
    requestAnimationFrame(positionAtAnchor);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    };
    const onResize = () => setPos((current) => clampToViewport(current.x, current.y));
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    });
  });

  return (
    <section
      ref={windowRef}
      class="border-editor-window border-editor-window--gallery border-editor-window--floating"
      role="dialog"
      aria-label="Borders"
      style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
    >
      <header
        class="border-gallery__header"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
      >
        <button class="border-gallery__ghost-button" type="button" onClick={cancel}>
          Cancel
        </button>


        <div class="border-gallery__header-actions">
          <button class="border-gallery__ghost-button" type="button" onClick={resetDraft}>
            Reset
          </button>
          <button class="border-gallery__done-button" type="button" onClick={apply}>
            Done
          </button>
        </div>
      </header>

      <div class="border-gallery__body">
        <nav class="border-gallery__tabs" role="tablist" aria-label="Border controls">
          <For each={BORDER_EDITOR_TABS}>
            {(tab) => (
              <button
                classList={{ "border-gallery__tab": true, "is-active": activeTab() === tab.id }}
                id={`border-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab() === tab.id ? "true" : "false"}
                aria-controls={`border-panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </nav>

        <div class="border-gallery__tab-panel">
          <Show when={activeTab() === "frame"}>
            <section id="border-panel-frame" class="border-gallery__section" role="tabpanel">
              <input
                ref={(el) => (frameImageInputRef = el)}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => void chooseFrameImage(event.currentTarget.files?.[0])}
              />

              <div class="border-gallery__select-row">
                <span>Frame Type</span>
                <div class="border-gallery__select-root">
                  <select
                    class="border-gallery__select"
                    value={frameSelectValue()}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (value === FRAME_IMAGE_SELECT_VALUE) {
                        openFrameImagePicker();
                        return;
                      }
                      choosePreset(value as PresentationBorderPreset);
                    }}
                  >
                    <For each={PRESENTATION_BORDER_PRESETS}>
                      {(preset) => <option value={preset.id}>{preset.label}</option>}
                    </For>
                    <option value={FRAME_IMAGE_SELECT_VALUE}>Use another image...</option>
                  </select>
                  <span class="border-gallery__select-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m4 6 4 4 4-4" />
                    </svg>
                  </span>
                </div>
              </div>

              <Show when={draft().backgroundMode === "image" && draft().frameImage}>
                {(frameImage) => (
                  <div class="border-gallery__frame-image">
                    <span class="border-gallery__frame-image-name" title={frameImage().name}>
                      {frameImage().name}
                    </span>
                    <button type="button" onClick={openFrameImagePicker}>
                      Change
                    </button>
                    <button type="button" title="Rotate frame image 90 degrees" onClick={rotateFrameImage}>
                      Rotate
                    </button>
                    <button type="button" onClick={clearFrameImage}>
                      Clear
                    </button>
                  </div>
                )}
              </Show>

              <div class="border-gallery__section-head border-gallery__section-head--spaced">
                <span>Look</span>
              </div>

              <Show when={draft().backgroundMode === "blur"}>
                <div class="border-gallery__control">
                  <div class="border-gallery__control-head">
                    <span>Blur</span>
                    <strong>{Math.round(draft().blurAmount)}px</strong>
                  </div>
                  <Slider
                    label=""
                    value={draft().blurAmount}
                    min={0}
                    max={80}
                    step={1}
                    default={28}
                    format={(value) => `${Math.round(value)}px`}
                    onInput={(value) => updateDraft({ blurAmount: value, enabled: true })}
                  />
                </div>
              </Show>

              <label class="border-gallery__color-row">
                <span>Color</span>
                <span class="border-gallery__color-control">
                  <input
                    type="color"
                    value={rgbToHex(draft().color)}
                    onInput={(event) =>
                      updateDraft({ color: hexToRgb(event.currentTarget.value), enabled: true })
                    }
                  />
                  <span
                    class="border-gallery__color-swatch"
                    style={{ "background-color": rgbToHex(draft().color) }}
                  />
                  <strong>{rgbToHex(draft().color)}</strong>
                </span>
              </label>

              <Show when={imagePalette().length > 0}>
                <div class="border-gallery__palette" role="group" aria-label="Colors from this image">
                  <For each={imagePalette()}>
                    {(hex) => (
                      <button
                        classList={{
                          "border-gallery__palette-swatch": true,
                          "is-active": hex.toLowerCase() === activeColorHex(),
                        }}
                        type="button"
                        title={hex}
                        aria-label={`Use ${hex}`}
                        style={{ "background-color": hex }}
                        onClick={() => updateDraft({ color: hexToRgb(hex), enabled: true })}
                      />
                    )}
                  </For>
                </div>
              </Show>

              <div class="border-gallery__control">
                <div class="border-gallery__control-head">
                  <span>Size</span>
                  <strong>{pct1(draft().size)}</strong>
                </div>
                <Slider
                  label=""
                  hideValue
                  value={draft().size}
                  min={0}
                  max={0.5}
                  step={0.005}
                  default={0}
                  format={pct1}
                  onInput={(value) => updateDraft({ size: value, enabled: value > 0 })}
                />
              </div>

              <label class="border-gallery__toggle-row">
                <span>Link sides</span>
                <input
                  class="border-gallery__toggle"
                  type="checkbox"
                  checked={draft().linked}
                  onChange={(event) => updateDraft({ linked: event.currentTarget.checked })}
                />
              </label>

              <Show when={!draft().linked}>
                <div class="border-gallery__side-controls">
                  <Slider label="Top" value={draft().top} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ top: value, enabled: value > 0 })} />
                  <Slider label="Right" value={draft().right} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ right: value, enabled: value > 0 })} />
                  <Slider label="Bottom" value={draft().bottom} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ bottom: value, enabled: value > 0 })} />
                  <Slider label="Left" value={draft().left} min={0} max={0.5} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ left: value, enabled: value > 0 })} />
                </div>
              </Show>
            </section>
          </Show>

          <Show when={activeTab() === "ratio"}>
            <section id="border-panel-ratio" class="border-gallery__section" role="tabpanel">
              <div class="border-gallery__section-head"><span>Canvas ratio</span><small>{draft().aspectRatio}</small></div>
              <div class="border-gallery__ratio-grid" role="group" aria-label="Canvas ratio">
                <For each={BORDER_RATIO_CHIPS}>{(option) => (
                  <button classList={{ "border-gallery__chip": true, "is-active": draft().aspectRatio === option.value }} type="button" aria-pressed={draft().aspectRatio === option.value} onClick={() => updateDraft({ aspectRatio: option.value })}>
                    <RatioOptionIcon ratio={option.value} /><span>{option.label}</span>
                  </button>
                )}</For>
                <button classList={{ "border-gallery__chip": true, "is-active": isCustomRatio() }} type="button" aria-pressed={isCustomRatio()} onClick={() => applyCustomRatio()}>
                  <RatioOptionIcon custom /><span>Custom</span>
                </button>
              </div>
              <Show when={isCustomRatio()}>
                <div class="border-gallery__custom-ratio" role="group" aria-label="Custom ratio">
                  <label><span>Width</span><input type="number" min="1" max="99" value={customRatioWidth()} onInput={(event) => applyCustomRatio(event.currentTarget.valueAsNumber, customRatioHeight())} /></label>
                  <span class="border-gallery__custom-ratio-separator">:</span>
                  <label><span>Height</span><input type="number" min="1" max="99" value={customRatioHeight()} onInput={(event) => applyCustomRatio(customRatioWidth(), event.currentTarget.valueAsNumber)} /></label>
                </div>
              </Show>
              <Show when={hasSelectedRatio()}>
                <div class="border-gallery__ratio-details">
                  <div class="border-gallery__section-head"><span>Corners</span></div>
                  <div class="border-gallery__control"><div class="border-gallery__control-head"><span>Image</span><strong>{pct1(draft().imageRadius)}</strong></div><Slider label="" value={draft().imageRadius} min={0} max={1} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ imageRadius: value, enabled: value > 0 })} /></div>
                  <div class="border-gallery__control"><div class="border-gallery__control-head"><span>Frame</span><strong>{pct1(draft().frameRadius)}</strong></div><Slider label="" value={draft().frameRadius} min={0} max={1} step={0.005} default={0} format={pct1} onInput={(value) => updateDraft({ frameRadius: value, enabled: value > 0 })} /></div>
                  <div class="border-gallery__section-head border-gallery__section-head--spaced"><span>Shadows</span></div>
                  <div class="border-gallery__control"><div class="border-gallery__control-head"><span>Drop shadow</span><strong>{pct1(draft().imageShadow)}</strong></div><Slider label="" value={draft().imageShadow} min={0} max={1} step={0.01} default={0} format={pct1} onInput={(value) => updateDraft({ imageShadow: value, enabled: value > 0 })} /></div>
                  <div class="border-gallery__control"><div class="border-gallery__control-head"><span>Inner shadow</span><strong>{pct1(draft().imageInnerShadow)}</strong></div><Slider label="" value={draft().imageInnerShadow} min={0} max={1} step={0.01} default={0} format={pct1} onInput={(value) => updateDraft({ imageInnerShadow: value, enabled: value > 0 })} /></div>
                </div>
              </Show>
            </section>
          </Show>
        </div>
      </div>

      <footer class="border-gallery__footer">
        <button
          class="border-gallery__bypass-button"
          type="button"
          onPointerDown={() => setCompareActive(true)}
          onPointerUp={() => setCompareActive(false)}
          onPointerCancel={() => setCompareActive(false)}
          onPointerLeave={() => setCompareActive(false)}
          onBlur={() => setCompareActive(false)}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") setCompareActive(true);
          }}
          onKeyUp={() => setCompareActive(false)}
        >
          Bypass
        </button>
      </footer>
    </section>
  );
}
