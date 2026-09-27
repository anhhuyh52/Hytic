import { describe, expect, it } from "vitest";
import {
  createCatalogFields,
  createCatalogSearchDocument,
  evaluateSmartCollection,
  matchesCatalogText,
  normalizeCatalogFields,
  normalizeKeywords,
  patchCatalogFields,
} from "./catalog";

const catalog = createCatalogFields({ fileName: "IMG_0001.CR3", size: 42, now: 100 });
const document = createCatalogSearchDocument({
  accountId: "a",
  projectId: "p",
  projectName: "Travel",
  assetId: "m",
  fileName: "IMG_0001.CR3",
  width: 6000,
  height: 4000,
  metadata: {
    cameraModel: "Canon EOS R5",
    lens: "RF 24-70mm F2.8",
    iso: 800,
    aperture: "f/2.8",
    shutterSpeed: "1/125",
    focalLength: "50 mm",
    capturedAt: "2025:06:10 12:30:00",
  },
  catalog: patchCatalogFields(catalog, {
    rating: 4,
    flag: "pick",
    keywords: ["Street", "Night"],
  }, 200),
});

describe("catalog metadata", () => {
  it("normalizes keywords case-insensitively while preserving first casing", () => {
    expect(normalizeKeywords([" Street ", "street", "NIGHT", ""])).toEqual(["Street", "NIGHT"]);
  });

  it("hydrates legacy assets to neutral additive defaults", () => {
    expect(normalizeCatalogFields(undefined, { fileName: "old.jpg", size: 12, timestamp: 50 })).toMatchObject({
      rating: 0,
      flag: "none",
      keywords: [],
      importedAt: 50,
      sourceIdentity: { fileName: "old.jpg", size: 12 },
    });
  });

  it("searches only normalized supported catalog fields", () => {
    expect(matchesCatalogText(document, "canon night")).toBe(true);
    expect(matchesCatalogText(document, "private arbitrary exif")).toBe(false);
  });
});

describe("smart collection queries", () => {
  it("combines rating, keyword, camera and numeric EXIF predicates", () => {
    expect(evaluateSmartCollection(document, {
      type: "and",
      children: [
        { type: "predicate", field: "rating", operator: "gte", value: 4 },
        { type: "predicate", field: "keywords", operator: "contains", value: "night" },
        { type: "predicate", field: "camera", operator: "contains", value: "eos" },
        { type: "predicate", field: "iso", operator: "between", value: [400, 1600] },
        { type: "predicate", field: "shutter", operator: "lte", value: 1 / 60 },
      ],
    })).toBe(true);
  });

  it("handles missing EXIF without matching numeric predicates", () => {
    const noExif = { ...document, iso: undefined, aperture: undefined };
    expect(evaluateSmartCollection(noExif, {
      type: "predicate",
      field: "iso",
      operator: "gte",
      value: 100,
    })).toBe(false);
  });
});
