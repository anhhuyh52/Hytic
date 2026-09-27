import { describe, expect, it } from "vitest";
import {
  cloneEditorOverlayLayer,
  createEditorOverlayLayer,
  createGradientOverlayLayer,
  deserializeEditorOverlays,
} from "./editorOverlayTypes";

function layer() {
  return createEditorOverlayLayer({
    name: "overlay.png", sourceId: "source", sourceDataUrl: "data:image/png;base64,AA==",
    width: 100, height: 100, imageAspect: 1,
  });
}

describe("editor overlay masks", () => {
  it("defaults new overlays to no mask", () => {
    expect(layer().mask).toBeNull();
  });

  it("deep-clones brush strokes per overlay", () => {
    const source = layer();
    source.mask = {
      id: "brush-1", type: "brush", brush_radius: 0.1, brush_opacity: 1,
      brush_hardness: 0, brush_masking: 0, brush_erase: false, invert: false,
      opacity: 1, alpha: 1, brush: [{ id: "stroke", mode: "mask", radius: 0.1,
        opacity: 1, hardness: 0, masking: 0, spacing: 0.25, interpolate: true,
        randomize: 0, points: [{ x: 0.5, y: 0.5, pressure: 1, time: 1 }] }],
    };
    const clone = cloneEditorOverlayLayer(source);
    (clone.mask as any).brush[0].points[0].x = 0;
    expect((source.mask as any).brush[0].points[0].x).toBe(0.5);
  });

  it("restores supported masks and rejects unknown mask types", () => {
    const source = layer();
    source.mask = { id: "lum", type: "luminance", target: 0.5, range: 0.4,
      smoothness: 0.2, invert: false, opacity: 1, alpha: 1 };
    expect(deserializeEditorOverlays([source])[0]?.mask?.type).toBe("luminance");
    expect(deserializeEditorOverlays([{ ...source, mask: { type: "object" } }])[0]?.mask).toBeNull();
  });
});

describe("gradient overlay layers", () => {
  it("creates an editable centered linear gradient", () => {
    const gradient = createGradientOverlayLayer();
    expect(gradient).toMatchObject({
      type: "gradient",
      position: [0.5, 0.5],
      scale: [1, 1],
      angle: 0,
      opacity: 1,
      fill: 1,
      blendMode: "NORMAL",
      gradientConfig: { kind: "linear", reverse: false, reflect: false, repeat: false },
    });
    expect(gradient.gradientConfig.stops).toHaveLength(2);
    expect(new Set(gradient.gradientConfig.stops.map((stop) => stop.id)).size).toBe(2);
  });

  it("normalizes malformed persisted stops and transform values", () => {
    const restored = deserializeEditorOverlays([{
      id: "gradient",
      type: "gradient",
      name: "Gradient",
      position: [2, -1],
      scale: [0, Number.NaN],
      angle: Number.POSITIVE_INFINITY,
      opacity: 4,
      fill: -2,
      blendMode: "COLOR",
      gradientConfig: {
        kind: "radial",
        stops: [
          { id: "same", position: 2, color: [2, -1, 0.5, 4] },
          { id: "same", position: -1, color: [0, 1, 1, 1] },
        ],
      },
    }])[0];
    expect(restored?.type).toBe("gradient");
    if (restored?.type !== "gradient") return;
    expect(restored.position).toEqual([2, -1]);
    expect(restored.scale).toEqual([0.0001, 1]);
    expect(restored.opacity).toBe(1);
    expect(restored.fill).toBe(0);
    expect(restored.gradientConfig.stops.map((stop) => stop.position)).toEqual([0, 1]);
    expect(new Set(restored.gradientConfig.stops.map((stop) => stop.id)).size).toBe(2);
  });

  it("keeps at least one valid stop", () => {
    const restored = deserializeEditorOverlays([{
      ...createGradientOverlayLayer(),
      gradientConfig: { kind: "luminance", stops: [], reverse: false, reflect: false, repeat: false },
    }])[0];
    expect(restored?.type === "gradient" && restored.gradientConfig.stops.length).toBeGreaterThan(0);
  });
});
