import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT_STATE } from "../engine/state/EditState";
import { toPlainSerializedEditState } from "../project/serializeEditState";
import { buildMediaEditPatch, mergeMediaEditPatch } from "./mediaEditPatch";

function defaultSerializedState() {
  return toPlainSerializedEditState(DEFAULT_EDIT_STATE);
}

describe("mediaEditPatch", () => {
  it("always carries preset identity and only selected modules", () => {
    const source = defaultSerializedState();
    source.exposure!.enabled = true;
    source.transform.orientation = 90;

    const patch = buildMediaEditPatch(source, ["exposure"]);

    expect(patch).toEqual({ preset: source.preset, exposure: source.exposure });
    expect(patch).not.toHaveProperty("transform");
  });

  it("copies only the selected color-management side", () => {
    const source = defaultSerializedState();
    const patch = buildMediaEditPatch(source, ["idt"]);
    const colorManagement = source.colorManagement!;

    expect(patch.colorManagement).toEqual({
      enabled: colorManagement.enabled,
      inputColorSpace: colorManagement.inputColorSpace,
      inputColorSpaceId: colorManagement.inputColorSpaceId,
    });
    expect(patch.colorManagement).not.toHaveProperty("displayColorSpaceId");
  });

  it("copies masks/local adjustments when selected", () => {
    const source = defaultSerializedState();
    source.localAdjustments = [
      {
        id: "mask-1",
        name: "Local Mask",
        enabled: true,
        components: [
          {
            id: "comp-1",
            type: "gradient",
            startPoint: [0.5, 0.75],
            endPoint: [0.5, 0.25],
            reflect: false,
            invert: false,
            opacity: 1,
            alpha: 1,
          },
        ],
        adjustments: {
          curve: source.curve,
          contrast: source.contrast,
          balance: source.balance,
          scattering: source.scattering,
          refraction: source.refraction,
          saturation: source.saturation,
          rgbMixer: source.rgbMixer,
          densityChroma: source.densityChroma,
          radiance: source.radiance,
          tone: source.tone,
          shadowHighlight: source.shadowHighlight,
          exposure: source.exposure,
        },
      } as any,
    ];

    const patch = buildMediaEditPatch(source, ["masks"]);

    expect(patch.localAdjustments).toEqual(source.localAdjustments);
  });

  it("copies Spot Removal state when retouch is selected", () => {
    const source = defaultSerializedState();
    source.retouch!.spots = [
      {
        id: "retouch-test-1",
        type: "spot",
        position: [0, 0],
        sourcePosition: [0.2, 0.2],
        size: [0.1, 0.2],
        angle: 0,
        feather: 0.4,
        opacity: 1,
        mode: 1,
      },
    ];

    const patch = buildMediaEditPatch(source, ["retouch"]);

    expect(patch.retouch).toEqual(source.retouch);
  });

  it("preserves the unselected density/chroma sibling when merging", () => {
    const source = defaultSerializedState();
    const target = defaultSerializedState();
    source.densityChroma.density!.points[0].y = 0.8;
    source.densityChroma.chroma!.points[0].y = 0.9;
    target.densityChroma.density!.points[0].y = 0.1;
    target.densityChroma.chroma!.points[0].y = 0.2;

    const result = mergeMediaEditPatch(target, buildMediaEditPatch(source, ["density"]));

    expect(result.densityChroma.density!.points[0].y).toBe(0.8);
    expect(result.densityChroma.chroma!.points[0].y).toBe(0.2);
    expect(target.densityChroma.density!.points[0].y).toBe(0.1);
  });
});
