import { Mesh, PlaneGeometry, ShaderMaterial, Vector2, type IUniform, type Texture } from "three";
import type { OverlayBlendMode, OverlayGradientType, OverlayLayer } from "../../features/overlays/overlayTypes";
import vertexShader from "../shaders/overlays/overlayLayer.vert?raw";
import fragmentShader from "../shaders/overlays/overlayLayer.frag?raw";

const blendModes: Partial<Record<OverlayBlendMode, number>> = { NORMAL: 0, SCREEN: 1, MULTIPLY: 2, OVERLAY: 3, SOFT_LIGHT: 4, LIGHTEN: 5, DARKEN: 6, ADD: 7 };
const gradientTypes: Record<OverlayGradientType, number> = { none: 0, linear: 1, radial: 2, luminance: 3 };

export class OverlayLayerPass {
  readonly uniforms: Record<string, IUniform>;
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    this.uniforms = {
      uBaseTexture: { value: null }, uLayerTexture: { value: null }, uMaskTexture: { value: null }, uGradientTexture: { value: null },
      uPosition: { value: new Vector2() }, uScale: { value: new Vector2(1, 1) }, uAngle: { value: 0 },
      uFill: { value: 1 }, uOpacity: { value: 1 }, uBlendMode: { value: 0 }, uGradientType: { value: 0 },
      uHasMask: { value: false }, uReverse: { value: false }, uReflect: { value: false }, uRepeat: { value: false },
    };
    const material = new ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.frustumCulled = false;
  }

  configure(layer: OverlayLayer, base: Texture, texture: Texture, gradient: Texture | undefined, mask: Texture | undefined): void {
    this.uniforms.uBaseTexture!.value = base;
    this.uniforms.uLayerTexture!.value = texture;
    this.uniforms.uGradientTexture!.value = gradient ?? texture;
    this.uniforms.uMaskTexture!.value = mask ?? texture;
    (this.uniforms.uPosition!.value as Vector2).set(...layer.position);
    (this.uniforms.uScale!.value as Vector2).set(...layer.scale);
    this.uniforms.uAngle!.value = layer.angle;
    this.uniforms.uFill!.value = layer.fill;
    this.uniforms.uOpacity!.value = layer.opacity;
    this.uniforms.uBlendMode!.value = blendModes[layer.blendMode] ?? 0;
    this.uniforms.uGradientType!.value = gradientTypes[layer.gradientType];
    this.uniforms.uHasMask!.value = !!mask;
    this.uniforms.uReverse!.value = layer.reverse;
    this.uniforms.uReflect!.value = layer.reflect;
    this.uniforms.uRepeat!.value = layer.repeat;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
