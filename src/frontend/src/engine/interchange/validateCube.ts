import type { LUTData3D, LUTImportResult, RGBTriplet } from "./InterchangeTypes";
import { createLUTData3D, validateLUTData3D } from "./LUTData";

type ParsedCube = LUTImportResult & {
  comments: string[];
};

export function validateCubeText(text: string): string[] {
  try {
    parseCubeText(text);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Invalid .cube file."];
  }
}

export function parseCubeText(text: string): ParsedCube {
  const comments: string[] = [];
  const warnings: string[] = [];
  let title: string | undefined;
  let size: number | undefined;
  let domainMin: RGBTriplet = [0, 0, 0];
  let domainMax: RGBTriplet = [1, 1, 1];
  const values: number[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const raw = lines[i];
    const withoutComment = stripInlineComment(raw);
    const trimmed = withoutComment.trim();

    if (raw.trim().startsWith("#")) {
      comments.push(raw.trim().slice(1).trim());
      continue;
    }
    if (!trimmed) continue;

    const keyword = trimmed.split(/\s+/, 1)[0].toUpperCase();

    if (keyword === "TITLE") {
      title = parseTitle(trimmed, lineNumber);
      continue;
    }

    if (keyword === "LUT_1D_SIZE") {
      throw new Error("Unsupported .cube file: 1D LUTs are not supported in this phase.");
    }

    if (keyword === "LUT_3D_SIZE") {
      size = parseIntegerDirective(trimmed, "LUT_3D_SIZE", lineNumber);
      if (size <= 1) throw new Error(`LUT_3D_SIZE must be greater than 1 at line ${lineNumber}.`);
      continue;
    }

    if (keyword === "DOMAIN_MIN") {
      domainMin = parseTripletDirective(trimmed, "DOMAIN_MIN", lineNumber);
      continue;
    }

    if (keyword === "DOMAIN_MAX") {
      domainMax = parseTripletDirective(trimmed, "DOMAIN_MAX", lineNumber);
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length === 3) {
      const row = parts.map((part) => Number(part));
      if (row.some((value) => !Number.isFinite(value))) {
        throw new Error(`Malformed RGB row at line ${lineNumber}: values must be finite numbers.`);
      }
      values.push(row[0], row[1], row[2]);
      continue;
    }

    if (/^[A-Z_]/i.test(keyword)) {
      warnings.push(`Ignoring unsupported .cube directive at line ${lineNumber}: ${keyword}.`);
      continue;
    }

    throw new Error(`Malformed RGB row at line ${lineNumber}: expected three numeric values.`);
  }

  if (size === undefined) {
    throw new Error("Invalid .cube file: LUT_3D_SIZE is required.");
  }

  const expectedValues = size * size * size * 3;
  if (values.length !== expectedValues) {
    throw new Error(
      `Invalid .cube file: expected ${size ** 3} RGB rows for LUT_3D_SIZE ${size}, got ${values.length / 3}.`,
    );
  }

  validateDomain(domainMin, domainMax);
  const lut: LUTData3D = createLUTData3D(
    size,
    new Float32Array(values),
    domainMin,
    domainMax,
    [0, 0, 0],
    [1, 1, 1],
  );
  const errors = validateLUTData3D(lut);
  if (errors.length > 0) {
    throw new Error(`Invalid .cube LUT data: ${errors.join(" ")}`);
  }

  return {
    kind: "cube",
    title,
    size,
    lut,
    warnings,
    comments,
  };
}

function stripInlineComment(line: string): string {
  const commentIndex = line.indexOf("#");
  return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
}

function parseTitle(line: string, lineNumber: number): string {
  const quoted = /^TITLE\s+"([^"]*)"\s*$/i.exec(line);
  if (quoted) return quoted[1];
  const bare = /^TITLE\s+(.+)$/i.exec(line);
  if (bare) return bare[1].trim();
  throw new Error(`Malformed TITLE directive at line ${lineNumber}.`);
}

function parseIntegerDirective(line: string, directive: string, lineNumber: number): number {
  const parts = line.split(/\s+/);
  if (parts.length !== 2) {
    throw new Error(`Malformed ${directive} directive at line ${lineNumber}.`);
  }
  const value = Number(parts[1]);
  if (!Number.isInteger(value)) {
    throw new Error(`${directive} must be an integer at line ${lineNumber}.`);
  }
  return value;
}

function parseTripletDirective(line: string, directive: string, lineNumber: number): RGBTriplet {
  const parts = line.split(/\s+/);
  if (parts.length !== 4) {
    throw new Error(`Malformed ${directive} directive at line ${lineNumber}.`);
  }
  const values = parts.slice(1).map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${directive} values must be finite at line ${lineNumber}.`);
  }
  return [values[0], values[1], values[2]];
}

function validateDomain(min: RGBTriplet, max: RGBTriplet): void {
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(min[i]) || !Number.isFinite(max[i])) {
      throw new Error("DOMAIN_MIN and DOMAIN_MAX values must be finite.");
    }
    if (max[i] <= min[i]) {
      throw new Error("DOMAIN_MAX must be greater than DOMAIN_MIN on every channel.");
    }
  }
}
