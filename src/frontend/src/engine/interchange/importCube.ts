import type { LUTImportResult } from "./InterchangeTypes";
import { parseCubeText } from "./validateCube";

export async function importCube(file: File): Promise<LUTImportResult> {
  return importCubeText(await file.text(), file.name);
}

export function importCubeText(text: string, fallbackTitle?: string): LUTImportResult {
  const parsed = parseCubeText(text);
  return {
    kind: "cube",
    title: parsed.title ?? fallbackTitle,
    size: parsed.size,
    lut: parsed.lut,
    warnings: parsed.warnings,
  };
}
