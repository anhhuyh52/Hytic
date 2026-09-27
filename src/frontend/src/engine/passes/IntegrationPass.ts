import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from "three";
import type { LUTTextureHandle, LUTTextureKind } from "../lut/LUTStorageTypes";
import type { ImageFXState, TransformState } from "../state/EditState";
import { getTransformDisplayDimensions } from "../transform/transformGeometry";
import vertexShader from "../shaders/integration/integration.vert?raw";
import fragmentShader from "../shaders/integration/integration.frag?raw";
import transformShader from "../shaders/common/transform.glsl?raw";
import { recordUniformUpdate } from "../../app/performanceCounters";

export type IntegrationDebugMode = "final" | "uv" | "alpha" | "checker";
export type LUTInterpolationMode = "trilinear" | "tetrahedral";

const debugModeValues: Record<IntegrationDebugMode, number> = {
  final: 0,
  uv: 1,
  alpha: 2,
  checker: 3,
};

export class IntegrationPass {
  public readonly uniforms: Record<string, IUniform>;
  public readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  private readonly geometry: PlaneGeometry;
  private readonly material: ShaderMaterial;

  constructor() {
    this.uniforms = {
      uImage: { value: null },
      uProcessed: { value: null },
      uImageSize: { value: new Vector2(1, 1) },
      uDebugMode: { value: debugModeValues.final },
      uSplitX: { value: 0.0 },
      uCanvasSize: { value: new Vector2(1, 1) },
      uCropEnabled: { value: false },
      uCropRect: { value: new Vector4(0, 0, 1, 1) },
      uSourceSize: { value: new Vector2(1, 1) },
      uDisplaySize: { value: new Vector2(1, 1) },
      uOrientationAngle: { value: 0 },
      uStraighten: { value: 0 },
      uFlipX: { value: false },
      uFlipY: { value: false },
      // Presentation border (GPU compositing): the graded picture stays in uProcessed
      // and the shader places it inside uPictureRect within the frame, filling the
      // surrounding border region. No CPU readback/canvas — grade stays live.
      uBorderEnabled: { value: false },
      uPictureRect: { value: new Vector4(0, 0, 1, 1) }, // x,y,w,h in frame UV (bottom-up)
      uCoverRect: { value: new Vector4(0, 0, 1, 1) }, // cover mapping for blurred bg
      uBorderColor: { value: new Vector3(0, 0, 0) },
      uBorderImage: { value: null },
      uBorderImageRotation: { value: 0 },
      uBorderOpacity: { value: 1 },
      uBorderBgMode: { value: 0 }, // 0 = solid, 1 = blurred-image, 2 = frame image
      uBorderBlur: { value: new Vector2(0, 0) }, // blur radius in frame-UV (x,y)
      uPictureRadius: { value: 0 }, // inner picture corner radius, frame-height UV units
      uFrameRadius: { value: 0 }, // outer frame corner radius, frame-height UV units
      uPictureShadowOpacity: { value: 0 },
      uPictureShadowBlur: { value: 0 },
      uPictureShadowOffset: { value: new Vector2(0, 0) },
      uPictureInnerShadowOpacity: { value: 0 },
      uPictureInnerShadowBlur: { value: 0 },
      uFrameAspect: { value: 1 }, // frame width / height, for circular corners in UV space
      uBorderClearColor: { value: new Vector3(0.0667, 0.0667, 0.0627) }, // shown outside a rounded frame
    };

    this.geometry = new PlaneGeometry(1, 1, 1, 1);
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: fragmentShader.replace("#include <transform>", transformShader),
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setImageTexture(texture: Texture, width: number, height: number) {
    this.uniforms.uImage.value = texture;
    this.uniforms.uImageSize.value.set(Math.max(1, width), Math.max(1, height));
    this.uniforms.uSourceSize.value.set(Math.max(1, width), Math.max(1, height));
    this.uniforms.uDisplaySize.value.set(Math.max(1, width), Math.max(1, height));
    this.mesh.visible = !!this.uniforms.uProcessed.value;
    recordUniformUpdate(4);
  }

  clearImageTexture() {
    this.uniforms.uImage.value = null;
    this.uniforms.uImageSize.value.set(1, 1);
    this.uniforms.uSourceSize.value.set(1, 1);
    this.uniforms.uDisplaySize.value.set(1, 1);
    this.mesh.visible = false;
    recordUniformUpdate(4);
  }

  setProcessedTexture(texture: Texture | null) {
    this.uniforms.uProcessed.value = texture;
    this.mesh.visible = !!this.uniforms.uImage.value && !!texture;
    recordUniformUpdate();
  }

  /**
   * Enables GPU presentation-border compositing. The processed (graded) picture is
   * placed inside `pictureRect` (frame UV, bottom-up) and the border region is filled
   * with the background. Pass `null` to disable and show the picture full-frame.
   */
  setPresentationBorder(
    params: {
      pictureRect: readonly [number, number, number, number];
      coverRect: readonly [number, number, number, number];
      color: readonly [number, number, number];
      backgroundImageTexture?: Texture | null;
      backgroundImageRotation?: 0 | 90 | 180 | 270;
      opacity: number;
      blurred: boolean;
      imageBackground?: boolean;
      blur: readonly [number, number];
      pictureRadius: number;
      frameRadius: number;
      pictureShadowOpacity: number;
      pictureShadowBlur: number;
      pictureShadowOffset: readonly [number, number];
      pictureInnerShadowOpacity: number;
      pictureInnerShadowBlur: number;
      frameAspect: number;
      clearColor: readonly [number, number, number];
    } | null,
  ) {
    if (!params) {
      this.uniforms.uBorderEnabled.value = false;
      recordUniformUpdate();
      return;
    }
    this.uniforms.uBorderEnabled.value = true;
    this.uniforms.uPictureRect.value.set(...params.pictureRect);
    this.uniforms.uCoverRect.value.set(...params.coverRect);
    this.uniforms.uBorderColor.value.set(params.color[0], params.color[1], params.color[2]);
    this.uniforms.uBorderImage.value = params.backgroundImageTexture ?? null;
    this.uniforms.uBorderImageRotation.value = params.backgroundImageRotation ?? 0;
    this.uniforms.uBorderOpacity.value = params.opacity;
    this.uniforms.uBorderBgMode.value = params.imageBackground ? 2 : params.blurred ? 1 : 0;
    this.uniforms.uBorderBlur.value.set(params.blur[0], params.blur[1]);
    this.uniforms.uPictureRadius.value = params.pictureRadius;
    this.uniforms.uFrameRadius.value = params.frameRadius;
    this.uniforms.uPictureShadowOpacity.value = params.pictureShadowOpacity;
    this.uniforms.uPictureShadowBlur.value = params.pictureShadowBlur;
    this.uniforms.uPictureShadowOffset.value.set(
      params.pictureShadowOffset[0],
      params.pictureShadowOffset[1],
    );
    this.uniforms.uPictureInnerShadowOpacity.value = params.pictureInnerShadowOpacity;
    this.uniforms.uPictureInnerShadowBlur.value = params.pictureInnerShadowBlur;
    this.uniforms.uFrameAspect.value = params.frameAspect;
    this.uniforms.uBorderClearColor.value.set(
      params.clearColor[0],
      params.clearColor[1],
      params.clearColor[2],
    );
    recordUniformUpdate(19);
  }

  setLUTHandle(handle: LUTTextureHandle | null) {
    void handle;
  }

  setLUTTexture(texture: Texture | null) {
    void texture;
  }

  setLUTStorageMode(kind: LUTTextureKind) {
    void kind;
  }

  setUseLUT(enabled: boolean) {
    void enabled;
  }

  setLUTInterpolationMode(mode: LUTInterpolationMode) {
    void mode;
  }

  setCanvasSize(width: number, height: number) {
    this.uniforms.uCanvasSize.value.set(Math.max(1, width), Math.max(1, height));
    recordUniformUpdate();
  }

  updateFXState(fxState: ImageFXState): void {
    void fxState;
  }

  updateTransformState(state: TransformState, cropEnabledOverride = false): void {
    const active = state.enabled;
    const sourceWidth = this.uniforms.uSourceSize.value.x as number;
    const sourceHeight = this.uniforms.uSourceSize.value.y as number;
    const display = getTransformDisplayDimensions(sourceWidth, sourceHeight, state);
    this.uniforms.uDisplaySize.value.set(display.width, display.height);
    this.uniforms.uCropEnabled.value = active && state.cropEnabled && !cropEnabledOverride;
    this.uniforms.uCropRect.value.set(state.cropX, state.cropY, state.cropWidth, state.cropHeight);
    this.uniforms.uOrientationAngle.value = active ? state.orientation : 0;
    this.uniforms.uStraighten.value = active ? state.straighten : 0;
    this.uniforms.uFlipX.value = active && state.flipX;
    this.uniforms.uFlipY.value = active && state.flipY;
    recordUniformUpdate(7);
  }

  setDebugMode(mode: IntegrationDebugMode) {
    this.uniforms.uDebugMode.value = debugModeValues[mode];
    recordUniformUpdate();
  }

  setSplit(splitX: number) {
    this.material.uniforms.uSplitX.value = Math.max(0, Math.min(1, splitX));
    recordUniformUpdate();
  }

  dispose() {
    this.clearImageTexture();
    this.setProcessedTexture(null);
    this.geometry.dispose();
    this.material.dispose();
  }
}
