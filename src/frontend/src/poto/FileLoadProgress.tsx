import { createEffect, on, onCleanup, Show } from "solid-js";

/**
 * Batch-import progress toast, ported from the legacy `<file-load-progress>`
 * custom element (package.min.js). A top-center card shows "Importing X/Y" with
 * a spinner and an eased progress fill that sweeps left→right behind the text;
 * on completion it swaps to a success/error icon and a summary, then PotoApp
 * auto-hides it.
 *
 * The fill animation faithfully reproduces the legacy animator: each file step
 * eases the bar toward `index/total` with an easeOutQuint curve over 5s, and a
 * step that arrives mid-ease snaps to its target before starting the next — so a
 * slow decode visibly creeps forward while a fast burst still reads as discrete.
 */
export type FileLoadProgressStatus = "idle" | "loading" | "success" | "error" | "partial";

export interface FileLoadProgressProps {
  active: () => boolean;
  /** Total files in the current import session. */
  total: () => number;
  /** 1-based index of the file currently processing (drives the eased bar). */
  index: () => number;
  status: () => FileLoadProgressStatus;
  title: () => string;
  info: () => string;
}

export function FileLoadProgress(props: FileLoadProgressProps) {
  let barEl: HTMLDivElement | undefined;

  // ── easeOutQuint progress animator (legacy file-load-progress) ────────────
  const DURATION = 5000;
  let total = 1; // legacy `t`
  let from = 0; // legacy `i` — last settled file index
  let to = 0; // legacy `o` — current target index
  let startT = 0; // legacy `s`
  let raf = 0; // legacy `a`

  const emit = (v: number) =>
    barEl?.style.setProperty("--progress", String(v < 0 ? 0 : v > 1 ? 1 : v));

  const tick = (now: number) => {
    const e = 1 - Math.pow(1 - Math.min(1, (now - startT) / DURATION), 5);
    emit((from + e * (to - from)) / total);
    if (e < 1) raf = requestAnimationFrame(tick);
    else {
      from = to;
      raf = 0;
    }
  };

  // legacy `_r`: settle the in-flight segment, then ease one file forward.
  const advance = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      from = to;
      emit(from / total);
    }
    if (from + 1 <= total) {
      to = from + 1;
      startT = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  // legacy `vr`: update the total without losing settled progress.
  const setTotal = (n: number) => {
    total = Math.max(1, n);
    emit(from / total);
  };

  const finish = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    from = total;
    to = total;
    emit(1);
  };

  const reset = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    total = 1;
    from = 0;
    to = 0;
    emit(0);
  };

  // Fresh session → reset and seed the total.
  createEffect(
    on(props.active, (active, prev) => {
      if (active && !prev) {
        reset();
        setTotal(props.total());
      }
    }),
  );

  // Files added mid-session grow the total.
  createEffect(on(props.total, (n) => props.active() && setTotal(n), { defer: true }));

  // Each file start advances the bar one step.
  createEffect(
    on(
      props.index,
      (i, prev) => {
        if (props.active() && i > 0 && i !== prev) advance();
      },
      { defer: true },
    ),
  );

  // Final state snaps the bar to 100%.
  createEffect(
    on(
      props.status,
      (st) => {
        if (st === "success" || st === "error" || st === "partial") finish();
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
  });

  const done = () => props.status() === "success";
  const failed = () => props.status() === "error" || props.status() === "partial";

  return (
    <Show when={props.active()}>
      <div
        class="poto-file-progress"
        classList={{
          "poto-file-progress--done": done(),
          "poto-file-progress--error": failed(),
        }}
        role="status"
        aria-live="polite"
      >
        <div ref={barEl} class="poto-file-progress__bar" aria-hidden="true" />
        <header class="poto-file-progress__head">
          <span class="poto-file-progress__title">{props.title()}</span>
          <Show when={props.status() === "loading"}>
            <div class="poto-file-progress__spinner" aria-hidden="true" />
          </Show>
          <Show when={done()}>
            <img
              src="/assets/icons/success_colored_icon.svg"
              alt=""
              class="poto-file-progress__icon"
            />
          </Show>
          <Show when={failed()}>
            <img
              src="/assets/icons/error_colored_icon.svg"
              alt=""
              class="poto-file-progress__icon"
            />
          </Show>
        </header>
        <Show when={props.info()}>
          <span class="poto-file-progress__info">{props.info()}</span>
        </Show>
      </div>
    </Show>
  );
}
