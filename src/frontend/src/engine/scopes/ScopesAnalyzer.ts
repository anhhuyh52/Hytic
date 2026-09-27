import { chroma, luma709, rgbToHsv } from "./ScopeMath";
import {
  SCOPE_HISTOGRAM_BINS,
  type ScopeFrameData,
  type ScopeMode,
  type VectorscopeData,
  type WaveformData,
} from "./ScopeTypes";

/**
 * CPU analysis of a small processed-image buffer (RGBA, top-down). Always
 * computes the cheap 1D distributions; computes waveform/vectorscope/mask only
 * for the active mode to keep it light.
 */
export function analyzeScopeFrame(
  pixels: Uint8Array,
  width: number,
  height: number,
  mode: ScopeMode,
): ScopeFrameData {
  const bins = SCOPE_HISTOGRAM_BINS;
  const r = new Uint32Array(bins);
  const g = new Uint32Array(bins);
  const b = new Uint32Array(bins);
  const luma = new Uint32Array(bins);
  const hue = new Uint32Array(bins);
  const saturation = new Uint32Array(bins);

  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const R = pixels[o];
    const G = pixels[o + 1];
    const B = pixels[o + 2];
    r[R] += 1;
    g[G] += 1;
    b[B] += 1;

    const rn = R / 255;
    const gn = G / 255;
    const bn = B / 255;
    const y = luma709(rn, gn, bn);
    luma[Math.min(bins - 1, Math.round(y * (bins - 1)))] += 1;

    const [h, s] = rgbToHsv(rn, gn, bn);
    hue[Math.min(bins - 1, Math.floor((h / 360) * bins))] += 1;
    saturation[Math.min(bins - 1, Math.round(s * (bins - 1)))] += 1;
  }

  const data: ScopeFrameData = {
    width,
    height,
    histogram: { r, g, b, luma },
    hue,
    saturation,
  };

  if (mode === "wvf" || mode === "prd") {
    data.waveform = computeWaveform(pixels, width, height);
  } else if (mode === "vec") {
    data.vectorscope = computeVectorscope(pixels, width, height);
  } else if (mode === "ntg") {
    data.mask = computeNeutralMask(pixels, width, height);
  } else if (mode === "skn") {
    data.mask = computeSkinMask(pixels, width, height);
  }

  return data;
}

function computeWaveform(pixels: Uint8Array, width: number, height: number): WaveformData {
  const columns = Math.min(width, 256);
  const valueBins = 256;
  const r = new Uint32Array(columns * valueBins);
  const g = new Uint32Array(columns * valueBins);
  const b = new Uint32Array(columns * valueBins);
  const luma = new Uint32Array(columns * valueBins);
  let max = 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const col = Math.min(columns - 1, Math.floor((x / width) * columns));
      const base = col * valueBins;
      const rv = pixels[o];
      const gv = pixels[o + 1];
      const bv = pixels[o + 2];
      const lv = Math.min(255, Math.round(luma709(rv / 255, gv / 255, bv / 255) * 255));
      const cr = (r[base + rv] += 1);
      const cg = (g[base + gv] += 1);
      const cb = (b[base + bv] += 1);
      const cl = (luma[base + lv] += 1);
      if (cr > max) max = cr;
      if (cg > max) max = cg;
      if (cb > max) max = cb;
      if (cl > max) max = cl;
    }
  }

  return { columns, valueBins, r, g, b, luma, max };
}

function computeVectorscope(pixels: Uint8Array, width: number, height: number): VectorscopeData {
  const size = 256;
  const grid = new Uint32Array(size * size);
  let max = 1;
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const rn = pixels[o] / 255;
    const gn = pixels[o + 1] / 255;
    const bn = pixels[o + 2] / 255;
    const y = luma709(rn, gn, bn);
    const cb = (bn - y) * 0.5; // ~[-0.5, 0.5]
    const cr = (rn - y) * 0.5;
    const gx = Math.min(size - 1, Math.max(0, Math.round((cb + 0.5) * (size - 1))));
    const gy = Math.min(size - 1, Math.max(0, Math.round((0.5 - cr) * (size - 1)))); // Cr up
    const idx = gy * size + gx;
    const c = (grid[idx] += 1);
    if (c > max) max = c;
  }

  return { size, bins: grid, max };
}

// Highlights pixels close to neutral; darkens the rest. Analysis only.
function computeNeutralMask(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const rn = pixels[o] / 255;
    const gn = pixels[o + 1] / 255;
    const bn = pixels[o + 2] / 255;
    const y = luma709(rn, gn, bn);
    const isNeutral = chroma(rn, gn, bn) < 0.04 && y > 0.04 && y < 0.96;
    writeMaskPixel(out, o, pixels, isNeutral);
  }
  return out;
}

// NOTE: this is a heuristic hue/chroma analysis, NOT semantic skin detection.
function computeSkinMask(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const rn = pixels[o] / 255;
    const gn = pixels[o + 1] / 255;
    const bn = pixels[o + 2] / 255;
    const [h, s, v] = rgbToHsv(rn, gn, bn);
    const isSkin = h >= 15 && h <= 55 && s > 0.1 && s < 0.85 && v > 0.2 && v < 0.97;
    writeMaskPixel(out, o, pixels, isSkin);
  }
  return out;
}

function writeMaskPixel(out: Uint8ClampedArray, o: number, pixels: Uint8Array, highlight: boolean) {
  if (highlight) {
    out[o] = pixels[o];
    out[o + 1] = pixels[o + 1];
    out[o + 2] = pixels[o + 2];
  } else {
    out[o] = pixels[o] * 0.18;
    out[o + 1] = pixels[o + 1] * 0.18;
    out[o + 2] = pixels[o + 2] * 0.18;
  }
  out[o + 3] = 255;
}
