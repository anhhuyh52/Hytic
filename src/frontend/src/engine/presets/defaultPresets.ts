import type { PresetDefinition } from "./PresetTypes";

// Built-in demo presets. These pre-date the curve-based Density/Chroma/Saturation/
// Radiance panels; their old scalar look sections had no faithful flat→curve
// mapping (legacy density/radiance are per-hue), so they now express their
// character through contrast / balance / rgbMixer only. Curve-based looks ship
// via the official legacy packs (applyPreset).
export const DEFAULT_PRESETS: PresetDefinition[] = [
  {
    id: "clean-neutral",
    name: "Clean Neutral",
    description: "A restrained baseline with a small contrast lift and no color shift.",
    category: "Clean",
    look: {
      contrast: {
        amount: 0.06,
        pivot: 0.18,
      },
    },
  },
  {
    id: "soft-film",
    name: "Soft Film",
    description: "Lower contrast with a gentle warm balance.",
    category: "Film",
    look: {
      contrast: {
        amount: -0.12,
        pivot: 0.18,
      },
      balance: {
        temperature: 0.06,
      },
    },
  },
  {
    id: "vivid-chrome",
    name: "Vivid Chrome",
    description: "A punchier look with brighter color separation and modest contrast.",
    category: "Chrome",
    look: {
      contrast: {
        amount: 0.16,
        pivot: 0.2,
      },
      rgbMixer: {
        red: { r: 1.04, g: -0.02, b: -0.02 },
        green: { r: -0.02, g: 1.05, b: -0.01 },
        blue: { r: -0.01, g: -0.03, b: 1.04 },
      },
    },
  },
  {
    id: "cool-matte",
    name: "Cool Matte",
    description: "Cooler balance with softer contrast.",
    category: "Matte",
    look: {
      contrast: {
        amount: -0.1,
        pivot: 0.2,
      },
      balance: {
        temperature: -0.12,
        tint: 0.03,
        blue: 0.04,
      },
    },
  },
  {
    id: "warm-portrait",
    name: "Warm Portrait",
    description: "Warm balance with a touch of contrast.",
    category: "Portrait",
    look: {
      contrast: {
        amount: 0.04,
        pivot: 0.18,
      },
      balance: {
        temperature: 0.14,
        tint: 0.04,
        red: 0.03,
        blue: -0.03,
      },
    },
  },
];
