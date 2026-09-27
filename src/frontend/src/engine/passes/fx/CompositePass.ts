import { ShaderMaterial, Texture, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import type { DiffusionState, HalationState } from "../../state/EditState";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import fragmentShader from "../../shaders/fx/fxComposite.frag?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

/**
 * Final composite for the Halation / Diffusion FX. Reproduces the legacy "lastPass"
 * shaders: blends the blurred glow (`effect`) over the graded base. The legacy
 * state→uniform mappings (`Wu/Xu/ju/$u` for halation, `Hu/ku/zu/Fu` for diffusion) are
 * applied here so the shader receives the same values the legacy engine used.
 */
export class CompositePass {
  private readonly material = new ShaderMaterial({
    uniforms: {
      uBase: { value: null },
      uEffect: { value: null },
      uMode: { value: 0 },
      uAmount: { value: 0 },
      // Halation
      uSpill: { value: 0 },
      uHue: { value: 0 },
      uSat: { value: 0 },
      // Diffusion
      uFog: { value: 0 },
      uThreshold: { value: 0 },
      uFadeLevel: { value: 0 },
      uCenterAlpha: { value: 1 },
      uCenter: { value: new Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly resources = createFullscreenResources(this.material);

  renderHalation(
    renderer: WebGLRenderer,
    base: Texture,
    effect: Texture,
    target: WebGLRenderTarget,
    state: HalationState,
  ) {
    const u = this.material.uniforms;
    u.uBase.value = base;
    u.uEffect.value = effect;
    u.uMode.value = 0;
    // Wu: amount = 3·mix (intentional overdrive). Xu: spl = 1 − (1−spill)³.
    u.uAmount.value = 3 * state.amount;
    u.uSpill.value = 1 - Math.pow(1 - state.spill, 3);
    // ju: hue = 0.2·hueState (remap of [−0.4,0.6]→[0,0.2] after −0.4 shift). $u: sat = 2·satState.
    u.uHue.value = 0.2 * state.hue;
    u.uSat.value = 2 * state.saturation;
    renderPassToTarget(renderer, this.resources, target);
  }

  renderDiffusion(
    renderer: WebGLRenderer,
    base: Texture,
    effect: Texture,
    target: WebGLRenderTarget,
    state: DiffusionState,
    width: number,
    height: number,
  ) {
    const u = this.material.uniforms;
    u.uBase.value = base;
    u.uEffect.value = effect;
    u.uMode.value = 1;
    // Hu: amount = diffAmount, fog = diffAmount². ku: threshold = 0.8·thr.
    u.uAmount.value = state.amount;
    u.uFog.value = state.amount * state.amount;
    u.uThreshold.value = 0.8 * state.threshold;
    // zu: fadeLevel = 0.042·fog + 0.025. Fu: centerAlpha = 1 − focusProtect²·0.8.
    u.uFadeLevel.value = 0.042 * state.fog + 0.025;
    u.uCenterAlpha.value = 1 - state.focusProtect * state.focusProtect * 0.8;
    (u.uCenter.value as Vector2).set(state.centerX, state.centerY);
    u.uAspect.value = width / Math.max(1, height);
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}
