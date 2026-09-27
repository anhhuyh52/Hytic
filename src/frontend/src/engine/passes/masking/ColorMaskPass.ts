import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  LinearFilter,
  NoColorSpace,
  UnsignedByteType,
  Scene,
  OrthographicCamera,
} from "three";
import vertexShader from "../../shaders/masking/colorMask.vert?raw";
import fragmentShader from "../../shaders/masking/colorMask.frag?raw";

export interface ColorMaskParams {
  feather: number;
  threshold: number;
  size: [number, number];
  angle: number;
  position: [number, number];
  useRadius: boolean;
  selectedColor?: [number, number, number] | null;
  sampledColor?: [number, number, number] | null;
  useSelectedColor: boolean;
  invert: boolean;
  opacity: number;
  alpha: number;
}

function normalizeColor(color: [number, number, number]): [number, number, number] {
  const max = Math.max(color[0], color[1], color[2]);
  const scale = max > 1 ? 1 / 255 : 1;
  return [
    Math.max(0, Math.min(1, color[0] * scale)),
    Math.max(0, Math.min(1, color[1] * scale)),
    Math.max(0, Math.min(1, color[2] * scale)),
  ];
}

export class ColorMaskPass {
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
        uImage: { value: null },
        uImageSize: { value: new Vector2(1, 1) },

        // Color mask controls.
        uFeather: { value: 0.35 },
        uThreshold: { value: 0.2 },
        uSelectedColor: { value: new Vector3(0, 0, 0) },
        uUseSelectedColor: { value: false },
        uInvert: { value: false },

        // Radius controls.
        uSize: { value: new Vector2(0.3, 0.3) },
        uAngle: { value: 0.0 },
        uPosition: { value: new Vector2(0.5, 0.5) },
        uUseRadius: { value: false },

        // Real mask strength. This is not red overlay opacity.
        uMaskOpacity: { value: 1.0 },
        uMaskAlpha: { value: 1.0 },
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

  setCanvasSize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.ceil(width));
    const nextHeight = Math.max(1, Math.ceil(height));

    if (
      nextWidth !== this.renderTarget.width ||
      nextHeight !== this.renderTarget.height
    ) {
      this.renderTarget.setSize(nextWidth, nextHeight);
    }
  }

  render(
    renderer: import("three").WebGLRenderer,
    imageTexture: Texture | null,
    preview: ColorMaskParams,
    maskSourceTexture?: Texture | null,
  ) {
    const uniforms = this.material.uniforms;

    const sourceTexture = maskSourceTexture ?? imageTexture;
    uniforms.uImage.value = sourceTexture;

    const image = imageTexture?.image as
      | { width?: number; height?: number }
      | undefined;

    uniforms.uImageSize.value.set(
      Math.max(1, image?.width || this.renderTarget.width || 1),
      Math.max(1, image?.height || this.renderTarget.height || 1),
    );

    uniforms.uFeather.value = Math.max(0, Math.min(1, preview.feather));
    uniforms.uThreshold.value = Math.max(0.001, Math.min(1, preview.threshold));

    uniforms.uSize.value.set(
      Math.max(0.0001, preview.size[0]),
      Math.max(0.0001, preview.size[1]),
    );

    uniforms.uAngle.value = preview.angle;
    uniforms.uPosition.value.set(preview.position[0], preview.position[1]);
    uniforms.uUseRadius.value = preview.useRadius;

    const color = preview.selectedColor || preview.sampledColor;
    if (color) {
      const normalizedColor = normalizeColor(color);
      uniforms.uSelectedColor.value.set(
        normalizedColor[0],
        normalizedColor[1],
        normalizedColor[2],
      );
    }

    uniforms.uUseSelectedColor.value = preview.useSelectedColor && !!color;
    uniforms.uInvert.value = preview.invert;

    // Keep this as real mask strength. Do not mix this with red preview opacity.
    uniforms.uMaskOpacity.value = Math.max(0, Math.min(1, preview.opacity));
    uniforms.uMaskAlpha.value = Math.max(0, Math.min(1, preview.alpha));

    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.renderTarget);
    renderer.clearColor();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(oldTarget);

    return this.renderTarget;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}