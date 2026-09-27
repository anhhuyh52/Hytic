import { putOverlayLibraryItem } from "../../project/indexedDbProjectStore";
import type { OverlayLibraryItem } from "../../project/ProjectTypes";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function generateThumbnailBlob(file: File | Blob, maxSize: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      
      if (width > maxSize || height > maxSize) {
        const scale = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Failed to get 2d context"));
      
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob failed"));
        },
        "image/jpeg",
        0.8
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for thumbnail"));
    };
    img.src = url;
  });
}

export async function saveOverlayToLibrary(file: File): Promise<OverlayLibraryItem> {
  const thumbnailBlob = await generateThumbnailBlob(file, 200);
  
  const item: OverlayLibraryItem = {
    id: generateId(),
    name: file.name,
    blob: file, // Storing File object (which is a Blob with a name) directly in IndexedDB is supported
    thumbnailBlob,
    addedAt: Date.now(),
  };
  
  await putOverlayLibraryItem(item);
  return item;
}
