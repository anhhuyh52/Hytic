import {
  ShaderMaterial,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import type { DistortState, RetouchState, TransformState } from "../../state/EditState";
import fullscreenVertexShader from "../../shaders/fx/fullscreen.vert?raw";
import {
  buildRetouchContextFragmentShader,
  createProcessedUniforms,
  setProcessedDistortState,
  setProcessedRetouchState,
  setProcessedTransformState,
} from "../processedPipeline";
import { createFullscreenResources, renderPassToTarget } from "../fx/passUtils";

export type RetouchContextViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class RetouchContextPass {
  private readonly uniforms = createProcessedUniforms();
  private readonly material = new ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: fullscreenVertexShader,
    fragmentShader: buildRetouchContextFragmentShader(),
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly resources = createFullscreenResources(this.material);

  render(
    renderer: WebGLRenderer,
    image: Texture,
    target: WebGLRenderTarget,
    sourceWidth: number,
    sourceHeight: number,
    transform: TransformState,
    distort: DistortState,
    retouch: RetouchState,
    viewport: RetouchContextViewport = { x: 0, y: 0, width: 1, height: 1 },
  ): void {
    this.uniforms.uImage.value = image;
    this.uniforms.uApplyTransform.value = true;
    this.uniforms.uFlipSourceY.value = true;
    this.uniforms.uExportViewport.value.set(
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    );
    this.uniforms.uOutputSize.value.set(Math.max(1, target.width), Math.max(1, target.height));
    setProcessedTransformState(this.uniforms, transform, undefined, {
      width: sourceWidth,
      height: sourceHeight,
    });
    setProcessedDistortState(this.uniforms, distort, {
      width: sourceWidth,
      height: sourceHeight,
    });
    setProcessedRetouchState(this.uniforms, retouch, null, null);
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose(): void {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}
