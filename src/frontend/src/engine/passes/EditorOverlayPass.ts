import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  CanvasTexture,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type TextureDataType,
  type WebGLRenderer,
} from "three";
import type { EditorOverlayLayer, EditorOverlayMask } from "../../features/overlays/editorOverlayTypes";
import { RadialMaskPass } from "./masking/RadialMaskPass";
import { GradientMaskPass } from "./masking/GradientMaskPass";
import { ColorMaskPass } from "./masking/ColorMaskPass";
import { BrushMaskTexturePass } from "./masking/BrushMaskTexturePass";
import { BrushMaskPass } from "./masking/BrushMaskPass";
import { LuminanceMaskPass } from "./masking/LuminanceMaskPass";
import { DepthMaskPass } from "./masking/DepthMaskPass";

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBaseTexture;
uniform sampler2D uLayerTexture;
uniform sampler2D uMaskTexture;
uniform vec2 uPosition;
uniform vec2 uScale;
uniform vec2 uOutputOffset;
uniform vec2 uOutputScale;
uniform vec2 uImageSize;
uniform float uAngle;
uniform float uOpacity;
uniform float uFill;
uniform int uBlendMode;
uniform int uOverlayType;
uniform bool uGradientReverse;
uniform bool uGradientReflect;
uniform bool uGradientRepeat;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 colorDodge(vec3 base, vec3 layer) {
  return min(vec3(1.0), base / max(vec3(0.00001), 1.0 - layer));
}

vec3 colorBurn(vec3 base, vec3 layer) {
  return max(vec3(0.0), 1.0 - (1.0 - base) / max(vec3(0.00001), layer));
}

vec3 rgbToHsv(vec3 color) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
  vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsvToRgb(vec3 color) {
  vec3 p = abs(fract(color.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return color.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), color.y);
}

float blendLum(vec3 color) {
  return dot(color, vec3(0.3, 0.59, 0.11));
}

vec3 clipColor(vec3 color) {
  float luminance = blendLum(color);
  float minimum = min(min(color.r, color.g), color.b);
  float maximum = max(max(color.r, color.g), color.b);
  if (minimum < 0.0) color = vec3(luminance) + (color - luminance) * luminance / max(0.00001, luminance - minimum);
  if (maximum > 1.0) color = vec3(luminance) + (color - luminance) * (1.0 - luminance) / max(0.00001, maximum - luminance);
  return color;
}

vec3 setLum(vec3 color, float luminance) {
  return clipColor(color + (luminance - blendLum(color)));
}

vec3 blendColor(vec3 base, vec3 layer) {
  if (uBlendMode == 1) return 1.0 - (1.0 - base) * (1.0 - layer);
  if (uBlendMode == 2) return base * layer;
  if (uBlendMode == 3) return mix(2.0 * base * layer, 1.0 - 2.0 * (1.0 - base) * (1.0 - layer), step(0.5, base));
  if (uBlendMode == 4) return mix(2.0 * base * layer + base * base * (1.0 - 2.0 * layer), sqrt(max(base, vec3(0.0))) * (2.0 * layer - 1.0) + 2.0 * base * (1.0 - layer), step(0.5, layer));
  if (uBlendMode == 5) return mix(2.0 * base * layer, 1.0 - 2.0 * (1.0 - base) * (1.0 - layer), step(0.5, layer));
  if (uBlendMode == 6) return colorDodge(base, layer);
  if (uBlendMode == 7) return colorBurn(base, layer);
  if (uBlendMode == 8) return mix(colorBurn(base, layer * 2.0), colorDodge(base, (layer - 0.5) * 2.0), step(0.5, layer));
  if (uBlendMode == 9) return clamp(base + 2.0 * layer - 1.0, 0.0, 1.0);
  if (uBlendMode == 10) return max(base, layer);
  if (uBlendMode == 11) return min(base, layer);
  if (uBlendMode == 12) return min(vec3(1.0), base + layer);
  if (uBlendMode == 13) return max(vec3(0.0), base - layer);
  if (uBlendMode == 14) return abs(base - layer);
  if (uBlendMode == 15) return base + layer - 2.0 * base * layer;
  if (uBlendMode == 16) return min(vec3(1.0), base / max(layer, vec3(0.00001)));
  if (uBlendMode == 17) {
    vec3 baseHsv = rgbToHsv(base);
    vec3 layerHsv = rgbToHsv(layer);
    return hsvToRgb(vec3(layerHsv.x, baseHsv.yz));
  }
  if (uBlendMode == 18) {
    vec3 baseHsv = rgbToHsv(base);
    return hsvToRgb(vec3(baseHsv.x, rgbToHsv(layer).y, baseHsv.z));
  }
  if (uBlendMode == 19) return setLum(layer, blendLum(base));
  if (uBlendMode == 20) return setLum(base, blendLum(layer));
  return layer;
}

vec3 applyBlendMode(vec3 base, vec3 layer, float fill) {
  vec3 neutral = base;
  if (uBlendMode == 1 || uBlendMode == 6 || (uBlendMode >= 12 && uBlendMode <= 15)) neutral = vec3(0.0);
  if (uBlendMode == 2 || uBlendMode == 7 || uBlendMode == 16) neutral = vec3(1.0);
  if (uBlendMode == 3 || uBlendMode == 4 || uBlendMode == 5 || uBlendMode == 8 || uBlendMode == 9) neutral = vec3(0.5);
  return blendColor(base, mix(neutral, layer, fill));
}

void main() {
  vec4 base = texture2D(uBaseTexture, vUv);
  vec2 imageUv = uOutputOffset + vUv * uOutputScale;
  float maskAlpha = texture2D(uMaskTexture, imageUv).r;

  float radians = -uAngle * 0.017453292519943295;
  mat2 rotation = mat2(cos(radians), -sin(radians), sin(radians), cos(radians));
  vec2 pixelDelta = (imageUv - uPosition) * uImageSize;
  vec2 layerUv = rotation * pixelDelta / (uScale * uImageSize) + 0.5;

  vec4 layer;
  float bounds = 1.0;

  if (uOverlayType == 0) {
    bounds = step(0.0, layerUv.x) * step(layerUv.x, 1.0) * step(0.0, layerUv.y) * step(layerUv.y, 1.0);
    layer = texture2D(uLayerTexture, layerUv);
  } else {
    float x;
    if (uOverlayType == 1) {
      x = layerUv.x;
    } else if (uOverlayType == 2) {
      x = length(layerUv * 2.0 - 1.0);
    } else {
      x = luma(base.rgb);
    }

    if (uGradientRepeat) {
      x = fract(x);
    } else {
      x = clamp(x, 0.0, 1.0);
    }
    if (uGradientReflect) x = abs(1.0 - x * 2.0);
    if (uGradientReverse) x = 1.0 - x;

    if (uOverlayType == 1 || uOverlayType == 2) {
      x += (random(gl_FragCoord.xy) - 0.5) * 0.01;
    }

    layer = texture2D(uLayerTexture, vec2(clamp(x, 0.0, 1.0), 0.5));
  }

  float amount = clamp(layer.a * bounds * maskAlpha, 0.0, 1.0);
  vec3 blended = applyBlendMode(base.rgb, layer.rgb, uFill);
  float finalAlpha = uOpacity * amount;
  gl_FragColor = vec4(mix(base.rgb, blended, finalAlpha), base.a);
}`;

const blendModeIndex: Record<EditorOverlayLayer["blendMode"], number> = {
  NORMAL: 0,
  SCREEN: 1,
  MULTIPLY: 2,
  OVERLAY: 3,
  SOFT_LIGHT: 4,
  HARD_LIGHT: 5,
  COLOR_DODGE: 6,
  COLOR_BURN: 7,
  VIVID_LIGHT: 8,
  LINEAR_LIGHT: 9,
  LIGHTEN: 10,
  DARKEN: 11,
  ADD: 12,
  SUBTRACT: 13,
  DIFFERENCE: 14,
  EXCLUSION: 15,
  DIVIDE: 16,
  HUE: 17,
  SATURATION: 18,
  COLOR: 19,
  LUMINOSITY: 20,
};

type TextureRecord = { source: string; texture: Texture };

export class EditorOverlayPass {
  private readonly loader = new TextureLoader();
  private readonly textures = new Map<string, TextureRecord>();
  private readonly targets: Array<WebGLRenderTarget | null> = [null, null];
  private readonly material = new ShaderMaterial({
    uniforms: {
      uBaseTexture: { value: null },
      uLayerTexture: { value: null },
      uMaskTexture: { value: null },
      uPosition: { value: new Vector2(0.5, 0.5) },
      uScale: { value: new Vector2(1, 1) },
      uOutputOffset: { value: new Vector2(0, 0) },
      uOutputScale: { value: new Vector2(1, 1) },
      uImageSize: { value: new Vector2(1, 1) },
      uAngle: { value: 0 },
      uOpacity: { value: 1 },
      uFill: { value: 1 },
      uBlendMode: { value: 0 },
      uOverlayType: { value: 0 },
      uGradientReverse: { value: false },
      uGradientReflect: { value: false },
      uGradientRepeat: { value: false },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly mesh = new Mesh(this.geometry, this.material);
  private readonly radialMaskPass = new RadialMaskPass();
  private readonly gradientMaskPass = new GradientMaskPass();
  private readonly colorMaskPass = new ColorMaskPass();
  private readonly brushMaskTexturePass = new BrushMaskTexturePass();
  private readonly brushMaskPass = new BrushMaskPass();
  private readonly luminanceMaskPass = new LuminanceMaskPass();
  private readonly depthMaskPass = new DepthMaskPass();
  private readonly whiteMask = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  private readonly blackMask = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);

  constructor() {
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.whiteMask.colorSpace = NoColorSpace;
    this.whiteMask.needsUpdate = true;
    this.blackMask.colorSpace = NoColorSpace;
    this.blackMask.needsUpdate = true;
  }

  sync(layers: readonly EditorOverlayLayer[], onReady: () => void): boolean {
    const liveIds = new Set(layers.map((layer) => layer.id));
    for (const [id, record] of this.textures) {
      if (liveIds.has(id)) continue;
      record.texture.dispose();
      this.textures.delete(id);
    }
    for (const layer of layers) {
      if (layer.type === "gradient") {
        const hash = layer.gradientConfig.stops.map(s => `${s.position},${s.color.join(',')}`).join('|');
        const existing = this.textures.get(layer.id);
        if (existing?.source === hash) continue;
        if (existing) existing.texture.dispose();

        const canvas = new OffscreenCanvas(256, 1);
        const ctx = canvas.getContext("2d")!;
        const grad = ctx.createLinearGradient(0, 0, 256, 0);
        const sortedStops = [...layer.gradientConfig.stops].sort((left, right) => left.position - right.position);
        const textureStops = sortedStops.length === 1
          ? [{ ...sortedStops[0]!, position: 0 }, { ...sortedStops[0]!, position: 1 }]
          : sortedStops;
        for (const stop of textureStops) {
          grad.addColorStop(stop.position, `rgba(${stop.color[0]*255},${stop.color[1]*255},${stop.color[2]*255},${stop.color[3]})`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 1);

        const texture = new CanvasTexture(canvas as any);
        texture.colorSpace = NoColorSpace;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;

        this.textures.set(layer.id, { source: hash, texture });
        continue;
      }

      const existing = this.textures.get(layer.id);
      if (existing?.source === layer.sourceDataUrl) continue;
      if (existing) {
        existing.texture.dispose();
        this.textures.delete(layer.id);
      }
      if (!layer.sourceDataUrl) continue;
      this.loader.load(layer.sourceDataUrl, (texture) => {
        texture.colorSpace = NoColorSpace;
        // TextureLoader sources use the DOM/image top-left convention. Keep
        // Three's Y flip so layer pixels line up with image UV and UI handles.
        texture.flipY = true;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        const current = this.textures.get(layer.id);
        current?.texture.dispose();
        this.textures.set(layer.id, { source: layer.sourceDataUrl!, texture });
        onReady();
      });
    }
    return this.areLayersReady(layers);
  }

  areLayersReady(layers: readonly EditorOverlayLayer[]): boolean {
    return layers.every((layer) => {
      if (!layer.visible || layer.opacity <= 0 || (layer.type === "image" && !layer.sourceDataUrl)) return true;
      if (layer.type === "gradient") return true; // Generated synchronously
      return this.textures.get(layer.id)?.source === layer.sourceDataUrl;
    });
  }

  render(
    renderer: WebGLRenderer,
    baseTexture: Texture,
    layers: readonly EditorOverlayLayer[],
    width: number,
    height: number,
    type: TextureDataType,
    outputViewport?: { x: number; y: number; width: number; height: number; fullWidth: number; fullHeight: number },
    depthTexture?: Texture | null,
  ): WebGLRenderTarget | null {
    const ready = layers.filter((layer) => layer.visible && layer.opacity > 0 && this.textures.has(layer.id));
    if (!ready.length) return null;
    this.brushMaskTexturePass.retain(
      ready.filter((layer) => layer.mask?.type === "brush").map((layer) => layer.mask!.id),
    );
    const previousTarget = renderer.getRenderTarget();
    const previousViewport = new Vector4();
    const previousScissor = new Vector4();
    const previousScissorTest = renderer.getScissorTest();
    renderer.getViewport(previousViewport);
    renderer.getScissor(previousScissor);
    let input = baseTexture;
    let output: WebGLRenderTarget | null = null;
    const offset = outputViewport
      ? [outputViewport.x / outputViewport.fullWidth, outputViewport.y / outputViewport.fullHeight]
      : [0, 0];
    const outputScale = outputViewport
      ? [outputViewport.width / outputViewport.fullWidth, outputViewport.height / outputViewport.fullHeight]
      : [1, 1];
    try {
      for (let index = 0; index < ready.length; index += 1) {
        const layer = ready[index]!;
        output = this.ensureTarget(index % 2, width, height, type);
        const uniforms = this.material.uniforms;
        uniforms.uBaseTexture!.value = input;
        uniforms.uLayerTexture!.value = this.textures.get(layer.id)!.texture;
        uniforms.uMaskTexture!.value = this.resolveMaskTexture(
          renderer,
          baseTexture,
          layer.mask,
          width,
          height,
          depthTexture,
        );
        (uniforms.uPosition!.value as Vector2).set(...layer.position);
        (uniforms.uScale!.value as Vector2).set(...layer.scale);
        (uniforms.uOutputOffset!.value as Vector2).set(offset[0]!, offset[1]!);
        (uniforms.uOutputScale!.value as Vector2).set(outputScale[0]!, outputScale[1]!);
        (uniforms.uImageSize!.value as Vector2).set(
          outputViewport?.fullWidth ?? width,
          outputViewport?.fullHeight ?? height,
        );
        uniforms.uAngle!.value = layer.angle;
        uniforms.uOpacity!.value = layer.opacity;
        uniforms.uFill!.value = layer.fill;
        uniforms.uBlendMode!.value = blendModeIndex[layer.blendMode];

        if (layer.type === "gradient") {
          uniforms.uOverlayType!.value = layer.gradientConfig.kind === "linear" ? 1 : layer.gradientConfig.kind === "radial" ? 2 : 3;
          uniforms.uGradientReverse!.value = layer.gradientConfig.reverse;
          uniforms.uGradientReflect!.value = layer.gradientConfig.reflect;
          uniforms.uGradientRepeat!.value = layer.gradientConfig.repeat;
        } else {
          uniforms.uOverlayType!.value = 0;
        }

        // setRenderTarget applies the target's full pixel viewport directly.
        // Do not call WebGLRenderer.setViewport(width, height) here: that public
        // method multiplies values by the renderer DPR even for render targets,
        // producing a DPR-sized viewport and rendering only a cropped section.
        renderer.setRenderTarget(output);
        renderer.setScissorTest(false);
        renderer.clear(true, false, false);
        renderer.render(this.scene, this.camera);
        input = output.texture;
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
    }
    return output;
  }

  private resolveMaskTexture(
    renderer: WebGLRenderer,
    sourceTexture: Texture,
    mask: EditorOverlayMask | null,
    width: number,
    height: number,
    depthTexture?: Texture | null,
  ): Texture {
    if (!mask) return this.whiteMask;
    if (mask.type === "radial") {
      this.radialMaskPass.setCanvasSize(width, height);
      return this.radialMaskPass.render(renderer, {
        position: mask.position,
        size: mask.size,
        angle: mask.angle,
        feather: mask.feather,
        invert: mask.invert,
        opacity: mask.opacity,
        alpha: mask.alpha,
      }, width, height).texture;
    }
    if (mask.type === "gradient") {
      this.gradientMaskPass.setCanvasSize(width, height);
      return this.gradientMaskPass.render(renderer, mask).texture;
    }
    if (mask.type === "brush") {
      const brushTexture = this.brushMaskTexturePass.getOrBuildTexture({
        renderer,
        sourceTexture,
        sourceWidth: width,
        sourceHeight: height,
        maskId: mask.id,
        component: mask,
        liveStroke: null,
      });
      this.brushMaskPass.setCanvasSize(width, height);
      return this.brushMaskPass.render(renderer, brushTexture.texture, mask).texture;
    }
    if (mask.type === "luminance") {
      this.luminanceMaskPass.setCanvasSize(width, height);
      return this.luminanceMaskPass.render(renderer, sourceTexture, mask).texture;
    }
    if (mask.type === "depth") {
      if (!depthTexture) return this.blackMask;
      this.depthMaskPass.setCanvasSize(width, height);
      return this.depthMaskPass.render(renderer, depthTexture, mask).texture;
    }
    this.colorMaskPass.setCanvasSize(width, height);
    return this.colorMaskPass.render(renderer, sourceTexture, mask, sourceTexture).texture;
  }

  private ensureTarget(index: number, width: number, height: number, type: TextureDataType): WebGLRenderTarget {
    let target = this.targets[index];
    if (!target || target.width !== width || target.height !== height || target.texture.type !== type) {
      target?.dispose();
      target = new WebGLRenderTarget(width, height, {
        type,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.colorSpace = NoColorSpace;
      this.targets[index] = target;
    }
    return target;
  }

  dispose(): void {
    for (const record of this.textures.values()) record.texture.dispose();
    this.textures.clear();
    for (const target of this.targets) target?.dispose();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.whiteMask.dispose();
    this.blackMask.dispose();
    this.radialMaskPass.dispose();
    this.gradientMaskPass.dispose();
    this.colorMaskPass.dispose();
    this.brushMaskTexturePass.dispose();
    this.brushMaskPass.dispose();
    this.luminanceMaskPass.dispose();
    this.depthMaskPass.dispose();
  }
}
