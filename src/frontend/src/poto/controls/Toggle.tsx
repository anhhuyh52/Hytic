/** Poto-style labeled on/off toggle row. */
export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      class="poto-toggle poto-toggle"
      classList={{ checked: props.checked }}
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="poto-toggle__label">{props.label}</span>
      <span class="poto-toggle__switch" aria-hidden="true" />
    </button>
  );
}
