import { describe, expect, it } from "vitest";
import { OFFICIAL_PACKS, packJsonUrl } from "./officialPacks";

describe("official preset catalog", () => {
  it("keeps TetraChrome available in the local workspace", () => {
    const tetraChrome = OFFICIAL_PACKS.find((pack) => pack.slug === "tetrachrome");

    expect(tetraChrome).toMatchObject({ name: "TetraChrome" });
    expect(packJsonUrl("official", "TetraChrome")).toBe(
      "/assets/presets/official/TetraChrome.json",
    );
  });

  it("keeps the official preset catalog available", () => {
    expect(OFFICIAL_PACKS.length).toBeGreaterThan(1);
    expect(OFFICIAL_PACKS.every((pack) => pack.source === "official")).toBe(true);
  });
});
