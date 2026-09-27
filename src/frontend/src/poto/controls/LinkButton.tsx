/**
 * Legacy `link-button`: a small chain toggle. When linked, the Refraction panel
 * keeps its shadow and highlight hexagons in sync.
 */
export function LinkButton(props: {
  linked: boolean;
  title?: string;
  onToggle: (linked: boolean) => void;
}) {
  return (
    <button
      type="button"
      class="poto-linkbtn"
      classList={{ linked: props.linked }}
      title={props.title ?? "Link controls"}
      aria-pressed={props.linked}
      onClick={() => props.onToggle(!props.linked)}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9.5 12.5h5" />
        <path d="M9 8H7a4 4 0 0 0 0 8h2" />
        <path d="M15 8h2a4 4 0 0 1 0 8h-2" />
      </svg>
    </button>
  );
}
