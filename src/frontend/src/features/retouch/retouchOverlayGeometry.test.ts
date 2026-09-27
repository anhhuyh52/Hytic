import { describe, expect, it } from "vitest";
import { createRetouchSpot } from "./retouchStore";
import {
  ellipseBoundaryPoint,
  moveRetouchSpot,
  pinchRetouchSpot,
  resizeRotateRetouchSpot,
} from "./retouchOverlayGeometry";

describe("retouch overlay geometry", () => {
  it("moves destination and source independently from the immutable drag start", () => {
    const start = createRetouchSpot();
    const destination = moveRetouchSpot(
      start,
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.35 },
      "destination",
    );
    const source = moveRetouchSpot(start, { x: 0.5, y: 0.5 }, { x: 0.4, y: 0.7 }, "source");

    expect(destination.position[0]).toBeCloseTo(0.1);
    expect(destination.position[1]).toBeCloseTo(-0.15);
    expect(destination.sourcePosition).toEqual(start.sourcePosition);
    expect(source.position).toEqual(start.position);
    expect(source.sourcePosition[0]).toBeCloseTo(0.1);
    expect(source.sourcePosition[1]).toBeCloseTo(0.4);
    expect(start.position).toEqual([0, 0]);
  });

  it("uniformly resizes and rotates without moving either center", () => {
    const start = createRetouchSpot();
    const next = resizeRotateRetouchSpot(start, 0.2, 170, 0.4, -170);

    expect(next.size[0] / start.size[0]).toBeCloseTo(2);
    expect(next.size[1] / start.size[1]).toBeCloseTo(2);
    expect(next.angle).toBe(20);
    expect(next.position).toEqual(start.position);
    expect(next.sourcePosition).toEqual(start.sourcePosition);
  });

  it("pinches uniformly and enforces the minimum size", () => {
    const start = createRetouchSpot();
    const larger = pinchRetouchSpot(start, 1.5);
    const minimum = pinchRetouchSpot(start, 0);

    expect(larger.size[0] / start.size[0]).toBeCloseTo(1.5);
    expect(larger.size[1] / start.size[1]).toBeCloseTo(1.5);
    expect(minimum.size[0]).toBeGreaterThanOrEqual(0.01);
    expect(minimum.size[1]).toBeGreaterThanOrEqual(0.01);
  });

  it("places connector endpoints on rotated ellipse boundaries", () => {
    const horizontal = ellipseBoundaryPoint({ x: 0, y: 0 }, 20, 10, 0, { x: 100, y: 0 });
    const rotated = ellipseBoundaryPoint({ x: 0, y: 0 }, 20, 10, 90, { x: 0, y: 100 });

    expect(horizontal).toEqual({ x: 20, y: 0 });
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(20);
  });
});
