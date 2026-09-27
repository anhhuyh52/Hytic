// Normalize a dropped video into a browser-editable MP4.
//
// The live editor renders from a real <video> element (Engine.installVideoSource)
// and the importer probes with one too, so a clip is only editable if the browser
// can play it. Chrome routinely refuses `video/quicktime` even when the .mov holds
// plain H.264 — so rather than reject, we re-wrap the file as MP4 via mediabunny's
// high-level Conversion. When the source codec is already MP4-compatible
// (H.264/H.265/AV1) this is a fast, lossless container remux (passthrough); only
// genuinely incompatible codecs are re-encoded. Codecs WebCodecs can't decode at
// all (e.g. Apple ProRes, DNxHD) surface as an invalid conversion and throw an
// `UnconvertibleVideoError` so the UI can point the user at supported formats.

const MP4_NAME = /\.[^.]+$/;

export class UnconvertibleVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconvertibleVideoError";
  }
}

export type ConvertToMp4Options = {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

/** True for containers the browser may refuse to play and that benefit from remux. */
export function needsMp4Normalization(file: Blob & { name?: string; type?: string }): boolean {
  const name = file.name ?? "";
  const type = file.type ?? "";
  if (type === "video/mp4" || /\.(mp4|m4v)$/i.test(name)) return false;
  return (
    type === "video/quicktime" ||
    type === "video/x-msvideo" ||
    type === "video/x-matroska" ||
    /\.(mov|avi|mkv)$/i.test(name)
  );
}

function mp4Name(originalName: string): string {
  const stem = originalName.replace(MP4_NAME, "");
  return `${stem || "video"}.mp4`;
}

/**
 * Convert `file` to an MP4 `File` the browser can decode and edit. Resolves to a
 * new File (`*.mp4`, `video/mp4`); throws `UnconvertibleVideoError` when the
 * source can't be decoded in-browser (e.g. ProRes).
 */
export async function convertToMp4(file: File, options: ConvertToMp4Options = {}): Promise<File> {
  const { Input, ALL_FORMATS, BlobSource, Output, BufferTarget, Mp4OutputFormat, Conversion } =
    await import("mediabunny");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });

  const conversion = await Conversion.init({ input, output });
  if (options.onProgress) {
    conversion.onProgress = (progress) => options.onProgress!(progress);
  }

  let disposed = false;
  const disposeInput = () => {
    if (disposed) return;
    disposed = true;
    input.dispose();
  };

  try {
    // A clip is only editable if its VIDEO track makes it into the output. `isValid`
    // alone isn't enough: a ProRes .mov with a decodable AAC track stays "valid" but
    // would yield an audio-only MP4, so reject when any video track was discarded.
    const discardedVideo = conversion.discardedTracks.filter((entry) => entry.track.isVideoTrack());
    if (!conversion.isValid || discardedVideo.length > 0) {
      // mediabunny (WebCodecs) can't decode this codec. We no longer ship the heavy
      // ffmpeg.wasm fallback, so professional codecs like Apple ProRes or DNxHD are
      // unsupported — reject with a clear error the importer turns into a dialog.
      await conversion.cancel().catch(() => {});
      throw new UnconvertibleVideoError(
        "This video uses a codec your browser can't decode (for example Apple ProRes).",
      );
    }

    if (options.signal?.aborted) {
      throw new DOMException("Video conversion cancelled", "AbortError");
    }
    options.signal?.addEventListener("abort", () => void conversion.cancel(), { once: true });

    await conversion.execute();

    const buffer = target.buffer;
    if (!buffer) throw new UnconvertibleVideoError("The video converter produced no output.");
    return new File([buffer], mp4Name(file.name), { type: "video/mp4" });
  } finally {
    disposeInput();
  }
}
