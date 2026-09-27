import { Select } from "@kobalte/core/select";
import { createMemo } from "solid-js";
import { Dynamic } from "solid-js/web";
import { editState, setEditState } from "../../app/editor-store";
import { IDT_MENU, ODT_MENU, type ColorSpaceMenu } from "../../engine/color/colorSpaceCatalog";

type ColorSpaceOption = ColorSpaceMenu["options"][number];

type ColorSpaceSelectProps = {
  kind: "input" | "output";
  label: string;
  shortLabel: string;
  options: ColorSpaceMenu[];
  value: () => string;
  onChange: (value: string) => void;
};

function ColorSpaceSelect(props: ColorSpaceSelectProps) {
  const selectedOption = createMemo(() => {
    const value = props.value();
    return props.options.flatMap((group) => group.options).find((option) => option.id === value);
  });

  return (
    <Dynamic
      component={props.kind === "input" ? "input-selector" : "output-selector"}
      class="poto-space-chip"
      title={props.label}
    >
      <Select<ColorSpaceOption, ColorSpaceMenu>
        class="poto-space-select"
        options={props.options}
        optionValue="id"
        optionTextValue="label"
        optionGroupChildren="options"
        value={selectedOption()}
        onChange={(option) => option && props.onChange(option.id)}
        placement="bottom-start"
        sameWidth={false}
        aria-label={props.label}
        itemComponent={(itemProps) => (
          <Select.Item class="poto-space-select__item" item={itemProps.item}>
            <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
            <Select.ItemIndicator class="poto-space-select__item-indicator">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3 8.2 3.1 3.1L13 4.8" />
              </svg>
            </Select.ItemIndicator>
          </Select.Item>
        )}
        sectionComponent={(sectionProps) => (
          <Select.Section class="poto-space-select__section">
            {sectionProps.section.rawValue.group}
          </Select.Section>
        )}
      >
        <Select.HiddenSelect />
        <Select.Trigger class="poto-space-select__trigger">
          <span class="poto-space-select__label">{props.shortLabel}</span>
          <Select.Value<ColorSpaceOption> class="poto-space-select__value">
            {(state) => state.selectedOption().label}
          </Select.Value>
          <Select.Icon class="poto-space-select__icon">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content class="poto-space-select__content">
            <Select.Listbox class="poto-space-select__listbox" />
          </Select.Content>
        </Select.Portal>
      </Select>
    </Dynamic>
  );
}

export function InputSelector() {
  return (
    <ColorSpaceSelect
      kind="input"
      label="Input color space"
      shortLabel="Input"
      options={IDT_MENU}
      value={() => editState.colorManagement.inputColorSpaceId}
      onChange={(value) => setEditState("colorManagement", "inputColorSpaceId", value)}
    />
  );
}

export function OutputSelector() {
  return (
    <ColorSpaceSelect
      kind="output"
      label="Output color space"
      shortLabel="Output"
      options={ODT_MENU}
      value={() => editState.colorManagement.displayColorSpaceId}
      onChange={(value) => setEditState("colorManagement", "displayColorSpaceId", value)}
    />
  );
}
