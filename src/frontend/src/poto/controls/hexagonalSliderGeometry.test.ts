import { describe, expect, it } from "vitest";
import {
  CENTER,
  DISTANCE_RANGE,
  getHexagonalSliderGeometry,
  hexagonalSliderPointerToPoint,
  hexagonalSliderPointToXY,
} from "./hexagonalSliderGeometry";

describe("hexagonalSliderGeometry", () => {
  it("uses the legacy clockwise polar convention", () => {
    const up = hexagonalSliderPointToXY([0, DISTANCE_RANGE], 40);
    const right = hexagonalSliderPointToXY([90, DISTANCE_RANGE], 40);

    expect(up.x).toBeCloseTo(CENTER);
    expect(up.y).toBeCloseTo(CENTER - 40);
    expect(right.x).toBeCloseTo(CENTER + 40);
    expect(right.y).toBeCloseTo(CENTER);
  });

  it("clamps pointer radius to the usable circle", () => {
    const point = hexagonalSliderPointerToPoint(100, 0, 40, {
      angle: 90,
      previous: 0,
      next: 180,
      initialRadius: 10,
    });

    expect(point?.[0]).toBeCloseTo(90);
    expect(point?.[1]).toBeCloseTo(DISTANCE_RANGE);
  });

  it("supports legacy modifier constraints", () => {
    const bounds = { angle: 60, previous: 0, next: 120, initialRadius: 20 };

    expect(hexagonalSliderPointerToPoint(10, -20, 40, bounds, true, true)).toBeNull();
    expect(hexagonalSliderPointerToPoint(30, 0, 40, bounds, false, true)?.[0]).toBeCloseTo(60);
    expect(hexagonalSliderPointerToPoint(30, 0, 40, bounds, true)?.[1]).toBeCloseTo(
      Math.pow(0.5, 1.8) * DISTANCE_RANGE,
    );
  });

  it("scales handle geometry with rendered size", () => {
    expect(getHexagonalSliderGeometry(190).pointRadius).toBeCloseTo((18 / 2) * (100 / 190));
    expect(getHexagonalSliderGeometry(0).usableRadius).toBe(CENTER);
  });
});
