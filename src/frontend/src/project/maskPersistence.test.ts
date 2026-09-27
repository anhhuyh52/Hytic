import { describe, expect, it } from "vitest";
import {
  cloneColorState,
  cloneEditState,
  DEFAULT_COLOR_STATE,
  DEFAULT_EDIT_STATE,
  type BrushMaskComponent,
  type DepthMaskComponent,
} from "../engine/state/EditState";
import { deserializeEditState } from "./deserializeEditState";
import { serializeEditState } from "./serializeEditState";

describe("mask persistence", () => {
  it("round-trips brush strokes and depth mask parameters", () => {
    const brush: BrushMaskComponent = {
      id: "brush-component",
      type: "brush",
      brush: [
        {
          id: "stroke-1",
          mode: "erase",
          points: [
            { x: 0.2, y: 0.3, pressure: 0.4, time: 10 },
            { x: 0.6, y: 0.7, pressure: 0.8, time: 20 },
          ],
          radius: 0.12,
          opacity: 0.75,
          hardness: 0.35,
          masking: 1,
          spacing: 0.2,
          interpolate: true,
          randomize: 0,
        },
      ],
      brush_radius: 0.18,
      brush_opacity: 0.65,
      brush_hardness: 0.45,
      brush_masking: 1,
      brush_erase: true,
      invert: true,
      opacity: 0.9,
      alpha: 0.8,
      mode: "mask",
      showOverlay: true,
    };
    const depth: DepthMaskComponent = {
      id: "depth-component",
      type: "depth",
      target: 0.42,
      range: 0.16,
      invert: true,
      opacity: 0.7,
      alpha: 0.6,
      showOverlay: false,
    };
    const state = cloneEditState(DEFAULT_EDIT_STATE);
    state.localAdjustments = [
      {
        id: "brush-layer",
        name: "Brush Mask",
        enabled: true,
        components: [brush],
        adjustments: cloneColorState(DEFAULT_COLOR_STATE),
      },
      {
        id: "depth-layer",
        name: "Depth Mask",
        enabled: true,
        components: [depth],
        adjustments: cloneColorState(DEFAULT_COLOR_STATE),
      },
    ];

    const restored = deserializeEditState(serializeEditState(state));

    expect(restored.localAdjustments[0]?.components[0]).toEqual(brush);
    expect(restored.localAdjustments[1]?.components[0]).toEqual(depth);
  });
});
