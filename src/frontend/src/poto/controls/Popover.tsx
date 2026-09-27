import { onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { consumeContextMenuEvent } from "../contextMenuGuards";

/**
 * Port of the legacy popup positioning (`openNextTo(target, { x, y, margin })`).
 * Renders into a body portal so the top-bar's overflow can't clip it, anchors to a
 * target element, and closes on outside-pointerdown / Escape. The legacy top-bar
 * opens both the side-menu and export popups with { x: "center", y: "bottom",
 * margin: 12 }; that's the default here.
 */
export type PopoverAlign = {
  x: "center" | "left" | "right";
  y: "bottom" | "top";
  margin: number;
};

const DEFAULT_ALIGN: PopoverAlign = { x: "center", y: "bottom", margin: 12 };

export function Popover(props: {
  anchor: HTMLElement;
  onClose: () => void;
  align?: PopoverAlign;
  centerOnMobile?: boolean;
  onRightClick?: (event: MouseEvent) => void;
  class?: string;
  children: JSX.Element;
}) {
  let el: HTMLDivElement | undefined;

  function position() {
    if (!el || !props.anchor?.isConnected) return;
    const align = props.align ?? DEFAULT_ALIGN;
    const a = props.anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    const centerOnMobile = props.centerOnMobile ?? true;
    if (centerOnMobile && window.innerWidth <= window.innerHeight) {
      const left = Math.max(
        pad,
        Math.min((window.innerWidth - w) * 0.5, window.innerWidth - w - pad),
      );
      const top = Math.max(pad, window.innerHeight - h - align.margin);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      return;
    }
    let left =
      align.x === "center"
        ? a.left + a.width / 2 - w / 2
        : align.x === "left"
          ? a.left
          : a.right - w;
    let top = align.y === "bottom" ? a.bottom + align.margin : a.top - h - align.margin;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  onMount(() => {
    position();
    // Re-position once the content has laid out (size known).
    requestAnimationFrame(position);

    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el?.contains(t) || props.anchor?.contains(t)) return;
      props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    // Defer the outside-click listener so the click that opened the popover
    // doesn't immediately close it.
    const timer = setTimeout(() => document.addEventListener("pointerdown", onPointer, true), 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", position, true);
    window.addEventListener("scroll", position, true);

    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", position, true);
      window.removeEventListener("scroll", position, true);
    });
  });

  return (
    <Portal>
      <div
        ref={el}
        class={`poto-popover ${props.class ?? ""}`}
        role="dialog"
        onContextMenu={(event) => {
          if (props.onRightClick) {
            consumeContextMenuEvent(event);
            props.onRightClick(event);
            return;
          }
          event.preventDefault();
        }}
      >
        {props.children}
      </div>
    </Portal>
  );
}
