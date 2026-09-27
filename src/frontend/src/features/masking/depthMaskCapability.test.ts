import { describe, expect, it } from "vitest";
import { evaluateDepthMaskCapability, normalizeDepthSamples } from "./depthMaskCapability";

describe("depth mask capability", () => {
  it("requires both ready status and a GPU texture", () => {
    expect(evaluateDepthMaskCapability({ metadataHasDepth: true, status: "ready", hasTexture: false })).toMatchObject({ available: false, reason: "depth-texture-missing" });
    expect(evaluateDepthMaskCapability({ metadataHasDepth: true, status: "ready", hasTexture: true })).toEqual({ available: true, status: "ready", reason: null });
  });

  it("distinguishes loading, decode failure, and absent metadata", () => {
    expect(evaluateDepthMaskCapability({ metadataHasDepth: false, status: "unavailable", hasTexture: false }).reason).toBe("no-depth-data");
    expect(evaluateDepthMaskCapability({ metadataHasDepth: true, status: "loading", hasTexture: false }).reason).toBe("depth-loading");
    expect(evaluateDepthMaskCapability({ metadataHasDepth: true, status: "error", hasTexture: false }).reason).toBe("depth-decode-failed");
  });

  it("normalizes all decoders to 0 near / 1 far", () => {
    expect([...normalizeDepthSamples([10, 20, 30])]).toEqual([0, 0.5, 1]);
    expect([...normalizeDepthSamples([10, 20, 30], true)]).toEqual([1, 0.5, 0]);
  });
});
