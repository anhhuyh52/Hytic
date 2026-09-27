import { describe, expect, it } from "vitest";
import { needsMp4Normalization } from "./transcodeToMp4";

describe("needsMp4Normalization", () => {
  it("skips files already in an MP4 container", () => {
    expect(needsMp4Normalization(new File([], "clip.mp4", { type: "video/mp4" }))).toBe(false);
    expect(needsMp4Normalization(new File([], "clip.m4v", { type: "" }))).toBe(false);
    // Even a quirky MIME is fine when the extension says mp4.
    expect(needsMp4Normalization(new File([], "clip.mp4", { type: "video/quicktime" }))).toBe(false);
  });

  it("normalizes QuickTime and other non-MP4 containers", () => {
    expect(needsMp4Normalization(new File([], "clip.mov", { type: "video/quicktime" }))).toBe(true);
    expect(needsMp4Normalization(new File([], "clip.mov", { type: "" }))).toBe(true);
    expect(needsMp4Normalization(new File([], "clip.avi", { type: "video/x-msvideo" }))).toBe(true);
    expect(needsMp4Normalization(new File([], "clip.mkv", { type: "video/x-matroska" }))).toBe(true);
  });

  it("ignores non-video files", () => {
    expect(needsMp4Normalization(new File([], "photo.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});
