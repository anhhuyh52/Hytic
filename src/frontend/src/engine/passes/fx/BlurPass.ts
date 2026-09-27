import { ShaderMaterial, Texture, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import horizontalShader from "../../shaders/fx/blurHorizontal.frag?raw";
import verticalShader from "../../shaders/fx/blurVertical.frag?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

export class BlurPass {
  private readonly horizontalMaterial = this.createMaterial(horizontalShader);
  private readonly verticalMaterial = this.createMaterial(verticalShader);
  private readonly horizontalResources = createFullscreenResources(this.horizontalMaterial);
  private readonly verticalResources = createFullscreenResources(this.verticalMaterial);

  render(
    renderer: WebGLRenderer,
    input: Texture,
    tempTarget: WebGLRenderTarget,
    outputTarget: WebGLRenderTarget,
    radius: number,
  ) {
    this.horizontalMaterial.uniforms.uInput.value = input;
    this.horizontalMaterial.uniforms.uTexelSize.value.set(
      1 / Math.max(1, tempTarget.width),
      1 / Math.max(1, tempTarget.height),
    );
    this.horizontalMaterial.uniforms.uRadius.value = radius;
    renderPassToTarget(renderer, this.horizontalResources, tempTarget);

    this.verticalMaterial.uniforms.uInput.value = tempTarget.texture;
    this.verticalMaterial.uniforms.uTexelSize.value.set(
      1 / Math.max(1, outputTarget.width),
      1 / Math.max(1, outputTarget.height),
    );
    this.verticalMaterial.uniforms.uRadius.value = radius;
    renderPassToTarget(renderer, this.verticalResources, outputTarget);
  }

  dispose() {
    this.horizontalResources.scene.remove(this.horizontalResources.mesh);
    this.verticalResources.scene.remove(this.verticalResources.mesh);
    this.horizontalResources.geometry.dispose();
    this.verticalResources.geometry.dispose();
    this.horizontalMaterial.dispose();
    this.verticalMaterial.dispose();
  }

  private createMaterial(fragmentShader: string) {
    return new ShaderMaterial({
      uniforms: {
        uInput: { value: null },
        uTexelSize: { value: new Vector2(1, 1) },
        uRadius: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }
}
