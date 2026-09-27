import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector3,
  NormalBlending,
  Scene,
  OrthographicCamera,
  Vector4,
} from "three";
import vertexShader from "../../shaders/masking/maskOverlay.vert?raw";
import fragmentShader from "../../shaders/masking/maskOverlay.frag?raw";

export class MaskOverlayPass {
  private readonly scene: Scene;
  private readonly camera: OrthographicCamera;
  private readonly geometry: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    this.geometry = new PlaneGeometry(1, 1, 1, 1);

    this.material = new ShaderMaterial({
      uniforms: {
        uMaskTexture: { value: null },
        uOverlayColor: { value: new Vector3(1, 0, 0) },
        uOpacity: { value: 1.0 },
        uTextureMode: { value: false },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: NormalBlending,
      toneMapped: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    this.scene = new Scene();
    this.scene.add(this.mesh);

    this.camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    this.camera.position.z = 1;
  }

  render(
    renderer: import("three").WebGLRenderer,
    maskTexture: Texture,
    overlayColor: [number, number, number],
    opacity: number,
    viewport: { x: number; y: number; width: number; height: number },
  ) {
    const uniforms = this.material.uniforms;
    uniforms.uMaskTexture.value = maskTexture;
    uniforms.uTextureMode.value = false;
    uniforms.uOverlayColor.value.set(
      overlayColor[0],
      overlayColor[1],
      overlayColor[2],
    );
    uniforms.uOpacity.value = Math.max(0, Math.min(1, opacity));

    this.renderViewport(renderer, viewport);
  }

  /**
   * Paints a prepared image texture over the displayed image rectangle using the
   * same post-scene viewport/scissor path as mask previews. The base scene and its
   * IntegrationPass texture remain untouched.
   */
  renderTexture(
    renderer: import("three").WebGLRenderer,
    texture: Texture,
    viewport: { x: number; y: number; width: number; height: number },
  ) {
    const uniforms = this.material.uniforms;
    uniforms.uMaskTexture.value = texture;
    uniforms.uTextureMode.value = true;
    uniforms.uOpacity.value = 1;
    this.renderViewport(renderer, viewport);
  }

  private renderViewport(
    renderer: import("three").WebGLRenderer,
    viewport: { x: number; y: number; width: number; height: number },
  ) {
    const x = Math.round(viewport.x);
    const y = Math.round(viewport.y);
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    if (width <= 0 || height <= 0) return;

    const oldAutoClear = renderer.autoClear;
    const oldScissorTest = renderer.getScissorTest();

    const oldViewport = new Vector4();
    const oldScissor = new Vector4();

    renderer.getViewport(oldViewport);
    renderer.getScissor(oldScissor);

    renderer.autoClear = false;

    // The viewport values are THREE renderer logical pixels, not already-scaled
    // drawing-buffer pixels. WebGLRenderer applies renderer.getPixelRatio()
    // internally for the default framebuffer.
    renderer.setViewport(x, y, width, height);
    renderer.setScissor(x, y, width, height);
    renderer.setScissorTest(true);

    renderer.render(this.scene, this.camera);

    renderer.setViewport(oldViewport);
    renderer.setScissor(oldScissor);
    renderer.setScissorTest(oldScissorTest);
    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
