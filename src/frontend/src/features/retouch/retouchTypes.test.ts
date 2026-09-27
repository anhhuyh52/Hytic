import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT_STATE, cloneEditState } from "../../engine/state/EditState";
import { deserializeEditState } from "../../project/deserializeEditState";
import { serializeEditState } from "../../project/serializeEditState";
import { createRetouchSpot } from "./retouchStore";

describe("retouch spot state", () => {
  it("creates an aspect-corrected Heal spot with the confirmed defaults", () => {
    const spot = createRetouchSpot({
      imageWidth: 4000,
      imageHeight: 2000,
      zoom: 1,
      cropWidth: 1,
      cropHeight: 1,
    });

    expect(spot.mode).toBe(1);
    expect(spot.id).toEqual(expect.any(String));
    expect(spot.feather).toBe(0.4);
    expect(spot.opacity).toBe(1);
    expect(spot.position).toEqual([0, 0]);
    expect(spot.sourcePosition).toEqual([0.2, 0.2]);
    expect(spot.size).toEqual([0.1, 0.2]);
  });

  it("round-trips spots through project serialization without sharing tuple references", () => {
    const state = cloneEditState(DEFAULT_EDIT_STATE);
    state.retouch.spots = [
      createRetouchSpot({
        imageWidth: 3000,
        imageHeight: 2000,
        zoom: 2,
        cropWidth: 0.8,
        cropHeight: 0.6,
      }),
    ];
    state.retouch.spots[0].angle = 27;
    state.retouch.spots[0].mode = 0;

    const restored = deserializeEditState(serializeEditState(state));

    expect(restored.retouch).toEqual(state.retouch);
    expect(restored.retouch.spots[0].position).not.toBe(state.retouch.spots[0].position);
    expect(restored.retouch.spots[0].sourcePosition).not.toBe(
      state.retouch.spots[0].sourcePosition,
    );
    expect(restored.retouch.spots[0].size).not.toBe(state.retouch.spots[0].size);
  });

  it("fills the neutral retouch state for older projects", () => {
    const serialized = serializeEditState(DEFAULT_EDIT_STATE);
    delete serialized.retouch;

    expect(deserializeEditState(serialized).retouch).toEqual({
      enabled: true,
      bypass: false,
      spots: [],
    });
  });

  it("assigns a stable id when loading legacy id-less spots", () => {
    const state = cloneEditState(DEFAULT_EDIT_STATE);
    state.retouch.spots = [createRetouchSpot()];
    const serialized = serializeEditState(state);
    delete (serialized.retouch!.spots[0] as { id?: string }).id;

    const restored = deserializeEditState(serialized);

    expect(restored.retouch.spots[0].id).toEqual(expect.any(String));
    expect(restored.retouch.spots[0].id.length).toBeGreaterThan(0);
  });
});
