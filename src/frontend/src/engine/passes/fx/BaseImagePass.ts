import {
  GLSL3,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
} from "three";
import { LUT_SIZE } from "../../lut/lutConstants";
import type { LUTTextureHandle, LUTTextureKind } from "../../lut/LUTStorageTypes";
import type { DirectCreativeShader } from "../../lut/LUTGenerator";
import type { DistortState, RetouchState, TransformState } from "../../state/EditState";
import type { LUTInterpolationMode } from "../IntegrationPass";
import {
  buildDirectProcessedFragmentShader,
  buildProcessedFragmentShader,
  buildProcessedVertexShader,
  createProcessedUniforms,
  setProcessedDistortState,
  setProcessedLUTHandle,
  setProcessedRetouchState,
  setProcessedTransformState,
} from "../processedPipeline";
import {
  createFullscreenResources,
  renderPassToTarget,
  type FullscreenPassResources,
} from "./passUtils";

const interpolationModeValues: Record<LUTInterpolationMode, number> = {
  trilinear: 0,
  tetrahedral: 1,
};

export class BaseImagePass {
  private readonly uniforms: Record<string, IUniform> = createProcessedUniforms();
  private material2D = this.createMaterial("2d-atlas");
  private material3D = this.createMaterial("3d-texture");
  private directMaterial2D: ShaderMaterial | null = null;
  private directMaterial3D: ShaderMaterial | null = null;
  private directCreative: DirectCreativeShader | null = null;
  private useDirectCreativeShader = false;
  private readonly resources: FullscreenPassResources;
  private activeLUTKind: LUTTextureKind = "2d-atlas";
  private sourceWidth = 1;
  private sourceHeight = 1;

  constructor() {
    this.resources = createFullscreenResources(this.material2D);
  }

  setImageTexture(texture: Texture | null, sourceWidth?: number, sourceHeight?: number) {
    this.uniforms.uImage.value = texture;
    const image = texture?.image as { width?: number; height?: number } | undefined;
    this.sourceWidth = Math.max(1, sourceWidth ?? image?.width ?? 1);
    this.sourceHeight = Math.max(1, sourceHeight ?? image?.height ?? 1);
  }

  setLUTHandle(handle: LUTTextureHandle | null) {
    if (handle) this.setLUTStorageMode(handle.kind);
    setProcessedLUTHandle(this.uniforms, handle);
  }

  setLUTTexture(texture: Texture | null) {
    this.setLUTHandle(texture ? { kind: "2d-atlas", texture, size: LUT_SIZE } : null);
  }

  setLUTStorageMode(kind: LUTTextureKind) {
    if (this.activeLUTKind === kind) return;
    this.activeLUTKind = kind;
    this.updateActiveMaterial();
  }

  setUseLUT(enabled: boolean) {
    this.uniforms.uUseLUT.value = enabled;
  }

  setAcesLinearInput(enabled: boolean) {
    this.uniforms.uAcesLinearInput.value = enabled;
  }

  setApplyTransform(enabled: boolean) {
    this.uniforms.uApplyTransform.value = enabled;
  }

  setFlipSourceY(enabled: boolean) {
    this.uniforms.uFlipSourceY.value = enabled;
  }

  setExportViewport(x: number, y: number, width: number, height: number) {
    this.uniforms.uExportViewport.value.set(x, y, width, height);
  }

  setDirectCreativeShader(creative: DirectCreativeShader | null) {
    if (this.directCreative?.fragmentPrelude === creative?.fragmentPrelude) {
      this.directCreative = creative;
      return;
    }

    this.directMaterial2D?.dispose();
    this.directMaterial3D?.dispose();
    this.directMaterial2D = null;
    this.directMaterial3D = null;
    this.directCreative = creative;
    this.updateActiveMaterial();
  }

  setUseDirectCreativeShader(enabled: boolean) {
    if (this.useDirectCreativeShader === enabled) return;
    this.useDirectCreativeShader = enabled;
    this.updateActiveMaterial();
  }

  setLUTInterpolationMode(mode: LUTInterpolationMode) {
    this.uniforms.uLUTInterpolationMode.value = interpolationModeValues[mode];
  }

  updateTransformState(state: TransformState) {
    setProcessedTransformState(this.uniforms, state, undefined, {
      width: this.sourceWidth,
      height: this.sourceHeight,
    });
  }

  updateDistortState(state: DistortState) {
    setProcessedDistortState(this.uniforms, state, {
      width: this.sourceWidth,
      height: this.sourceHeight,
    });
  }

  updateRetouchState(
    state: RetouchState,
    sourceSmoothTexture: Texture | null,
    destinationContextTexture: Texture | null = sourceSmoothTexture,
  ) {
    setProcessedRetouchState(
      this.uniforms,
      state,
      sourceSmoothTexture,
      destinationContextTexture,
    );
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget, width: number, height: number) {
    this.uniforms.uOutputSize.value.set(Math.max(1, width), Math.max(1, height));
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material2D.dispose();
    this.material3D.dispose();
    this.directMaterial2D?.dispose();
    this.directMaterial3D?.dispose();
  }

  private createMaterial(lutKind: LUTTextureKind) {
    const fragSrc = buildProcessedFragmentShader(lutKind);
    if (fragSrc.includes("#include ")) {
      console.error("[BaseImagePass] Unresolved #include in fragment shader:", fragSrc.match(/#include [<\w>]+/g));
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

  private createDirectMaterial(lutKind: LUTTextureKind) {
    if (!this.directCreative) return null;
    const fragSrc = buildDirectProcessedFragmentShader(this.directCreative, lutKind);
    if (fragSrc.includes("#include ")) {
      console.error("[BaseImagePass] Unresolved #include in direct fragment shader:", fragSrc.match(/#include [<\w>]+/g));
    }
    return new ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        ...this.directCreative.uniforms,
      },
      vertexShader: buildProcessedVertexShader(lutKind),
      fragmentShader: fragSrc,
      ...(lutKind === "3d-texture" ? { glslVersion: GLSL3 } : {}),
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
  }

  private updateActiveMaterial() {
    if (this.useDirectCreativeShader && this.directCreative) {
      if (this.activeLUTKind === "3d-texture") {
        this.directMaterial3D ??= this.createDirectMaterial("3d-texture");
        if (this.directMaterial3D) {
          this.resources.mesh.material = this.directMaterial3D;
          return;
        }
      } else {
        this.directMaterial2D ??= this.createDirectMaterial("2d-atlas");
        if (this.directMaterial2D) {
          this.resources.mesh.material = this.directMaterial2D;
          return;
        }
      }
    }

    this.resources.mesh.material =
      this.activeLUTKind === "3d-texture" ? this.material3D : this.material2D;
  }
}
