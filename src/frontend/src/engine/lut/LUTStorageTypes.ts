import type { Texture } from "three";

export type LUTStorageMode = "auto" | "2d-atlas" | "3d-texture";

export type EngineSettingsState = {
  lutStorageMode: LUTStorageMode;
};

export const DEFAULT_ENGINE_SETTINGS: EngineSettingsState = {
  lutStorageMode: "auto",
};

export type LUTTextureKind = "2d-atlas" | "3d-texture";

export type LUTTextureHandle = {
  kind: LUTTextureKind;
  texture: Texture;
  size: number;
};

export type LUTMemoryEstimate = {
  activeLUTCount: number;
  atlasBytesPerLUT: number;
  texture3DBytesPerLUT: number;
  totalAtlasBytes: number;
  total3DTextureBytes: number;
  totalApproxBytes: number;
  warning?: string;
};
