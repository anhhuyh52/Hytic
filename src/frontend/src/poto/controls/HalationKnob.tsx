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

export function HalationKnob(props: KnobProps) {
  return (
    <FxVerticalKnob
      {...props}
      perfId={`halation-knob:${props.label}`}
      gradient={["#ffb199", "#ff2200"]}
    />
  );
}
