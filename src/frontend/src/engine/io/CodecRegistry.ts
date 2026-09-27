export type SupportedImageFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "gif"
  | "bmp"
  | "video"
  | "heic"
  | "tiff"
  | "dpx"
  | "exr"
  | "raw";

export type DecodeStatus = "supported" | "partial" | "experimental" | "unsupported";

export type ImageIOMatrixFormat =
  | SupportedImageFormat
  | "transparent-png"
  | "raw"
  | "cube"
  | "clf"
  | "zip-project-bundle";

export type FormatSupportDescriptor = {
  format: ImageIOMatrixFormat;
  label: string;
  importStatus: DecodeStatus | "disabled" | "not implemented";
  exportStatus: DecodeStatus | "disabled" | "not implemented";
  decoder: string;
  worker: "main thread" | "worker" | "not wired" | "not applicable";
  wasm: "yes" | "no" | "not wired" | "not applicable";
  metadata: string;
  orientation: string;
  status: DecodeStatus | "disabled" | "not implemented";
  uploadMimeTypes: readonly string[];
  uploadExtensions: readonly string[];
  notes: string;
};

export type CodecFileStatus =
  | "USED"
  | "PRESENT BUT UNUSED"
  | "BROKEN"
  | "DISABLED INTENTIONALLY"
  | "TODO";

export type CodecFileInventoryEntry = {
  fileName: string;
  purpose: string;
  status: CodecFileStatus;
  importPath: string;
  execution: "main thread" | "worker" | "not wired";
  wasmRequirement: "yes" | "no" | "sidecar" | "not applicable";
  limitations: string;
};

// Camera RAW extensions handled by the vendored legacy wlbr LibRaw build.
// Mirrors the legacy app's supported RAW list.
export const RAW_EXTENSION_LIST = [
  ".dng",
  ".cr2",
  ".cr3",
  ".arw",
  ".nef",
  ".nrw",
  ".raf",
  ".dc2",
  ".rdc",
  ".bay",
  ".crw",
  ".cap",
  ".dcs",
  ".dcr",
  ".drf",
  ".eip",
  ".erf",
  ".fff",
  ".iiq",
  ".k25",
  ".kdc",
  ".mdc",
  ".mef",
  ".mos",
  ".mrw",
  ".obm",
  ".orf",
  ".pef",
  ".ptx",
  ".pxn",
  ".raw",
  ".rwl",
  ".rw2",
  ".rwz",
  ".sr2",
  ".srf",
  ".srw",
  ".x3f",
  ".3fr",
  ".gpr",
] as const;

const NON_RAW_UPLOAD_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".dpx",
  ".exr",
  ".heic",
  ".heif",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".m4v",
] as const;

const UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
] as const;

export const IMAGE_UPLOAD_ACCEPT = [
  ...NON_RAW_UPLOAD_EXTENSIONS,
  ...RAW_EXTENSION_LIST,
  ...UPLOAD_MIME_TYPES,
].join(",");

const REFERENCE_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".bmp",
] as const;

const REFERENCE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
] as const;

export const REFERENCE_IMAGE_ACCEPT = [
  ...REFERENCE_IMAGE_EXTENSIONS,
  ...REFERENCE_IMAGE_MIME_TYPES,
].join(",");

const jpegMimeTypes = ["image/jpeg", "image/pjpeg"] as const;
const pngMimeTypes = ["image/png"] as const;

export const FORMAT_SUPPORT_MATRIX: readonly FormatSupportDescriptor[] = [
  {
    format: "jpeg",
    label: "JPEG",
    importStatus: "supported",
    exportStatus: "partial",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "ExifReader camera/lens/exposure/date/orientation fields",
    orientation: 'applied once by createImageBitmap({ imageOrientation: "from-image" })',
    status: "supported",
    uploadMimeTypes: jpegMimeTypes,
    uploadExtensions: [".jpg", ".jpeg"],
    notes:
      "JPEG upload reaches GPU preview and PNG export; JPEG export exists only as an internal canvas encoder option.",
  },
  {
    format: "png",
    label: "PNG",
    importStatus: "supported",
    exportStatus: "supported",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "not parsed",
    orientation: "not applicable",
    status: "supported",
    uploadMimeTypes: pngMimeTypes,
    uploadExtensions: [".png"],
    notes: "PNG upload and PNG export use the browser-native path.",
  },
  {
    format: "transparent-png",
    label: "Transparent PNG",
    importStatus: "supported",
    exportStatus: "supported",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "not parsed",
    orientation: "not applicable",
    status: "supported",
    uploadMimeTypes: pngMimeTypes,
    uploadExtensions: [".png"],
    notes:
      "Alpha is carried through texture sampling/export; the preview is composited over the viewer background.",
  },
  {
    format: "webp",
    label: "WebP",
    importStatus: "supported",
    exportStatus: "not implemented",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "best-effort ExifReader fields",
    orientation: 'applied by createImageBitmap({ imageOrientation: "from-image" })',
    status: "supported",
    uploadMimeTypes: ["image/webp"],
    uploadExtensions: [".webp"],
    notes:
      "Decoded by the browser-native createImageBitmap path (all modern browsers support WebP). Alpha is carried through.",
  },
  {
    format: "avif",
    label: "AVIF",
    importStatus: "supported",
    exportStatus: "not implemented",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "best-effort ExifReader fields",
    orientation: 'applied by createImageBitmap({ imageOrientation: "from-image" })',
    status: "supported",
    uploadMimeTypes: ["image/avif"],
    uploadExtensions: [".avif"],
    notes:
      "Decoded by the browser-native createImageBitmap path (modern browsers support AVIF). Alpha is carried through.",
  },
  {
    format: "gif",
    label: "GIF",
    importStatus: "supported",
    exportStatus: "not implemented",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "dimensions only",
    orientation: "not applicable",
    status: "supported",
    uploadMimeTypes: ["image/gif"],
    uploadExtensions: [".gif"],
    notes:
      "Matches legacy Um/Nm: original GIF bytes are stored and the browser decodes the first frame for preview/thumbnail.",
  },
  {
    format: "bmp",
    label: "BMP",
    importStatus: "supported",
    exportStatus: "not implemented",
    decoder: "browser createImageBitmap",
    worker: "main thread",
    wasm: "no",
    metadata: "dimensions only",
    orientation: "not applicable",
    status: "supported",
    uploadMimeTypes: ["image/bmp"],
    uploadExtensions: [".bmp"],
    notes:
      "Matches legacy Um/Nm: original BMP bytes are stored and browser-decoded at full resolution.",
  },
  {
    format: "video",
    label: "Video first frame",
    importStatus: "partial",
    exportStatus: "not implemented",
    decoder: "HTMLVideoElement first-frame extraction",
    worker: "main thread",
    wasm: "no",
    metadata: "derived PNG dimensions",
    orientation: "browser video presentation",
    status: "partial",
    uploadMimeTypes: [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
    ],
    uploadExtensions: [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"],
    notes:
      "Imports the first decodable frame as <source>_thumbnail.png. Container acceptance does not imply codec support; capability and decode failures are reported as browser codec limitations.",
  },
  {
    format: "heic",
    label: "HEIC/HEIF",
    importStatus: "supported",
    exportStatus: "not implemented",
    decoder: "libheif-js (WASM, worker, dynamic import)",
    worker: "worker",
    wasm: "yes",
    metadata: "best-effort ExifReader fields plus decoded dimensions",
    orientation: "handled by libheif",
    status: "supported",
    uploadMimeTypes: ["image/heic", "image/heif"],
    uploadExtensions: [".heic", ".heif"],
    notes:
      "Decoded in ImageDecodeWorker via libheif-js (HEVC needs a real codec); the ~2 MB WASM is dynamically imported only when a HEIC is loaded. Downconverts to 8-bit RGBA preview.",
  },
  {
    format: "tiff",
    label: "TIFF",
    importStatus: "partial",
    exportStatus: "not implemented",
    decoder: "native baseline decoder (codecs/tiff.ts, worker)",
    worker: "worker",
    wasm: "no",
    metadata: "TIFF orientation, make/model/date and decoded dimensions",
    orientation: "TIFF tag 274 applied once in the worker",
    status: "partial",
    uploadMimeTypes: ["image/tiff"],
    uploadExtensions: [".tif", ".tiff"],
    notes:
      "Native baseline decoder in ImageDecodeWorker: little/big-endian, strip-based, uncompressed/PackBits/LZW/Deflate, 8/16-bit, RGB/RGBA/grayscale, horizontal predictor; downconverts to 8-bit RGBA. Unsupported: JPEG-in-TIFF, tiled, planar=2, palette/CMYK/YCbCr, float.",
  },
  {
    format: "dpx",
    label: "DPX",
    importStatus: "partial",
    exportStatus: "not implemented",
    decoder: "native validated decoder (codecs/dpx.ts, worker)",
    worker: "worker",
    wasm: "no",
    metadata: "not parsed",
    orientation: "not applicable",
    status: "partial",
    uploadMimeTypes: ["image/dpx", "application/dpx"],
    uploadExtensions: [".dpx"],
    notes:
      "Only single-element, uncompressed RGB descriptor 50 is accepted: 10-bit filled method A or 16-bit unpacked, big/little endian, linear or Rec. 709 transfer. Log transfer and all other packing/layouts are rejected.",
  },
  {
    format: "exr",
    label: "EXR",
    importStatus: "partial",
    exportStatus: "not implemented",
    decoder: "native scanline decoder (codecs/exr.ts, worker)",
    worker: "worker",
    wasm: "no",
    metadata: "not parsed",
    orientation: "not applicable",
    status: "partial",
    uploadMimeTypes: ["image/x-exr", "application/x-exr"],
    uploadExtensions: [".exr"],
    notes:
      "Native scanline decoder: NONE/RLE/ZIPS/ZIP, HALF/FLOAT, unit-sampled R/G/B(/A) or Y(/A). Scene-linear values are clamped and sRGB-encoded to an 8-bit preview. PIZ/PXR24/B44/DWA, tiled/deep/multipart, UINT, subsampled, and auxiliary channel layouts are rejected.",
  },
  {
    format: "raw",
    label: "RAW",
    importStatus: "supported",
    exportStatus: "not implemented",
    decoder: "legacy wlbr LibRaw build (worker)",
    worker: "worker",
    wasm: "yes",
    metadata: "camera make/model/date and developed dimensions via wlbr metadata",
    orientation: "handled by the legacy wlbr develop path",
    status: "supported",
    uploadMimeTypes: [
      "image/x-adobe-dng",
      "image/x-canon-cr2",
      "image/x-sony-arw",
      "image/x-nikon-nef",
    ],
    uploadExtensions: RAW_EXTENSION_LIST,
    notes:
      "Decoded in ImageDecodeWorker via the vendored legacy wlbr process(ptr, size, 0, 6, 0.2, 66.667, 0.5, 0, 0) call. Camera WB + sRGB 8-bit output -> ImageBitmap preview. No alternate RAW fallback is used, so parity failures stay visible.",
  },
  {
    format: "cube",
    label: "CUBE",
    importStatus: "partial",
    exportStatus: "partial",
    decoder: "LUT text parser, not ImageIOService",
    worker: "not applicable",
    wasm: "not applicable",
    metadata: "LUT metadata only",
    orientation: "not applicable",
    status: "partial",
    uploadMimeTypes: [],
    uploadExtensions: [".cube"],
    notes:
      "CUBE is LUT interchange, not image upload. It must not be advertised as image decode support.",
  },
  {
    format: "clf",
    label: "CLF",
    importStatus: "partial",
    exportStatus: "partial",
    decoder: "CLF LUT3D XML subset parser, not ImageIOService",
    worker: "not applicable",
    wasm: "not applicable",
    metadata: "LUT metadata only",
    orientation: "not applicable",
    status: "partial",
    uploadMimeTypes: [],
    uploadExtensions: [".clf", ".xml"],
    notes:
      "CLF support is limited to the documented LUT3D subset and is separate from image upload/export.",
  },
  {
    format: "zip-project-bundle",
    label: "ZIP/project bundle",
    importStatus: "not implemented",
    exportStatus: "not implemented",
    decoder: "none",
    worker: "not wired",
    wasm: "not applicable",
    metadata: "not applicable",
    orientation: "not applicable",
    status: "not implemented",
    uploadMimeTypes: [],
    uploadExtensions: [".zip"],
    notes:
      "Project persistence currently uses IndexedDB blobs; ZIP/package download is not implemented.",
  },
];

export const CODEC_FILE_INVENTORY: readonly CodecFileInventoryEntry[] = [
  {
    fileName: "client-zip.min.js",
    purpose: "ZIP/package generation",
    status: "TODO",
    importPath: "not present in this checkout and not imported",
    execution: "not wired",
    wasmRequirement: "not applicable",
    limitations: "No project ZIP/package export path is implemented.",
  },
  {
    fileName: "dpx.min.js",
    purpose: "DPX decode",
    status: "PRESENT BUT UNUSED",
    importPath: "rebuilt natively as src/engine/io/codecs/dpx.ts (imported by ImageDecodeWorker)",
    execution: "worker",
    wasmRequirement: "no",
    limitations:
      "Validated uncompressed single-element RGB subset only; unsupported descriptors, log transfer, packing, padding, and encoding are rejected.",
  },
  {
    fileName: "exifreader.min.js",
    purpose: "EXIF metadata read",
    status: "USED",
    importPath: "replaced by the exifreader package in src/engine/io/ExifMetadata.ts",
    execution: "main thread",
    wasmRequirement: "no",
    limitations:
      "Selected camera/lens/exposure/date/orientation fields are retained; ICC profile bytes are not parsed.",
  },
  {
    fileName: "exr.min.js",
    purpose: "EXR / HDR decode",
    status: "PRESENT BUT UNUSED",
    importPath: "rebuilt natively as src/engine/io/codecs/exr.ts (imported by ImageDecodeWorker)",
    execution: "worker",
    wasmRequirement: "no",
    limitations:
      "Only validated scanline NONE/RLE/ZIPS/ZIP HALF/FLOAT RGB or luminance layouts are accepted; preview is 8-bit, not HDR-preserving.",
  },
  {
    fileName: "jpeg-encoder.js",
    purpose: "JPEG encoding",
    status: "TODO",
    importPath: "not present in this checkout and not imported",
    execution: "not wired",
    wasmRequirement: "no",
    limitations: "UI exports PNG; internal canvas JPEG encoding exists only through ExportOptions.",
  },
  {
    fileName: "libheif.wasm.js",
    purpose: "HEIF/HEIC decode via WASM",
    status: "PRESENT BUT UNUSED",
    importPath: "replaced by the npm libheif-js/wasm-bundle (dynamic import in ImageDecodeWorker)",
    execution: "worker",
    wasmRequirement: "yes",
    limitations:
      "Uses the maintained npm libheif-js (embedded WASM) instead of the legacy bundle; HEVC decode genuinely requires this library.",
  },
  {
    fileName: "srp-static.js",
    purpose: "Static LUT/color helper bundle",
    status: "TODO",
    importPath: "not present in this checkout and not imported",
    execution: "not wired",
    wasmRequirement: "not applicable",
    limitations:
      "Current LUT logic lives in engine LUT modules; no dependency on this helper is present.",
  },
  {
    fileName: "ubitmap.asm.js",
    purpose: "Bitmap/WASM image processing helper",
    status: "DISABLED INTENTIONALLY",
    importPath: "not present in this checkout and not imported",
    execution: "not wired",
    wasmRequirement: "sidecar",
    limitations: "No legacy bitmap helper path is active.",
  },
  {
    fileName: "ubitmap.wasm",
    purpose: "Bitmap/WASM image processing helper sidecar",
    status: "DISABLED INTENTIONALLY",
    importPath: "not present in this checkout and not imported",
    execution: "not wired",
    wasmRequirement: "yes",
    limitations: "No legacy bitmap helper path is active.",
  },
  {
    fileName: "upng.min.js",
    purpose: "PNG encode/decode",
    status: "DISABLED INTENTIONALLY",
    importPath: "not present in this checkout and not imported",
    execution: "not wired",
    wasmRequirement: "no",
    limitations: "PNG uses browser createImageBitmap for decode and canvas.toBlob for export.",
  },
  {
    fileName: "utif.min.js",
    purpose: "TIFF decode",
    status: "DISABLED INTENTIONALLY",
    importPath: "replaced by src/engine/io/codecs/tiff.ts",
    execution: "worker",
    wasmRequirement: "no",
    limitations:
      "Native baseline subsets only; JPEG-in-TIFF, tiled, planar, palette/CMYK/YCbCr and float TIFF remain unsupported.",
  },
  {
    fileName: "wlbr.js",
    purpose: "Legacy LibRaw RAW develop",
    status: "USED",
    importPath: "src/engine/io/codecs/rawWlbr.ts",
    execution: "worker",
    wasmRequirement: "yes",
    limitations:
      "Develops RAW to 8-bit sRGB RGBA using the legacy parameter tuple; unsupported RAW failures are surfaced instead of silently falling back to a different decoder.",
  },
];

export function detectImageFormat(
  file: Pick<File, "name" | "type">,
): SupportedImageFormat | undefined {
  const mime = file.type.toLowerCase();
  const extension = extensionOf(file.name);

  if (
    jpegMimeTypes.includes(mime as (typeof jpegMimeTypes)[number]) ||
    extension === ".jpg" ||
    extension === ".jpeg"
  ) {
    return "jpeg";
  }
  if (pngMimeTypes.includes(mime as (typeof pngMimeTypes)[number]) || extension === ".png") {
    return "png";
  }
  if (mime === "image/webp" || extension === ".webp") return "webp";
  if (mime === "image/avif" || extension === ".avif") return "avif";
  if (mime === "image/gif" || extension === ".gif") return "gif";
  if (mime === "image/bmp" || extension === ".bmp") return "bmp";
  if (
    mime.startsWith("video/") ||
    [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"].includes(extension)
  ) {
    return "video";
  }
  if (
    mime === "image/heic" ||
    mime === "image/heif" ||
    extension === ".heic" ||
    extension === ".heif"
  ) {
    return "heic";
  }
  if (mime === "image/tiff" || extension === ".tif" || extension === ".tiff") return "tiff";
  if (mime === "image/dpx" || mime === "application/dpx" || extension === ".dpx") return "dpx";
  if (mime === "image/x-exr" || mime === "application/x-exr" || extension === ".exr") return "exr";
  if (RAW_EXTENSIONS.has(extension)) return "raw";

  return undefined;
}

// Camera RAW extensions handled by the vendored legacy wlbr decoder.
export const RAW_EXTENSIONS = new Set<string>(RAW_EXTENSION_LIST);

export function getFormatSupportDescriptor(
  format: ImageIOMatrixFormat,
): FormatSupportDescriptor | undefined {
  return FORMAT_SUPPORT_MATRIX.find((descriptor) => descriptor.format === format);
}

export function isSupportedImageFile(file: Pick<File, "name" | "type">): boolean {
  const format = detectImageFormat(file);
  if (!format) return false;
  const descriptor = getFormatSupportDescriptor(format);
  return descriptor?.importStatus === "supported" || descriptor?.importStatus === "partial";
}

export function isSupportedReferenceImageFile(file: Pick<File, "name" | "type">): boolean {
  const mime = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  return (
    REFERENCE_IMAGE_MIME_TYPES.includes(mime as (typeof REFERENCE_IMAGE_MIME_TYPES)[number]) ||
    REFERENCE_IMAGE_EXTENSIONS.includes(extension as (typeof REFERENCE_IMAGE_EXTENSIONS)[number])
  );
}

export function getUnsupportedImageMessage(file: Pick<File, "name" | "type">): string {
  const format = detectImageFormat(file);
  const descriptor = format ? getFormatSupportDescriptor(format) : undefined;
  const label = descriptor?.label ?? (file.type || extensionOf(file.name) || "this file");

  if (
    descriptor &&
    descriptor.importStatus !== "supported" &&
    descriptor.importStatus !== "partial"
  ) {
    return `${label} import is ${descriptor.status}.`;
  }

  return `Unsupported file type (${label}).`;
}

export function getUnsupportedReferenceImageMessage(): string {
  return "No reference image loaded. Supported formats for references are .jpg, .png, .avif, .webp, .gif and .bmp";
}

export function getImageIOAuditSnapshot() {
  return {
    accept: IMAGE_UPLOAD_ACCEPT,
    formats: FORMAT_SUPPORT_MATRIX,
    codecs: CODEC_FILE_INVENTORY,
  };
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return "";
  return fileName.slice(index).toLowerCase();
}
