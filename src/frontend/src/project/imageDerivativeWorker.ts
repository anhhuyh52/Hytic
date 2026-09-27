/// <reference lib="webworker" />

type DerivativeSpec = {
  maxLongEdge: number;
  mimeType: "image/jpeg" | "image/webp" | "image/png";
  quality: number;
};

type Request = {
  id: number;
  bitmap: ImageBitmap;
  specs: DerivativeSpec[];
};

type Response = { id: number; ok: true; blobs: Blob[] } | { id: number; ok: false; error: string };

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Response): void;
};

function dimensions(width: number, height: number, max: number): [number, number] {
  if (Math.max(width, height) <= max) return [width, height];
  const scale = max / Math.max(width, height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

worker.onmessage = async (event) => {
  const { id, bitmap, specs } = event.data;
  try {
    // Generate the largest derivative first, then use it as the source for the
    // smaller ones. A 60 MP source is sampled only once and all canvas/encoding
    // work stays off the UI thread.
    const ordered = specs
      .map((spec, index) => ({ spec, index }))
      .sort((a, b) => b.spec.maxLongEdge - a.spec.maxLongEdge);
    const blobs = new Array<Blob>(specs.length);
    let source: CanvasImageSource = bitmap;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;

    for (const { spec, index } of ordered) {
      const [width, height] = dimensions(sourceWidth, sourceHeight, spec.maxLongEdge);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Unable to create derivative canvas");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
      blobs[index] = await canvas.convertToBlob({
        type: spec.mimeType,
        quality: spec.quality,
      });
      source = canvas;
      sourceWidth = width;
      sourceHeight = height;
    }
    bitmap.close();
    worker.postMessage({ id, ok: true, blobs });
  } catch (error) {
    bitmap.close();
    worker.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
