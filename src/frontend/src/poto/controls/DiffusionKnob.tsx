import { FxVerticalKnob } from "./FxVerticalKnob";

export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  default: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
  onChange?: (v: number) => void;
}

export function DiffusionKnob(props: KnobProps) {
  return (
    <FxVerticalKnob
      {...props}
      perfId={`diffusion-knob:${props.label}`}
      gradient={["#1a3a6e", "#3366ee", "#00aaff"]}
    />
  );
}
