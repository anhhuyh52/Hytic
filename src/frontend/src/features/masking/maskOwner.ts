import type { EditState } from "../../engine/state/EditState";
import type { EditorOverlayLayer, EditorOverlayMask } from "../overlays/editorOverlayTypes";

export type MaskOwner =
  | { type: "local-adjustment"; ownerId: string }
  | { type: "overlay"; ownerId: string };

export function getMaskByOwner(
  owner: MaskOwner,
  state: Pick<EditState, "localAdjustments" | "overlays">,
  overlayLayers: readonly EditorOverlayLayer[] = state.overlays,
): EditorOverlayMask | null {
  if (owner.type === "overlay") {
    return overlayLayers.find((layer) => layer.id === owner.ownerId)?.mask ?? null;
  }
  return state.localAdjustments.find((layer) => layer.id === owner.ownerId)?.components[0] ?? null;
}

/** Stable-ID overlay update helper; safe when layers are reordered while editing. */
export function updateOverlayMaskByOwner(
  layers: readonly EditorOverlayLayer[],
  owner: Extract<MaskOwner, { type: "overlay" }>,
  update: (mask: EditorOverlayMask | null) => EditorOverlayMask | null,
): EditorOverlayLayer[] {
  return layers.map((layer) =>
    layer.id === owner.ownerId ? { ...layer, mask: update(layer.mask) } : layer,
  );
}
