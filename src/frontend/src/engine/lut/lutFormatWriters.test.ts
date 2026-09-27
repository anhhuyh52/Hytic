import { describe, expect, it } from "vitest";
import { writeLUT } from "./lutFormatWriters";
import type { BakedLUTReadback } from "../interchange/LUTData";

function identity(size = 2): BakedLUTReadback {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        data[i++] = r / (size - 1);
        data[i++] = g / (size - 1);
        data[i++] = b / (size - 1);
      }
    }
  }
  return { data, size, is8Bit: false };
}

describe("LUT format writers", () => {
  it("writes a generic CUBE with required headers and red-fastest rows", async () => {
    const { blob } = await writeLUT(identity(), {
      extension: ".cube",
      layout: "cube",
      size: 2,
      title: "Test",
    });
    const text = await blob.text();
    expect(text).toContain('TITLE "Test - Created with Hytic"');
    expect(text).toContain("LUT_3D_SIZE 2");
    expect(text).toContain("DOMAIN_MIN 0.0 0.0 0.0");
    const rows = text.split("\n").filter((line) => /^\d/.test(line));
    expect(rows).toHaveLength(8);
    expect(rows.slice(0, 2)).toEqual([
      "0.000000 0.000000 0.000000",
      "1.000000 0.000000 0.000000",
    ]);
  });

  it("writes the Cinema4D/Redshift comment-header CUBE variant", async () => {
    const { blob } = await writeLUT(identity(), {
      extension: ".cube",
      layout: "c4d",
      size: 2,
      title: "Redshift Look",
    });
    const text = await blob.text();
    expect(text).toContain("# Redshift Look");
    expect(text).toContain("# Created with Hytic for Cinema 4D / Redshift");
    expect(text).toContain("LUT_3D_SIZE 2");
    expect(text).not.toContain("DOMAIN_MIN");
    expect(text).not.toContain("TITLE");
  });

  it("writes PNG grid, strip, and Hald layouts at the required dimensions", async () => {
    const dimensions: Array<[number, number]> = [];
    const originalImageData = globalThis.ImageData;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    class FakeImageData {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    }
    class FakeCanvas {
      constructor(public width: number, public height: number) {
        dimensions.push([width, height]);
      }
      getContext() { return { putImageData() {} }; }
      async convertToBlob() { return new Blob(["png"], { type: "image/png" }); }
    }
    Object.assign(globalThis, { ImageData: FakeImageData, OffscreenCanvas: FakeCanvas });
    try {
      const baked = identity(16);
      for (const layout of ["grid", "strip", "cube"] as const) {
        const result = await writeLUT(baked, {
          extension: ".png", layout, size: 16, title: "Texture",
        });
        expect(result.mimeType).toBe("image/png");
      }
      expect(dimensions).toEqual([[64, 64], [256, 16], [64, 64]]);
    } finally {
      Object.assign(globalThis, {
        ImageData: originalImageData,
        OffscreenCanvas: originalOffscreenCanvas,
      });
    }
  });

  it("rejects unsupported output formats with a useful message", async () => {
    await expect(
      writeLUT(identity(), {
        extension: ".invalid",
        layout: "cube",
        size: 2,
        title: "Test",
      }),
    ).rejects.toThrow('Unsupported LUT format ".invalid"');
  });
});
