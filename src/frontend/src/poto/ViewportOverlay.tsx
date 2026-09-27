/**
 * viewport-overlay — the floating toolbar over the image. Reproduces the exact
 * legacy DOM: data-action open-projects / import-files / toggle-split /
 * crop-rotate / toggle-scopes + data-zoom, using the legacy overlay-button /
 * rounded-full / square / pd-050 classes. The Projects button thumbnail swaps
 * from empty_project_icon.svg to the active image thumbnail when present.
 */
import { createEffect, createSignal, onCleanup, Show, type ParentProps } from "solid-js";

export function ViewportOverlay(props: ParentProps<{
  hasImage: boolean;
  zoom: number;
  splitActive: boolean;
  projectThumb?: string;
  /** Show local project loading and saving controls. */
  showProjects?: boolean;
  /** Crop & Rotate is a still-image tool; hidden while a video clip is loaded. */
  allowCrop?: boolean;
  /** Explicitly hide the toolbar (e.g. when an overlay is open). */
  hidden?: boolean;
  onOpenProjects: () => void;
  onImport: () => void;
  onFitZoom: () => void;
  onToggleSplit: () => void;
  onCropRotate: () => void;
  onOpenDistort: () => void;
  distortActive?: boolean;
  allowDistort?: boolean;
  onOpenBorder: (event: MouseEvent) => void;
  onToggleScopes: () => void;
  /** Called when a mask type is picked — the parent enters masking mode. */
  onSelectMask: () => void;
  onOpenOverlays?: () => void;
  /** Sampler API for color picking. */
  /** Late-bound accessor because the Viewer ref is assigned after this toolbar mounts. */
}>) {
  const zoomPct = () => `${Math.round((props.zoom ?? 1) * 100)}%`;

  const [speedDialOpen, setSpeedDialOpen] = createSignal(false);
  let speedDialRef!: HTMLDivElement;
  let speedDialToggleRef!: HTMLButtonElement;

  createEffect(() => {
    if (!speedDialOpen()) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (speedDialRef.contains(target)) {
        return;
      }
      setSpeedDialOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSpeedDialOpen(false);
      speedDialToggleRef.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    });
  });

  return (
    <>
      <viewport-overlay
        class="pos-abs w-full flex-row x-between gap-050 pd-050 y-bottom"
        classList={{ "viewport-overlay--hidden": !!props.hidden }}
        hidden={props.hidden}
        aria-hidden={props.hidden ? "true" : undefined}
        style={{ bottom: 0 }}
      >
        <div class="viewport-overlay__column flex-row items-center justify-center gap-050" style="height:fit-content">
          <Show when={props.showProjects}>
            <button
              type="button"
              title="Projects"
              data-action="open-projects"
              class="overlay-button pd-0 rounded-100 square overflow-hidden"
              onClick={props.onOpenProjects}
            >
              <img
                class="w-full h-full object-cover pointer-events-none"
                src={props.projectThumb ?? "/assets/icons/empty_project_icon.svg"}
                draggable={false}
                alt=""
              />
            </button>
          </Show>
          <button
            type="button"
            title="Import Files"
            data-action="import-files"
            class="overlay-button pd-050 rounded-full square"
            onClick={props.onImport}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-full h-full pointer-events-none">
              <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </button>

          <Show when={props.hasImage}>
            <button
              type="button"
              title="Fit image to screen"
              data-zoom=""
              class="overlay-button flex-row center align-center text-xs rounded-200 action-button"
              onClick={props.onFitZoom}
            >
              {zoomPct()}
            </button>
          </Show>
        </div>
        {props.children}

        <Show when={props.hasImage}>
          <div
            ref={speedDialRef}
            class="viewport-overlay__column viewport-speed-dial items-center justify-center"
            classList={{ "viewport-speed-dial--open": speedDialOpen() }}
          >
            <div id="viewport-speed-dial-actions" class="viewport-speed-dial__actions">
              <button
                type="button"
                title="Split Screen"
                data-action="toggle-split"
                class="overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                classList={{ "overlay-button--active": props.splitActive }}
                onClick={() => {
                  props.onToggleSplit();
                  setSpeedDialOpen(false);
                }}
              >
                <img src="/assets/icons/split_screen_icon.svg" draggable={false} alt="" />
              </button>
              <Show when={props.allowCrop ?? true}>
                <button
                  type="button"
                  title="Crop & Rotate"
                  data-action="crop-rotate"
                  class="pos-rel overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                  onClick={() => {
                    props.onCropRotate();
                    setSpeedDialOpen(false);
                  }}
                >
                  <img
                    class="w-full h-full pointer-events-none"
                    src="/assets/icons/crop_icon.svg"
                    draggable={false}
                    alt=""
                  />
                </button>
              </Show>
              <Show when={props.allowDistort ?? true}>
                <button
                  type="button"
                  title="Distort"
                  aria-label="Open Distort editor"
                  data-action="open-distort"
                  class="overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                  classList={{ "overlay-button--active": props.distortActive }}
                  onClick={() => {
                    props.onOpenDistort();
                    setSpeedDialOpen(false);
                  }}
                >
                  <svg
                    class="w-full h-full pointer-events-none"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    aria-hidden="true"
                  >
                    <path d="M5 5.5 19 4l-1 16-13-1.5Z" />
                    <path d="M9.5 5v14M14.5 4.5 14 19.5M5 10l13.5-.75M5 14.5l13.25.5" />
                  </svg>
                </button>
              </Show>
              <button
                type="button"
                title="Masking"
                aria-label="Masking"
                data-action="open-masking"
                class="overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                onClick={() => {
                  setSpeedDialOpen(false);
                  props.onSelectMask();
                }}
              >
                <img
                  class="w-full h-full pointer-events-none"
                  src="/assets/icons/mask_icon.svg"
                  draggable={false}
                  alt=""
                />
              </button>
              <button
                type="button"
                title="Borders"
                data-action="open-border"
                class="overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                onClick={(event) => {
                  setSpeedDialOpen(false);
                  props.onOpenBorder(event);
                }}
              >
                <img
                  class="w-full h-full pointer-events-none"
                  src="/assets/icons/frame_white_icon.svg"
                  draggable={false}
                  alt=""
                />
              </button>
              <button
                type="button"
                title="Layers / Overlays"
                aria-label="Layers and overlays"
                data-action="open-overlays"
                class="overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                onClick={() => {
                  setSpeedDialOpen(false);
                  props.onOpenOverlays?.();
                }}
              >
                <img
                  class="w-full h-full pointer-events-none"
                  style={{ filter: "brightness(0) invert(1)" }}
                  src="/assets/icons/layers.svg"
                  draggable={false}
                  alt=""
                />
              </button>
              <button
                type="button"
                title="Scopes & Histograms"
                data-action="toggle-scopes"
                class="overlay-button viewport-speed-dial__action pd-050 rounded-full square"
                onClick={() => {
                  props.onToggleScopes();
                  setSpeedDialOpen(false);
                }}
              >
                <img src="/assets/icons/histogram_icon.svg" draggable={false} alt="" />
              </button>
            </div>

            <button
              type="button"
              ref={speedDialToggleRef}
              title={speedDialOpen() ? "Close tools" : "Open tools"}
              aria-label={speedDialOpen() ? "Close tools" : "Open tools"}
              aria-expanded={speedDialOpen()}
              aria-controls="viewport-speed-dial-actions"
              class="overlay-button viewport-speed-dial__toggle rounded-full square"
              onClick={() => setSpeedDialOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>
        </Show>
      </viewport-overlay>

    </>
  );
}
