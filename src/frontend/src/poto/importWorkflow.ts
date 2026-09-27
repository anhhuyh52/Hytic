export type PostImportSelectionInput = {
  previousAssetId: string | null;
  firstImportedAssetId: string | null;
  activeAssetId: string | null;
  selectionRevision: number;
  currentSelectionRevision: number;
};

export type PostImportSelection = {
  targetAssetId: string | null;
  selectionIsCurrent: boolean;
  shouldSwitch: boolean;
};

/**
 * Resolve the editor selection after a background import session.
 *
 * Existing work always wins: importing adds media to the project without changing
 * the file the user is editing. With no existing selection, the first successful
 * import becomes the editor target. A user selection made during the import
 * supersedes both choices.
 */
export function resolvePostImportSelection(
  input: PostImportSelectionInput,
): PostImportSelection {
  const targetAssetId = input.previousAssetId ?? input.firstImportedAssetId;
  const selectionIsCurrent = input.selectionRevision === input.currentSelectionRevision;
  return {
    targetAssetId,
    selectionIsCurrent,
    shouldSwitch:
      selectionIsCurrent && !!targetAssetId && targetAssetId !== input.activeAssetId,
  };
}
