export type MediaKind = "image" | "video";

export type VideoColorSpace = "rec709" | "srgb" | "pq" | "hlg" | "unknown";

export type VideoMetadata = {
  durationUs: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  container: "mp4" | "webm" | "mov" | "unknown";
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  nominalFrameRate?: number;
  colorSpace: VideoColorSpace;
};

export type SerializedVideoState = {
  trimStartUs: number;
  trimEndUs: number;
};

export type VideoPlaybackState = {
  currentTimeUs: number;
  durationUs: number;
  playing: boolean;
  muted: boolean;
  volume: number;
};

export type VideoTrimCommit = SerializedVideoState & {
  reason: "trim-start" | "trim-end";
};

export const DEFAULT_VIDEO_STATE: SerializedVideoState = {
  trimStartUs: 0,
  trimEndUs: 0,
};

export function clampVideoTrim(
  value: SerializedVideoState,
  durationUs: number,
  minimumFrameUs = 33_333,
): SerializedVideoState {
  const duration = Math.max(0, Math.round(durationUs));
  const minimum = Math.min(duration, Math.max(1, Math.round(minimumFrameUs)));
  const start = Math.max(0, Math.min(duration, Math.round(value.trimStartUs)));
  const end = Math.max(start, Math.min(duration, Math.round(value.trimEndUs || duration)));
  if (end - start >= minimum) return { trimStartUs: start, trimEndUs: end };
  if (start + minimum <= duration) return { trimStartUs: start, trimEndUs: start + minimum };
  return { trimStartUs: Math.max(0, duration - minimum), trimEndUs: duration };
}

export function isVideoFile(file: Blob & { name?: string }): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(file.name ?? "");
}
