import { createLUTData3D, validateLUTData3D } from "./LUTData";
import type { LUTData3D, LUTImportResult } from "./InterchangeTypes";

export async function importCLF(file: File): Promise<LUTImportResult> {
  return importCLFText(await file.text(), file.name);
}

export function importCLFText(text: string, title?: string): LUTImportResult {
  const lut = parseSimpleCLFLUT3D(text);
  return {
    kind: "clf",
    title,
    size: lut.size,
    lut,
    warnings: ["Imported first simple LUT3D Array only."],
  };
}

export function parseSimpleCLFLUT3D(xml: string): LUTData3D {
  const unsupportedNodes = [
    "Matrix",
    "Range",
    "ASC_CDL",
    "LUT1D",
    "Reference",
    "ExposureContrast",
    "Log",
  ].filter((node) => new RegExp(`<\\s*(?:[A-Za-z0-9_]+:)?${node}\\b`, "i").test(xml));
  if (unsupportedNodes.length > 0) {
    throw new Error(`Unsupported process nodes in CLF: ${unsupportedNodes.join(", ")}.`);
  }

  const arrayMatch =
    /<\s*(?:[A-Za-z0-9_]+:)?Array\b([^>]*)>([\s\S]*?)<\s*\/\s*(?:[A-Za-z0-9_]+:)?Array\s*>/i.exec(
      xml,
    );
  if (!arrayMatch) throw new Error("Invalid CLF file: LUT3D Array was not found.");

  const dimMatch = /\bdim\s*=\s*["']([^"']+)["']/i.exec(arrayMatch[1]);
  if (!dimMatch) throw new Error("Invalid CLF LUT3D Array: dim attribute is required.");
  const dims = dimMatch[1]
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (dims.length !== 4 || dims.some((value) => !Number.isInteger(value))) {
    throw new Error("Invalid CLF LUT3D Array: dim must be four integer values.");
  }
  const [r, g, b, channels] = dims;
  if (r !== g || g !== b || r <= 1 || channels !== 3) {
    throw new Error("Invalid CLF LUT3D Array: only cubic RGB LUT3D arrays are supported.");
  }

  const values = arrayMatch[2]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => {
      const value = Number(part);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid CLF LUT3D Array: non-finite value at token ${index}.`);
      }
      return value;
    });
  const expected = r * r * r * 3;
  if (values.length !== expected) {
    throw new Error(`Invalid CLF LUT3D Array: expected ${expected} values, got ${values.length}.`);
  }

  const lut = createLUTData3D(r, new Float32Array(values));
  const errors = validateLUTData3D(lut);
  if (errors.length > 0) throw new Error(`Invalid CLF LUT data: ${errors.join(" ")}`);
  return lut;
}
