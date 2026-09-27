/**
 * Port of the legacy `undo-redo` custom element (`pi`). Three icon buttons:
 *   - undo  (revert_icon)  — `disabled` when !canUndo, click → onUndo
 *   - history (down_arrow) — click → onOpenHistory(anchor) (timeline/versions popup)
 *   - redo  (revert_icon, mirrored) — hidden via `none` when !canRedo, click → onRedo
 *
 * The legacy element drives undo/redo enablement off the global history event `B`
 * ({ canUndo, canRedo }); here those come in as reactive props from PotoApp's
 * history state, so the chrome stays in sync as panel edits push history.
 */
export function UndoRedo(props: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenHistory: (anchor: HTMLElement) => void;
  onOpenFeedback: (anchor: HTMLElement) => void;
}) {
  let historyImg: HTMLImageElement | undefined;
  let feedbackButton: HTMLButtonElement | undefined;
  return (
    <undo-redo class="mg-r-auto">
      <img
        class="undo-redo__btn"
        src="/assets/icons/revert_icon.svg"
        title="Undo (Ctrl + Z)"
        alt="Undo"
        draggable={false}
        aria-disabled={props.canUndo ? "false" : "true"}
        classList={{ "is-disabled": !props.canUndo }}
        onClick={() => props.canUndo && props.onUndo()}
      />
      <img
        ref={historyImg}
        class="undo-redo__btn undo-redo__history"
        src="/assets/icons/down_arrow.svg"
        title="History Timeline & Versions"
        alt="History"
        draggable={false}
        onClick={() => historyImg && props.onOpenHistory(historyImg)}
      />
      <img
        class="undo-redo__btn undo-redo__redo"
        classList={{ none: !props.canRedo }}
        src="/assets/icons/revert_icon.svg"
        title="Redo (Ctrl + Y)"
        alt="Redo"
        draggable={false}
        onClick={() => props.canRedo && props.onRedo()}
      />
      <button
        ref={feedbackButton}
        type="button"
        class="undo-redo__btn undo-redo__feedback"
        title="Report an issue or suggestion"
        aria-label="Report an issue or suggestion"
        onClick={() => feedbackButton && props.onOpenFeedback(feedbackButton)}
      >
        <img src="/assets/icons/help_icon.svg" alt="" draggable={false} />
      </button>
    </undo-redo>
  );
}
