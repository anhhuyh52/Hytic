import type { VideoMetadata } from "./types";

export const UNSUPPORTED_VIDEO_CODEC_MESSAGE = "This video codec is not supported by your browser.";

export type ProbedVideo = {
  metadata: VideoMetadata;
  poster: Blob;
};

async function inspectContainer(file: File): Promise<Partial<VideoMetadata>> {
  const { Input, ALL_FORMATS, BlobSource } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [duration, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!videoTrack) throw new Error("The file does not contain a video track.");
    if (await videoTrack.hasHighDynamicRange()) {
      throw new Error("HDR PQ/HLG video is not supported yet. Convert this clip to SDR Rec.709.");
    }
    const [width, height, rotation, videoCodec, audioCodec] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      videoTrack.getRotation(),
      videoTrack.getCodecParameterString(),
      audioTrack?.getCodecParameterString() ?? Promise.resolve(null),
    ]);
    return {
      durationUs: Math.max(1, Math.round(duration * 1_000_000)),
      width,
      height,
      rotation,
      videoCodec: videoCodec ?? undefined,
      audioCodec: audioCodec ?? undefined,
      hasAudio: Boolean(audioTrack),
      colorSpace: "rec709",
    };
  } finally {
    input.dispose();
  }
}

function containerFor(file: File): VideoMetadata["container"] {
  if (/\.webm$/i.test(file.name) || file.type === "video/webm") return "webm";
  if (/\.mov$/i.test(file.name) || file.type === "video/quicktime") return "mov";
  if (/\.(mp4|m4v)$/i.test(file.name) || file.type === "video/mp4") return "mp4";
  return "unknown";
}

async function frameToPoster(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create the video poster.");
  context.drawImage(video, 0, 0, width, height);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
}

export function probeVideoFile(file: File): Promise<ProbedVideo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    if (file.type && video.canPlayType(file.type) === "") {
      reject(new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE));
      return;
    }
    const url = URL.createObjectURL(file);
    let timeout = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE));
    };
    video.addEventListener("error", () => fail(new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE)), {
      once: true,
    });
    video.addEventListener(
      "loadeddata",
      () => {
        void (async () => {
          try {
            if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
              throw new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE);
            }
            const [poster, inspected] = await Promise.all([
              frameToPoster(video),
              inspectContainer(file),
            ]);
            if (settled) return;
            settled = true;
            const metadata: VideoMetadata = {
              durationUs: Math.max(1, Math.round(video.duration * 1_000_000)),
              width: video.videoWidth,
              height: video.videoHeight,
              rotation: 0,
              container: containerFor(file),
              hasAudio: false,
              colorSpace: "rec709",
              ...inspected,
            };
            cleanup();
            resolve({ metadata, poster });
          } catch (error) {
            fail(error);
          }
        })();
      },
      { once: true },
    );
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    timeout = window.setTimeout(() => fail(new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE)), 20_000);
    video.src = url;
    video.load();
  });
}
