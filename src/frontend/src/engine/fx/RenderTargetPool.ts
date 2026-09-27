import {
  ClampToEdgeWrapping,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  WebGLRenderTarget,
  type TextureDataType,
} from "three";

export class RenderTargetPool {
  private readonly targets = new Map<string, WebGLRenderTarget>();

  get(key: string, width: number, height: number, type: TextureDataType = UnsignedByteType) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const existing = this.targets.get(key);

    if (
      existing &&
      existing.width === w &&
      existing.height === h &&
      existing.texture.type === type
    ) {
      return existing;
    }

    existing?.dispose();
    const target = new WebGLRenderTarget(w, h, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      type,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.generateMipmaps = false;
    target.texture.colorSpace = NoColorSpace;
    this.targets.set(key, target);
    return target;
  }

  dispose() {
    for (const target of this.targets.values()) {
      target.dispose();
    }
    this.targets.clear();
  }
}
