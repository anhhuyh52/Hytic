import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Check, Ellipsis } from "lucide-solid";
import { ColorArea } from "@kobalte/core/color-area";
import { ColorField } from "@kobalte/core/color-field";
import { ColorSlider } from "@kobalte/core/color-slider";
import { ColorSwatch } from "@kobalte/core/color-swatch";
import { parseColor, type Color } from "@kobalte/core/colors";
import { Dialog } from "@kobalte/core/dialog";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { SegmentedControl } from "@kobalte/core/segmented-control";
import {
  normalizeGradientStops,
  type GradientKind,
  type GradientOverlayLayer,
  type GradientStop,
} from "../../features/overlays/editorOverlayTypes";
import { createOverlayId } from "../../features/overlays/overlayIds";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const colorChannel01 = (value: number) => clamp01(value / 255);
const gradientOptions = ["reverse", "reflect", "repeat"] as const;
const gradientKinds = [
  ["radial", "Radial"],
  ["linear", "Linear"],
  ["luminance", "Tone Map"],
] as const;

function colorCss(color: GradientStop["color"]): string {
  return `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${color[3]})`;
}

function gradientColorToKobalte(color: GradientStop["color"]): Color {
  return parseColor(colorCss(color)).toFormat("hsba");
}

function kobalteColorToGradientColor(color: Color): GradientStop["color"] {
  const rgba = color.toFormat("rgba");
  return [
    colorChannel01(rgba.getChannelValue("red")),
    colorChannel01(rgba.getChannelValue("green")),
    colorChannel01(rgba.getChannelValue("blue")),
    clamp01(rgba.getChannelValue("alpha")),
  ];
}

function formatOptionLabel(option: (typeof gradientOptions)[number]): string {
  return option[0]!.toUpperCase() + option.slice(1);
}

function CheckIcon() {
  return <Check size={14} aria-hidden="true" />;
}

function MoreIcon() {
  return <Ellipsis size={15} aria-hidden="true" />;
}

export function sampleGradientColor(stops: readonly GradientStop[], position: number): GradientStop["color"] {
  const sorted = [...stops].sort((left, right) => left.position - right.position);
  if (!sorted.length) return [0, 0, 0, 1];
  if (position <= sorted[0]!.position) return [...sorted[0]!.color];
  if (position >= sorted[sorted.length - 1]!.position) return [...sorted[sorted.length - 1]!.color];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    if (position < left.position || position > right.position) continue;
    const distance = Math.max(0.000001, right.position - left.position);
    const amount = (position - left.position) / distance;
    return left.color.map((channel, channelIndex) =>
      channel + (right.color[channelIndex]! - channel) * amount,
    ) as GradientStop["color"];
  }
  return [...sorted[0]!.color];
}

export function GradientPicker(props: {
  layer: GradientOverlayLayer;
  onUpdate(patch: Pick<GradientOverlayLayer, "gradientConfig">): void;
  onCommit(): void;
  onClose(): void;
}) {
  let cleanupDrag: (() => void) | undefined;
  const [activeStopId, setActiveStopId] = createSignal<string | null>(null);
  const [draggingStopId, setDraggingStopId] = createSignal<string | null>(null);
  const stops = () => props.layer.gradientConfig.stops;
  const sortedStops = createMemo(() => [...stops()].sort((left, right) => left.position - right.position));
  const activeStop = createMemo(() => stops().find((stop) => stop.id === activeStopId()) ?? sortedStops()[0]);
  const activeColor = createMemo(() => gradientColorToKobalte(activeStop()?.color ?? [0, 0, 0, 1]));

  createEffect(() => {
    const current = activeStopId();
    if (!current || !stops().some((stop) => stop.id === current)) {
      setActiveStopId(sortedStops()[0]?.id ?? null);
    }
  });

  onCleanup(() => cleanupDrag?.());

  function updateStops(nextStops: readonly GradientStop[]) {
    props.onUpdate({
      gradientConfig: { ...props.layer.gradientConfig, stops: nextStops.map((stop) => ({ ...stop, color: [...stop.color] })) },
    });
  }

  function beginStopDrag(stopId: string, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupDrag?.();
    setActiveStopId(stopId);
    setDraggingStopId(stopId);
    const initialStops = stops().map((stop) => ({ ...stop, color: [...stop.color] as GradientStop["color"] }));
    const initialStop = initialStops.find((stop) => stop.id === stopId);
    const bar = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>("[data-gradient-bar]");
    const barWidth = bar?.getBoundingClientRect().width ?? 1;
    const startX = event.clientX;
    let moved = false;
    if (!initialStop) return;

    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const position = clamp01(initialStop.position + (moveEvent.clientX - startX) / Math.max(1, barWidth));
      moved = moved || Math.abs(position - initialStop.position) > 0.000001;
      updateStops(stops().map((stop) => stop.id === stopId ? { ...stop, position } : stop));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      setDraggingStopId(null);
      cleanupDrag = undefined;
    };
    const finish = () => {
      cleanup();
      if (!moved) return;
      updateStops(normalizeGradientStops(stops()));
      props.onCommit();
    };
    const cancel = () => {
      cleanup();
      if (moved) updateStops(initialStops);
    };
    cleanupDrag = cancel;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  }

  function addStopAt(position: number) {
    const id = createOverlayId();
    updateStops(normalizeGradientStops([...stops(), { id, position, color: sampleGradientColor(stops(), position) }]));
    setActiveStopId(id);
    props.onCommit();
  }

  function handleBarClick(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    addStopAt(clamp01((event.clientX - rect.left) / Math.max(1, rect.width)));
  }

  function addStopFromMenu() {
    const active = activeStop();
    const sorted = sortedStops();
    if (!active || sorted.length === 0) return addStopAt(0.5);
    if (sorted.length === 1) return addStopAt(active.position <= 0.5 ? 1 : 0);
    const index = sorted.findIndex((stop) => stop.id === active.id);
    const neighbor = sorted[index + 1] ?? sorted[index - 1]!;
    addStopAt((active.position + neighbor.position) * 0.5);
  }

  function removeActiveStop() {
    const active = activeStop();
    if (!active || stops().length <= 1) return;
    const remaining = normalizeGradientStops(stops().filter((stop) => stop.id !== active.id));
    const nearest = [...remaining].sort((left, right) =>
      Math.abs(left.position - active.position) - Math.abs(right.position - active.position),
    )[0];
    updateStops(remaining);
    setActiveStopId(nearest?.id ?? null);
    props.onCommit();
  }

  function updateActiveColor(color: GradientStop["color"], commit: boolean) {
    const id = activeStopId();
    if (!id) return;
    updateStops(stops().map((stop) => stop.id === id ? { ...stop, color } : stop));
    if (commit) props.onCommit();
  }

  function updateActiveKobalteColor(color: Color, commit: boolean) {
    updateActiveColor(kobalteColorToGradientColor(color), commit);
  }

  function updateActiveTextColor(value: string) {
    try {
      updateActiveKobalteColor(parseColor(value).toFormat("hsba"), false);
    } catch {
      // Kobalte emits intermediate text input values while editing; ignore invalid colors until they parse.
    }
  }

  function updateConfig(patch: Partial<GradientOverlayLayer["gradientConfig"]>) {
    props.onUpdate({ gradientConfig: { ...props.layer.gradientConfig, ...patch } });
    props.onCommit();
  }

  function setKind(kind: GradientKind) {
    if (kind !== props.layer.gradientConfig.kind) updateConfig({ kind });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          class="gradient-picker-drawer"
          aria-label="Gradient picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header class="gradient-picker-drawer__header">
            <Dialog.Title class="gradient-picker-drawer__title">Gradient</Dialog.Title>
            <div class="gradient-picker-drawer__actions">
              <DropdownMenu placement="bottom-end" modal={false}>
                <DropdownMenu.Trigger class="gradient-picker-icon-button" aria-label="Gradient options">
                  <MoreIcon />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="gradient-picker-menu">
                    <For each={gradientOptions}>
                      {(property) => (
                        <DropdownMenu.CheckboxItem
                          class="gradient-picker-menu__item gradient-picker-menu__item--check"
                          checked={props.layer.gradientConfig[property]}
                          closeOnSelect={false}
                          onChange={(checked) => updateConfig({ [property]: checked })}
                        >
                          <DropdownMenu.ItemIndicator class="gradient-picker-menu__indicator">
                            <CheckIcon />
                          </DropdownMenu.ItemIndicator>
                          <DropdownMenu.ItemLabel>{formatOptionLabel(property)}</DropdownMenu.ItemLabel>
                        </DropdownMenu.CheckboxItem>
                      )}
                    </For>
                    <DropdownMenu.Separator class="gradient-picker-menu__separator" />
                    <DropdownMenu.Item class="gradient-picker-menu__item" onSelect={addStopFromMenu}>
                      Add Stop
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      class="gradient-picker-menu__item"
                      disabled={stops().length <= 1}
                      onSelect={removeActiveStop}
                    >
                      Remove Stop
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
              <Dialog.CloseButton class="gradient-picker-icon-button" aria-label="Close gradient picker">
                <CheckIcon />
              </Dialog.CloseButton>
            </div>
          </header>

          <div class="gradient-picker-stops">
            <div
              class="gradient-picker-stops__bar"
              data-gradient-bar
              onClick={handleBarClick}
              style={{ background: `linear-gradient(to right, ${sortedStops().map((stop) => `${colorCss(stop.color)} ${stop.position * 100}%`).join(", ")})` }}
            />
            <For each={sortedStops()}>
              {(stop) => (
                <button
                  type="button"
                  aria-label={`Gradient stop ${Math.round(stop.position * 100)}%`}
                  aria-pressed={activeStopId() === stop.id}
                  onClick={(event) => { event.stopPropagation(); setActiveStopId(stop.id); }}
                  onPointerDown={(event) => beginStopDrag(stop.id, event)}
                  class="gradient-picker-stops__handle"
                  classList={{
                    "gradient-picker-stops__handle--active": activeStopId() === stop.id,
                    "gradient-picker-stops__handle--dragging": draggingStopId() === stop.id,
                  }}
                  style={{ left: `${stop.position * 100}%` }}
                >
                  <span class="gradient-picker-stops__swatch" style={{ background: colorCss(stop.color) }} />
                  <span class="gradient-picker-stops__caret" />
                </button>
              )}
            </For>
          </div>

          <Show when={activeStop()}>
            {(stop) => (
              <div class="gradient-picker-color">
                <div class="gradient-picker-color__preview">
                  <ColorSwatch class="gradient-picker-color__swatch" value={activeColor()} aria-label="Selected stop color" />
                  <span>{Math.round(stop().position * 100)}%</span>
                </div>
                <ColorArea
                  class="gradient-picker-color-area"
                  colorSpace="hsb"
                  xChannel="saturation"
                  yChannel="brightness"
                  value={activeColor()}
                  onChange={(color) => updateActiveKobalteColor(color, false)}
                  onChangeEnd={(color) => updateActiveKobalteColor(color, true)}
                >
                  <ColorArea.Background class="gradient-picker-color-area__background" />
                  <ColorArea.Thumb class="gradient-picker-color-area__thumb" />
                  <ColorArea.HiddenInputX />
                  <ColorArea.HiddenInputY />
                </ColorArea>
                <ColorSlider
                  class="gradient-picker-color-slider"
                  colorSpace="hsb"
                  channel="hue"
                  value={activeColor()}
                  onChange={(color) => updateActiveKobalteColor(color, false)}
                  onChangeEnd={(color) => updateActiveKobalteColor(color, true)}
                >
                  <ColorSlider.Label class="gradient-picker-color-slider__label">Hue</ColorSlider.Label>
                  <ColorSlider.Track class="gradient-picker-color-slider__track gradient-picker-color-slider__track--hue">
                    <ColorSlider.Thumb class="gradient-picker-color-slider__thumb">
                      <ColorSlider.Input />
                    </ColorSlider.Thumb>
                  </ColorSlider.Track>
                </ColorSlider>
                <ColorSlider
                  class="gradient-picker-color-slider"
                  colorSpace="hsb"
                  channel="alpha"
                  value={activeColor()}
                  onChange={(color) => updateActiveKobalteColor(color, false)}
                  onChangeEnd={(color) => updateActiveKobalteColor(color, true)}
                >
                  <ColorSlider.Label class="gradient-picker-color-slider__label">
                    Alpha <span>{Math.round(stop().color[3] * 100)}%</span>
                  </ColorSlider.Label>
                  <ColorSlider.Track
                    class="gradient-picker-color-slider__track gradient-picker-color-slider__track--alpha"
                    style={{ "--gradient-picker-alpha-color": colorCss([stop().color[0], stop().color[1], stop().color[2], 1]) }}
                  >
                    <ColorSlider.Thumb class="gradient-picker-color-slider__thumb">
                      <ColorSlider.Input />
                    </ColorSlider.Thumb>
                  </ColorSlider.Track>
                </ColorSlider>
                <ColorField
                  class="gradient-picker-color-field"
                  value={activeColor().toString("hexa")}
                  onChange={updateActiveTextColor}
                >
                  <ColorField.Label class="gradient-picker-color-field__label">Color</ColorField.Label>
                  <ColorField.Input
                    class="gradient-picker-color-field__input"
                    onBlur={() => props.onCommit()}
                  />
                </ColorField>
              </div>
            )}
          </Show>

          <SegmentedControl
            class="gradient-picker-mode"
            value={props.layer.gradientConfig.kind}
            onChange={(value) => value && setKind(value as GradientKind)}
          >
            <For each={gradientKinds}>
              {([kind, label]) => (
                <SegmentedControl.Item class="gradient-picker-mode__item" value={kind}>
                  <SegmentedControl.ItemInput />
                  <SegmentedControl.ItemLabel>{label}</SegmentedControl.ItemLabel>
                </SegmentedControl.Item>
              )}
            </For>
          </SegmentedControl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
