import { describe, expect, it } from "vitest";
import { createGradientOverlayLayer } from "../../features/overlays/editorOverlayTypes";
import {
  linearEndpointUv,
  radialHandleUv,
  resizeLinearFromEndpoint,
  resizeRadialFromHandle,
} from "./gradientTransformGeometry";

describe("gradient transform geometry", () => {
  it("keeps the opposite linear endpoint fixed on a non-square image", () => {
    const layer = createGradientOverlayLayer();
    const aspect = 2;
    const fixed = linearEndpointUv(layer, "w", aspect);
    const patch = resizeLinearFromEndpoint(layer, "e", [0.5, 1.5], aspect);
    const next = { ...layer, ...patch };
    expect(linearEndpointUv(next, "w", aspect)[0]).toBeCloseTo(fixed[0]);
    expect(linearEndpointUv(next, "w", aspect)[1]).toBeCloseTo(fixed[1]);
    expect(linearEndpointUv(next, "e", aspect)).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
    expect(linearEndpointUv(next, "e", aspect)[0]).toBeCloseTo(0.5);
    expect(linearEndpointUv(next, "e", aspect)[1]).toBeCloseTo(1.5);
  });

  it("keeps the opposite radial side fixed while resizing", () => {
    const layer = { ...createGradientOverlayLayer(), gradientConfig: { ...createGradientOverlayLayer().gradientConfig, kind: "radial" as const } };
    const aspect = 1.5;
    const fixed = radialHandleUv(layer, "w", aspect);
    const patch = resizeRadialFromHandle(layer, "e", [1.4, 0.8], aspect, { alt: false, shift: false, constrainRotation: false });
    const next = { ...layer, ...patch };
    expect(radialHandleUv(next, "w", aspect)[0]).toBeCloseTo(fixed[0]);
    expect(radialHandleUv(next, "w", aspect)[1]).toBeCloseTo(fixed[1]);
    expect(radialHandleUv(next, "e", aspect)[0]).toBeCloseTo(1.4);
    expect(radialHandleUv(next, "e", aspect)[1]).toBeCloseTo(0.8);
  });
});
