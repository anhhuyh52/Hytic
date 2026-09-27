import { createContext, useContext } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { EditState } from "../../engine/state/EditState";
import { editState as globalEditState, setEditState as globalSetEditState } from "../../app/editor-store";

export const EditStateContext = createContext<{
  state: EditState;
  setState: SetStoreFunction<EditState>;
}>();

export function useEditState() {
  const ctx = useContext(EditStateContext);
  return ctx || { state: globalEditState, setState: globalSetEditState };
}
