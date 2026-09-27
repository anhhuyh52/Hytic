import {
  ShaderMaterial,
  Vector2,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import fullscreenVertexShader from "../../shaders/fx/fullscreen.vert?raw";
import fragmentShader from "../../shaders/retouch/edgeAwareSmooth.frag?raw";
import {
  createFullscreenResources,
  renderPassToTarget,
} from "../fx/passUtils";

export type EdgeAwareSmoothOptions = {
  sampleSpacing: number;
  spatialFalloff: number;
  rangeFalloff: number;
  centerWeight: number;
};

const DEFAULT_SMOOTH_OPTIONS: EdgeAwareSmoothOptions = {
  sampleSpacing: 2,
  spatialFalloff: 0.22,
  rangeFalloff: 28,
  centerWeight: 4,
};

export class EdgeAwareSmoothPass {
  private readonly material = new ShaderMaterial({
    uniforms: {
      uImage: { value: null },
      uTexelSize: { value: new Vector2(1, 1) },
      uSampleSpacing: { value: DEFAULT_SMOOTH_OPTIONS.sampleSpacing },
      uSpatialFalloff: { value: DEFAULT_SMOOTH_OPTIONS.spatialFalloff },
      uRangeFalloff: { value: DEFAULT_SMOOTH_OPTIONS.rangeFalloff },
      uCenterWeight: { value: DEFAULT_SMOOTH_OPTIONS.centerWeight },
    },
    vertexShader: fullscreenVertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly resources = createFullscreenResources(this.material);

  render(
    renderer: WebGLRenderer,
    image: Texture,
    target: WebGLRenderTarget,
    contextWidth: number,
    contextHeight: number,
    options: EdgeAwareSmoothOptions = DEFAULT_SMOOTH_OPTIONS,
  ): void {
    this.material.uniforms.uImage.value = image;
    this.material.uniforms.uTexelSize.value.set(
      1 / Math.max(1, contextWidth),
      1 / Math.max(1, contextHeight),
    );
    this.material.uniforms.uSampleSpacing.value = options.sampleSpacing;
    this.material.uniforms.uSpatialFalloff.value = options.spatialFalloff;
    this.material.uniforms.uRangeFalloff.value = options.rangeFalloff;
    this.material.uniforms.uCenterWeight.value = options.centerWeight;
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose(): void {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}
