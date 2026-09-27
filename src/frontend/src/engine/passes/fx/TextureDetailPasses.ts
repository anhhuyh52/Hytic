import { ShaderMaterial, Texture, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import acutanceShader from "../../shaders/fx/acutance.frag?raw";
import sharpenShader from "../../shaders/fx/acutanceSharpen.frag?raw";
import softenShader from "../../shaders/fx/soften.frag?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

export type TextureDetailViewport = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
};

/**
 * Shared single-pass detail filter for the Texture FX (acutance / sharpen / soften). Each is a
 * render-only full-screen pass with the same uniform shape (`uInput`, `uAmount`, `uTexelSize`);
 * only the fragment shader differs. amount = 0 is an identity for all three.
 */
class TextureDetailPass {
  private readonly material: ShaderMaterial;
  private readonly resources: ReturnType<typeof createFullscreenResources>;

  constructor(fragmentShader: string) {
    this.material = new ShaderMaterial({
      uniforms: {
        uInput: { value: null },
        uAmount: { value: 0 },
        uTexelSize: { value: new Vector2(1, 1) },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.resources = createFullscreenResources(this.material);
  }

  render(
    renderer: WebGLRenderer,
    input: Texture,
    target: WebGLRenderTarget,
    width: number,
    height: number,
    amount: number,
    viewport?: TextureDetailViewport,
  ) {
    this.material.uniforms.uInput.value = input;
    this.material.uniforms.uAmount.value = amount;
    const texel = resolveTextureDetailTexel(width, height, viewport);
    (this.material.uniforms.uTexelSize.value as Vector2).set(texel.x, texel.y);
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose() {
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    this.material.dispose();
  }
}

/** Film Acutance (legacy `Ou`): 16-sample log-space edge-preserving clarity / local contrast. */
export class AcutancePass extends TextureDetailPass {
  constructor() {
    super(acutanceShader);
  }
}

/** Film Resolution sharpen (legacy `Ku`, resolution > 0.5): FidelityFX-CAS 5-tap sharpening. */
export class SharpenPass extends TextureDetailPass {
  constructor() {
    super(sharpenShader);
  }
}

/** Film Resolution soften (legacy `Qu`, resolution < 0.5): 9-tap tent blur. */
export class SoftenPass extends TextureDetailPass {
  constructor() {
    super(softenShader);
  }
}

function resolveTextureDetailTexel(
  width: number,
  height: number,
  viewport?: TextureDetailViewport,
): { x: number; y: number } {
  if (!viewport) {
    return {
      x: 1 / Math.max(1, width),
      y: 1 / Math.max(1, height),
    };
  }

  const imageWidth = Math.max(1, viewport.imageWidth);
  const imageHeight = Math.max(1, viewport.imageHeight);
  const renderScale = Math.max(
    1e-4,
    Math.min(Math.max(1, width) / imageWidth, Math.max(1, height) / imageHeight),
  );
  const targetZoom = Math.max(1e-4, viewport.zoom / renderScale);

  return {
    x: targetZoom / Math.max(1, viewport.viewportWidth),
    y: targetZoom / Math.max(1, viewport.viewportHeight),
  };
}
