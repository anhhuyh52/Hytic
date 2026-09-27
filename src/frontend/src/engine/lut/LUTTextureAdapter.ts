import type { EngineCapabilities } from "../capabilities/EngineCapabilities";
import { LUT_SIZE, LUT_TEXTURE_SIZE } from "./lutConstants";
import type { LUTMemoryEstimate, LUTStorageMode, LUTTextureKind } from "./LUTStorageTypes";

export function resolveLUTTextureKind(
  mode: LUTStorageMode,
  capabilities: EngineCapabilities,
): LUTTextureKind {
  if (mode === "2d-atlas") {
    return "2d-atlas";
  }

  if (mode === "3d-texture") {
    return capabilities.supports3DTextures ? "3d-texture" : "2d-atlas";
  }

  return capabilities.supports3DTextures ? "3d-texture" : "2d-atlas";
}

export function getLUTStorageWarning(
  mode: LUTStorageMode,
  capabilities: EngineCapabilities,
): string | undefined {
  if (mode === "3d-texture" && !capabilities.supports3DTextures) {
    return "3D LUT textures require WebGL2; falling back to the 2D atlas LUT path.";
  }

  if (mode === "auto" && !capabilities.supports3DTextures) {
    return "WebGL2 3D LUT textures are unavailable; using the 2D atlas LUT path.";
  }

  return undefined;
}

export function getLUTPathLabel(kind: LUTTextureKind, interpolationLabel: string): string {
  if (kind === "3d-texture") {
    return "3D Texture / Trilinear";
  }

  return interpolationLabel === "trilinear" ? "2D Atlas / Trilinear" : "2D Atlas / Tetrahedral";
}

export function estimateLUTMemory(kind: LUTTextureKind, activeLUTCount: number): LUTMemoryEstimate {
  const count = Math.max(0, Math.floor(activeLUTCount));
  const atlasBytesPerLUT = LUT_TEXTURE_SIZE * LUT_TEXTURE_SIZE * 4;
  const texture3DBytesPerLUT = LUT_SIZE * LUT_SIZE * LUT_SIZE * 4;
  const totalAtlasBytes = atlasBytesPerLUT * count;
  const total3DTextureBytes = kind === "3d-texture" ? texture3DBytesPerLUT * count : 0;
  const totalApproxBytes = totalAtlasBytes + total3DTextureBytes;
  const warning =
    kind === "3d-texture" && count > 4
      ? "3D LUT mode stores one extra 64^3 RGBA8 texture for the base LUT and each active local layer."
      : undefined;

  return {
    activeLUTCount: count,
    atlasBytesPerLUT,
    texture3DBytesPerLUT,
    totalAtlasBytes,
    total3DTextureBytes,
    totalApproxBytes,
    warning,
  };
}
