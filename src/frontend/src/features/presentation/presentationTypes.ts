export type PresentationRatioId =
  | "original"
  | "1:1"
  | "4:5"
  | "5:4"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "2.39:1";

export type PresentationBackgroundMode = "solid" | "blurred-image" | "image";

export type PresentationBackgroundImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  rotationDegrees?: 0 | 90 | 180 | 270;
};

export type BorderSettings = {
  enabled: boolean;
  ratio: PresentationRatioId;
  backgroundMode: PresentationBackgroundMode;
  backgroundImage?: PresentationBackgroundImage;
  backgroundColor: [number, number, number];
  backgroundOpacity: number;
  blurAmount: number;
  imageScale: number;
  imageRadius: number; // 0..1; rounds the inner picture corners (fraction of frame short edge)
  frameRadius: number; // 0..1; rounds the outer frame corners (fraction of frame short edge)
  imageShadow: number; // 0..1; soft drop shadow behind the image
  imageInnerShadow: number; // 0..1; soft inset shadow inside the image edge
  borderSize: number;
  linked: boolean;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PresentationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PresentationGeometry = {
  frame: { width: number; height: number };
  imageRect: PresentationRect;
  backgroundRect: PresentationRect;
};
