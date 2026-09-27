/** Legacy Hm: extract the first decodable video frame and import it as a PNG file. */
export const UNSUPPORTED_VIDEO_CODEC_MESSAGE = "This video codec is not supported by your browser.";

export function extractVideoFrameFile(file: File): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    const video = document.createElement("video");
    if (file.type && video.canPlayType(file.type) === "") {
      reject(new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE));
      return;
    }
    const url = URL.createObjectURL(file);
    let settled = false;
    let timeout = 0;

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    const finish = (value: File | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const onError = () => {
      finish(new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE));
    };
    const onLoaded = () => {
      window.setTimeout(() => {
        void (async () => {
          try {
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) throw new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE);
            let blob: Blob;
            if (typeof OffscreenCanvas !== "undefined") {
              const canvas = new OffscreenCanvas(width, height);
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Unable to create the video frame canvas.");
              context.drawImage(video, 0, 0, width, height);
              blob = await canvas.convertToBlob({ type: "image/png" });
            } else {
              const canvas = Object.assign(document.createElement("canvas"), { width, height });
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Unable to create the video frame canvas.");
              context.drawImage(video, 0, 0, width, height);
              blob = await new Promise<Blob>((resolveBlob, rejectBlob) =>
                canvas.toBlob(
                  (result: Blob | null) =>
                    result
                      ? resolveBlob(result)
                      : rejectBlob(new Error("Unable to encode video frame.")),
                  "image/png",
                ),
              );
            }
            const dot = file.name.lastIndexOf(".");
            const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
            finish(new File([blob], `${stem}_thumbnail.png`, { type: "image/png" }));
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      }, 10);
    };

    video.muted = true;
    video.loop = true;
    video.preload = "auto";
    video.playsInline = true;
    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    timeout = window.setTimeout(() => finish(new Error(UNSUPPORTED_VIDEO_CODEC_MESSAGE)), 15000);
    video.src = url;
    video.load();
  });
}
