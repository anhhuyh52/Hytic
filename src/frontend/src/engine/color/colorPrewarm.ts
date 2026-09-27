// Curated set of the most commonly-used legacy IDT (input) / ODT (display) spaces.
// After an image loads (and whenever the selection changes), the engine
// background-compiles these small per-pixel color-pass materials so switching to
// them is instant — matching the legacy app's snappy IDT/ODT switching. Uncommon
// spaces still compile lazily on first use.
// Ids must match idtOdtSources.ts (unknown ids are skipped at build time).
export const COMMON_INPUT_TRANSFORMS: readonly string[] = [
  "sRGB",
  "Rec709",
  "Rec2020",
  "AdobeRGB",
  "DisplayP3_IDT",
  "ProPhotoRGB",
  "Cineon_IDT",
  "ArriLogC",
  "ArriLogC_NO_VGAMMA",
  "ArriAlexa35",
  "BlackMagicDesignWideGamutGen5",
  "Sony_SLog3SGamut3",
  "Sony_SLog3SGamut3_Cine",
  "Panasonic_VLogVGamut",
  "Fuji_FLogFGamut",
  "FujiFLog2FGamut",
  "CanonLog3CinemaGamut_Daylight",
  "CanonLog3BT2020_Daylight",
  "RedLog3G10WideGamutRGB",
  "DJI_DLogDGamut",
  "AppleLog",
  "DaVinci_WideGamut_IDT",
  "ACES_2065_1",
  "ACES_CCT",
  // RAW-development IDTs — the default for any imported RAW. Without these, the
  // first switch to a RAW lazily compiles VisionLog→ODT synchronously (~800ms),
  // which blocks the main thread and freezes the media switch. Prewarming them in
  // the background makes RAW switching instant, like the other camera-log inputs.
  "VisionLog",
  "VisionLogFlat",
  "FilmNegative",
  "VisionLogFilmNegative",
];

export const COMMON_DISPLAY_TRANSFORMS: readonly string[] = [
  "sRGB",
  "Rec709",
  "Rec2020",
  "AdobeRGB",
  "P3D65",
  "P3_DCI_D65",
  "P3_DCI_D60",
  "DisplayP3_ODT",
  "ProPhotoRGB",
  "ArriLogC3",
];

/**
 * Builds the prioritized prewarm combo list for the current selection: the active
 * pair first (so it's ready soonest), then each common IDT against the current ODT
 * (input is the axis users explore most), then each common ODT against the current
 * IDT. Deduplicated.
 */
export function buildColorPrewarmCombos(
  currentIdt: string,
  currentOdt: string,
): Array<{ idtId: string; odtId: string }> {
  const combos: Array<{ idtId: string; odtId: string }> = [];
  const seen = new Set<string>();
  const add = (idtId: string, odtId: string) => {
    const key = `${idtId}|${odtId}`;
    if (seen.has(key)) return;
    seen.add(key);
    combos.push({ idtId, odtId });
  };
  add(currentIdt, currentOdt);
  for (const idt of COMMON_INPUT_TRANSFORMS) add(idt, currentOdt);
  for (const odt of COMMON_DISPLAY_TRANSFORMS) add(currentIdt, odt);
  return combos;
}
