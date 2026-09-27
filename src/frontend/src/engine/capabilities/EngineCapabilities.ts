import type { WebGLRenderer } from "three";

export type EngineCapabilities = {
  isWebGL2: boolean;
  supports3DTextures: boolean;
  supportsFloatTextures: boolean;
  supportsHalfFloatTextures: boolean;
  maxTextureSize: number;
  max3DTextureSize: number;
};

export function detectEngineCapabilities(renderer: WebGLRenderer): EngineCapabilities {
  const gl = renderer.getContext();
  const isWebGL2Context =
    typeof WebGL2RenderingContext !== "undefined"
      ? gl instanceof WebGL2RenderingContext
      : "texImage3D" in gl;
  const isWebGL2 = renderer.capabilities.isWebGL2 && isWebGL2Context;
  const max3DTextureSize = isWebGL2
    ? Number(gl.getParameter((gl as WebGL2RenderingContext).MAX_3D_TEXTURE_SIZE))
    : 0;

  return {
    isWebGL2,
    supports3DTextures: isWebGL2 && max3DTextureSize > 0,
    supportsFloatTextures:
      renderer.extensions.has("OES_texture_float") ||
      renderer.extensions.has("EXT_color_buffer_float"),
    supportsHalfFloatTextures:
      renderer.extensions.has("OES_texture_half_float") ||
      renderer.extensions.has("EXT_color_buffer_half_float") ||
      renderer.extensions.has("EXT_color_buffer_float"),
    maxTextureSize: renderer.capabilities.maxTextureSize,
    max3DTextureSize,
  };
}
