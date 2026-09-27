import {
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

/** Reads one normalized value from the existing GPU depth texture. */
export class DepthSamplePass {
  private readonly target = new WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly material = new ShaderMaterial({
    uniforms: { uDepth: { value: null }, uUv: { value: new Vector2(0.5, 0.5) } },
    vertexShader: "void main(){gl_Position=vec4(position.xy,0.0,1.0);}",
    fragmentShader: "precision highp float; uniform sampler2D uDepth; uniform vec2 uUv; void main(){float d=texture2D(uDepth,uUv).r; gl_FragColor=vec4(d,d,d,1.0);}",
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly mesh = new Mesh(this.geometry, this.material);
  private readonly pixel = new Uint8Array(4);

  constructor() {
    this.target.texture.colorSpace = NoColorSpace;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  read(renderer: WebGLRenderer, texture: Texture, u: number, v: number): number {
    const previous = renderer.getRenderTarget();
    this.material.uniforms.uDepth.value = texture;
    (this.material.uniforms.uUv.value as Vector2).set(u, v);
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.pixel);
    renderer.setRenderTarget(previous);
    return this.pixel[0]! / 255;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
