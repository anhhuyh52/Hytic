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
import { renderTargetToBlob } from "../export/exportImage";
import { LUT_SIZE } from "../lut/lutConstants";
import type { LUTTextureHandle, LUTTextureKind } from "../lut/LUTStorageTypes";
import type { DistortState, ImageFXState, TransformState } from "../state/EditState";
import { getTransformOutputDimensions } from "../transform/transformGeometry";
import type { LUTInterpolationMode } from "./IntegrationPass";
import {
  buildProcessedFragmentShader,
  buildProcessedVertexShader,
  createProcessedUniforms,
  setProcessedLUTHandle,
  setProcessedFXState,
  setProcessedDistortState,
  setProcessedTransformState,
} from "./processedPipeline";

export type ExportOptions = {
  width?: number;
  height?: number;
  mimeType?: "image/png" | "image/jpeg";
  quality?: number;
  // 16 requests a true 16-bit PNG (half-float export RT + readback). Falls back
  // to 8-bit when the GPU can't render to a float color buffer. Only valid with
  // PNG output.
  bitDepth?: 8 | 16;
};

/** Output color space for export (§10). `preview` = the current preview transform. */
export type ExportColorSpace =
  | "preview"
  | "display-p3"
  | "p3-d65"
  | "aces-cct"
  | "dwg"
  | "log-c-3"
  | "log-c-4"
  | "ipp2";

/** Full export-render request (legacy-style image export, §2). */
export type ExportImageRequest = {
  width: number;
  height: number;
  format: "jpg" | "webp" | "png-8" | "png-16" | "tif";
  quality?: number;
  dpi?: number;
  colorSpace: ExportColorSpace;
  gammaCurve: "kalar" | "native";
  metadata?: {
    make?: string;
    model?: string;
    lens?: string;
    capturedAt?: string;
    software?: string;
  };
};

const interpolationModeValues: Record<LUTInterpolationMode, number> = {
  trilinear: 0,
  tetrahedral: 1,
};

export class ExportPass {
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
  private imageWidth = 1;
  private imageHeight = 1;
  private currentTransform: TransformState | null = null;
  private activeLUTKind: LUTTextureKind = "2d-atlas";

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.material2D = this.createMaterial("2d-atlas");
    this.material3D = this.createMaterial("3d-texture");
    this.material = this.material2D;
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setImageTexture(texture: Texture, width: number, height: number) {
    this.uniforms.uImage.value = texture;
    this.imageWidth = Math.max(1, Math.floor(width));
    this.imageHeight = Math.max(1, Math.floor(height));
    this.uniforms.uSourceSize.value.set(this.imageWidth, this.imageHeight);
    this.uniforms.uDisplaySize.value.set(this.imageWidth, this.imageHeight);
  }

  clearImageTexture() {
    this.uniforms.uImage.value = null;
    this.imageWidth = 1;
    this.imageHeight = 1;
    this.uniforms.uSourceSize.value.set(1, 1);
    this.uniforms.uDisplaySize.value.set(1, 1);
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
    this.currentTransform = state;
    setProcessedTransformState(this.uniforms, state, undefined, {
      width: this.imageWidth,
      height: this.imageHeight,
    });
  }

  updateDistortState(state: DistortState): void {
    setProcessedDistortState(this.uniforms, state, {
      width: this.imageWidth,
      height: this.imageHeight,
    });
  }

  async export(options: ExportOptions = {}): Promise<Blob> {
    if (!this.uniforms.uImage.value) {
      throw new Error("No image loaded");
    }

    const { width, height } = this.resolveExportDimensions(options);
    const maxTextureSize = this.renderer.capabilities.maxTextureSize;

    if (width > maxTextureSize || height > maxTextureSize) {
      throw new Error(
        `Export size ${width}x${height} exceeds GPU maximum texture size ${maxTextureSize}`,
      );
    }

    const renderTarget = this.getRenderTarget(width, height);
    this.uniforms.uOutputSize.value.set(width, height);
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

    return renderTargetToBlob(
      this.renderer,
      renderTarget,
      width,
      height,
      options.mimeType ?? "image/png",
      options.quality,
    );
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material2D.dispose();
    this.material3D.dispose();
    this.renderTarget?.dispose();
    this.renderTarget = undefined;
  }

  /**
   * Compute export pixel dimensions from the transform state and any explicit
   * overrides. Accounts for orientation 90/270 flipping displayed w/h.
   */
  private resolveExportDimensions(options: ExportOptions): { width: number; height: number } {
    if (options.width !== undefined && options.height !== undefined) {
      return {
        width: normalizeExportDimension(options.width),
        height: normalizeExportDimension(options.height),
      };
    }

    const t = this.currentTransform;
    const fallback = t
      ? getTransformOutputDimensions(this.imageWidth, this.imageHeight, t)
      : { width: this.imageWidth, height: this.imageHeight };

    return {
      width: normalizeExportDimension(options.width ?? fallback.width),
      height: normalizeExportDimension(options.height ?? fallback.height),
    };
  }

  private getRenderTarget(width: number, height: number) {
    if (
      this.renderTarget &&
      this.renderTarget.width === width &&
      this.renderTarget.height === height
    ) {
      return this.renderTarget;
    }

    this.renderTarget?.dispose();
    this.renderTarget = new WebGLRenderTarget(width, height, {
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
      console.error("[ExportPass] Unresolved #include in fragment shader:", fragSrc.match(/#include [<\w>]+/g));
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

function normalizeExportDimension(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Export size must be finite");
  }

  return Math.max(1, Math.floor(value));
}
