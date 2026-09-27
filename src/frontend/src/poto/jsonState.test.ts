import { describe, expect, it } from "vitest";
import { cloneJson, mergeJsonPatch } from "./jsonState";

describe("jsonState", () => {
  it("deep-clones JSON values", () => {
    const source = { nested: { value: 1 }, items: [{ id: "a" }] };
    const clone = cloneJson(source);

    clone.nested.value = 2;
    clone.items[0].id = "b";

    expect(source).toEqual({ nested: { value: 1 }, items: [{ id: "a" }] });
  });

  it("merges plain objects while replacing arrays and scalars", () => {
    const base = {
      color: { exposure: 1, balance: { red: 0, blue: 0 } },
      points: [1, 2, 3],
      enabled: false,
    };

    const result = mergeJsonPatch(base, {
      color: { balance: { red: 0.25 } },
      points: [8, 9],
      enabled: true,
    });

    expect(result).toEqual({
      color: { exposure: 1, balance: { red: 0.25, blue: 0 } },
      points: [8, 9],
      enabled: true,
    });
    expect(base.points).toEqual([1, 2, 3]);
  });

  it("ignores undefined patch values", () => {
    expect(mergeJsonPatch({ value: 4 }, { value: undefined })).toEqual({ value: 4 });
  });
});
