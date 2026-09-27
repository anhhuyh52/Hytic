import {
  GLSL3,
  RawShaderMaterial,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { GrainState } from "../../state/EditState";
import vertexShader from "../../shaders/fx/grainComposite.glsl3.vert?raw";
import fragmentShader from "../../shaders/fx/grainComposite.glsl3.frag?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

export type GrainViewport = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
};

export class GrainPass {
  private readonly material = createGrainMaterial(vertexShader, fragmentShader);
  private readonly resources = createFullscreenResources(this.material);

  render(
    renderer: WebGLRenderer,
    input: Texture,
    target: WebGLRenderTarget,
    width: number,
    height: number,
    state: GrainState,
    viewport?: GrainViewport,
    outputViewport?: {
      x: number;
      y: number;
      width: number;
      height: number;
      fullWidth: number;
      fullHeight: number;
    },
  ) {
    applyGrainUniforms(this.material, input, width, height, state, viewport, outputViewport);
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}

function createGrainMaterial(vertexShaderSource: string, fragmentShaderSource: string) {
  return new RawShaderMaterial({
    uniforms: {
      uInput: { value: null },
      uUseGrain: { value: false },
      uGrainAmount: { value: 0 },
      uGrainSize: { value: 1 },
      uGrainColorAmount: { value: 0.25 },
      uGrainSeed: { value: 1 },
      uImage: { value: new Vector4(1, 1, 1, 1) },
      uViewport: { value: new Vector2(1, 1) },
      uOffset: { value: new Vector2(0, 0) },
      uScale: { value: new Vector2(1, 1) },
      uExportViewport: { value: new Vector4(0, 0, 1, 1) },
    },
    vertexShader: vertexShaderSource,
    fragmentShader: fragmentShaderSource,
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function applyGrainUniforms(
  material: ShaderMaterial,
  input: Texture,
  width: number,
  height: number,
  state: GrainState,
  viewport?: GrainViewport,
  outputViewport?: {
    x: number;
    y: number;
    width: number;
    height: number;
    fullWidth: number;
    fullHeight: number;
  },
) {
  // Legacy `af`/`sf`: grain cell size + amount scaling are derived from Film Resolution.
  const res = state.resolution;
  const size = res > 0.5 ? 1.2 - 0.4 * (res - 0.5) : 1.75 - 1.1 * res;
  const amount =
    res > 0.5 && state.amount > 1 ? Math.max(1, state.amount * (1 - (res - 0.5))) : state.amount;
  material.uniforms.uInput.value = input;
  material.uniforms.uUseGrain.value = state.enabled && !state.bypass && state.amount > 0;
  material.uniforms.uGrainAmount.value = amount;
  material.uniforms.uGrainSize.value = size;
  // Legacy `rf(t)` stores the raw 0..1 slider in state, then sends t^3 to
  // the shader's chroma uniform.
  material.uniforms.uGrainColorAmount.value =
    state.colorAmount * state.colorAmount * state.colorAmount;
  material.uniforms.uGrainSeed.value = state.seed;
  const grainViewport = resolveGrainViewport(width, height, viewport);
  material.uniforms.uExportViewport.value.set(
    outputViewport ? outputViewport.x / outputViewport.fullWidth : 0,
    outputViewport ? outputViewport.y / outputViewport.fullHeight : 0,
    outputViewport ? outputViewport.width / outputViewport.fullWidth : 1,
    outputViewport ? outputViewport.height / outputViewport.fullHeight : 1,
  );
  material.uniforms.uImage.value.set(
    grainViewport.imageWidth,
    grainViewport.imageHeight,
    1 / grainViewport.imageWidth,
    1 / grainViewport.imageHeight,
  );
  material.uniforms.uViewport.value.set(grainViewport.viewportWidth, grainViewport.viewportHeight);
  material.uniforms.uOffset.value.set(grainViewport.offsetX, grainViewport.offsetY);
  material.uniforms.uScale.value.set(grainViewport.zoom, Math.min(1, grainViewport.zoom));
}

function resolveGrainViewport(width: number, height: number, viewport?: GrainViewport) {
  if (!viewport) {
    return {
      viewportWidth: Math.max(1, width),
      viewportHeight: Math.max(1, height),
      imageWidth: Math.max(1, width),
      imageHeight: Math.max(1, height),
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    };
  }

  const imageWidth = Math.max(1, viewport.imageWidth);
  const imageHeight = Math.max(1, viewport.imageHeight);
  const renderScale = Math.max(
    1e-4,
    Math.min(Math.max(1, width) / imageWidth, Math.max(1, height) / imageHeight),
  );
  const targetZoom = Math.max(1e-4, viewport.zoom / renderScale);
  const viewportWidth = Math.max(1, viewport.viewportWidth);
  const viewportHeight = Math.max(1, viewport.viewportHeight);

  return {
    viewportWidth,
    viewportHeight,
    imageWidth,
    imageHeight,
    offsetX:
      Math.max(1, width) * 0.5 - viewportWidth / (2 * targetZoom) - viewport.panX / targetZoom,
    offsetY:
      Math.max(1, height) * 0.5 - viewportHeight / (2 * targetZoom) + viewport.panY / targetZoom,
    zoom: targetZoom,
  };
}
