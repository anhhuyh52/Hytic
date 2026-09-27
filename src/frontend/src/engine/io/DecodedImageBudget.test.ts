import { describe, expect, it } from "vitest";
import {
  MAX_DECODED_PIXELS,
  assertDecodedImageWithinBudget,
  isDecodedImageWithinBudget,
} from "./DecodedImageBudget";

describe("decoded image budget", () => {
  it("accepts typical high-resolution camera images", () => {
    expect(isDecodedImageWithinBudget(9504, 6336)).toBe(true);
  });

  it("accepts the exact pixel boundary", () => {
    expect(isDecodedImageWithinBudget(8192, 8192)).toBe(true);
    expect(8192 * 8192).toBe(MAX_DECODED_PIXELS);
  });

  it("rejects oversized and invalid dimensions", () => {
    expect(isDecodedImageWithinBudget(100_000, 100_000)).toBe(false);
    expect(isDecodedImageWithinBudget(0, 100)).toBe(false);
    expect(() => assertDecodedImageWithinBudget(100_000, 100_000, "TIFF")).toThrow(
      /safe browser decode limit/,
    );
  });
});
