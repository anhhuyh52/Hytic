import { createStore } from "solid-js/store";
import {
  clonePresentationBorder,
  DEFAULT_PRESENTATION_BORDER,
  normalizePresentationBorder,
  type PresentationBorderSettings,
} from "./border/borderTypes";

export type PresentationState = {
  border: PresentationBorderSettings;
};

export const DEFAULT_PRESENTATION_STATE: PresentationState = {
  border: clonePresentationBorder(DEFAULT_PRESENTATION_BORDER),
};

export const [presentationState, setPresentationState] = createStore<PresentationState>({
  border: clonePresentationBorder(DEFAULT_PRESENTATION_BORDER),
});

export function setPresentationBorder(border: PresentationBorderSettings): void {
  setPresentationState("border", normalizePresentationBorder(border));
}

export function resetPresentationBorder(): void {
  setPresentationState("border", clonePresentationBorder(DEFAULT_PRESENTATION_BORDER));
}
