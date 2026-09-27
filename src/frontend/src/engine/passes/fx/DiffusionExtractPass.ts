import { ShaderMaterial, Texture, WebGLRenderer, WebGLRenderTarget } from "three";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import fragmentShader from "../../shaders/fx/diffusionExtract.frag?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

/**
 * Downsamples the graded base image into the blur-resolution render target. The legacy
 * diffusion bloom blurs the whole image (no threshold extraction); fog, threshold and
 * focus-protection all happen in CompositePass.
 */
export class DiffusionExtractPass {
  private readonly material = new ShaderMaterial({
    uniforms: {
      uInput: { value: null },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly resources = createFullscreenResources(this.material);

  render(renderer: WebGLRenderer, input: Texture, target: WebGLRenderTarget) {
    this.material.uniforms.uInput.value = input;
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}
