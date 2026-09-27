/*
 * The 16 legacy control panels, in legacy order, with the exact panel keys,
 * icon asset paths, labels and sup tags from the legacy index.html (source of
 * truth). `helpScope` distinguishes LUT-baked vs render-only effects.
 */
export type PanelKey =
  | "presets"
  | "match"
  | "distort"
  | "retouch"
  | "balance"
  | "exposure"
  | "contrast"
  | "scattering"
  | "refraction"
  | "density"
  | "chroma"
  | "radiance"
  | "saturation"
  | "rgb"
  | "spotlight"

  | "halation"
  | "diffusion"
  | "texture";

export type PanelDef = {
  key: PanelKey;
  icon: string; // /assets/icons/*.svg
  label: string;
  sup?: string; // superscript (AI / FX)
  hasHelp: boolean;
  helpTitle?: string;
  helpScope?: string;
  helpBlurb?: string;
};

const ICON = (name: string) => `/assets/icons/${name}`;

export const PANELS: PanelDef[] = [
  {
    key: "presets",
    icon: ICON("presets_icon.svg"),
    label: "Presets",
    hasHelp: false,
  },
  {
    key: "match",
    icon: ICON("match_icon.svg"),
    label: "Color Match",
    sup: "AI",
    hasHelp: true,
    helpTitle: "Color Match AI",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Match the color, brightness and contrast of a reference image to your current image. Ideal for replicating film looks or kickstarting a grade.",
  },
  /*
  {
    key: "retouch",
    icon: ICON("comb_icon.svg"),
    label: "Retouch",
    hasHelp: true,
    helpTitle: "Spot Removal",
    helpScope: "Render-Only (Not Included in LUTs)",
    helpBlurb:
      "Remove blemishes with a manually positioned Heal or Clone source. Drag either circle independently and use the source handle to resize and rotate.",
  },
  */
  {
    key: "balance",
    icon: ICON("balance_icon.svg"),
    label: "Balance",
    hasHelp: true,
    helpTitle: "Balance",
    helpScope: "Included in LUT Exports",
    helpBlurb: "Adjust global exposure, saturation, temperature and tint with the 2-axis controls.",
  },
  {
    key: "exposure",
    icon: ICON("exposure_icon.svg"),
    label: "Exposure Curve",
    hasHelp: true,
    helpTitle: "Exposure Curve",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Shape brightness across shadows, midtones and highlights with precise control over luminance ranges.",
  },
  {
    key: "contrast",
    icon: ICON("contrast_icon.svg"),
    label: "Contrast Curve",
    hasHelp: true,
    helpTitle: "Contrast Curve",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Adjust contrast distribution across tonal zones with film-density modeling and full control over curve shape.",
  },
  {
    key: "scattering",
    icon: ICON("scatter_icon.svg"),
    label: "Scattering",
    hasHelp: true,
    helpTitle: "Scattering",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Add physically accurate shadow and highlight tinting based on natural light behavior using the two color wheels.",
  },
  {
    key: "refraction",
    icon: ICON("refract_icon.svg"),
    label: "Refraction",
    hasHelp: true,
    helpTitle: "Refraction",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Filmic HSL. Change hue and saturation in shadows and highlights independently for all color vectors.",
  },
  {
    key: "density",
    icon: ICON("density_vs_hue_icon.svg"),
    label: "Density Curve",
    hasHelp: true,
    helpTitle: "Density Curve",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Control color richness and saturation hue-by-hue, based on analog film density behavior.",
  },
  {
    key: "chroma",
    icon: ICON("chroma_icon.svg"),
    label: "Chroma Curve",
    hasHelp: true,
    helpTitle: "Chroma Curve",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Adjust saturation based on how colorful pixels already are. Boost muted tones or protect vibrant highlights.",
  },
  {
    key: "radiance",
    icon: ICON("radiance_curve_icon.svg"),
    label: "Radiance Curve",
    hasHelp: true,
    helpTitle: "Radiance Curve",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Adjust brightness per hue for subtle tonal balancing and natural color contrast without masking.",
  },
  {
    key: "saturation",
    icon: ICON("saturation_icon.svg"),
    label: "Saturation Curve",
    hasHelp: true,
    helpTitle: "Saturation Curve",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Control saturation across brightness ranges. Boost shadows or reduce highlights to avoid color clipping.",
  },
  {
    key: "rgb",
    icon: ICON("sliders_icon.svg"),
    label: "Shadow Highlight",
    hasHelp: true,
    helpTitle: "Shadows & Highlights",
    helpScope: "Included in LUT Exports",
    helpBlurb:
      "Adjust brightness and introduce subtle hue shifts separately in the shadows and highlights of your image.",
  },
  {
    key: "spotlight",
    icon: ICON("relight_icon.svg"),
    label: "Spotlight",
    sup: "FX",
    hasHelp: true,
    helpTitle: "Spotlight",
    helpScope: "Render-Only (Not Included in LUTs)",
    helpBlurb:
      "Dynamic re-illumination with localized exposure and pop. Drag the point on the image to position the light; double-click it to recenter.",
  },

  {
    key: "halation",
    icon: ICON("halation_icon.svg"),
    label: "Halation",
    sup: "FX",
    hasHelp: true,
    helpTitle: "Halation",
    helpScope: "Render-Only (Not Included in LUTs)",
    helpBlurb:
      "Simulate the iconic red-orange glow around highlights seen in analog film photography.",
  },
  {
    key: "diffusion",
    icon: ICON("diffusion_icon.svg"),
    label: "Diffusion",
    sup: "FX",
    hasHelp: true,
    helpTitle: "Diffusion",
    helpScope: "Render-Only (Not Included in LUTs)",
    helpBlurb:
      "Real-time optical diffusion that softens highlights while maintaining subject focus. Drag the point on the image to position the protected area; double-click it to recenter.",
  },
  {
    key: "texture",
    icon: ICON("grain_icon.svg"),
    label: "Texture",
    sup: "FX",
    hasHelp: true,
    helpTitle: "Texture",
    helpScope: "Render-Only (Not Included in LUTs)",
    helpBlurb:
      "Re-texture every pixel with volumetric film grain and localized micro-contrast, from fine 35mm to gritty ISO 800.",
  },
];
