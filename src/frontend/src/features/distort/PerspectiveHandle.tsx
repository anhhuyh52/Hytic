import type { JSX } from "solid-js";
import type { PerspectiveHandleId } from "./distortTypes";

export function PerspectiveHandle(props: {
  id: PerspectiveHandleId;
  x: number;
  y: number;
  disabled?: boolean;
  onPointerDown: JSX.EventHandlerUnion<HTMLButtonElement, PointerEvent>;
}) {
  return (
    <button
      type="button"
      class="perspective-handle"
      data-handle={props.id}
      aria-label={`Perspective ${props.id}`}
      disabled={props.disabled}
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
      }}
      onPointerDown={props.onPointerDown}
    />
  );
}
