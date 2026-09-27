import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  LinearFilter,
  NoColorSpace,
  UnsignedByteType,
  Scene,
  OrthographicCamera,
} from "three";
import type { WebGLRenderer } from "three";
import vertexShader   from "../../shaders/masking/gradientMask.vert?raw";
import fragmentShader from "../../shaders/masking/gradientMask.frag?raw";

export interface GradientMaskParams {
  startPoint: [number, number]; // image UV — transparent side
  endPoint:   [number, number]; // image UV — opaque side
  reflect:    boolean;
  invert:     boolean;
  opacity:    number;
  alpha:      number;
}

export class GradientMaskPass {
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
        uStartPoint: { value: new Vector2(0.5, 0.75) },
        uEndPoint:   { value: new Vector2(0.5, 0.25) },
        uReflect:    { value: false },
        uInvert:     { value: false },
        uOpacity:    { value: 1.0 },
        uAlpha:      { value: 1.0 },
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
      minFilter:    LinearFilter,
      magFilter:    LinearFilter,
      colorSpace:   NoColorSpace,
      type:         UnsignedByteType,
      depthBuffer:  false,
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

  render(renderer: WebGLRenderer, params: GradientMaskParams): WebGLRenderTarget {
    const u = this.material.uniforms;
    u.uStartPoint.value.set(params.startPoint[0], params.startPoint[1]);
    u.uEndPoint.value.set(  params.endPoint[0],   params.endPoint[1]);
    u.uReflect.value  = params.reflect;
    u.uInvert.value   = params.invert;
    u.uOpacity.value  = Math.max(0, Math.min(1, params.opacity));
    u.uAlpha.value    = Math.max(0, Math.min(1, params.alpha));

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
