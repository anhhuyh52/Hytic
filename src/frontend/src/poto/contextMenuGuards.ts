const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_PX = 5;

type Cleanup = () => void;

export function preventNativeDefault(event: Event) {
  event.preventDefault();
}

export function consumeContextMenuEvent(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function installAppContextMenuGuards(root: HTMLElement): Cleanup {
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let target: EventTarget | null = null;

  const clearLongPress = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    target = null;
    document.removeEventListener("touchmove", onTouchMove, true);
    document.removeEventListener("touchend", clearLongPress, true);
    document.removeEventListener("touchcancel", clearLongPress, true);
  };

  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) {
      clearLongPress();
      return;
    }
    if (
      Math.abs(touch.clientX - startX) > LONG_PRESS_MOVE_PX ||
      Math.abs(touch.clientY - startY) > LONG_PRESS_MOVE_PX
    ) {
      clearLongPress();
    }
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || isEditableTarget(event.target)) return;

    target = event.target;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    timer = window.setTimeout(() => {
      const dispatchTarget = target;
      clearLongPress();
      dispatchTarget?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: startX,
          clientY: startY,
          button: 2,
        }),
      );
    }, LONG_PRESS_MS);

    document.addEventListener("touchmove", onTouchMove, true);
    document.addEventListener("touchend", clearLongPress, true);
    document.addEventListener("touchcancel", clearLongPress, true);
  };

  root.addEventListener("contextmenu", preventNativeDefault);
  root.addEventListener("touchstart", onTouchStart, true);
  window.addEventListener("dragover", preventNativeDefault);
  window.addEventListener("drop", preventNativeDefault);

  return () => {
    clearLongPress();
    root.removeEventListener("contextmenu", preventNativeDefault);
    root.removeEventListener("touchstart", onTouchStart, true);
    window.removeEventListener("dragover", preventNativeDefault);
    window.removeEventListener("drop", preventNativeDefault);
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
  );
}
