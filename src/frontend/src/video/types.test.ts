import { describe, expect, it } from "vitest";
import { clampVideoTrim, isVideoFile } from "./types";

describe("video media contracts", () => {
  it("defaults an empty end boundary to the full duration", () => {
    expect(clampVideoTrim({ trimStartUs: 0, trimEndUs: 0 }, 2_000_000)).toEqual({
      trimStartUs: 0,
      trimEndUs: 2_000_000,
    });
  });

  it("keeps at least one frame when either trim handle crosses", () => {
    expect(clampVideoTrim({ trimStartUs: 950_000, trimEndUs: 940_000 }, 1_000_000, 40_000)).toEqual(
      { trimStartUs: 950_000, trimEndUs: 990_000 },
    );
  });

  it("clamps a final-frame selection against duration", () => {
    expect(
      clampVideoTrim({ trimStartUs: 999_000, trimEndUs: 1_500_000 }, 1_000_000, 40_000),
    ).toEqual({ trimStartUs: 960_000, trimEndUs: 1_000_000 });
  });

  it("detects video from MIME type or extension", () => {
    expect(isVideoFile(new File([], "clip.bin", { type: "video/mp4" }))).toBe(true);
    expect(isVideoFile(new File([], "clip.webm"))).toBe(true);
    expect(isVideoFile(new File([], "photo.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});
