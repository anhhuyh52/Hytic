import { HalfFloatType, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { recordFullResReadback } from "../../app/performanceCounters";

/**
 * Read a render target into an 8-bit bottom-up buffer. Export pipelines may use
 * half-float intermediates; quantization happens here, once, at final readback.
 */
export function readRenderTargetRgba8(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
): Uint8Array {
  recordFullResReadback();
  if (renderTarget.texture.type !== HalfFloatType) {
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);
    return pixels;
  }

  const half = new Uint16Array(width * height * 4);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, half);
  const pixels = new Uint8Array(half.length);
  for (let i = 0; i < half.length; i += 1) {
    const value = halfToFloat(half[i]);
    pixels[i] = Math.round(Math.min(1, Math.max(0, value)) * 255);
  }
  return pixels;
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  let value: number;
  if (e === 0) value = f * Math.pow(2, -24);
  else if (e === 0x1f) value = f ? Number.NaN : Number.POSITIVE_INFINITY;
  else value = (1 + f / 1024) * Math.pow(2, e - 15);
  return s ? -value : value;
}
