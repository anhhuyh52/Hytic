import type { PresentationBorderFrameImage } from "./borderTypes";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read frame image"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

export async function readPresentationFrameImage(file: File): Promise<PresentationBorderFrameImage> {
  const [dataUrl, bitmap] = await Promise.all([readFileAsDataUrl(file), createImageBitmap(file)]);
  try {
    return {
      dataUrl,
      name: file.name || "Frame image",
      width: Math.max(1, bitmap.width),
      height: Math.max(1, bitmap.height),
      rotationDegrees: 0,
    };
  } finally {
    bitmap.close();
  }
}
