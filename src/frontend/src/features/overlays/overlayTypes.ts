export type OverlaySourceType = "builtin" | "file" | "gradient";
export type OverlayGradientType = "none" | "linear" | "radial" | "luminance";

export type OverlayBlendMode =
  | "NORMAL" | "SCREEN" | "LIGHTEN" | "ADD" | "COLOR_DODGE"
  | "MULTIPLY" | "DARKEN" | "SUBTRACT" | "COLOR_BURN" | "OVERLAY"
  | "SOFT_LIGHT" | "VIVID_LIGHT" | "HARD_LIGHT" | "LINEAR_LIGHT"
  | "HUE" | "SATURATION" | "COLOR" | "LUMINOSITY" | "DIFFERENCE"
  | "EXCLUSION" | "DIVIDE";

export type GradientStop = {
  id: string;
  position: number;
  color: [number, number, number, number];
};

export interface OverlayLayer {
  id: string;
  name: string;
  category: string;
  sourceType: OverlaySourceType;
  sourceId: string | null;
  textureId: string | null;
  position: [number, number];
  scale: [number, number];
  angle: number;
  blendMode: OverlayBlendMode;
  /** Blend strength. Displayed as Opacity in the toolbar. */
  fill: number;
  /** Final layer compositing opacity. */
  opacity: number;
  gradientType: OverlayGradientType;
  gradientStops: GradientStop[];
  reverse: boolean;
  reflect: boolean;
  repeat: boolean;
  maskId: string | null;
  disabled: boolean;
  visible: boolean;
}

export interface OverlayState {
  layers: OverlayLayer[];
  selectedLayerId: string | null;
  isEditing: boolean;
  isPanMode: boolean;
  isConfirmMode: boolean;
  openMenu: null | "library" | "blend" | "transform" | "mask" | "gradient";
}

export type OverlayTransformPatch = Partial<Pick<OverlayLayer, "position" | "scale" | "angle">>;
