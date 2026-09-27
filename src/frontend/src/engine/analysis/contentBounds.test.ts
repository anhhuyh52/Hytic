import { describe, expect, it } from "vitest";
import {
  analyzeContentBoundsFrame,
  boundsAreFullFrame,
  combineContentBoundsFrames,
  contentBoundsToCropRect,
  detectContentBoundsFromImageData,
  fullFrameBounds,
  isInsideContentBounds,
  normalizeContentBounds,
  type FrameBoundsResult,
  type ImageDataLike,
} from "./contentBounds";

// --- synthetic frame builders ----------------------------------------------

type Rgb = [number, number, number];

function makeFrame(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** High per-row variance content (alternating dark/bright columns). */
function contentPixel(x: number): Rgb {
  const v = x % 2 === 0 ? 40 : 210;
  return [v, v, v];
}

/** Flat dark bar. */
function barPixel(_x: number, _y: number): Rgb {
  return [8, 8, 8];
}

/** Dark bar with small deterministic noise (still flat overall). */
function noisyBarPixel(x: number, y: number): Rgb {
  const v = 6 + ((x * 7 + y * 13) % 11); // 6..16
  return [v, v, v];
}

function letterbox(
  width: number,
  height: number,
  barH: number,
  bar: (x: number, y: number) => Rgb = barPixel,
): ImageDataLike {
  return makeFrame(width, height, (x, y) =>
    y < barH || y >= height - barH ? bar(x, y) : contentPixel(x),
  );
}

function pillarbox(width: number, height: number, barW: number): ImageDataLike {
  return makeFrame(width, height, (x, y) =>
    x < barW || x >= width - barW ? barPixel(x, y) : contentPixel(y),
  );
}

// --- helper unit tests ------------------------------------------------------

describe("content-bounds helpers", () => {
  it("builds a full-frame rect", () => {
    expect(fullFrameBounds(100, 60)).toEqual({
      top: 0,
      bottom: 60,
      left: 0,
      right: 100,
      width: 100,
      height: 60,
    });
  });

  it("normalizes bounds to UV and a crop rect", () => {
    const bounds = { top: 12, bottom: 68, left: 0, right: 80, width: 80, height: 56 };
    expect(normalizeContentBounds(bounds, 80, 80)).toEqual({
      top: 0.15,
      bottom: 0.85,
      left: 0,
      right: 1,
    });
    const crop = contentBoundsToCropRect(bounds, 80, 80);
    expect(crop.x).toBeCloseTo(0);
    expect(crop.y).toBeCloseTo(0.15);
    expect(crop.width).toBeCloseTo(1);
    expect(crop.height).toBeCloseTo(0.7);
  });

  it("tests pixel membership", () => {
    const bounds = { top: 10, bottom: 50, left: 5, right: 70, width: 65, height: 40 };
    expect(isInsideContentBounds(6, 11, bounds)).toBe(true);
    expect(isInsideContentBounds(2, 11, bounds)).toBe(false);
    expect(isInsideContentBounds(6, 5, bounds)).toBe(false);
  });
});

// --- image detection (spec cases 1–5) --------------------------------------

describe("detectContentBoundsFromImageData", () => {
  it("case 1: detects top/bottom letterbox bars", () => {
    const bounds = detectContentBoundsFromImageData(letterbox(80, 80, 12));
    expect(bounds.top).toBe(12);
    expect(bounds.bottom).toBe(68);
    expect(bounds.left).toBe(0);
    expect(bounds.right).toBe(80);
  });

  it("case 2: detects left/right pillarbox bars", () => {
    const bounds = detectContentBoundsFromImageData(pillarbox(80, 80, 12));
    expect(bounds.left).toBe(12);
    expect(bounds.right).toBe(68);
    expect(bounds.top).toBe(0);
    expect(bounds.bottom).toBe(80);
  });

  it("case 3: leaves a dark but textured image uncropped", () => {
    const dark = makeFrame(80, 80, (x) => {
      const v = x % 2 === 0 ? 10 : 90;
      return [v, v, v];
    });
    const bounds = detectContentBoundsFromImageData(dark);
    expect(boundsAreFullFrame(bounds, 80, 80)).toBe(true);
  });

  it("case 4: detects noisy/compressed dark bars", () => {
    const bounds = detectContentBoundsFromImageData(letterbox(80, 80, 12, noisyBarPixel));
    expect(bounds.top).toBe(12);
    expect(bounds.bottom).toBe(68);
  });

  it("case 5: ignores a sub-1.5% border", () => {
    const bounds = detectContentBoundsFromImageData(letterbox(80, 80, 1));
    expect(boundsAreFullFrame(bounds, 80, 80)).toBe(true);
  });

  it("does not mistake a smooth dark scene for a bar (no boundary jump)", () => {
    // Whole frame flat-dark with a faint gradient — no real content boundary.
    const flat = makeFrame(80, 80, (_x, y) => {
      const v = 6 + Math.floor(y / 16);
      return [v, v, v];
    });
    expect(boundsAreFullFrame(detectContentBoundsFromImageData(flat), 80, 80)).toBe(true);
  });
});

// --- video merging (spec cases 6–8) ----------------------------------------

function blackFrameResult(width: number, height: number): FrameBoundsResult {
  return analyzeContentBoundsFrame(makeFrame(width, height, () => [0, 0, 0]));
}

describe("combineContentBoundsFrames", () => {
  it("case 6: merges agreeing letterbox frames", () => {
    const frames = [12, 12, 12, 12].map((h) => analyzeContentBoundsFrame(letterbox(80, 80, h)));
    const merged = combineContentBoundsFrames(frames, 80, 80);
    expect(merged.bounds.top).toBe(12);
    expect(merged.bounds.bottom).toBe(68);
    expect(merged.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("case 7: ignores a black intro frame and still finds the bars", () => {
    const frames = [
      blackFrameResult(80, 80),
      ...[12, 12, 12].map((h) => analyzeContentBoundsFrame(letterbox(80, 80, h))),
    ];
    const merged = combineContentBoundsFrames(frames, 80, 80);
    expect(merged.bounds.top).toBe(12);
    expect(merged.bounds.bottom).toBe(68);
  });

  it("case 8: falls back to full frame when frames disagree", () => {
    const frames = [12, 30, 4, 24].map((h) => analyzeContentBoundsFrame(letterbox(80, 80, h)));
    const merged = combineContentBoundsFrames(frames, 80, 80);
    expect(boundsAreFullFrame(merged.bounds, 80, 80)).toBe(true);
    expect(merged.confidence).toBe(0);
  });

  it("falls back to full frame with too few reliable frames", () => {
    const merged = combineContentBoundsFrames([blackFrameResult(80, 80)], 80, 80);
    expect(boundsAreFullFrame(merged.bounds, 80, 80)).toBe(true);
  });
});
