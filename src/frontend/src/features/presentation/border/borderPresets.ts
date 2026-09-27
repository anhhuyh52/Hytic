import {
  DEFAULT_PRESENTATION_BORDER,
  type PresentationBorderPreset,
  type PresentationBorderSettings,
} from "./borderTypes";

export const PRESENTATION_BORDER_PRESETS: Array<{
  id: PresentationBorderPreset;
  label: string;
  settings: PresentationBorderSettings;
}> = [
  {
    id: "none",
    label: "None",
    settings: { ...DEFAULT_PRESENTATION_BORDER },
  },
  {
    id: "white-gallery",
    label: "White Gallery",
    settings: {
      ...DEFAULT_PRESENTATION_BORDER,
      enabled: true,
      preset: "white-gallery",
      imageScale: 0.96,
      imageShadow: 0.18,
      color: [246, 243, 238],
      size: 0.08,
      top: 0.08,
      right: 0.08,
      bottom: 0.08,
      left: 0.08,
    },
  },
  {
    id: "black-matte",
    label: "Black Matte",
    settings: {
      ...DEFAULT_PRESENTATION_BORDER,
      enabled: true,
      preset: "black-matte",
      imageScale: 0.96,
      imageShadow: 0.22,
      color: [16, 16, 16],
      size: 0.1,
      top: 0.1,
      right: 0.1,
      bottom: 0.1,
      left: 0.1,
    },
  },
  {
    id: "polaroid",
    label: "Polaroid",
    settings: {
      ...DEFAULT_PRESENTATION_BORDER,
      enabled: true,
      preset: "polaroid",
      imageScale: 0.94,
      imageShadow: 0.2,
      color: [250, 247, 239],
      linked: false,
      top: 0.06,
      right: 0.06,
      bottom: 0.2,
      left: 0.06,
    },
  },
  {
    id: "cinematic",
    label: "Cinematic",
    settings: {
      ...DEFAULT_PRESENTATION_BORDER,
      enabled: true,
      preset: "cinematic",
      imageScale: 0.98,
      imageShadow: 0.16,
      color: [0, 0, 0],
      aspectRatio: "2.39:1",
      linked: false,
      top: 0.04,
      right: 0.04,
      bottom: 0.04,
      left: 0.04,
    },
  },
  {
    id: "blur-background",
    label: "Blurred Backdrop",
    settings: {
      ...DEFAULT_PRESENTATION_BORDER,
      enabled: true,
      preset: "blur-background",
      backgroundMode: "blur",
      imageScale: 0.9,
      imageShadow: 0.32,
      blurAmount: 32,
      opacity: 0.16,
      color: [0, 0, 0],
      aspectRatio: "4:5",
      size: 0.06,
      top: 0.06,
      right: 0.06,
      bottom: 0.06,
      left: 0.06,
    },
  },
  {
    id: "social-4x5",
    label: "Social 4:5",
    settings: {
      ...DEFAULT_PRESENTATION_BORDER,
      enabled: true,
      preset: "social-4x5",
      imageScale: 0.94,
      imageShadow: 0.22,
      color: [245, 242, 235],
      aspectRatio: "4:5",
      size: 0.06,
      top: 0.06,
      right: 0.06,
      bottom: 0.06,
      left: 0.06,
    },
  },
];

export function getPresentationBorderPreset(id: PresentationBorderPreset) {
  return PRESENTATION_BORDER_PRESETS.find((preset) => preset.id === id) ?? PRESENTATION_BORDER_PRESETS[0];
}
