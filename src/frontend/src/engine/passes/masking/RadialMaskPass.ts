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
import vertexShader from "../../shaders/masking/radialMask.vert?raw";
import fragmentShader from "../../shaders/masking/radialMask.frag?raw";

export interface RadialMaskParams {
  /** Normalized image-UV center (0..1). */
  position: [number, number];
  /**
   * Normalized image-UV *diameter* per axis (0..1).
   * The pass halves these internally so the shader receives radii.
   */
  size: [number, number];
  /** Rotation angle in radians. */
  angle: number;
  /** Feather softness 0 (hard) … 1 (fully soft). */
  feather: number;
  /** When true, selected area is outside the ellipse. */
  invert: boolean;
  /** Mask strength multiplier 0..1. */
  opacity: number;
  /** Per-layer blend alpha 0..1. */
  alpha: number;
}

export class RadialMaskPass {
  public readonly renderTarget: WebGLRenderTarget;

  private readonly scene: Scene;
  private readonly camera: OrthographicCamera;
  private readonly geometry: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    this.geometry = new PlaneGeometry(1, 1, 1, 1);

    this.material = new ShaderMaterial({
      uniforms: {
        uPosition:    { value: new Vector2(0.5, 0.5) },
        uSize:        { value: new Vector2(0.275, 0.275) },
        uAngle:       { value: 0.0 },
        uFeather:     { value: 1.0 },
        uInvert:      { value: true },
        uOpacity:     { value: 1.0 },
        uAlpha:       { value: 1.0 },
        uTextureSize: { value: new Vector2(1, 1) },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    this.scene = new Scene();
    this.scene.add(this.mesh);

    this.camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    this.camera.position.z = 1;

    this.renderTarget = new WebGLRenderTarget(1, 1, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      colorSpace: NoColorSpace,
      type: UnsignedByteType,
      depthBuffer: false,
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
    renderer: import("three").WebGLRenderer,
    params: RadialMaskParams,
    imageWidth: number,
    imageHeight: number,
  ): WebGLRenderTarget {
    const u = this.material.uniforms;

    u.uPosition.value.set(params.position[0], params.position[1]);
    // shader expects radius (half of diameter)
    u.uSize.value.set(
      Math.max(0.0001, params.size[0]) * 0.5,
      Math.max(0.0001, params.size[1]) * 0.5,
    );
    u.uAngle.value   = params.angle;
    u.uFeather.value = Math.max(0, Math.min(1, params.feather));
    u.uInvert.value  = params.invert;
    u.uOpacity.value = Math.max(0, Math.min(1, params.opacity));
    u.uAlpha.value   = Math.max(0, Math.min(1, params.alpha));
    u.uTextureSize.value.set(
      Math.max(1, imageWidth),
      Math.max(1, imageHeight),
    );

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
