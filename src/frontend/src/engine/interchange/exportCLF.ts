import type { LUTData3D, LUTInterchangeMetadata } from "./InterchangeTypes";
import { validateLUTData3D } from "./LUTData";

export function exportCLF(lutData: LUTData3D, metadata: LUTInterchangeMetadata): Blob {
  return new Blob([lutDataToCLFXML(lutData, metadata)], { type: "application/xml" });
}

export function lutDataToCLFXML(lutData: LUTData3D, metadata: LUTInterchangeMetadata): string {
  const errors = validateLUTData3D(lutData);
  if (errors.length > 0) {
    throw new Error(`Invalid LUT data for CLF export: ${errors.join(" ")}`);
  }

  const safeTitle = metadata.title.trim() || "Hytic Look";
  const processId = slugId(safeTitle);
  const notes = [
    "CLF-compatible subset.",
    "experimental CLF export.",
    "global transform only.",
    "Internal transform-chain export.",
    "Does not include masks, local layers, image-space FX, crop, scopes, or project state.",
    "This is not a certified ACES or OCIO implementation.",
    ...metadata.notes,
  ];

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<ProcessList id="${escapeXmlAttribute(processId)}" name="${escapeXmlAttribute(safeTitle)}" compCLFversion="3.0">`,
  );
  lines.push(
    `  <Description>${escapeXmlText(metadata.description ?? "Global color transform only.")}</Description>`,
  );
  lines.push("  <Info>");
  lines.push(`    <App>Hytic</App>`);
  lines.push(`    <Export>experimental CLF export</Export>`);
  lines.push(`    <Subset>CLF-compatible subset</Subset>`);
  lines.push(`    <Scope>global transform only</Scope>`);
  lines.push(`    <GeneratedAt>${new Date(metadata.generatedAt).toISOString()}</GeneratedAt>`);
  if (metadata.appVersion) {
    lines.push(`    <AppVersion>${escapeXmlText(metadata.appVersion)}</AppVersion>`);
  }
  lines.push(`    <InputColorSpace>${escapeXmlText(metadata.inputColorSpace)}</InputColorSpace>`);
  lines.push(
    `    <WorkingColorSpace>${escapeXmlText(metadata.workingColorSpace)}</WorkingColorSpace>`,
  );
  lines.push(
    `    <DisplayColorSpace>${escapeXmlText(metadata.displayColorSpace)}</DisplayColorSpace>`,
  );
  lines.push(`    <ViewTransform>${escapeXmlText(metadata.viewTransform)}</ViewTransform>`);
  for (const note of notes) {
    lines.push(`    <Note>${escapeXmlText(note)}</Note>`);
  }
  lines.push("  </Info>");
  lines.push(
    `  <LUT3D id="${escapeXmlAttribute(`${processId}-lut3d`)}" name="${escapeXmlAttribute(safeTitle)}" interpolation="tetrahedral">`,
  );
  lines.push(`    <Array dim="${lutData.size} ${lutData.size} ${lutData.size} 3">`);

  for (let b = 0; b < lutData.size; b += 1) {
    for (let g = 0; g < lutData.size; g += 1) {
      for (let r = 0; r < lutData.size; r += 1) {
        const index = (b * lutData.size * lutData.size + g * lutData.size + r) * 3;
        lines.push(
          `      ${fmt(lutData.data[index])} ${fmt(lutData.data[index + 1])} ${fmt(lutData.data[index + 2])}`,
        );
      }
    }
  }

  lines.push("    </Array>");
  lines.push("  </LUT3D>");
  lines.push("</ProcessList>");
  return `${lines.join("\n")}\n`;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0.0000000";
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return clamped.toFixed(7);
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `hytic-${slug}` : "hytic-look";
}
