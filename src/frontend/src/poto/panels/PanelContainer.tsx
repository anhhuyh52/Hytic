import { createSignal, onCleanup, Show } from "solid-js";
import { PanelContent } from "./panelContent";
import type { PanelDef } from "../panels";
import type { MatchApi } from "./MatchPanel";
import type { EditState, CurvePreviewInput } from "../../engine/state/EditState";
import { openGenerator } from "../spectraGenerator";

export function PanelHeader(props: {
  panel: PanelDef;
  open: boolean;
  edited: boolean;
  bypassed: boolean;
  disabled?: boolean;
  helpVisible: boolean;
  onToggle: () => void;
  onHelp: (event: MouseEvent) => void;
  onBypass: (event: MouseEvent) => void;
  onReset: (event: MouseEvent) => void;
}) {
  const [presetCtaState, setPresetCtaState] = createSignal<"idle" | "generating" | "generated">("idle");
  let presetCtaTimer: number | undefined;

  onCleanup(() => {
    window.clearTimeout(presetCtaTimer);
  });

  function openPresetGeneratorFromCta(event: MouseEvent): void {
    if (presetCtaState() !== "idle") return;
    event.stopPropagation();
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    setPresetCtaState("generating");
    window.clearTimeout(presetCtaTimer);
    presetCtaTimer = window.setTimeout(() => {
      setPresetCtaState("generated");
      openGenerator({
        x: rect.left,
        y: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
      presetCtaTimer = window.setTimeout(() => {
        setPresetCtaState("idle");
      }, 700);
    }, 2400);
  }

  return (
    <control-panel-header
      attr:panel={props.panel.key}
      attr:open={props.open ? "" : undefined}
      attr:edited={props.edited ? "" : undefined}
      attr:bypass={props.bypassed ? "" : undefined}
      attr:disabled={props.disabled ? "" : undefined}
      aria-disabled={props.disabled}
      classList={{ "help-visible": props.helpVisible }}
      onClick={() => {
        if (!props.disabled) props.onToggle();
      }}
    >
      <img src={props.panel.icon} alt="" draggable={false} />
      <span>
        {props.panel.label}
        <Show when={props.panel.sup}>
          <sup>{props.panel.sup}</sup>
        </Show>
      </span>
      <Show when={props.panel.key === "presets"}>
        <button
          type="button"
          class="control-panel-header__cta ai-button"
          title="Generate new presets with AI"
          aria-label="Generate new presets with AI"
          aria-busy={presetCtaState() === "generating"}
          disabled={presetCtaState() !== "idle"}
          attr:data-state={presetCtaState()}
          onClick={openPresetGeneratorFromCta}
        >
          <svg
            class="ai-button__icon"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 3.5L13.3 8.2L18 9.5L13.3 10.8L12 15.5L10.7 10.8L6 9.5L10.7 8.2L12 3.5Z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
            <path
              d="M18.2 14.2L18.9 16.6L21.3 17.3L18.9 18L18.2 20.4L17.5 18L15.1 17.3L17.5 16.6L18.2 14.2Z"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
          </svg>
          <span>
            Generate with AI
          </span>
        </button>
      </Show>
      <Show when={props.panel.hasHelp}>
        <control-panel-button
          type="help"
          title="Learn More"
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            props.onHelp(event);
          }}
        />
      </Show>
      <control-panel-button
        type="bypass"
        title={props.panel.key === "presets" ? "Bypass all preset effects" : "Bypass this panel"}
        attr:bypassed={props.bypassed ? "" : undefined}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          props.onBypass(event);
        }}
      />
      <control-panel-button
        type="reset"
        title={props.panel.key === "presets" ? "Reset all preset effects" : "Reset this panel"}
        attr:disabled={props.edited ? undefined : ""}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          props.onReset(event);
        }}
      />
    </control-panel-header>
  );
}

export function ActivePanel(props: {
  panel: PanelDef;
  bypassed: boolean;
  helpVisible: boolean;
  matchApi?: MatchApi;
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  previewCurveInput?: (input: CurvePreviewInput) => void;
  clearPreviewPatch?: (reason?: string) => void;
  commitEditHistory?: (label: string) => void;
}) {
  return (
    <control-panel attr:open="" attr:bypass={props.bypassed ? "" : undefined}>
      <control-panel-content>
        <Show when={props.panel.hasHelp && props.helpVisible}>
          <aside class="panel-help">
            <h2>{props.panel.helpTitle}</h2>
            <Show when={props.panel.helpScope}>
              <h3>{props.panel.helpScope}</h3>
            </Show>
            <p>{props.panel.helpBlurb}</p>
          </aside>
        </Show>

        <PanelContent
          panel={props.panel.key}
          matchApi={props.matchApi}
          previewEditPatch={props.previewEditPatch}
          previewCurveInput={props.previewCurveInput}
          clearPreviewPatch={props.clearPreviewPatch}
          commitEditHistory={props.commitEditHistory}
        />
      </control-panel-content>
    </control-panel>
  );
}
