import type {
  CurveModel,
  ExposureState,
  SaturationState,
  ToneState,
} from "../../engine/state/EditState";

export type AutoEnhanceResult = {
  tone: ToneState;
  exposure: ExposureState;
  saturation: SaturationState;
  analysis: {
    low: number;
    median: number;
    high: number;
    meanChroma: number;
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

function percentile(histogram: Uint32Array, sampleCount: number, amount: number): number {
  const target = Math.max(0, Math.ceil(sampleCount * amount));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index];
    if (seen >= target) return index / 255;
  }
  return 1;
}

/**
 * Produces a conservative, deterministic correction from source RGBA pixels.
 * It uses robust luminance percentiles so a few clipped pixels do not dominate,
 * then gently centers exposure, expands tonal range, and normalizes saturation.
 */
export function calculateAutoEnhance(
  pixels: Uint8Array | Uint8ClampedArray,
): AutoEnhanceResult | null {
  const pixelCount = Math.floor(pixels.length / 4);
  if (pixelCount === 0) return null;

  // Analyze at most ~120k evenly spaced pixels. This keeps the button immediate
  // for large RAW files while remaining deterministic.
  const pixelStep = Math.max(1, Math.floor(pixelCount / 120_000));
  const histogram = new Uint32Array(256);
  let sampleCount = 0;
  let chromaSum = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += pixelStep) {
    const offset = pixel * 4;
    if (pixels[offset + 3] < 16) continue;
    const r = pixels[offset] / 255;
    const g = pixels[offset + 1] / 255;
    const b = pixels[offset + 2] / 255;
    const luma = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 1);
    histogram[Math.min(255, Math.round(luma * 255))] += 1;
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
    sampleCount += 1;
  }

  if (sampleCount === 0) return null;

  const low = percentile(histogram, sampleCount, 0.02);
  const median = percentile(histogram, sampleCount, 0.5);
  const high = percentile(histogram, sampleCount, 0.98);
  const meanChroma = chromaSum / sampleCount;

  // Move the median only partway toward middle gray to preserve the intended
  // mood of high-key and low-key photographs.
  const exposureStops = clamp(Math.log2(0.46 / Math.max(0.04, median)) * 0.36, -0.5, 0.5);
  const exposureValue = clamp(2 ** exposureStops - 0.5, 0.25, 0.82);

  const range = high - low;
  const contrastStrength = clamp((0.78 - range) / 0.62, 0.08, 0.62);
  const shadowX = clamp(low, 0.025, 0.25);
  const highlightX = clamp(high, 0.75, 0.975);
  const middleX = clamp(median, shadowX + 0.08, highlightX - 0.08);
  const toneCurve: CurveModel = {
    mode: "cubic",
    points: [
      { x: 0, y: 0 },
      { x: shadowX, y: clamp(mix(shadowX, 0.025, contrastStrength), 0, 1) },
      { x: middleX, y: middleX },
      { x: highlightX, y: clamp(mix(highlightX, 0.975, contrastStrength), 0, 1) },
      { x: 1, y: 1 },
    ],
  };

  // Avoid adding color to genuinely monochrome images. Color photographs get a
  // restrained maximum boost of 14% (or slight reduction when already vivid).
  const saturationMultiplier =
    meanChroma < 0.025 ? 1 : clamp(0.18 / Math.max(meanChroma, 0.001), 0.96, 1.14);
  const saturationValue = saturationMultiplier * 0.5;
  const saturationCurve: CurveModel = {
    mode: "bezier",
    points: [0, 0.25, 0.5, 0.75, 1].map((x) => ({ x, y: saturationValue })),
  };
  const exposureCurve: CurveModel = {
    mode: "cubic",
    points: [0, 1 / 3, 2 / 3, 1].map((x) => ({ x, y: exposureValue })),
  };

  return {
    tone: { enabled: true, bypass: false, curve: toneCurve },
    exposure: { enabled: true, bypass: false, curve: exposureCurve },
    saturation: { enabled: true, bypass: false, curve: saturationCurve },
    analysis: { low, median, high, meanChroma },
  };
}
