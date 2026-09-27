import { For } from "solid-js";
import { Slider } from "../../poto/controls/Slider";

export type DistortSliderSpec = {
  key: "distortionAmount" | "distortionHorizontal" | "distortionVertical";
  label: string;
  title: string;
  value: number;
};

export function DistortSliderGroup(props: {
  sliders: DistortSliderSpec[];
  onInput: (key: DistortSliderSpec["key"], value: number) => void;
  onChange: (key: DistortSliderSpec["key"], value: number) => void;
}) {
  return (
    <div class="poto-distort-sliders">
      <For each={props.sliders}>
        {(slider) => (
          <Slider
            label={slider.label}
            min={-100}
            max={100}
            step={1}
            default={0}
            value={slider.value}
            bipolar
            hideValue
            title={slider.title}
            format={(value) => `${Math.round(value)}`}
            onInput={(value) => props.onInput(slider.key, value)}
            onChange={(value) => props.onChange(slider.key, value)}
          />
        )}
      </For>
    </div>
  );
}
