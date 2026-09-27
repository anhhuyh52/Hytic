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

export function SpotlightKnob(props: KnobProps) {
  return (
    <FxVerticalKnob
      {...props}
      perfId={`spotlight-knob:${props.label}`}
      gradient={["#ffe2a3", "#ffc04d", "#f5a000"]}
    />
  );
}
