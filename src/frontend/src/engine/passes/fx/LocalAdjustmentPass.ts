import {
  GLSL3,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
} from "three";
import vertexShader from "../../shaders/fx/fullscreen.glsl3.vert?raw";
import fragmentShaderRaw from "../../shaders/fx/localAdjustment.frag?raw";
import colorPipelineShader from "../../shaders/common/colorPipeline.glsl?raw";
import {
  createFullscreenResources,
  renderPassToTarget,
  type FullscreenPassResources,
} from "./passUtils";
import type { LUTTextureHandle } from "../../lut/LUTStorageTypes";
import type { LocalAdjustmentLayer } from "../../state/EditState";

const fragmentShader = fragmentShaderRaw.replace(
  "#include <colorPipeline>",
  colorPipelineShader,
);

export class LocalAdjustmentPass {
  private readonly uniforms: Record<string, IUniform> = {
    uImage: { value: null },
    uMaskTexture: { value: null },
    uLUT3D: { value: null },

    uHasMaskTexture: { value: false },
    uHasLUT3D: { value: false },

    uMaskOpacity: { value: 1.0 },
    uMaskAlpha: { value: 1.0 },
    uAcesLinearInput: { value: false },
  };

  private readonly material: ShaderMaterial;
  private readonly resources: FullscreenPassResources;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      glslVersion: GLSL3,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });

    this.resources = createFullscreenResources(this.material);
  }

  setImage(texture: Texture, _sourceWidth: number, _sourceHeight: number) {
    this.uniforms.uImage.value = texture;
  }

  setMaskTexture(texture: Texture | null | undefined) {
    this.uniforms.uMaskTexture.value = texture ?? null;
    this.uniforms.uHasMaskTexture.value = !!texture;
  }

  setLUTHandle(handle: LUTTextureHandle | null | undefined) {
    const texture = handle?.texture ?? null;

    this.uniforms.uLUT3D.value = texture;
    this.uniforms.uHasLUT3D.value = !!texture;
  }

  setLayer(layer: LocalAdjustmentLayer, _sourceWidth: number, _sourceHeight: number) {
    const component = layer.components[0];

    this.uniforms.uMaskOpacity.value = component?.opacity ?? 1.0;
    this.uniforms.uMaskAlpha.value = component?.alpha ?? 1.0;
  }

  setAcesLinearInput(enabled: boolean) {
    this.uniforms.uAcesLinearInput.value = enabled;
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget) {
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}