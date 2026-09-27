import { describe, expect, it, vi } from "vitest";
import {
  HalfFloatType,
  UnsignedByteType,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { readRenderTargetRgba8 } from "./readRenderTarget";

function rendererReturning(values: number[]) {
  return {
    readRenderTargetPixels: vi.fn(
      (
        _target: WebGLRenderTarget,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        output: Uint8Array | Uint16Array,
      ) => output.set(values),
    ),
  } as unknown as WebGLRenderer;
}

function target(type: typeof HalfFloatType | typeof UnsignedByteType) {
  return { texture: { type } } as WebGLRenderTarget;
}

describe("readRenderTargetRgba8", () => {
  it("keeps unsigned-byte export pixels unchanged", () => {
    const renderer = rendererReturning([0, 64, 128, 255]);

    expect([...readRenderTargetRgba8(renderer, target(UnsignedByteType), 1, 1)]).toEqual([
      0, 64, 128, 255,
    ]);
  });

  it("quantizes half-float export pixels only at readback", () => {
    const renderer = rendererReturning([
      0x0000, // 0
      0x3800, // 0.5
      0x3c00, // 1
      0x4000, // 2, clamped
    ]);

    expect([...readRenderTargetRgba8(renderer, target(HalfFloatType), 1, 1)]).toEqual([
      0, 128, 255, 255,
    ]);
  });
});
