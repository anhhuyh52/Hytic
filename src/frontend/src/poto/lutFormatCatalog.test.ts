import { describe, expect, it } from "vitest";
import { deriveLutSettings, LUT_FORMAT_OPTIONS } from "./lutFormatCatalog";

describe("LUT format catalog", () => {
  it("preserves the Cinema4D writer variant while using a .cube filename", () => {
    const option = LUT_FORMAT_OPTIONS.find((item) => item.value === "cube-c4d");
    expect(option).toBeDefined();
    expect(deriveLutSettings(option!, 32)).toMatchObject({
      lutExtension: ".cube",
      lutLayout: "c4d",
      lutSize: 32,
    });
  });

  it("falls back to a destination-supported LUT size", () => {
    const option = LUT_FORMAT_OPTIONS.find((item) => item.label === "Panasonic Varicam");
    expect(option).toBeDefined();
    expect(deriveLutSettings(option!, 64).lutSize).toBe(17);
  });

  it("maps each PNG destination to its declared texture layout", () => {
    for (const value of ["png-grid", "png-strip", "png-cube"] as const) {
      const option = LUT_FORMAT_OPTIONS.find((item) => item.value === value);
      expect(option).toBeDefined();
      expect(deriveLutSettings(option!, option!.sizes[0]).lutLayout).toBe(
        value.replace("png-", ""),
      );
    }
  });
});
