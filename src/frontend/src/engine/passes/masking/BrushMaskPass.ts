/**
 * BrushMaskPass
 *
 * Reads the cached brush texture (output of BrushMaskTexturePass) and applies
 * invert / opacity / alpha, producing a greyscale mask texture for LocalAdjustmentPass.
 *
 * This is a cheap single-quad blit — the heavy work happens in BrushMaskTexturePass.
 */

import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  LinearFilter,
  NoColorSpace,
  UnsignedByteType,
  Scene,
  OrthographicCamera,
  Texture,
  Color,
} from "three";
import type { WebGLRenderer } from "three";
import type { BrushMaskComponent } from "../../state/EditState";

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uBrushTexture;
uniform float uInvert;
uniform float uOpacity;
uniform float uAlpha;

void main() {
  float mask = texture2D(uBrushTexture, vUv).r;

  if (uInvert > 0.5) {
    mask = 1.0 - mask;
  }

  mask *= clamp(uOpacity, 0.0, 1.0);
  mask *= clamp(uAlpha,   0.0, 1.0);

  gl_FragColor = vec4(mask, mask, mask, mask);
}
`;

export class BrushMaskPass {
  public readonly renderTarget: WebGLRenderTarget;

  private readonly scene    = new Scene();
  private readonly camera   = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: ShaderMaterial;
  private readonly mesh:     Mesh;

  constructor() {
    this.camera.position.z = 1;

    this.material = new ShaderMaterial({
      uniforms: {
        uBrushTexture: { value: null },
        uInvert:       { value: 0.0 },
        uOpacity:      { value: 1.0 },
        uAlpha:        { value: 1.0 },
      },
      vertexShader:  VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest:   false,
      depthWrite:  false,
      transparent: false,
      toneMapped:  false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

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

  render(
    renderer: WebGLRenderer,
    brushTexture: Texture,
    component: BrushMaskComponent,
  ): WebGLRenderTarget {
    const u = this.material.uniforms;
    u.uBrushTexture.value = brushTexture;
    u.uInvert.value       = component.invert ? 1.0 : 0.0;
    u.uOpacity.value      = Math.max(0, Math.min(1, component.opacity ?? 1));
    u.uAlpha.value        = Math.max(0, Math.min(1, component.alpha ?? 1));

    const old = renderer.getRenderTarget();
    const oldClearColor = renderer.getClearColor(new Color());
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clearColor();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(old);
    renderer.setClearColor(oldClearColor, oldClearAlpha);

    return this.renderTarget;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}
