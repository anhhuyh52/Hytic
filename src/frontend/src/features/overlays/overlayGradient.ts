import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, NoColorSpace } from "three";
import type { GradientStop } from "./overlayTypes";

const rgba = ([r, g, b, a]: GradientStop["color"]) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

/** Creates a 256x1 LUT. Call only when stops change and dispose the previous LUT. */
export function createGradientTexture(stops: GradientStop[], width = 256): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable");
  const gradient = context.createLinearGradient(0, 0, width, 0);
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) {
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(1, "transparent");
  } else {
    for (const stop of sorted) gradient.addColorStop(Math.min(1, Math.max(0, stop.position)), rgba(stop.color));
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, 1);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
