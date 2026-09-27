/*
 * Content-bounds detection — letterbox / pillarbox bar finder.
 *
 * Imported media can carry black / dark-grey / noisy / compressed / tinted bars
 * at the top+bottom (letterbox) or left+right (pillarbox). Those bars should not
 * influence grading analysis (histogram, scopes, Color Match, exposure, …) nor
 * receive edits. In this codebase the *single* mechanism that already excludes a
 * region from every analysis + render + export pass is the transform CROP (see
 * Engine.renderScopes / renderExport, all threaded with `transform`). So the
 * integration applies the detected content rect AS a crop — this module only has
 * to find the rect; it deliberately knows nothing about shaders or scopes.
 *
 * Detection is luminance + variance based, edge-connected, and conservative:
 *   - bars must be near-flat (low row/column variance) AND share an edge luma,
 *   - bars must be connected to the frame edge (we scan inward and stop at the
 *     first content line, so a dark region INSIDE the image is never removed),
 *   - there must be a real luma jump at the content boundary (so a merely dark
 *     scene is not mistaken for a bar),
 *   - tiny insets (< ~1.5% of the dimension) are rejected,
 *   - low confidence returns the FULL frame (no crop).
 *
 * Pure-data entry points (detectContentBoundsFromImageData / the analyze+combine
 * helpers) run in plain JS with no DOM, so they are unit-tested directly. The
 * source/video entry points add downsampling + frame sampling on top.
 */

export interface ContentBounds {
  /** First content row, inclusive (0 = top edge). */
  top: number;
  /** One past the last content row, exclusive (height = bottom edge). */
  bottom: number;
  /** First content column, inclusive (0 = left edge). */
  left: number;
  /** One past the last content column, exclusive (width = right edge). */
  right: number;
  /** Content width in pixels (right - left). */
  width: number;
  /** Content height in pixels (bottom - top). */
  height: number;
}

/** Bounds as UV fractions (0..1) of the frame — handy for crop rects / shaders. */
export interface NormalizedContentBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Minimal structural ImageData so the core runs in node tests without the DOM. */
export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Richer per-frame result kept internal to detection + video merging. */
export interface FrameBoundsResult {
  bounds: ContentBounds;
  /** 0..1 — how strongly the bars were detected (1 = very strong / clear jump). */
  confidence: number;
  /** False for unusable frames (full black/white, fades, blank title cards). */
  reliable: boolean;
  frameWidth: number;
  frameHeight: number;
}

// --- tuning constants (luma is normalised 0..1) -----------------------------

/** Cap analysis resolution; larger media is downsampled to this max side. */
export const MAX_ANALYSIS_DIM = 640;
/** Reject bars thinner than this fraction of the dimension (~1.5%). */
const MIN_BAR_FRACTION = 0.015;
/** A single side's bar can never plausibly exceed this fraction of the frame. */
const MAX_BAR_FRACTION = 0.45;
/** Absolute variance ceiling for a "flat" bar line. */
const BAR_VAR_ABS = 0.003;
/** A bar line may also be flat relative to content variance… */
const BAR_VAR_RATIO = 0.25;
/** …but never looser than this absolute cap (guards against over-cropping). */
const BAR_VAR_ABS_MAX = 0.006;
/** Bar lines must share a luma within this tolerance of the edge line. */
const BAR_LUMA_TOL = 0.065;
/** Minimum luma jump at the content boundary to trust a detection. */
const BOUNDARY_JUMP_MIN = 0.03;
/** Luma jump that yields full per-edge confidence. */
const BOUNDARY_JUMP_GOOD = 0.12;
/** Below this whole-frame variance a frame is treated as blank/fade/title. */
const RELIABLE_MIN_VAR = 0.0008;
/** Confidence at/above which the integration should apply the crop. */
export const CONTENT_BOUNDS_ACCEPT_CONFIDENCE = 0.6;
/** Per-edge inset fractions within this delta count as "the same" bar. */
const FRAME_AGREE_TOLERANCE = 0.02;
/** Fraction of reliable frames that must agree on an edge (≥60%). */
const FRAME_AGREE_RATIO = 0.6;

function debugEnabled(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __DEBUG_CONTENT_BOUNDS__?: boolean }).__DEBUG_CONTENT_BOUNDS__ === true
  );
}

// --- public helpers ---------------------------------------------------------

export function fullFrameBounds(width: number, height: number): ContentBounds {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { top: 0, bottom: h, left: 0, right: w, width: w, height: h };
}

/** True when the bounds cover (practically) the whole frame — i.e. no crop. */
export function boundsAreFullFrame(bounds: ContentBounds, width: number, height: number): boolean {
  const insetX = bounds.left + (width - bounds.right);
  const insetY = bounds.top + (height - bounds.bottom);
  return (
    insetX < Math.max(1, width * MIN_BAR_FRACTION) &&
    insetY < Math.max(1, height * MIN_BAR_FRACTION)
  );
}

export function normalizeContentBounds(
  bounds: ContentBounds,
  width: number,
  height: number,
): NormalizedContentBounds {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return {
    left: clamp01(bounds.left / w),
    right: clamp01(bounds.right / w),
    top: clamp01(bounds.top / h),
    bottom: clamp01(bounds.bottom / h),
  };
}

/** Bounds → a transform crop rect (UV-space x/y/width/height, 0..1). */
export function contentBoundsToCropRect(
  bounds: ContentBounds,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const n = normalizeContentBounds(bounds, width, height);
  const x = clamp01(n.left);
  const y = clamp01(n.top);
  return {
    x,
    y,
    width: clamp01(n.right - n.left),
    height: clamp01(n.bottom - n.top),
  };
}

export function isInsideContentBounds(x: number, y: number, bounds: ContentBounds): boolean {
  return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// --- core analysis ----------------------------------------------------------

/** Rec.709 luma, normalised 0..1. */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

type LineStats = {
  mean: Float64Array;
  variance: Float64Array;
  globalMean: number;
  globalVariance: number;
};

/** Per-row + per-column luma mean/variance plus whole-frame stats, one pass. */
function computeStats(image: ImageDataLike): { rows: LineStats; cols: LineStats } {
  const { data, width, height } = image;
  const rowSum = new Float64Array(height);
  const rowSumSq = new Float64Array(height);
  const colSum = new Float64Array(width);
  const colSumSq = new Float64Array(width);
  let total = 0;
  let totalSq = 0;

  for (let y = 0; y < height; y += 1) {
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const o = rowBase + x * 4;
      const l = luma(data[o], data[o + 1], data[o + 2]);
      rowSum[y] += l;
      rowSumSq[y] += l * l;
      colSum[x] += l;
      colSumSq[x] += l * l;
      total += l;
      totalSq += l * l;
    }
  }

  const rowMean = new Float64Array(height);
  const rowVar = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    const m = rowSum[y] / width;
    rowMean[y] = m;
    rowVar[y] = Math.max(0, rowSumSq[y] / width - m * m);
  }
  const colMean = new Float64Array(width);
  const colVar = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    const m = colSum[x] / height;
    colMean[x] = m;
    colVar[x] = Math.max(0, colSumSq[x] / height - m * m);
  }

  const n = Math.max(1, width * height);
  const globalMean = total / n;
  const globalVariance = Math.max(0, totalSq / n - globalMean * globalMean);

  return {
    rows: { mean: rowMean, variance: rowVar, globalMean, globalVariance },
    cols: { mean: colMean, variance: colVar, globalMean, globalVariance },
  };
}

/** Median of the central 60% of a variance array — a robust "content" estimate. */
function estimateContentVariance(variance: Float64Array): number {
  const count = variance.length;
  if (count === 0) return 0;
  const start = Math.floor(count * 0.2);
  const end = Math.max(start + 1, Math.ceil(count * 0.8));
  const slice = Array.from(variance.slice(start, end)).sort((a, b) => a - b);
  return slice[Math.floor(slice.length / 2)] ?? 0;
}

type EdgeScan = { count: number; jump: number };

/**
 * Scan inward from one edge counting contiguous bar-like lines. `order` lists
 * line indices from the edge inward. Returns how many lines are bars and the
 * luma jump at the content boundary (0 if no trustworthy boundary).
 */
function scanEdge(
  mean: Float64Array,
  variance: Float64Array,
  order: number[],
  contentVariance: number,
): EdgeScan {
  const limit = Math.floor(order.length * MAX_BAR_FRACTION);
  const varThreshold = Math.min(
    BAR_VAR_ABS_MAX,
    Math.max(BAR_VAR_ABS, contentVariance * BAR_VAR_RATIO),
  );
  const edgeLuma = mean[order[0]];

  let barMeanSum = 0;
  let count = 0;
  for (let i = 0; i < order.length; i += 1) {
    const idx = order[i];
    const isFlat = variance[idx] <= varThreshold;
    const matchesEdge = Math.abs(mean[idx] - edgeLuma) <= BAR_LUMA_TOL;
    if (isFlat && matchesEdge && count < limit) {
      barMeanSum += mean[idx];
      count += 1;
      continue;
    }
    break;
  }

  if (count === 0) return { count: 0, jump: 0 };

  // The boundary is real only if the first content line clearly departs from the
  // bar luma (a flat dark *scene* would keep matching and never jump).
  const boundaryIdx = order[count];
  if (boundaryIdx === undefined) return { count: 0, jump: 0 }; // whole strip flat → not a bar
  const barMean = barMeanSum / count;
  const jump = Math.abs(mean[boundaryIdx] - barMean);
  if (jump < BOUNDARY_JUMP_MIN) return { count: 0, jump: 0 };

  return { count, jump };
}

function edgeConfidence(jump: number): number {
  return clamp01((jump - BOUNDARY_JUMP_MIN) / (BOUNDARY_JUMP_GOOD - BOUNDARY_JUMP_MIN));
}

/**
 * Combine two opposite edges into one axis result. A matched pair (both edges,
 * similar thickness) is the classic letterbox/pillarbox and scores high; a lone
 * edge must clear a strong jump on its own (×0.7) to be trusted.
 */
function axisConfidence(near: EdgeScan, far: EdgeScan, dimension: number): number {
  const nearConf = near.count > 0 ? edgeConfidence(near.jump) : 0;
  const farConf = far.count > 0 ? edgeConfidence(far.jump) : 0;
  if (near.count > 0 && far.count > 0) {
    const balance = 1 - Math.abs(near.count - far.count) / Math.max(near.count, far.count);
    const symmetryBoost = balance >= 0.7 ? 1 : 0.85;
    return Math.min(1, ((nearConf + farConf) / 2) * symmetryBoost + 0.1);
  }
  // single edge
  void dimension;
  return Math.max(nearConf, farConf) * 0.7;
}

/**
 * Detect content bounds for ALREADY-PIXEL data (no downsampling). Returns the
 * full frame when confidence is low. Used directly per video frame and by the
 * single-image entry point after downsampling.
 */
export function analyzeContentBoundsFrame(image: ImageDataLike): FrameBoundsResult {
  const { width, height } = image;
  if (width < 8 || height < 8) {
    return {
      bounds: fullFrameBounds(width, height),
      confidence: 0,
      reliable: false,
      frameWidth: width,
      frameHeight: height,
    };
  }

  const { rows, cols } = computeStats(image);
  const reliable =
    rows.globalVariance >= RELIABLE_MIN_VAR && rows.globalMean > 0.02 && rows.globalMean < 0.98;

  const rowContentVar = estimateContentVariance(rows.variance);
  const colContentVar = estimateContentVariance(cols.variance);

  const topOrder = range(0, height, 1);
  const bottomOrder = range(height - 1, -1, -1);
  const leftOrder = range(0, width, 1);
  const rightOrder = range(width - 1, -1, -1);

  const top = scanEdge(rows.mean, rows.variance, topOrder, rowContentVar);
  const bottom = scanEdge(rows.mean, rows.variance, bottomOrder, rowContentVar);
  const left = scanEdge(cols.mean, cols.variance, leftOrder, colContentVar);
  const right = scanEdge(cols.mean, cols.variance, rightOrder, colContentVar);

  let topCount = applyMinFraction(top.count, height);
  let bottomCount = applyMinFraction(bottom.count, height);
  let leftCount = applyMinFraction(left.count, width);
  let rightCount = applyMinFraction(right.count, width);

  // Opposite bars must not collide (would mean the whole frame is "bar").
  if (topCount + bottomCount >= height) {
    topCount = 0;
    bottomCount = 0;
  }
  if (leftCount + rightCount >= width) {
    leftCount = 0;
    rightCount = 0;
  }

  const letterboxConf =
    topCount > 0 || bottomCount > 0
      ? axisConfidence(
          topCount > 0 ? top : { count: 0, jump: 0 },
          bottomCount > 0 ? bottom : { count: 0, jump: 0 },
          height,
        )
      : 0;
  const pillarConf =
    leftCount > 0 || rightCount > 0
      ? axisConfidence(
          leftCount > 0 ? left : { count: 0, jump: 0 },
          rightCount > 0 ? right : { count: 0, jump: 0 },
          width,
        )
      : 0;

  // Drop an axis whose confidence is too weak to trust on its own.
  if (letterboxConf < CONTENT_BOUNDS_ACCEPT_CONFIDENCE) {
    topCount = 0;
    bottomCount = 0;
  }
  if (pillarConf < CONTENT_BOUNDS_ACCEPT_CONFIDENCE) {
    leftCount = 0;
    rightCount = 0;
  }

  const bounds: ContentBounds = {
    top: topCount,
    bottom: height - bottomCount,
    left: leftCount,
    right: width - rightCount,
    width: width - leftCount - rightCount,
    height: height - topCount - bottomCount,
  };

  const detectedAxes = [letterboxConf, pillarConf].filter((c) => c > 0);
  const confidence = detectedAxes.length === 0 ? 0 : Math.min(...detectedAxes);

  if (debugEnabled()) {
    console.log("[content-bounds] frame", {
      size: `${width}x${height}`,
      reliable,
      mean: round3(rows.globalMean),
      variance: round3(rows.globalVariance),
      letterboxConf: round3(letterboxConf),
      pillarConf: round3(pillarConf),
      insets: { topCount, bottomCount, leftCount, rightCount },
    });
  }

  return { bounds, confidence, reliable, frameWidth: width, frameHeight: height };
}

function applyMinFraction(count: number, dimension: number): number {
  if (count <= 0) return 0;
  return count >= dimension * MIN_BAR_FRACTION ? count : 0;
}

function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
  return out;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Public single-frame entry point (spec API). Analyses the given ImageData as-is
 * — callers that hand in large frames should downsample first (see
 * detectContentBoundsForImage). Returns the full frame when unconfident.
 */
export function detectContentBoundsFromImageData(imageData: ImageDataLike): ContentBounds {
  return analyzeContentBoundsFrame(imageData).bounds;
}

// --- video frame merging ----------------------------------------------------

function insetFractions(result: FrameBoundsResult) {
  const { bounds, frameWidth, frameHeight } = result;
  return {
    top: bounds.top / frameHeight,
    bottom: (frameHeight - bounds.bottom) / frameHeight,
    left: bounds.left / frameWidth,
    right: (frameWidth - bounds.right) / frameWidth,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median inset across frames, but only if ≥60% of frames agree; else 0. */
function agreedInset(fractions: number[]): number {
  if (fractions.length === 0) return 0;
  const med = median(fractions);
  const agree = fractions.filter((f) => Math.abs(f - med) <= FRAME_AGREE_TOLERANCE).length;
  if (agree / fractions.length < FRAME_AGREE_RATIO) return 0;
  return med;
}

/**
 * Merge per-frame detections into one stable result at the given output size.
 * Drops unreliable frames (black/fade/title), requires majority agreement on
 * each edge, and falls back to the full frame when frames disagree.
 */
export function combineContentBoundsFrames(
  results: FrameBoundsResult[],
  width: number,
  height: number,
): FrameBoundsResult {
  const reliable = results.filter((r) => r.reliable);
  if (reliable.length < 2) {
    return {
      bounds: fullFrameBounds(width, height),
      confidence: 0,
      reliable: reliable.length > 0,
      frameWidth: width,
      frameHeight: height,
    };
  }

  const fractions = reliable.map(insetFractions);
  const top = agreedInset(fractions.map((f) => f.top));
  const bottom = agreedInset(fractions.map((f) => f.bottom));
  const left = agreedInset(fractions.map((f) => f.left));
  const right = agreedInset(fractions.map((f) => f.right));

  const topPx = Math.round(top * height);
  const bottomPx = Math.round(bottom * height);
  const leftPx = Math.round(left * width);
  const rightPx = Math.round(right * width);

  const bounds: ContentBounds = {
    top: topPx,
    bottom: height - bottomPx,
    left: leftPx,
    right: width - rightPx,
    width: width - leftPx - rightPx,
    height: height - topPx - bottomPx,
  };

  // Confidence = average of contributing frames' confidence, scaled by how many
  // reliable frames we actually had to vote with.
  const detected = top + bottom + left + right > 0;
  const meanConf = reliable.reduce((sum, r) => sum + r.confidence, 0) / reliable.length;
  const confidence = detected ? meanConf : 0;

  if (debugEnabled()) {
    console.log("[content-bounds] combined", {
      reliableFrames: reliable.length,
      insets: { top, bottom, left, right },
      confidence: round3(confidence),
    });
  }

  return { bounds, confidence, reliable: true, frameWidth: width, frameHeight: height };
}

// --- DOM entry points (image + video) ---------------------------------------

type DrawableSource =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLVideoElement;

type TextureLike = { image?: unknown };

function isImageDataLike(value: unknown): value is ImageDataLike {
  return (
    !!value && typeof value === "object" && "data" in value && "width" in value && "height" in value
  );
}

function sourceDimensions(source: DrawableSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  const anySource = source as { width: number; height: number };
  return { width: anySource.width, height: anySource.height };
}

function downsampleSize(width: number, height: number, max = MAX_ANALYSIS_DIM) {
  const scale = Math.min(1, max / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function createAnalysisCanvas(
  width: number,
  height: number,
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("content-bounds: 2D canvas unavailable");
    return { canvas, ctx };
  }
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("content-bounds: 2D canvas unavailable");
  return { canvas, ctx };
}

/** Average-pool downsample for ImageData inputs — avoids a full-res canvas. */
function downsampleImageData(image: ImageDataLike, max = MAX_ANALYSIS_DIM): ImageDataLike {
  const { width, height } = image;
  const target = downsampleSize(width, height, max);
  if (target.scale >= 1) return image;
  const { data } = image;
  const out = new Uint8ClampedArray(target.width * target.height * 4);
  const sx = width / target.width;
  const sy = height / target.height;
  for (let ty = 0; ty < target.height; ty += 1) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.min(height, Math.floor((ty + 1) * sy) || y0 + 1);
    for (let tx = 0; tx < target.width; tx += 1) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.min(width, Math.floor((tx + 1) * sx) || x0 + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const o = (y * width + x) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          n += 1;
        }
      }
      const to = (ty * target.width + tx) * 4;
      const inv = n > 0 ? 1 / n : 0;
      out[to] = r * inv;
      out[to + 1] = g * inv;
      out[to + 2] = b * inv;
      out[to + 3] = 255;
    }
  }
  return { data: out, width: target.width, height: target.height };
}

function scaleBoundsToSource(
  bounds: ContentBounds,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): ContentBounds {
  if (fromWidth === toWidth && fromHeight === toHeight) return bounds;
  const n = normalizeContentBounds(bounds, fromWidth, fromHeight);
  const left = Math.round(n.left * toWidth);
  const right = Math.round(n.right * toWidth);
  const top = Math.round(n.top * toHeight);
  const bottom = Math.round(n.bottom * toHeight);
  return { top, bottom, left, right, width: right - left, height: bottom - top };
}

/**
 * Detect content bounds for a still image. Accepts a decoded bitmap/canvas/img,
 * a Three.js texture ({ image }), or raw ImageData. Downsamples to
 * MAX_ANALYSIS_DIM before analysis and returns bounds in SOURCE pixels.
 */
export async function detectContentBoundsForImage(
  source: DrawableSource | TextureLike | ImageDataLike,
): Promise<ContentBounds> {
  // Unwrap a Three.js texture to its underlying image.
  if (source && typeof source === "object" && "image" in source && !isImageDataLike(source)) {
    const image = (source as TextureLike).image;
    if (image) return detectContentBoundsForImage(image as DrawableSource | ImageDataLike);
  }

  if (isImageDataLike(source)) {
    const small = downsampleImageData(source);
    const bounds = analyzeContentBoundsFrame(small).bounds;
    return scaleBoundsToSource(bounds, small.width, small.height, source.width, source.height);
  }

  const drawable = source as DrawableSource;
  const { width, height } = sourceDimensions(drawable);
  if (!width || !height) return fullFrameBounds(width || 1, height || 1);
  const target = downsampleSize(width, height);
  const { ctx } = createAnalysisCanvas(target.width, target.height);
  ctx.drawImage(drawable as CanvasImageSource, 0, 0, target.width, target.height);
  const imageData = ctx.getImageData(0, 0, target.width, target.height);
  const bounds = analyzeContentBoundsFrame(imageData).bounds;
  return scaleBoundsToSource(bounds, target.width, target.height, width, height);
}

/** Fractions of duration to sample for a video (avoid head/tail title cards). */
const VIDEO_SAMPLE_FRACTIONS = [0.05, 0.25, 0.5, 0.75, 0.95];

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done, { once: true });
    // Guard against browsers that never fire "seeked" (e.g. identical time).
    window.setTimeout(done, 600);
    try {
      video.currentTime = Math.max(0, time);
    } catch {
      done();
    }
  });
}

type VideoFrameCallbackHost = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

/**
 * Wait until a frame has actually been PAINTED after a seek. Seeking + immediate
 * drawImage routinely yields a black frame in Chrome (the "seeked" event fires
 * before the decoded frame is presented), which detection then discards as an
 * unreliable frame — so without this every sample looks black and no bars are
 * found. requestVideoFrameCallback resolves on real frame presentation; the
 * timeout is a safety net for browsers/codecs that never call it back.
 */
function awaitPaintedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const host = video as VideoFrameCallbackHost;
    if (typeof host.requestVideoFrameCallback === "function") {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      host.requestVideoFrameCallback(() => finish());
      window.setTimeout(finish, 400);
    } else {
      window.setTimeout(resolve, 150);
    }
  });
}

/** Nudge the decoder awake — some browsers paint black until the first play. */
async function warmupVideoDecode(video: HTMLVideoElement): Promise<void> {
  try {
    video.muted = true;
    const playback = video.play();
    if (playback && typeof playback.then === "function") await playback;
    video.pause();
  } catch {
    /* autoplay blocked / not needed — seek + frame-callback still settle it */
  }
}

/**
 * Detect content bounds for a video. Samples several frames across the clip,
 * ignores unusable frames, and merges the rest by median with majority
 * agreement (falling back to the full frame when frames disagree).
 *
 * Detection is meant to run ONCE per clip at import time; the result is applied
 * as a static crop and reused from cache thereafter — never per playback frame.
 */
export async function detectContentBoundsForVideo(
  source: HTMLVideoElement | File,
): Promise<ContentBounds> {
  let video: HTMLVideoElement;
  let objectUrl: string | undefined;
  let ownsVideo = false;

  if (typeof File !== "undefined" && source instanceof File) {
    video = document.createElement("video");
    objectUrl = URL.createObjectURL(source);
    ownsVideo = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error("content-bounds: unable to decode video"));
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", fail, { once: true });
      window.setTimeout(fail, 20_000);
      video.load();
    });
  } else {
    // Clone playback element so seeking for detection never disturbs the viewer.
    const src = (source as HTMLVideoElement).currentSrc || (source as HTMLVideoElement).src;
    if (src) {
      video = document.createElement("video");
      ownsVideo = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = src;
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        video.addEventListener("error", () => resolve(), { once: true });
        window.setTimeout(resolve, 20_000);
        video.load();
      });
    } else {
      video = source as HTMLVideoElement;
    }
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height || !Number.isFinite(video.duration) || video.duration <= 0) {
    if (ownsVideo) cleanupVideo(video, objectUrl);
    return fullFrameBounds(width || 1, height || 1);
  }

  const target = downsampleSize(width, height);
  const { ctx } = createAnalysisCanvas(target.width, target.height);
  const results: FrameBoundsResult[] = [];

  try {
    await warmupVideoDecode(video);
    for (const fraction of VIDEO_SAMPLE_FRACTIONS) {
      await seekVideo(video, fraction * video.duration);
      await awaitPaintedFrame(video);
      ctx.drawImage(video, 0, 0, target.width, target.height);
      const frame = ctx.getImageData(0, 0, target.width, target.height);
      results.push(analyzeContentBoundsFrame(frame));
    }
  } catch {
    if (ownsVideo) cleanupVideo(video, objectUrl);
    return fullFrameBounds(width, height);
  }

  if (ownsVideo) cleanupVideo(video, objectUrl);

  const merged = combineContentBoundsFrames(results, width, height);
  if (merged.confidence < CONTENT_BOUNDS_ACCEPT_CONFIDENCE) {
    return fullFrameBounds(width, height);
  }
  return merged.bounds;
}

function cleanupVideo(video: HTMLVideoElement, objectUrl?: string): void {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    /* ignore */
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}
