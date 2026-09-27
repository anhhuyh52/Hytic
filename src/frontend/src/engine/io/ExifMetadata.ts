// EXIF metadata read (import) + preserve/clean (export) via ExifReader (read) and raw JPEG
// APP1 copy (write). ExifReader only parses, so "preserve" copies the source JPEG's APP1 Exif
// segment verbatim into the exported JPEG; "clean" simply omits it (the default for re-encode).
// ExifReader is dynamically imported so it never bloats the engine/Viewer startup chunk.

export type ExifFields = {
  make?: string;
  model?: string;
  cameraModel?: string;
  lens?: string;
  iso?: number;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  capturedAt?: string;
  software?: string;
  orientation?: number;
  iccProfileDetected?: boolean;
  iccProfileDescription?: string;
  iccColorSpace?: string;
};

function str(tag: { description?: unknown; value?: unknown } | undefined): string | undefined {
  if (!tag) return undefined;
  const d = tag.description ?? tag.value;
  if (d === undefined || d === null) return undefined;
  const s = String(Array.isArray(d) ? d.join(" ") : d)
    .replace(/\0+$/, "")
    .trim();
  return s || undefined;
}

/** Parses EXIF/IPTC/XMP fields from an image blob. Never throws (returns {} on any failure). */
export async function readExif(blob: Blob): Promise<ExifFields> {
  try {
    const { default: ExifReader } = await import("exifreader");
    const buffer = await blob.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tags = ExifReader.load(buffer) as Record<string, any>;
    const make = str(tags.Make);
    const model = str(tags.Model);
    const isoTag = tags.ISOSpeedRatings ?? tags.PhotographicSensitivity ?? tags.ISO;
    const iso =
      isoTag?.value != null
        ? Number(Array.isArray(isoTag.value) ? isoTag.value[0] : isoTag.value)
        : undefined;
    const orientationVal = tags.Orientation?.value;
    const iccProfileDescription = str(tags["ICC Description"] ?? tags.ProfileDescription);
    const iccSignature = str(tags["ICC Signature"]);
    const iccProfileDetected = Boolean(
      tags.ICC_Profile ||
      iccProfileDescription ||
      iccSignature?.toLowerCase() === "acsp" ||
      (tags["Profile Version"] && tags["Profile/Device class"]),
    );
    const iccColorSpace = iccProfileDetected ? str(tags["Color Space"]) : undefined;
    return {
      make,
      model,
      cameraModel: [make, model].filter(Boolean).join(" ") || undefined,
      lens: str(tags.LensModel ?? tags.Lens),
      iso: Number.isFinite(iso) ? iso : undefined,
      aperture: str(tags.FNumber ?? tags.ApertureValue),
      shutterSpeed: str(tags.ExposureTime ?? tags.ShutterSpeedValue),
      focalLength: str(tags.FocalLength),
      capturedAt: str(tags.DateTimeOriginal ?? tags.DateTime ?? tags.CreateDate),
      software: str(tags.Software),
      orientation: typeof orientationVal === "number" ? orientationVal : undefined,
      iccProfileDetected,
      iccProfileDescription,
      iccColorSpace,
    };
  } catch {
    return {};
  }
}

/** Finds the APP1 "Exif\0\0" segment in a JPEG (FFE1) and returns the full marker+payload bytes. */
export function extractJpegExifApp1(jpeg: Uint8Array): Uint8Array | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null; // not a JPEG
  let p = 2;
  while (p + 4 < jpeg.length) {
    if (jpeg[p] !== 0xff) break;
    const marker = jpeg[p + 1];
    if (marker === 0xda) break; // SOS — image data starts, no more headers
    const len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    if (
      marker === 0xe1 &&
      jpeg[p + 4] === 0x45 &&
      jpeg[p + 5] === 0x78 &&
      jpeg[p + 6] === 0x69 &&
      jpeg[p + 7] === 0x66 // "Exif"
    ) {
      return jpeg.slice(p, p + 2 + len);
    }
    p += 2 + len;
  }
  return null;
}

/**
 * Copies the source JPEG's EXIF (APP1) into the exported JPEG blob (preserve-on-export). Only
 * JPEG→JPEG is supported; returns the output unchanged otherwise. The graded pixels are already
 * oriented, so the copied EXIF Orientation is normalized to 1 to avoid a double-rotation.
 */
export async function copyJpegExif(outBlob: Blob, sourceBlob: Blob): Promise<Blob> {
  if (outBlob.type !== "image/jpeg") return outBlob;
  try {
    const src = new Uint8Array(await sourceBlob.arrayBuffer());
    if (src[0] !== 0xff || src[1] !== 0xd8) return outBlob; // source isn't JPEG
    const app1 = extractJpegExifApp1(src);
    if (!app1) return outBlob;
    normalizeExifOrientation(app1);
    const out = new Uint8Array(await outBlob.arrayBuffer());
    return new Blob([injectJpegExifApp1(out, app1)], { type: outBlob.type });
  } catch {
    return outBlob;
  }
}

/** Sets the EXIF Orientation tag (if present) to 1 in a raw APP1 segment (pixels already oriented). */
function normalizeExifOrientation(app1: Uint8Array): void {
  // APP1 = FF E1, len(2), "Exif\0\0"(6), then TIFF header. Find the IFD0 Orientation tag (0x0112).
  const tiff = 4 + 6;
  if (app1.length < tiff + 8) return;
  const le = app1[tiff] === 0x49 && app1[tiff + 1] === 0x49;
  const dv = new DataView(app1.buffer, app1.byteOffset, app1.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > app1.length) return;
  const count = u16(ifd0);
  for (let i = 0; i < count; i += 1) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > app1.length) break;
    if (u16(e) === 0x0112) {
      dv.setUint16(e + 8, 1, le); // Orientation value (SHORT, inline)
      return;
    }
  }
}

/** Inserts an APP1 segment into a JPEG right after SOI, replacing any existing APP1. */
export function injectJpegExifApp1(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  // Skip a JFIF APP0 if present (keep it before our APP1), then drop any existing APP1.
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    insertAt = 4 + ((jpeg[4] << 8) | jpeg[5]);
  }
  let rest = jpeg.subarray(insertAt);
  if (rest[0] === 0xff && rest[1] === 0xe1) {
    const len = (rest[2] << 8) | rest[3];
    rest = rest.subarray(2 + len); // drop the existing APP1
  }
  const out = new Uint8Array(insertAt + app1.length + rest.length);
  out.set(jpeg.subarray(0, insertAt), 0);
  out.set(app1, insertAt);
  out.set(rest, insertAt + app1.length);
  return out;
}
