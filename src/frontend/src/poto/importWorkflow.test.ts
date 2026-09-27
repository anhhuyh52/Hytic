import { describe, expect, it } from "vitest";
import { resolvePostImportSelection } from "./importWorkflow";

describe("resolvePostImportSelection", () => {
  it("keeps the file that was being edited before the import", () => {
    expect(
      resolvePostImportSelection({
        previousAssetId: "current",
        firstImportedAssetId: "imported",
        activeAssetId: "imported",
        selectionRevision: 4,
        currentSelectionRevision: 4,
      }),
    ).toEqual({
      targetAssetId: "current",
      selectionIsCurrent: true,
      shouldSwitch: true,
    });
  });

  it("opens the first successful import when the editor was empty", () => {
    expect(
      resolvePostImportSelection({
        previousAssetId: null,
        firstImportedAssetId: "first-import",
        activeAssetId: "last-import",
        selectionRevision: 0,
        currentSelectionRevision: 0,
      }),
    ).toEqual({
      targetAssetId: "first-import",
      selectionIsCurrent: true,
      shouldSwitch: true,
    });
  });

  it("does not reload an asset that is already active", () => {
    expect(
      resolvePostImportSelection({
        previousAssetId: "current",
        firstImportedAssetId: "imported",
        activeAssetId: "current",
        selectionRevision: 2,
        currentSelectionRevision: 2,
      }).shouldSwitch,
    ).toBe(false);
  });

  it("does not override a selection made while import was running", () => {
    expect(
      resolvePostImportSelection({
        previousAssetId: "old",
        firstImportedAssetId: "imported",
        activeAssetId: "user-choice",
        selectionRevision: 7,
        currentSelectionRevision: 8,
      }),
    ).toMatchObject({ selectionIsCurrent: false, shouldSwitch: false });
  });
});
