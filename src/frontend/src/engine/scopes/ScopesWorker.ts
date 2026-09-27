import type { ScopeMode } from "./ScopeTypes";

type InitMessage = {
  type: "init";
  canvas: OffscreenCanvas;
  width: number;
  height: number;
};

type ResizeMessage = {
  type: "resize";
  width: number;
  height: number;
};

type DrawMessage = {
  type: "draw";
  mode: ScopeMode;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  opacity: number;
  showGrid: boolean;
};

let canvas: OffscreenCanvas | undefined;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | ResizeMessage | DrawMessage>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

workerSelf.onmessage = (event: MessageEvent<InitMessage | ResizeMessage | DrawMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    canvas = message.canvas;
    canvas.width = message.width;
    canvas.height = message.height;
    ctx = canvas.getContext("2d");
    clearScope();
    return;
  }

  if (message.type === "resize") {
    if (!canvas) return;
    canvas.width = message.width;
    canvas.height = message.height;
    clearScope();
    return;
  }

  if (!canvas || !ctx) return;
  const pixels = new Uint8Array(message.pixels);
  clearScope();
  ctx.save();
  ctx.globalAlpha = clamp(message.opacity, 0, 1);
  drawScope(ctx, message.mode, pixels, message.width, message.height, message.showGrid);
  ctx.restore();
  workerSelf.postMessage({ type: "released", buffer: message.pixels }, [message.pixels]);
};

function drawScope(
  target: OffscreenCanvasRenderingContext2D,
  mode: ScopeMode,
  pixels: Uint8Array,
  width: number,
  height: number,
  showGrid: boolean,
) {
  if (showGrid && mode !== "vec") drawGrid(target, mode);
  if (mode === "rgb") return drawRgbHistogram(target, pixels, width, height);
  if (mode === "hue") return drawHueHistogram(target, pixels, width, height);
  if (mode === "sat") return drawSaturationHistogram(target, pixels, width, height);
  if (mode === "lum") return drawLuminanceHistogram(target, pixels, width, height);
  if (mode === "vec") return drawVectorscope(target, pixels, width, height);
  if (mode === "wvf") return drawWaveform(target, pixels, width, height, false);
  if (mode === "prd") return drawWaveform(target, pixels, width, height, true);
  drawAnalysisMode(target, mode, pixels, width, height);
}

function clearScope() {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawGrid(target: OffscreenCanvasRenderingContext2D, mode: ScopeMode) {
  const width = target.canvas.width;
  const height = target.canvas.height;
  target.save();
  target.strokeStyle = "rgba(255,255,255,0.08)";
  target.lineWidth = 1;
  if (mode === "vec") {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.43;
    for (const scale of [0.33, 0.66, 1]) {
      target.beginPath();
      target.arc(cx, cy, radius * scale, 0, Math.PI * 2);
      target.stroke();
    }
    target.beginPath();
    target.moveTo(cx, cy - radius);
    target.lineTo(cx, cy + radius);
    target.moveTo(cx - radius, cy);
    target.lineTo(cx + radius, cy);
    target.stroke();
  } else {
    for (let i = 1; i < 4; i += 1) {
      const x = (width * i) / 4;
      const y = (height * i) / 4;
      target.beginPath();
      target.moveTo(x, 0);
      target.lineTo(x, height);
      target.moveTo(0, y);
      target.lineTo(width, y);
      target.stroke();
    }
  }
  target.restore();
}

function drawRgbHistogram(
  target: OffscreenCanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  forEachOpaquePixel(pixels, width, height, (r, g, b) => {
    red[r] += 1;
    green[g] += 1;
    blue[b] += 1;
  });
  target.globalCompositeOperation = "lighter";
  drawCurve(target, red, "#e5534e");
  drawCurve(target, green, "#51c472");
  drawCurve(target, blue, "#5689e9");
  target.globalCompositeOperation = "source-over";
}

function drawHueHistogram(
  target: OffscreenCanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  const bins = new Uint32Array(360);
  forEachOpaquePixel(pixels, width, height, (r, g, b) => {
    const [h, s] = rgbToHsl(r, g, b);
    if (s < 0.05) return;
    bins[Math.min(359, Math.max(0, Math.round(h)))] += 1;
  });
  drawCurve(target, bins, makeHueGradient(target));
}

function drawSaturationHistogram(
  target: OffscreenCanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  const bins = new Uint32Array(101);
  forEachOpaquePixel(pixels, width, height, (r, g, b) => {
    const [, s] = rgbToHsl(r, g, b);
    bins[Math.min(100, Math.max(0, Math.round(s * 100)))] += 1;
  });
  const gradient = target.createLinearGradient(0, 0, target.canvas.width, 0);
  gradient.addColorStop(0, "#777");
  gradient.addColorStop(1, "#f04d4d");
  drawCurve(target, bins, gradient);
}

function drawLuminanceHistogram(
  target: OffscreenCanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  const bins = new Uint32Array(101);
  forEachOpaquePixel(pixels, width, height, (r, g, b) => {
    bins[Math.min(100, Math.round(((r + g + b) / 3 / 255) * 100))] += 1;
  });
  drawCurve(target, bins, "#d8d8d8");
}

function drawCurve(
  target: OffscreenCanvasRenderingContext2D,
  bins: Uint32Array,
  style: string | CanvasGradient,
) {
  const max = Math.max(1, ...bins);
  const width = target.canvas.width;
  const height = target.canvas.height;
  const bottom = height - 10;
  const topPad = 12;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < bins.length; i += 1) {
    const prev = bins[Math.max(0, i - 1)];
    const next = bins[Math.min(bins.length - 1, i + 1)];
    const smoothed = (prev + bins[i] + next) / 3;
    const normalized = Math.sqrt(smoothed) / Math.sqrt(max);
    points.push([(i / (bins.length - 1)) * width, bottom - normalized * (bottom - topPad)]);
  }
  target.save();
  target.fillStyle = style;
  target.strokeStyle = style;
  target.lineWidth = 4;
  target.globalAlpha *= 0.22;
  target.beginPath();
  target.moveTo(0, bottom);
  for (const [x, y] of points) target.lineTo(x, y);
  target.lineTo(width, bottom);
  target.closePath();
  target.fill();
  target.globalAlpha /= 0.22;
  target.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  });
  target.stroke();
  target.restore();
}

function drawVectorscope(
  target: OffscreenCanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  const cw = target.canvas.width;
  const ch = target.canvas.height;
  const sx = cw / 256;
  const sy = ch / 256;
  const cx = 128 * sx;
  const cy = 127 * sy;
  const dotSize = Math.max(2, Math.round(cw / 300));
  target.save();
  target.globalAlpha *= 0.5;
  forEachOpaquePixel(pixels, width, height, (r, g, b) => {
    let x = ((0.5 - 0.169 * r - 0.331 * g + 0.5 * b + 128) | 0) * sx;
    let y = (255 - ((0.5 + 0.5 * r - 0.419 * g - 0.081 * b + 128) | 0)) * sy;
    x = cx + 0.87 * (x - cx);
    y = cy + 0.87 * (y - cy);
    target.fillStyle = `rgb(${r},${g},${b})`;
    target.fillRect(x - 0.5 * dotSize, y - 0.5 * dotSize, dotSize, dotSize);
  });
  target.restore();
}

function drawWaveform(
  target: OffscreenCanvasRenderingContext2D,
  pixels: Uint8Array,
  width: number,
  height: number,
  parade: boolean,
) {
  const bounds = findOpaqueBounds(pixels, width, height);
  const cw = target.canvas.width;
  const ch = target.canvas.height;
  target.save();
  target.globalCompositeOperation = "lighter";
  for (let y = bounds.y0; y <= bounds.y1; y += 1) {
    for (let x = bounds.x0; x <= bounds.x1; x += 1) {
      const offset = (y * width + x) * 4;
      const sourceX = (x - bounds.x0) / Math.max(1, bounds.x1 - bounds.x0);
      const channels = [
        [pixels[offset], "#ff0000", 0],
        [pixels[offset + 1], "#00ff00", 1],
        [pixels[offset + 2], "#0000ff", 2],
      ] as const;
      for (const [value, color, index] of channels) {
        const laneWidth = parade ? cw / 3 : cw;
        const drawX = parade ? index * laneWidth + sourceX * laneWidth : sourceX * cw;
        const drawY = (1 - value / 255) * ch;
        target.globalAlpha = (value / 765) * 0.9;
        target.fillStyle = color;
        target.fillRect(drawX, drawY, 1.4, 1.4);
      }
    }
  }
  target.restore();
}

function drawAnalysisMode(
  target: OffscreenCanvasRenderingContext2D,
  mode: ScopeMode,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  const bounds = findOpaqueBounds(pixels, width, height);
  const cw = target.canvas.width;
  const ch = target.canvas.height;
  const sourceW = bounds.x1 - bounds.x0 + 1;
  const sourceH = bounds.y1 - bounds.y0 + 1;
  const scale = Math.min(cw / sourceW, ch / sourceH);
  const drawW = Math.max(1, Math.floor(sourceW * scale));
  const drawH = Math.max(1, Math.floor(sourceH * scale));
  const ox = Math.floor((cw - drawW) / 2);
  const oy = Math.floor((ch - drawH) / 2);
  const image = target.createImageData(drawW, drawH);
  for (let dy = 0; dy < drawH; dy += 1) {
    const sy = bounds.y0 + Math.min(sourceH - 1, Math.floor(dy / scale));
    for (let dx = 0; dx < drawW; dx += 1) {
      const sx = bounds.x0 + Math.min(sourceW - 1, Math.floor(dx / scale));
      const source = (sy * width + sx) * 4;
      const dest = (dy * drawW + dx) * 4;
      const [r, g, b] = analysisColor(mode, pixels[source], pixels[source + 1], pixels[source + 2]);
      image.data[dest] = r;
      image.data[dest + 1] = g;
      image.data[dest + 2] = b;
      image.data[dest + 3] = 255;
    }
  }
  target.putImageData(image, ox, oy);
}

function analysisColor(mode: ScopeMode, r: number, g: number, b: number): [number, number, number] {
  const y = weightedLuma(r, g, b);
  if (mode === "fcl") return falseColor(y);
  if (mode === "clz") {
    if (y < 2) return [112, 52, 180];
    if (y > 98) return [220, 40, 34];
    return grayscale(y);
  }
  if (mode === "exz") return exposureColor(y);
  if (mode === "ntg") {
    const avg = (r + g + b) / 3;
    const delta = Math.hypot(r - avg, g - avg, b - avg);
    if (delta < 1) return [30, 255, 70];
    if (delta < 3) return [90, 190, 105];
    return grayscale(y);
  }
  if (mode === "skn") {
    const [h, s, l] = rgbToHsl(r, g, b);
    const skin = h > 4 && h < 46 && l > 0.15 && l < 0.83 && s > 0.167 && s < 0.667;
    return skin ? [255, 115, 175] : grayscale(y);
  }
  if (mode === "tmp") {
    const temp = (r - b + 255) / 510;
    if (temp < 0.35) return lerpColor([40, 80, 255], [0, 220, 240], temp / 0.35);
    if (temp < 0.65) return lerpColor([0, 220, 240], [245, 230, 40], (temp - 0.35) / 0.3);
    return lerpColor([245, 230, 40], [235, 30, 30], (temp - 0.65) / 0.35);
  }
  return [r, g, b];
}

function falseColor(luma: number): [number, number, number] {
  if (luma < 2) return [92, 37, 162];
  if (luma < 17) return [22, 71, 204];
  if (luma < 33) return [42, 42, 42];
  if (luma < 44) return [38, 154, 69];
  if (luma < 50) return [110, 110, 110];
  if (luma < 58) return [226, 96, 158];
  if (luma < 84) return [188, 188, 188];
  if (luma < 98) return [236, 212, 43];
  return [220, 35, 32];
}

function exposureColor(luma: number): [number, number, number] {
  const palette: Array<[number, number, number]> = [
    [30, 22, 75],
    [52, 42, 118],
    [20, 76, 170],
    [28, 134, 190],
    [33, 165, 128],
    [54, 154, 77],
    [107, 166, 64],
    [161, 178, 73],
    [190, 190, 190],
    [215, 185, 87],
    [226, 150, 67],
    [223, 104, 58],
    [205, 63, 70],
    [180, 48, 106],
    [150, 44, 145],
    [210, 70, 180],
    [245, 235, 238],
  ];
  let index = palette.length - 1;
  for (let i = 0; i < palette.length; i += 1) {
    const e = i / (palette.length - 1);
    const threshold = 100 * ((1 - 0.83) * e + ((1 - Math.cos(e * Math.PI)) / 2) * 0.83);
    if (luma <= threshold) {
      index = i;
      break;
    }
  }
  return palette[index];
}

function findOpaqueBounds(pixels: Uint8Array, width: number, height: number) {
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  let found = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] !== 255) continue;
      found = true;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return found ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
}

function forEachOpaquePixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  callback: (r: number, g: number, b: number) => void,
) {
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    if (pixels[offset + 3] === 0) continue;
    callback(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
  }
}

function rgbToHsl(r8: number, g8: number, b8: number): [number, number, number] {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return [h, s, l];
}

function weightedLuma(r: number, g: number, b: number) {
  return ((r * 0.29889531 + g * 0.58662247 + b * 0.11448223) / 255) * 100;
}

function grayscale(luma: number): [number, number, number] {
  const value = Math.round((luma / 100) * 255);
  return [value, value, value];
}

function makeHueGradient(target: OffscreenCanvasRenderingContext2D) {
  const gradient = target.createLinearGradient(0, 0, target.canvas.width, 0);
  for (let i = 0; i <= 12; i += 1) {
    const hue = (i / 12) * 360;
    gradient.addColorStop(i / 12, `hsl(${hue}, 100%, 50%)`);
  }
  return gradient;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const clamped = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * clamped),
    Math.round(a[1] + (b[1] - a[1]) * clamped),
    Math.round(a[2] + (b[2] - a[2]) * clamped),
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
