import { describe, expect, it } from "vitest";
import { calculateAutoEnhance } from "./autoEnhance";

function solidPixels(r: number, g: number, b: number, count = 64): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index += 1) {
    pixels.set([r, g, b, 255], index * 4);
  }
  return pixels;
}

describe("calculateAutoEnhance", () => {
  it("raises a dark image without tinting monochrome pixels", () => {
    const result = calculateAutoEnhance(solidPixels(40, 40, 40));

    expect(result).not.toBeNull();
    expect(result!.exposure.curve.points[0].y).toBeGreaterThan(0.5);
    expect(result!.saturation.curve.points[0].y).toBe(0.5);
  });

  it("reduces exposure for a very bright image", () => {
    const result = calculateAutoEnhance(solidPixels(235, 235, 235));

    expect(result).not.toBeNull();
    expect(result!.exposure.curve.points[0].y).toBeLessThan(0.5);
  });

  it("returns null when there are no visible pixels", () => {
    expect(calculateAutoEnhance(new Uint8ClampedArray(16))).toBeNull();
  });
});
