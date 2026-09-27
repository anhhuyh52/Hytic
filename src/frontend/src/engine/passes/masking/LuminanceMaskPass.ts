import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  WebGLRenderTarget,
  LinearFilter,
  NoColorSpace,
  UnsignedByteType,
  Scene,
  OrthographicCamera,
} from "three";
import type { WebGLRenderer } from "three";
import vertexShader   from "../../shaders/masking/luminanceMask.vert?raw";
import fragmentShader from "../../shaders/masking/luminanceMask.frag?raw";

export interface LuminanceMaskParams {
  /** 0..1 – which brightness value to select. 0 = shadows, 1 = highlights. */
  target: number;
  /** 0..1 – width of the selected luminance band. */
  range: number;
  /** 0..1 – feather/softness at the boundary. */
  smoothness: number;
  /** When true, flips selected/unselected regions. */
  invert: boolean;
  /** Overall mask strength 0..1. */
  opacity: number;
  /** Per-layer blend alpha 0..1. */
  alpha: number;
}

export class LuminanceMaskPass {
  public readonly renderTarget: WebGLRenderTarget;

  private readonly scene:    Scene;
  private readonly camera:   OrthographicCamera;
  private readonly geometry: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh:     Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    this.geometry = new PlaneGeometry(1, 1);

    this.material = new ShaderMaterial({
      uniforms: {
        uSourceTexture: { value: null },
        uTarget:        { value: 1.0 },
        uRange:         { value: 0.7 },
        uSmoothness:    { value: 1.0 },
        uInvert:        { value: 0.0 },   // float: 0 = normal, 1 = inverted
        uOpacity:       { value: 1.0 },
        uAlpha:         { value: 1.0 },
      },
      vertexShader,
      fragmentShader,
      depthTest:   false,
      depthWrite:  false,
      transparent: false,
      toneMapped:  false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    this.scene = new Scene();
    this.scene.add(this.mesh);

    this.camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    this.camera.position.z = 1;

    this.renderTarget = new WebGLRenderTarget(1, 1, {
      minFilter:     LinearFilter,
      magFilter:     LinearFilter,
      colorSpace:    NoColorSpace,
      type:          UnsignedByteType,
      depthBuffer:   false,
      stencilBuffer: false,
    });
  }

  setCanvasSize(width: number, height: number): void {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (w !== this.renderTarget.width || h !== this.renderTarget.height) {
      this.renderTarget.setSize(w, h);
    }
  }

  render(
    renderer: WebGLRenderer,
    sourceTexture: Texture,
    params: LuminanceMaskParams,
  ): WebGLRenderTarget {
    const u = this.material.uniforms;
    u.uSourceTexture.value = sourceTexture;
    u.uTarget.value        = Math.max(0, Math.min(1, params.target));
    u.uRange.value         = Math.max(0, Math.min(1, params.range));
    u.uSmoothness.value    = Math.max(0, Math.min(1, params.smoothness));
    u.uInvert.value        = params.invert ? 1.0 : 0.0;
    u.uOpacity.value       = Math.max(0, Math.min(1, params.opacity));
    u.uAlpha.value         = Math.max(0, Math.min(1, params.alpha));

    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.clearColor();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(old);

    return this.renderTarget;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}
