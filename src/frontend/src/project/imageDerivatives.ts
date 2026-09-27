export type ImageDerivativeOptions = {
  maxLongEdge: number;
  mimeType: "image/jpeg" | "image/webp" | "image/png";
  quality: number;
};

export const THUMBNAIL_LONG_EDGE = 640;
export const THUMBNAIL_JPEG_QUALITY = 0.76;

export const GALLERY_PREVIEW_LONG_EDGE = 2560;
export const GALLERY_PREVIEW_JPEG_QUALITY = 0.84;

type DerivativeWorkerResponse =
  | { id: number; ok: true; blobs: Blob[] }
  | { id: number; ok: false; error: string };

type PendingDerivative = {
  resolve: (blobs: Blob[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let derivativeWorker: Worker | undefined;
let nextDerivativeId = 1;
const pendingDerivatives = new Map<number, PendingDerivative>();
const DERIVATIVE_TIMEOUT_MS = 180_000;

function resetDerivativeWorker(error: Error): void {
  for (const pending of pendingDerivatives.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingDerivatives.clear();
  derivativeWorker?.terminate();
  derivativeWorker = undefined;
}

function getDerivativeWorker(): Worker {
  if (derivativeWorker) return derivativeWorker;
  derivativeWorker = new Worker(new URL("./imageDerivativeWorker.ts", import.meta.url), {
    type: "module",
    name: "image-derivatives",
  });
  derivativeWorker.onmessage = (event: MessageEvent<DerivativeWorkerResponse>) => {
    const message = event.data;
    const pending = pendingDerivatives.get(message.id);
    if (!pending) return;
    pendingDerivatives.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.blobs);
    else pending.reject(new Error(message.error));
  };
  derivativeWorker.onerror = (event) => {
    resetDerivativeWorker(new Error(event.message || "Image derivative worker failed"));
  };
  return derivativeWorker;
}

/**
 * Generates several sizes in one worker job. The source bitmap is consumed; this
 * prevents duplicate full-resolution decodes and keeps large-image resampling and
 * JPEG encoding off the browser's UI thread.
 */
export async function createImageDerivatives(
  source: ImageData | ImageBitmap | Blob,
  options: readonly ImageDerivativeOptions[],
): Promise<Blob[]> {
  if (!options.length) return [];
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return Promise.all(options.map((option) => createImageDerivative(source, option)));
  }

  const bitmap =
    typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap
      ? source
      : await createImageBitmap(source, {
          imageOrientation: source instanceof Blob ? "from-image" : "none",
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        });
  const id = nextDerivativeId++;
  return new Promise<Blob[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendingDerivatives.has(id)) return;
      resetDerivativeWorker(new Error("Image derivative generation timed out"));
    }, DERIVATIVE_TIMEOUT_MS);
    pendingDerivatives.set(id, { resolve, reject, timer });
    try {
      getDerivativeWorker().postMessage({ id, bitmap, specs: options }, [bitmap]);
    } catch (error) {
      clearTimeout(timer);
      pendingDerivatives.delete(id);
      bitmap.close();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Aspect-preserving downscale to a max side. */
function aspectResize(width: number, height: number, max: number): [number, number] {
  if (Math.max(width, height) <= max) return [width, height];
  const aspect = width / height;
  return width > height ? [max, Math.round(max / aspect)] : [Math.round(max * aspect), max];
}

/**
 * Creates a lightweight image derivative (e.g. thumbnail or preview)
 * from decoded pixel data (ImageData, ImageBitmap) or a Blob.
 */
export async function createImageDerivative(
  source: ImageData | ImageBitmap | Blob,
  options: ImageDerivativeOptions,
): Promise<Blob> {
  let sourceWidth = 0;
  let sourceHeight = 0;
  let bitmapToClose: ImageBitmap | undefined;
  let imageBitmap: ImageBitmap | undefined;
  let imageElement: HTMLImageElement | undefined;
  let objectUrlToRevoke: string | undefined;

  try {
    if (source instanceof Blob) {
      if (typeof createImageBitmap !== "undefined") {
        imageBitmap = await createImageBitmap(source);
        bitmapToClose = imageBitmap;
        sourceWidth = imageBitmap.width;
        sourceHeight = imageBitmap.height;
      } else {
        imageElement = new Image();
        imageElement.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          if (!imageElement) return reject(new Error("Image undefined"));
          imageElement.onerror = reject;
          imageElement.onload = () => resolve();
          objectUrlToRevoke = URL.createObjectURL(source);
          imageElement.src = objectUrlToRevoke;
        });
        sourceWidth = imageElement.naturalWidth;
        sourceHeight = imageElement.naturalHeight;
      }
    } else if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      imageBitmap = source;
      sourceWidth = source.width;
      sourceHeight = source.height;
    } else if (source instanceof ImageData) {
      sourceWidth = source.width;
      sourceHeight = source.height;
      if (typeof createImageBitmap !== "undefined") {
        imageBitmap = await createImageBitmap(source);
        bitmapToClose = imageBitmap;
      }
    } else {
      throw new Error("Unsupported source type for derivative generation");
    }

    const [width, height] = aspectResize(sourceWidth, sourceHeight, options.maxLongEdge);
    let blob: Blob | null = null;

    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context on OffscreenCanvas");

      // Use high quality image smoothing if we are downscaling significantly
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (imageBitmap) {
        ctx.drawImage(imageBitmap, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
      } else if (imageElement) {
        ctx.drawImage(imageElement, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
      } else if (source instanceof ImageData) {
        // Fallback for ImageData without createImageBitmap support (unlikely but safe)
        const tempCanvas = Object.assign(document.createElement("canvas"), {
          width: sourceWidth,
          height: sourceHeight,
        });
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.putImageData(source, 0, 0);
          ctx.drawImage(tempCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
        }
      }

      if ("convertToBlob" in canvas) {
        blob = await canvas.convertToBlob({ type: options.mimeType, quality: options.quality });
      } else {
        // Fallback if convertToBlob doesn't exist on OffscreenCanvas (Safari)
        blob = await new Promise<Blob | null>((resolve) => {
          (canvas as unknown as HTMLCanvasElement).toBlob(
            (b) => resolve(b),
            options.mimeType,
            options.quality,
          );
        });
      }
    } else {
      // Fallback to regular DOM canvas
      const canvas = Object.assign(document.createElement("canvas"), { width, height });
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context on HTMLCanvasElement");

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (imageBitmap) {
        ctx.drawImage(imageBitmap, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
      } else if (imageElement) {
        ctx.drawImage(imageElement, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
      } else if (source instanceof ImageData) {
        const tempCanvas = Object.assign(document.createElement("canvas"), {
          width: sourceWidth,
          height: sourceHeight,
        });
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.putImageData(source, 0, 0);
          ctx.drawImage(tempCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
        }
      }

      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), options.mimeType, options.quality);
      });
    }

    if (!blob) throw new Error("Failed to encode derivative blob");
    return blob;
  } finally {
    if (bitmapToClose) {
      bitmapToClose.close();
    }
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}
