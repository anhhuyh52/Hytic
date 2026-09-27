/*
 * JSX declarations for the legacy Poto custom elements so Solid TSX can
 * emit the exact legacy DOM (custom-element names + data-* / panel / open
 * hooks) without TypeScript errors. These are rendered as plain unknown
 * elements and styled by tag/attribute selectors in poto-*.css.
 */
import type { JSX } from "solid-js/jsx-runtime";

type CustomEl = JSX.HTMLAttributes<HTMLElement> & {
  // Permit the legacy hook attributes (panel, open, edited, type, data-*, ...)
  [key: string]: unknown;
};

declare module "solid-js/jsx-runtime" {
  namespace JSX {
    interface ImgHTMLAttributes<T> {
      selectable?: string;
    }

    interface IntrinsicElements {
      "poto-app": CustomEl;
      "top-bar": CustomEl;
      "undo-redo": CustomEl;
      "side-menu": CustomEl;
      "viewport-overlay": CustomEl;
      "start-screen": CustomEl;
      "overlay-view": CustomEl;
      "control-panel": CustomEl;
      "control-panel-header": CustomEl;
      "control-panel-button": CustomEl;
      "crop-edge": CustomEl;
      "crop-side": CustomEl;
      "crop-tool": CustomEl;
      "control-panel-content": CustomEl;
      "match-panel": CustomEl;
      "match-controls": CustomEl;
      "info-box": CustomEl;
      "progress-bar": CustomEl;
      "slider-controls": CustomEl;
      "reference-window": CustomEl;
      "preset-panel": CustomEl;
      "input-selector": CustomEl;
      "output-selector": CustomEl;
      "rolling-slider": CustomEl;
      "spline-interface": CustomEl;
      "curve-controls": CustomEl;
      "cardinal-slider": CustomEl;
      "cardinal-slider-inlay": CustomEl;
      "cardinal-slider-line": CustomEl;
      "color-wheel": CustomEl;
      "knob-control": CustomEl;
      "two-axis": CustomEl;
      "scope-view": CustomEl;
      "scroll-list": CustomEl;
      "context-menu": CustomEl;
      "context-title": CustomEl;
      "context-item": CustomEl;
      "context-separator": CustomEl;
      "context-radio": CustomEl;
      "version-snapshot": CustomEl;
      "preset-item": CustomEl;
      "preset-pack": CustomEl;
      "preset-generator": CustomEl;
      "preset-generator-grid": CustomEl;
      "generated-preset": CustomEl;
    }
  }
}
