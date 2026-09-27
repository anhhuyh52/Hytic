export type SpotRemovalMode = 0 | 1;

export type RetouchSpot = {
  id: string;
  type: "spot";
  /** Centered normalized display coordinates. Add 0.5 to render as image UV. */
  position: [number, number];
  sourcePosition: [number, number];
  /** Normalized diameter. X is image-aspect corrected so the overlay is circular. */
  size: [number, number];
  /** Degrees. */
  angle: number;
  feather: number;
  opacity: number;
  /** 0 = Clone, 1 = Heal. */
  mode: SpotRemovalMode;
  disabled?: boolean;
};

export type RetouchState = {
  enabled: boolean;
  bypass: boolean;
  spots: RetouchSpot[];
};

export const MAX_RETOUCH_SPOTS = 32;

export const DEFAULT_RETOUCH_STATE: RetouchState = {
  enabled: true,
  bypass: false,
  spots: [],
};

let fallbackSpotId = 0;

export function createRetouchSpotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackSpotId += 1;
  return `retouch-${Date.now().toString(36)}-${fallbackSpotId.toString(36)}`;
}

export function cloneRetouchSpot(spot: RetouchSpot): RetouchSpot {
  return {
    ...spot,
    position: [...spot.position],
    sourcePosition: [...spot.sourcePosition],
    size: [...spot.size],
  };
}

export function cloneRetouchState(state: RetouchState): RetouchState {
  return {
    enabled: state.enabled,
    bypass: state.bypass,
    spots: state.spots.map(cloneRetouchSpot),
  };
}
