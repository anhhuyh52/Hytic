import { ShaderMaterial, Texture, Vector2, Vector4, WebGLRenderer, WebGLRenderTarget } from "three";
import type { SpotlightState } from "../../state/EditState";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import fragmentShader from "../../shaders/fx/spotlightRelight.frag?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

/**
 * Single-pass Spotlight relight FX (faithful legacy `Lu` matte + `Au` composite,
 * fused into one pass since the matte is per-pixel). Identity at amount 0.
 */
export class SpotlightPass {
  private readonly material = new ShaderMaterial({
    uniforms: {
      uInput: { value: null },
      uAmount: { value: 0 },
      uContrast: { value: 0.5 },
      uBias: { value: 0.5 },
      uFocus: { value: 0.5 },
      uCenter: { value: new Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uExportViewport: { value: new Vector4(0, 0, 1, 1) },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly resources = createFullscreenResources(this.material);

  render(
    renderer: WebGLRenderer,
    input: Texture,
    target: WebGLRenderTarget,
    width: number,
    height: number,
    state: SpotlightState,
    viewport?: {
      x: number;
      y: number;
      width: number;
      height: number;
      fullWidth: number;
      fullHeight: number;
    },
  ) {
    const u = this.material.uniforms;
    u.uInput.value = input;
    u.uAmount.value = 0.667 * state.amount; // legacy Eu setter: amount = 0.667 * spotlightAmount
    u.uContrast.value = state.contrast;
    u.uBias.value = state.bias;
    u.uFocus.value = state.focus;
    u.uCenter.value.set(state.centerX, state.centerY);
    u.uAspect.value = Math.max(
      1e-3,
      (viewport?.fullWidth ?? width) / Math.max(1, viewport?.fullHeight ?? height),
    );
    u.uExportViewport.value.set(
      viewport ? viewport.x / viewport.fullWidth : 0,
      viewport ? viewport.y / viewport.fullHeight : 0,
      viewport ? viewport.width / viewport.fullWidth : 1,
      viewport ? viewport.height / viewport.fullHeight : 1,
    );
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}
