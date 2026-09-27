import { describe, expect, it } from "vitest";
import {
  buildPerspectiveMatrix,
  calculateAutoCropForDistortion,
  defaultDistortionPoints,
  invertMat3,
  isValidQuad,
  limitDistortionPoints,
  normalizeDistortionSlider,
  normalizePerspectiveSlider,
  pointsEqualDefault,
  transformPoint,
} from "./distortMath";
import type { DistortionPoints } from "./distortTypes";

describe("distort math", () => {
  it("default points produce an identity perspective matrix", () => {
    const matrix = buildPerspectiveMatrix(defaultDistortionPoints());
    expect(matrix[0]).toBeCloseTo(1);
    expect(matrix[1]).toBeCloseTo(0);
    expect(matrix[2]).toBeCloseTo(0);
    expect(matrix[3]).toBeCloseTo(0);
    expect(matrix[4]).toBeCloseTo(1);
    expect(matrix[5]).toBeCloseTo(0);
    expect(matrix[6]).toBeCloseTo(0);
    expect(matrix[7]).toBeCloseTo(0);
    expect(matrix[8]).toBeCloseTo(1);
  });

  it("rejects invalid and self-crossing quads", () => {
    const crossed: DistortionPoints = [-1, -1, 1, 1, -1, 1, 1, -1];
    expect(isValidQuad(crossed)).toBe(false);
  });

  it("limits self-crossing points back to the previous valid quad", () => {
    const previous = defaultDistortionPoints();
    const crossed: DistortionPoints = [-1, -1, 1, 1, -1, 1, 1, -1];
    expect(limitDistortionPoints(crossed, previous, "top-right")).toEqual(previous);
  });

  it("rejects concave quads with a projective pole in the image", () => {
    const concave: DistortionPoints = [-1, -1, 1, -1, 0.5, 0, 1, 1];
    expect(isValidQuad(concave)).toBe(false);
  });

  it("guards edge-handle drags that collapse the quad", () => {
    const previous = defaultDistortionPoints();
    const collapsedTop: DistortionPoints = [-1, -1, 1, -1, -1, -1, 1, -1];
    expect(limitDistortionPoints(collapsedTop, previous, "top")).toEqual(previous);
  });

  it("matrix inversion round-trips transformed points", () => {
    const points: DistortionPoints = [-0.8, -1, 0.9, -0.85, -1, 1, 0.75, 0.9];
    const matrix = buildPerspectiveMatrix(points);
    const inverse = invertMat3(matrix);
    const [x, y] = transformPoint(matrix, 0.2, -0.35);
    const [rx, ry] = transformPoint(inverse, x, y);
    expect(rx).toBeCloseTo(0.2, 5);
    expect(ry).toBeCloseTo(-0.35, 5);
  });

  it("transformPoint stays stable for singular-ish matrices", () => {
    const [x, y] = transformPoint([1, 0, 0, 0, 1, 0, 0, 0, 0], 0.25, 0.5);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  it("slider normalization never produces NaN", () => {
    for (const value of [-1000, -100, -1, 0, 1, 100, 1000, Number.NaN, Infinity]) {
      expect(Number.isNaN(normalizeDistortionSlider(value))).toBe(false);
      expect(Number.isNaN(normalizePerspectiveSlider(value))).toBe(false);
    }
  });

  it("auto crop uses the inscribed box of the warped quad", () => {
    // Polarr flips Y when writing the crop rect, so moving only the top-left
    // corner inward crops the left side and lowers the bottom edge.
    const crop = calculateAutoCropForDistortion([-0.6, -0.7, 1, -1, -1, 1, 1, 1], 800, 600);
    expect(crop.x).toBeCloseTo(0.2, 5);
    expect(crop.y).toBeCloseTo(0, 5);
    expect(crop.x + crop.width).toBeCloseTo(1, 5);
    expect(crop.y + crop.height).toBeCloseTo(0.85, 5);
  });

  it("auto crop returns a valid normalized crop", () => {
    const crop = calculateAutoCropForDistortion(
      [-0.8, -0.75, 0.85, -0.7, -0.9, 0.9, 0.8, 0.82],
      4000,
      3000,
    );
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.height).toBeGreaterThan(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
    expect(pointsEqualDefault(defaultDistortionPoints())).toBe(true);
  });
});
