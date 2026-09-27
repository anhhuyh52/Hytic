import {
  DataTexture,
  Mesh,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
} from "three";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import {
  buildInputTransformPrelude,
  buildDisplayTransformPrelude,
} from "../../color/colorTransformPrelude";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

const PLACEHOLDER_CUBE_ATLAS = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
PLACEHOLDER_CUBE_ATLAS.needsUpdate = true;

type ColorTransformKind = "idt" | "odt";

export class ColorTransformPass {
  private readonly uniforms: Record<string, IUniform> = {
    uInput: { value: null },
    uLutIdtAtlas: { value: PLACEHOLDER_CUBE_ATLAS },
    uLutOdtAtlas: { value: PLACEHOLDER_CUBE_ATLAS },
  };
  private readonly materialCache = new Map<string, ShaderMaterial>();
  private material: ShaderMaterial;
  private readonly resources;
  private activeId = "sRGB";
  private readonly prewarmQueue: string[] = [];
  private readonly queuedIds = new Set<string>();
  private prewarmScheduled = false;
  private disposed = false;

  constructor(private readonly kind: ColorTransformKind) {
    this.material = this.createMaterial(this.activeId);
    this.materialCache.set(this.activeId, this.material);
    this.resources = createFullscreenResources(this.material);
  }

  setTransform(renderer: WebGLRenderer, id: string): void {
    if (id === this.activeId) return;
    this.activeId = id;
    this.queuedIds.delete(id);

    let material = this.materialCache.get(id);
    if (!material) {
      material = this.createMaterial(id);
      this.materialCache.set(id, material);
      void this.compileMaterial(renderer, material);
    }

    this.material = material;
    this.resources.mesh.material = material;
  }

  prewarm(renderer: WebGLRenderer, ids: readonly string[]): void {
    for (const id of ids) {
      if (this.materialCache.has(id) || this.queuedIds.has(id)) continue;
      this.queuedIds.add(id);
      this.prewarmQueue.push(id);
    }
    this.schedulePrewarm(renderer);
  }

  setCubeAtlases(idtAtlas: Texture | null, odtAtlas: Texture | null): void {
    this.uniforms.uLutIdtAtlas.value = idtAtlas ?? PLACEHOLDER_CUBE_ATLAS;
    this.uniforms.uLutOdtAtlas.value = odtAtlas ?? PLACEHOLDER_CUBE_ATLAS;
  }

  render(renderer: WebGLRenderer, input: Texture, target: WebGLRenderTarget): void {
    this.uniforms.uInput.value = input;
    renderPassToTarget(renderer, this.resources, target);
  }

  dispose(): void {
    this.disposed = true;
    this.prewarmQueue.length = 0;
    this.queuedIds.clear();
    this.resources.scene.remove(this.resources.mesh);
    this.resources.geometry.dispose();
    for (const material of this.materialCache.values()) {
      material.dispose();
    }
    this.materialCache.clear();
  }

  private schedulePrewarm(renderer: WebGLRenderer): void {
    if (this.prewarmScheduled || this.disposed || this.prewarmQueue.length === 0) return;
    this.prewarmScheduled = true;
    const run = () => {
      this.prewarmScheduled = false;
      void this.compileNextPrewarm(renderer);
    };
    const requestIdle = globalThis.requestIdleCallback;
    if (typeof requestIdle === "function") requestIdle(run, { timeout: 1500 });
    else setTimeout(run, 32);
  }

  private async compileNextPrewarm(renderer: WebGLRenderer): Promise<void> {
    if (this.disposed) return;
    let id = this.prewarmQueue.shift();
    while (id && (this.materialCache.has(id) || !this.queuedIds.has(id))) {
      this.queuedIds.delete(id);
      id = this.prewarmQueue.shift();
    }
    if (!id) return;
    this.queuedIds.delete(id);
    const material = this.createMaterial(id);
    this.materialCache.set(id, material);
    await this.compileMaterial(renderer, material);
    // Never launch dozens of shader compiles in the image-load task. One idle
    // compile at a time keeps first boot and large-image upload responsive.
    this.schedulePrewarm(renderer);
  }

  private async compileMaterial(renderer: WebGLRenderer, material: ShaderMaterial): Promise<void> {
    const scene = new Scene();
    const mesh = new Mesh(this.resources.geometry, material);
    scene.add(mesh);
    try {
      await renderer.compileAsync(scene, this.resources.camera);
    } catch {
      // Best-effort warm-up; a later render can still compile the tiny shader inline.
    } finally {
      scene.remove(mesh);
    }
  }

  private createMaterial(id: string): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: buildColorTransformShader(this.kind, id),
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
  }
}

function buildColorTransformShader(kind: ColorTransformKind, id: string): string {
  const prelude =
    kind === "idt" ? buildInputTransformPrelude(id) : buildDisplayTransformPrelude(id);
  // Legacy `Mu` stores AP1 scene-linear (`cct2lin(CIO_IDT(...))`) in HDR buffers before
  // the FX chain. `Pd` converts that scene-linear result back to ACEScct for the selected
  // ODT and clamps only the final display value.
  const expr =
    kind === "idt"
      ? "max(cct2lin(activeIDT(src.rgb)), 0.0)"
      : "clamp(activeODT(clamp(lin2cct(max(src.rgb, 0.0)), 0.0, 1.0)), 0.0, 1.0)";

  return `
precision highp float;

uniform sampler2D uInput;

varying vec2 vUv;

${prelude}

void main() {
  vec4 src = texture2D(uInput, vUv);
  gl_FragColor = vec4(${expr}, src.a);
}
`;
}
