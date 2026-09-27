import {
  ClampToEdgeWrapping,
  GLSL3,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
} from "three";
import { LUT_SIZE } from "../lut/lutConstants";
import type { LUTTextureHandle, LUTTextureKind } from "../lut/LUTStorageTypes";
import type { ImageFXState, TransformState } from "../state/EditState";
import type { ScopeReadback } from "../scopes/ScopeTypes";
import type { LUTInterpolationMode } from "./IntegrationPass";
import {
  buildProcessedFragmentShader,
  buildProcessedVertexShader,
  createProcessedUniforms,
  setProcessedLUTHandle,
  setProcessedFXState,
  setProcessedTransformState,
} from "./processedPipeline";

const interpolationModeValues: Record<LUTInterpolationMode, number> = {
  trilinear: 0,
  tetrahedral: 1,
};

/**
 * Renders the processed pipeline (base LUT + FX, no preview/
 * debug/split) into a small render target and reads the pixels back to the CPU
 * for scope analysis. Read-only: never touches the canvas, LUTs, or export.
 */
export class ScopesReadbackPass {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2, 1, 1);
  private readonly uniforms: Record<string, IUniform> = createProcessedUniforms();
  private readonly material2D: ShaderMaterial;
  private readonly material3D: ShaderMaterial;
  private material: ShaderMaterial;
  private readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private renderTarget?: WebGLRenderTarget;
  private activeLUTKind: LUTTextureKind = "2d-atlas";
  private sourceWidth = 1;
  private sourceHeight = 1;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.material2D = this.createMaterial("2d-atlas");
    this.material3D = this.createMaterial("3d-texture");
    this.material = this.material2D;
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setImageTexture(texture: Texture | null) {
    this.uniforms.uImage.value = texture;
    const image = texture?.image as { width?: number; height?: number } | undefined;
    this.sourceWidth = Math.max(1, image?.width ?? 1);
    this.sourceHeight = Math.max(1, image?.height ?? 1);
    this.uniforms.uSourceSize.value.set(this.sourceWidth, this.sourceHeight);
    this.uniforms.uDisplaySize.value.set(this.sourceWidth, this.sourceHeight);
  }

  setLUTTexture(texture: Texture | null) {
    this.setLUTHandle(texture ? { kind: "2d-atlas", texture, size: LUT_SIZE } : null);
  }

  setLUTHandle(handle: LUTTextureHandle | null) {
    if (handle) {
      this.setLUTStorageMode(handle.kind);
    }
    setProcessedLUTHandle(this.uniforms, handle);
  }

  setLUTStorageMode(kind: LUTTextureKind) {
    if (this.activeLUTKind === kind) {
      return;
    }
    this.activeLUTKind = kind;
    this.material = kind === "3d-texture" ? this.material3D : this.material2D;
    this.mesh.material = this.material;
  }

  setUseLUT(enabled: boolean) {
    this.uniforms.uUseLUT.value = enabled;
  }

  setLUTInterpolationMode(mode: LUTInterpolationMode) {
    this.uniforms.uLUTInterpolationMode.value = interpolationModeValues[mode];
  }

  updateFXState(fxState: ImageFXState): void {
    setProcessedFXState(this.uniforms, fxState);
  }

  updateTransformState(state: TransformState): void {
    setProcessedTransformState(this.uniforms, state, undefined, {
      width: this.sourceWidth,
      height: this.sourceHeight,
    });
  }

  /** Renders to a size×size buffer and returns top-down RGBA pixels, or null if no image. */
  readPixels(size: number): ScopeReadback | null {
    if (!this.uniforms.uImage.value) {
      return null;
    }

    const dimension = Math.max(16, Math.floor(size));
    const renderTarget = this.getRenderTarget(dimension);
    this.uniforms.uOutputSize.value.set(dimension, dimension);

    const previousRenderTarget = this.renderer.getRenderTarget();
    const previousViewport = new Vector4();
    this.renderer.getViewport(previousViewport);

    this.renderer.setRenderTarget(renderTarget);
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(previousRenderTarget);
      this.renderer.setViewport(previousViewport);
    }

    const raw = new Uint8Array(dimension * dimension * 4);
    this.renderer.readRenderTargetPixels(renderTarget, 0, 0, dimension, dimension, raw);

    // Flip Y (WebGL bottom-up -> top-down) so mask-mode previews render upright.
    const pixels = new Uint8Array(dimension * dimension * 4);
    const rowBytes = dimension * 4;
    for (let targetRow = 0; targetRow < dimension; targetRow += 1) {
      const sourceRow = dimension - 1 - targetRow;
      pixels.set(
        raw.subarray(sourceRow * rowBytes, sourceRow * rowBytes + rowBytes),
        targetRow * rowBytes,
      );
    }

    return { width: dimension, height: dimension, pixels };
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material2D.dispose();
    this.material3D.dispose();
    this.renderTarget?.dispose();
    this.renderTarget = undefined;
  }

  private getRenderTarget(size: number) {
    if (
      this.renderTarget &&
      this.renderTarget.width === size &&
      this.renderTarget.height === size
    ) {
      return this.renderTarget;
    }
    this.renderTarget?.dispose();
    this.renderTarget = new WebGLRenderTarget(size, size, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      type: UnsignedByteType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.renderTarget.texture.generateMipmaps = false;
    this.renderTarget.texture.colorSpace = NoColorSpace;
    return this.renderTarget;
  }

  private createMaterial(lutKind: LUTTextureKind): ShaderMaterial {
    const fragSrc = buildProcessedFragmentShader(lutKind);
    if (fragSrc.includes("#include ")) {
      console.error("[ScopesReadbackPass] Unresolved #include in fragment shader:", fragSrc.match(/#include [<\w>]+/g));
    }
    return new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: buildProcessedVertexShader(lutKind),
      fragmentShader: fragSrc,
      ...(lutKind === "3d-texture" ? { glslVersion: GLSL3 } : {}),
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
  }
}
