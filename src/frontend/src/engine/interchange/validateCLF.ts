import type { LUTData3D, LUTImportResult } from "./InterchangeTypes";
import { createLUTData3D, validateLUTData3D } from "./LUTData";

export const UNSUPPORTED_CLF_NODES = [
  "Matrix",
  "Range",
  "ASC_CDL",
  "LUT1D",
  "Reference",
  "ExposureContrast",
  "Log",
] as const;

export function validateCLFXML(xml: string): string[] {
  try {
    parseCLFText(xml);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Invalid CLF XML."];
  }
}

export function parseCLFText(xml: string): LUTImportResult {
  const doc = parseXML(xml);
  const unsupported = findUnsupportedNodes(doc);
  if (unsupported.length > 0) {
    throw new Error(
      `This CLF contains unsupported process nodes and cannot be faithfully imported: ${unsupported.join(", ")}.`,
    );
  }

  const processList = findElements(doc, "ProcessList")[0];
  const lut3d = findElements(doc, "LUT3D")[0];
  if (!lut3d) {
    throw new Error("Invalid CLF file: no LUT3D node was found.");
  }

  const array = findChildElement(lut3d, "Array");
  if (!array) {
    throw new Error("Invalid CLF file: LUT3D is missing an Array node.");
  }

  const dim = parseArrayDim(array.getAttribute("dim"));
  const values = parseFloatArray(array.textContent ?? "");
  const expectedValues = dim.size * dim.size * dim.size * 3;
  if (values.length !== expectedValues) {
    throw new Error(
      `Invalid CLF LUT3D Array: expected ${expectedValues} numeric values, got ${values.length}.`,
    );
  }

  const lut: LUTData3D = createLUTData3D(dim.size, new Float32Array(values));
  const errors = validateLUTData3D(lut);
  if (errors.length > 0) {
    throw new Error(`Invalid CLF LUT data: ${errors.join(" ")}`);
  }

  return {
    kind: "clf",
    title: lut3d.getAttribute("name") ?? processList?.getAttribute("name") ?? undefined,
    size: dim.size,
    lut,
    warnings: ["Imported first simple LUT3D Array only."],
  };
}

function parseXML(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parserError = findElements(doc, "parsererror")[0];
  if (parserError) {
    throw new Error("Invalid CLF XML: XML parser reported an error.");
  }
  return doc;
}

function findUnsupportedNodes(doc: Document): string[] {
  const found = new Set<string>();
  for (const nodeName of UNSUPPORTED_CLF_NODES) {
    if (findElements(doc, nodeName).length > 0) found.add(nodeName);
  }
  return Array.from(found);
}

function findElements(root: ParentNode, localName: string): Element[] {
  return Array.from(root.querySelectorAll("*")).filter(
    (element) => element.localName === localName || element.nodeName === localName,
  );
}

function findChildElement(root: Element, localName: string): Element | undefined {
  return Array.from(root.children).find(
    (element) => element.localName === localName || element.nodeName === localName,
  );
}

function parseArrayDim(raw: string | null): { size: number } {
  if (!raw) {
    throw new Error("Invalid CLF LUT3D Array: dim attribute is required.");
  }
  const dims = raw
    .trim()
    .split(/\s+/)
    .map((part) => Number(part));
  if (dims.length !== 4 || dims.some((value) => !Number.isInteger(value))) {
    throw new Error("Invalid CLF LUT3D Array: dim must be four integer values like '64 64 64 3'.");
  }
  const [r, g, b, channels] = dims;
  if (r !== g || g !== b || r <= 1 || channels !== 3) {
    throw new Error("Invalid CLF LUT3D Array: only cubic RGB LUT3D arrays are supported.");
  }
  return { size: r };
}

function parseFloatArray(text: string): number[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).map((part, index) => {
    const value = Number(part);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid CLF LUT3D Array: non-finite value at numeric token ${index}.`);
    }
    return value;
  });
}
