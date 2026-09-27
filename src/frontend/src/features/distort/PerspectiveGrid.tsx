type Rect = { left: number; top: number; width: number; height: number };

const DEFAULT_DIVISIONS = 9;

/**
 * Visual-only alignment grid for the Distort window, matching the reference
 * screen-pass grid (`fract(coord * grid_size)`): straight, evenly spaced
 * lines covering the whole image rect — a fixed reference to line the photo
 * up against, never warped with the quad. SVG with transparent background —
 * it never touches the image canvas or the WebGL/export pipeline.
 */
export function PerspectiveGrid(props: {
  rect: Rect;
  visible: boolean;
  cols?: number;
  rows?: number;
}) {
  const ticks = (divisions?: number) => {
    const count = divisions && divisions > 0 ? divisions : DEFAULT_DIVISIONS;
    return Array.from({ length: count + 1 }, (_, index) => index / count);
  };

  return (
    <svg class="perspective-grid" aria-hidden="true">
      {props.visible && (
        <>
          {ticks(props.cols).map((t) => (
            <line
              class="perspective-grid__line"
              x1={props.rect.left + t * props.rect.width}
              y1={props.rect.top}
              x2={props.rect.left + t * props.rect.width}
              y2={props.rect.top + props.rect.height}
            />
          ))}
          {ticks(props.rows).map((t) => (
            <line
              class="perspective-grid__line"
              x1={props.rect.left}
              y1={props.rect.top + t * props.rect.height}
              x2={props.rect.left + props.rect.width}
              y2={props.rect.top + t * props.rect.height}
            />
          ))}
        </>
      )}
    </svg>
  );
}
