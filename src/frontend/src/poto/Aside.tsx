import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PANELS, type PanelKey } from "./panels";
import { isPanelEdited, isAnyPanelEdited } from "./edited";
import { getPanelBypass, resetPanel, togglePanelBypass } from "./panelOps";

import type { MatchApi } from "./panels/MatchPanel";
import type { EditState, CurvePreviewInput } from "../engine/state/EditState";

import { PanelHeader, ActivePanel } from "./panels/PanelContainer";

export function Aside(props: {
  hasImage: boolean;
  openPanel: PanelKey | null;
  matchApi?: MatchApi;
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  previewCurveInput?: (input: CurvePreviewInput) => void;
  clearPreviewPatch?: (reason?: string) => void;
  commitEditHistory?: (label: string) => void;
  onOpenPanelChange?: (panel: PanelKey | null) => void;
}) {
  const openPanel = () => props.openPanel;
  const setOpenPanel = (
    value: PanelKey | null | ((current: PanelKey | null) => PanelKey | null),
  ) => {
    const next = typeof value === "function" ? value(openPanel()) : value;
    props.onOpenPanelChange?.(next);
  };
  const [helpPanel, setHelpPanel] = createSignal<PanelKey | null>(null);
  const [viewportSize, setViewportSize] = createSignal({ width: 0, height: 0 });
  let railRef: HTMLElement | undefined;

  const railLayout = createMemo<"bottom" | "side">(() => {
    const { width, height } = viewportSize();
    if (width === 0 || height === 0) return "side";
    const shortLandscape = width > height && height <= 520;
    return width <= 900 && !shortLandscape ? "bottom" : "side";
  });

  const railStyle = createMemo(() => {
    const { width, height } = viewportSize();
    if (railLayout() !== "bottom") return undefined;

    const maxPanelHeight = width <= 640 ? 300 : 320;
    const panelHeight = Math.round(Math.min(maxPanelHeight, Math.max(198, height * 0.36)));
    const compactPanelHeight =
      height <= 620 ? Math.round(Math.min(228, Math.max(168, height * 0.33))) : panelHeight;

    return {
      "--aside-viewport-width": `${Math.round(width)}px`,
      "--aside-viewport-height": `${Math.round(height)}px`,
      "--aside-panel-height": `${compactPanelHeight}px`,
    };
  });

  const toggleOpen = (key: PanelKey) => {
    if (!props.hasImage) return;
    setOpenPanel((current) => (current === key && railLayout() !== "bottom" ? null : key));
    setHelpPanel(null);
  };

  createEffect(() => {
    if (!props.hasImage) {
      setOpenPanel(null);
      setHelpPanel(null);
    }
  });

  onMount(() => {
    const rail = railRef;
    if (!rail) return;
    const appRoot = rail.closest("poto-app") as HTMLElement | null;

    const onWheel = (event: WheelEvent) => event.stopPropagation();
    const syncLayout = () => {
      const visualViewport = window.visualViewport;
      const nextSize = {
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      };
      const shortLandscape = nextSize.width > nextSize.height && nextSize.height <= 520;
      const nextLayout = nextSize.width <= 900 && !shortLandscape ? "bottom" : "side";
      const maxPanelHeight = nextSize.width <= 640 ? 300 : 320;
      const panelHeight = Math.round(
        Math.min(maxPanelHeight, Math.max(198, nextSize.height * 0.36)),
      );
      const compactPanelHeight =
        nextSize.height <= 620
          ? Math.round(Math.min(228, Math.max(168, nextSize.height * 0.33)))
          : panelHeight;

      setViewportSize(nextSize);
      appRoot?.setAttribute("data-aside-layout", nextLayout);
      if (nextLayout === "bottom") {
        appRoot?.style.setProperty("--aside-panel-height", `${compactPanelHeight}px`);
        appRoot?.style.setProperty("--aside-viewport-width", `${Math.round(nextSize.width)}px`);
        appRoot?.style.setProperty("--aside-viewport-height", `${Math.round(nextSize.height)}px`);
      } else {
        appRoot?.style.removeProperty("--aside-panel-height");
        appRoot?.style.removeProperty("--aside-viewport-width");
        appRoot?.style.removeProperty("--aside-viewport-height");
      }
    };

    syncLayout();
    rail.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("resize", syncLayout);
    window.addEventListener("orientationchange", syncLayout);
    window.visualViewport?.addEventListener("resize", syncLayout);
    window.visualViewport?.addEventListener("scroll", syncLayout);

    onCleanup(() => {
      rail.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("orientationchange", syncLayout);
      window.visualViewport?.removeEventListener("resize", syncLayout);
      window.visualViewport?.removeEventListener("scroll", syncLayout);
      appRoot?.removeAttribute("data-aside-layout");
      appRoot?.style.removeProperty("--aside-panel-height");
      appRoot?.style.removeProperty("--aside-viewport-width");
      appRoot?.style.removeProperty("--aside-viewport-height");
    });
  });

  return (
    <aside
      ref={railRef}
      class="adjustment-panels"
      classList={{ "is-disabled": !props.hasImage }}
      aria-disabled={!props.hasImage}
      data-layout={railLayout()}
      style={railStyle()}
    >
      <For each={PANELS}>
        {(panel) => (
          <>
            <PanelHeader
              panel={panel}
              open={openPanel() === panel.key}
              edited={
                props.hasImage &&
                (panel.key === "presets" ? isAnyPanelEdited() : isPanelEdited(panel.key))
              }
              bypassed={props.hasImage && getPanelBypass(panel.key)}
              disabled={!props.hasImage}
              helpVisible={helpPanel() === panel.key}
              onToggle={() => toggleOpen(panel.key)}
              onHelp={() => {
                if (!props.hasImage) return;
                if (openPanel() !== panel.key) setOpenPanel(panel.key);
                setHelpPanel((current) => (current === panel.key ? null : panel.key));
              }}
              onBypass={() => {
                if (props.hasImage) togglePanelBypass(panel.key);
              }}
              onReset={() => {
                if (props.hasImage) resetPanel(panel.key);
              }}
            />
            <Show when={openPanel() === panel.key}>
              <ActivePanel
                panel={panel}
                bypassed={getPanelBypass(panel.key)}
                helpVisible={helpPanel() === panel.key}
                matchApi={props.matchApi}
                previewEditPatch={props.previewEditPatch}
                previewCurveInput={props.previewCurveInput}
                clearPreviewPatch={props.clearPreviewPatch}
                commitEditHistory={props.commitEditHistory}
              />
            </Show>
          </>
        )}
      </For>
    </aside>
  );
}
