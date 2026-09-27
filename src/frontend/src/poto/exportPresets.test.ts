import { describe, expect, it } from "vitest";
import { estimateExportBytes, formatEstimatedBytes } from "./exportPresets";

describe("export size estimates", () => {
  it("scales with pixel count", () => {
    const small = estimateExportBytes(1000, 1000, "jpg", 0.9);
    const large = estimateExportBytes(2000, 2000, "jpg", 0.9);
    expect(large).toBeGreaterThan(small * 3.9);
    expect(large).toBeLessThan(small * 4.1);
  });

  it("reflects lossy quality and lossless format cost", () => {
    const low = estimateExportBytes(2000, 1000, "jpg", 0.8);
    const high = estimateExportBytes(2000, 1000, "jpg", 1);
    const tiff = estimateExportBytes(2000, 1000, "tif");
    expect(high).toBeGreaterThan(low);
    expect(tiff).toBeGreaterThan(high);
  });

  it("formats readable units", () => {
    expect(formatEstimatedBytes(512 * 1024)).toBe("512 KB");
    expect(formatEstimatedBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });
});
