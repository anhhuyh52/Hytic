import type { SerializedVideoState } from "./types";

export type VideoExportContainer = "mp4" | "webm";

export type VideoExportRequest = {
  file: File;
  trim: SerializedVideoState;
  container: VideoExportContainer;
  renderFrame(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    canvas: OffscreenCanvas,
  ): { width: number; height: number };
  signal?: AbortSignal;
  onProgress?(progress: number): void;
};

export type VideoExportCapability = {
  supported: boolean;
  container: VideoExportContainer;
  videoCodec: "avc" | "vp9";
  audioCodec: "aac" | "opus";
  reason?: string;
};

export type VideoExportArtifact = {
  blob: Blob;
  dispose(): Promise<void>;
};

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Video export cancelled", "AbortError");
}

export async function checkVideoExportCapability(
  container: VideoExportContainer,
  width: number,
  height: number,
  audio?: { numberOfChannels: number; sampleRate: number },
): Promise<VideoExportCapability> {
  const { canEncodeVideo, canEncodeAudio, QUALITY_HIGH } = await import("mediabunny");
  const videoCodec = container === "mp4" ? "avc" : "vp9";
  const audioCodec = container === "mp4" ? "aac" : "opus";
  const [videoOk, audioOk] = await Promise.all([
    canEncodeVideo(videoCodec, { width, height, bitrate: QUALITY_HIGH }),
    audio ? canEncodeAudio(audioCodec, { ...audio, bitrate: 192_000 }) : Promise.resolve(true),
  ]);
  return {
    supported: videoOk && audioOk,
    container,
    videoCodec,
    audioCodec,
    reason: !videoOk
      ? `${videoCodec.toUpperCase()} video encoding is unavailable in this browser.`
      : !audioOk
        ? `${audioCodec.toUpperCase()} audio encoding is unavailable in this browser.`
        : undefined,
  };
}

export async function exportGradedVideo(request: VideoExportRequest): Promise<VideoExportArtifact> {
  const media = await import("mediabunny");
  const {
    Input,
    ALL_FORMATS,
    BlobSource,
    Output,
    BufferTarget,
    StreamTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    CanvasSource,
    AudioSampleSink,
    AudioSampleSource,
    VideoSampleSink,
    QUALITY_HIGH,
  } = media;
  abortIfNeeded(request.signal);
  const start = request.trim.trimStartUs / 1_000_000;
  const end = request.trim.trimEndUs / 1_000_000;
  if (!(end > start)) throw new Error("Choose a non-empty video range before exporting.");

  const input = new Input({ source: new BlobSource(request.file), formats: ALL_FORMATS });
  let tempDirectory: FileSystemDirectoryHandle | undefined;
  let tempFileHandle: FileSystemFileHandle | undefined;
  let tempFileName = "";
  let target: InstanceType<typeof BufferTarget> | InstanceType<typeof StreamTarget>;
  try {
    const root = await navigator.storage.getDirectory();
    tempDirectory = await root.getDirectoryHandle("kalar-video-exports", { create: true });
    tempFileName = `${crypto.randomUUID()}.${request.container}`;
    tempFileHandle = await tempDirectory.getFileHandle(tempFileName, { create: true });
    const writable = await tempFileHandle.createWritable();
    target = new StreamTarget(writable);
  } catch {
    // Private browsing and restricted storage contexts may not expose OPFS.
    target = new BufferTarget();
    tempDirectory = undefined;
    tempFileHandle = undefined;
    tempFileName = "";
  }
  const output = new Output({
    format: request.container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target,
  });
  let closePendingVideoSample: (() => void) | undefined;
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!videoTrack) throw new Error("The source has no video track.");

    const sink = new VideoSampleSink(videoTrack);
    const samples = sink.samples(start, end)[Symbol.asyncIterator]();
    let nextSample = await samples.next();
    if (nextSample.done) throw new Error("The selected range contains no decodable video frames.");
    closePendingVideoSample = () => {
      if (!nextSample.done) nextSample.value.close();
    };

    const sourceCanvas = new OffscreenCanvas(
      nextSample.value.displayWidth,
      nextSample.value.displayHeight,
    );
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("Unable to create the decoded-frame canvas.");
    nextSample.value.draw(sourceContext, 0, 0, sourceCanvas.width, sourceCanvas.height);

    const canvas = new OffscreenCanvas(1, 1);
    const size = request.renderFrame(sourceCanvas, sourceCanvas.width, sourceCanvas.height, canvas);
    const audioConfig = audioTrack
      ? {
          numberOfChannels: await audioTrack.getNumberOfChannels(),
          sampleRate: await audioTrack.getSampleRate(),
        }
      : undefined;
    const capability = await checkVideoExportCapability(
      request.container,
      size.width,
      size.height,
      audioConfig,
    );
    if (!capability.supported) throw new Error(capability.reason);

    const videoSource = new CanvasSource(canvas, {
      codec: capability.videoCodec,
      bitrate: QUALITY_HIGH,
      latencyMode: "quality",
    });
    output.addVideoTrack(videoSource);
    const audioSource = audioTrack
      ? new AudioSampleSource({ codec: capability.audioCodec, bitrate: 192_000 })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    let renderedSample = nextSample.value;
    const encodeVideo = async () => {
      let frame = 0;
      while (!nextSample.done) {
        const sample = nextSample.value;
        try {
          abortIfNeeded(request.signal);
          if (sample !== renderedSample) {
            sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            sample.draw(sourceContext, 0, 0, sourceCanvas.width, sourceCanvas.height);
            request.renderFrame(sourceCanvas, sourceCanvas.width, sourceCanvas.height, canvas);
            renderedSample = sample;
          }
          const sampleStart = Math.max(start, sample.timestamp);
          const sampleEnd = Math.min(end, sample.timestamp + sample.duration);
          if (sampleEnd <= sampleStart) {
            nextSample = await samples.next();
            continue;
          }
          await videoSource.add(
            sampleStart - start,
            sampleEnd - sampleStart,
            frame % 60 === 0 ? { keyFrame: true } : undefined,
          );
          frame += 1;
          request.onProgress?.(
            Math.max(0, Math.min(0.95, (sample.timestamp - start) / (end - start))),
          );
        } finally {
          sample.close();
        }
        nextSample = await samples.next();
      }
      videoSource.close();
    };

    const encodeAudio = async () => {
      if (!audioTrack || !audioSource) return;
      const sink = new AudioSampleSink(audioTrack);
      for await (const sample of sink.samples(start, end)) {
        try {
          abortIfNeeded(request.signal);
          sample.setTimestamp(Math.max(0, sample.timestamp - start));
          await audioSource.add(sample);
        } finally {
          sample.close();
        }
      }
      audioSource.close();
    };

    await Promise.all([encodeVideo(), encodeAudio()]);
    await output.finalize();
    request.onProgress?.(1);
    const mimeType = request.container === "mp4" ? "video/mp4" : "video/webm";
    const blob =
      target instanceof BufferTarget
        ? target.buffer
          ? new Blob([target.buffer], { type: mimeType })
          : null
        : tempFileHandle
          ? await tempFileHandle.getFile()
          : null;
    if (!blob) throw new Error("Video encoder produced no output.");
    return {
      blob,
      async dispose() {
        if (!tempDirectory || !tempFileName) return;
        await tempDirectory.removeEntry(tempFileName).catch(() => {});
      },
    };
  } catch (error) {
    if (output.state === "started") await output.cancel().catch(() => {});
    if (tempDirectory && tempFileName) {
      await tempDirectory.removeEntry(tempFileName).catch(() => {});
    }
    throw error;
  } finally {
    closePendingVideoSample?.();
    input.dispose();
  }
}
