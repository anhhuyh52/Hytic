/*
 * Official preset pack manifest mirrored from legacy package.min.js `pv`.
 * Pack `name` is the JSON filename in /assets/presets/{source}/{name}.json.
 */
export type OfficialPack = {
  slug: string;
  name: string;
  source: "official";
  niceName: string;
  img: string;
  description: string;
};

export const OFFICIAL_PACKS: OfficialPack[] = [
  {
    slug: "tetrachrome",
    name: "TetraChrome",
    source: "official",
    niceName: "TetraChrome(TM)",
    img: "assets/img/looks/tetrachrome.jpg",
    description:
      "Clean, high-precision processed film simulation based on Kodak(TM) Vision 3 series.",
  },
  {
    slug: "cinestill",
    name: "CineStill",
    source: "official",
    niceName: "CineStill(TM)",
    img: "assets/img/looks/cinestill.jpg",
    description:
      "CineStill 50D is great for daylight, 500T excels in low-light and when shooting with tungsten.",
  },
  {
    slug: "vsco_essentials",
    name: "VSCO Essentials",
    source: "official",
    niceName: "VSCO(TM) Essentials",
    img: "assets/img/looks/vsco_essentials.jpg",
    description:
      "Popular film presets directly in Color.io for complete control and exceptional quality.",
  },
  {
    slug: "minolta_konica",
    name: "Minolta Konica",
    source: "official",
    niceName: "Konica Minolta(TM)",
    img: "assets/img/looks/minolta_konica.jpg",
    description: "Emulations of film stocks by Minolta. Expired & great for lomography.",
  },
  {
    slug: "visioncolor_osiris",
    name: "VisionColor OSIRIS",
    source: "official",
    niceName: "VisionColor(TM) OSIRIS",
    img: "assets/img/looks/visioncolor_osiris.jpg",
    description: "Including the M31 Cinema LUT. Fully ported to Color.io for complete control.",
  },
  {
    slug: "cinematic_film_looks",
    name: "Cinematic Film Looks",
    source: "official",
    niceName: "Cinematic Film Looks",
    img: "assets/img/looks/cinematic_film_looks.jpg",
    description:
      "Re-grades inspired by popular blockbuster films - fully adjustable built-in film emulations.",
  },
  {
    slug: "fuji_still",
    name: "Fuji Still",
    source: "official",
    niceName: "Fuji(TM) Still",
    img: "assets/img/looks/fuji_still.jpg",
    description:
      "Essential collection of authentic Fuji Still Film Emulations for analog enthusiasts.",
  },
  {
    slug: "fuji_print_film",
    name: "Fuji Print Film",
    source: "official",
    niceName: "Fuji(TM) Print Film",
    img: "assets/img/looks/fuji_print_film.jpg",
    description: "Accurately sampled color-positive print film emulations from Fuji.",
  },
  {
    slug: "kodak_still",
    name: "Kodak Still",
    source: "official",
    niceName: "Kodak(TM) Still",
    img: "assets/img/looks/kodak_still.jpg",
    description: "Authentic still film stocks including Portra, Gold, Kodachrome & more.",
  },
  {
    slug: "kodak_motion_picture",
    name: "Kodak Motion Picture",
    source: "official",
    niceName: "Kodak(TM) Motion Picture",
    img: "assets/img/looks/kodak_motion_picture.jpg",
    description:
      "Color negative and print motion picture film stocks from the iconic Vision 3 family.",
  },
];

export const packThumbnail = (pack: OfficialPack) => `/${pack.img}`;
export const packJsonUrl = (source: string, name: string) =>
  `/assets/presets/${source}/${name}.json`;

export type PresetEntry = {
  name: string;
  data: PresetData;
  meta?: PresetMeta;
};

export type PresetMeta = {
  description?: string;
  packName?: string;
  basePackName?: string;
  basePackSource?: string;
  basePresetID?: string;
  installDate?: number;
  lastModified?: number;
  modifiedFromBase?: boolean;
  generated?: boolean;
};

export type PresetData = {
  c?: Record<string, unknown>;
  s?: Record<string, unknown>;
  d?: Record<string, unknown>;
  l?: Record<string, unknown>;
  r?: Record<string, unknown>;
  g?: Record<string, unknown>;
};

export async function loadOfficialPack(pack: OfficialPack): Promise<PresetEntry[]> {
  const resp = await fetch(packJsonUrl(pack.source, pack.name));
  if (!resp.ok) throw new Error(`Failed to load pack ${pack.name} (${resp.status})`);
  const json: unknown = await resp.json();
  if (!Array.isArray(json)) throw new Error(`Pack ${pack.name} is not a preset array`);
  return json as PresetEntry[];
}
