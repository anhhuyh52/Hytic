/* eslint-disable solid/no-innerhtml -- Templates are application-owned; dynamic labels are escaped. */
import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { consumeContextMenuEvent } from "../contextMenuGuards";

export type ContextMenuAction = {
  action?: (target: HTMLElement, event: MouseEvent) => void;
  disabled?: (target: HTMLElement) => boolean;
  render?: (target: HTMLElement) => string | false | void;
};

export type ContextMenuState = {
  x: number;
  y: number;
  html: string;
  actions: Record<string, ContextMenuAction>;
  returnFocus?: HTMLElement;
};

type ContextMenuProps = {
  state: ContextMenuState;
  onClose(): void;
};

export function openContextMenu(
  event: MouseEvent,
  html: string,
  actions: Record<string, ContextMenuAction>,
): ContextMenuState {
  consumeContextMenuEvent(event);
  return {
    x: event.clientX,
    y: event.clientY,
    html,
    actions,
    returnFocus: event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined,
  };
}

export function ContextMenu(props: ContextMenuProps) {
  let menuRef!: HTMLElement;
  let closeTimer: number | undefined;
  // `active` is true while a menu is open and accepting dismissal; it flips to
  // false the moment a close begins so the lifetime-scoped global listeners stop
  // acting, and back to true whenever a new state opens (including A→B reopens
  // where <Show> keeps this same component instance mounted).
  let active = false;
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [ready, setReady] = createSignal(false);
  const [closing, setClosing] = createSignal(false);

  function finishClose(): void {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    closeTimer = undefined;
    props.onClose();
  }

  function requestClose(): void {
    if (!active) return;
    active = false;
    menuRef.dataset.closing = "true";
    setClosing(true);
    setReady(false);
    closeTimer = window.setTimeout(finishClose, 180);
  }

  const actionableItems = () =>
    Array.from(
      menuRef.querySelectorAll<HTMLElement>(
        "[data-action]:not([disabled]):not([selected]):not(.none)",
      ),
    );

  function prepareMenu(state: ContextMenuState): void {
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const bounds = menuRef.getBoundingClientRect();
    const gutter = 6;
    setPosition({
      x: Math.max(
        viewportLeft + gutter,
        Math.min(state.x, viewportLeft + viewportWidth - bounds.width - gutter),
      ),
      y: Math.max(
        viewportTop + gutter,
        Math.min(state.y, viewportTop + viewportHeight - bounds.height - gutter),
      ),
    });
    menuRef.setAttribute("role", "menu");
    for (const item of actionableItems()) {
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
    }
    menuRef.tabIndex = -1;
    menuRef.focus({ preventScroll: true });
    setReady(true);
  }

  createEffect(() => {
    const state = props.state;
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    closeTimer = undefined;
    active = true;
    if (menuRef) delete menuRef.dataset.closing;
    setClosing(false);
    setReady(false);
    queueMicrotask(() => {
      if (!active) return;
      for (const [actionName, action] of Object.entries(state.actions)) {
        const nodes = menuRef.querySelectorAll<HTMLElement>(`[data-action="${actionName}"]`);
        nodes.forEach((node) => {
          node.removeAttribute("disabled");
          node.classList.remove("none");
          if (action.disabled?.(node)) node.setAttribute("disabled", "");
          const rendered = action.render?.(node);
          if (rendered === false) {
            node.classList.add("none");
          } else if (typeof rendered === "string") {
            node.innerHTML = rendered;
          }
        });
      }
      prepareMenu(state);
    });
  });

  const onClick: JSX.EventHandlerUnion<HTMLElement, MouseEvent> = (event) => {
    event.stopPropagation();
    if (!active) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-action]:not([disabled]):not([selected])",
    );
    if (!target || !menuRef.contains(target)) return;
    const actionName = target.dataset.action;
    if (!actionName) return;
    // Close first: an action may remove the element/component that owns this menu
    // (for example, deleting an overlay layer). Running the action before starting
    // dismissal leaves the menu handling a click after its owner has been disposed.
    const action = props.state.actions[actionName]?.action;
    const radio = target.closest("context-radio");
    if (radio) {
      radio.querySelectorAll("context-item").forEach((item) => item.removeAttribute("selected"));
      target.setAttribute("selected", "");
    }
    requestClose();
    action?.(target, event);
  };

  const onContextMenu: JSX.EventHandlerUnion<HTMLElement, MouseEvent> = (event) => {
    if (!active) return;
    consumeContextMenuEvent(event);
  };

  const onMenuKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent> = (event) => {
    const items = actionableItems();
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown")
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") {
      nextIndex =
        currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      items[nextIndex]?.focus({ preventScroll: true });
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && currentIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      items[currentIndex]?.click();
    }
  };

  // Global dismissal listeners are attached once for the component's lifetime so
  // they survive A→B reopens (where <Show> keeps this instance mounted) and are
  // never torn down by a close. They no-op unless a menu is currently `active`,
  // and re-arm automatically because the setup effect above sets `active = true`
  // for each new state.
  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (active && !menuRef.contains(event.target as Node)) requestClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (active && event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    const closeForViewportChange = () => {
      if (active) requestClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("scroll", closeForViewportChange, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("scroll", closeForViewportChange, true);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    });
  });

  createEffect(() => {
    // Capture returnFocus now: the onCleanup below runs during unmount, when
    // reading the reactive `props.state` would hit a stale <Show> accessor
    // (the parent has already cleared the menu signal) and throw — which would
    // corrupt <Show>'s disposal and leave the menu stuck, unable to reopen.
    const returnFocus = props.state.returnFocus;
    onCleanup(() => {
      if (menuRef && menuRef.contains(document.activeElement)) {
        returnFocus?.focus({ preventScroll: true });
      }
    });
  });

  return (
    <context-menu
      ref={(el) => (menuRef = el)}
      classList={{
        "poto-context-menu": true,
        "is-ready": ready(),
        "is-closing": closing(),
      }}
      style={{ left: `${position().x}px`, top: `${position().y}px` }}
      innerHTML={props.state.html}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onMenuKeyDown}
    />
  );
}
