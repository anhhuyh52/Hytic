import { ShaderMaterial, Texture, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import type { DiffusionState, HalationState } from "../../state/EditState";
import vertexShader from "../../shaders/fx/fullscreen.vert?raw";
import { createFullscreenResources, renderPassToTarget } from "./passUtils";

const downsampleFragmentShader = `
precision highp float;

uniform sampler2D uInput;
uniform vec2 uTexelSize;

varying vec2 vUv;

void main() {
  vec2 t = uTexelSize;
  vec4 c = texture2D(uInput, vUv);
  vec4 s = (
    (
      texture2D(uInput, vUv + t * vec2(-1.0,  1.0)) * texture2D(uInput, vUv + t * vec2(-1.0,  1.0)).a +
      texture2D(uInput, vUv + t * vec2( 1.0,  1.0)) * texture2D(uInput, vUv + t * vec2( 1.0,  1.0)).a +
      texture2D(uInput, vUv + t * vec2(-1.0, -1.0)) * texture2D(uInput, vUv + t * vec2(-1.0, -1.0)).a +
      texture2D(uInput, vUv + t * vec2( 1.0, -1.0)) * texture2D(uInput, vUv + t * vec2( 1.0, -1.0)).a
    ) * 0.125
  ) + (
    (
      texture2D(uInput, vUv + t * vec2(-2.0,  2.0)) * texture2D(uInput, vUv + t * vec2(-2.0,  2.0)).a +
      texture2D(uInput, vUv + t * vec2( 0.0,  2.0)) * texture2D(uInput, vUv + t * vec2( 0.0,  2.0)).a +
      texture2D(uInput, vUv + t * vec2( 2.0,  2.0)) * texture2D(uInput, vUv + t * vec2( 2.0,  2.0)).a +
      texture2D(uInput, vUv + t * vec2(-2.0,  0.0)) * texture2D(uInput, vUv + t * vec2(-2.0,  0.0)).a +
      texture2D(uInput, vUv + t * vec2( 2.0,  0.0)) * texture2D(uInput, vUv + t * vec2( 2.0,  0.0)).a +
      texture2D(uInput, vUv + t * vec2(-2.0, -2.0)) * texture2D(uInput, vUv + t * vec2(-2.0, -2.0)).a +
      texture2D(uInput, vUv + t * vec2( 0.0, -2.0)) * texture2D(uInput, vUv + t * vec2( 0.0, -2.0)).a +
      texture2D(uInput, vUv + t * vec2( 2.0, -2.0)) * texture2D(uInput, vUv + t * vec2( 2.0, -2.0)).a +
      c * c.a
    ) * 0.0555555
  );
  gl_FragColor = s.a > 0.01 ? s / s.a : vec4(0.0);
}
`;

const pyramidVertexShader = `
varying vec2 vUv;
varying vec2 vUv0;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec2 vUv3;
varying vec2 vUv4;
varying vec2 vUv5;
varying vec2 vUv6;
varying vec2 vUv7;
varying vec2 vgn;

uniform vec2 uTexelSize;
uniform bool uLastPass;
uniform vec2 uCenter;
uniform float uAspect;

void main() {
  vec2 texel = uTexelSize;
  vUv = uv;
  vUv0 = vUv + texel * vec2(-1.0,  1.0);
  vUv1 = vUv + texel * vec2( 0.0,  1.0);
  vUv2 = vUv + texel * vec2( 1.0,  1.0);
  vUv3 = vUv + texel * vec2(-1.0,  0.0);
  vUv4 = vUv + texel * vec2( 1.0,  0.0);
  vUv5 = vUv + texel * vec2(-1.0, -1.0);
  vUv6 = vUv + texel * vec2( 0.0, -1.0);
  vUv7 = vUv + texel * vec2( 1.0, -1.0);
  if (uLastPass) {
    vec2 size = uAspect < 1.0 ? vec2(1.2, 1.2 / uAspect) : vec2(1.2 * uAspect, 1.2);
    vgn = (vUv - uCenter) * size;
  }
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const diffusionFragmentShader = `
precision highp float;

uniform sampler2D uInput;
uniform sampler2D uLarge;
uniform float uAmount;
uniform float uFog;
uniform bool uLastPass;
uniform float uThreshold;
uniform float uFadeLevel;
uniform float uCenterAlpha;

varying vec2 vUv;
varying vec2 vUv0;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec2 vUv3;
varying vec2 vUv4;
varying vec2 vUv5;
varying vec2 vUv6;
varying vec2 vUv7;
varying vec2 vgn;

float linRgb2luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 tent9(sampler2D tex) {
  vec3 o = texture2D(tex, vUv0).rgb * 0.0625;
  o += texture2D(tex, vUv1).rgb * 0.125;
  o += texture2D(tex, vUv2).rgb * 0.0625;
  o += texture2D(tex, vUv3).rgb * 0.125;
  o += texture2D(tex,  vUv).rgb * 0.25;
  o += texture2D(tex, vUv4).rgb * 0.125;
  o += texture2D(tex, vUv5).rgb * 0.0625;
  o += texture2D(tex, vUv6).rgb * 0.125;
  o += texture2D(tex, vUv7).rgb * 0.0625;
  return o;
}

void main() {
  vec4 t = texture2D(uLarge, vUv);
  if (uAmount > 0.0) {
    vec3 o = tent9(uInput);
    if (uLastPass) {
      float vig = mix(uCenterAlpha, 1.0, smoothstep(0.0, 1.0, dot(vgn, vgn)));
      float ol = min(1.0, linRgb2luma(o));
      float tl = min(1.0, linRgb2luma(t.xyz));
      float nol = 1.0 - ol;
      float tr = mix(1.0, 1.0 - nol * nol * nol, uThreshold);
      float vt = vig * tr;
      o = mix(t.rgb, o, uAmount * vt);
      o = mix(o, o + uFadeLevel, uFog * vt * nol);
      o *= mix(1.0, mix(0.67, 1.0, uThreshold), uAmount * smoothstep(1.0, 0.0, tl));
      gl_FragColor = vec4(o, t.a);
    } else {
      gl_FragColor = vec4(mix(t.rgb, o, uAmount), t.a);
    }
  } else {
    gl_FragColor = t;
  }
}
`;

const halationFragmentShader = `
precision highp float;

uniform sampler2D uInput;
uniform sampler2D uLarge;
uniform bool uLastPass;
uniform float uAmount;
uniform float uHue;
uniform float uSat;
uniform float uSpill;

varying vec2 vUv;
varying vec2 vUv0;
varying vec2 vUv1;
varying vec2 vUv2;
varying vec2 vUv3;
varying vec2 vUv4;
varying vec2 vUv5;
varying vec2 vUv6;
varying vec2 vUv7;

float linRgb2luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 tent9(sampler2D tex) {
  vec3 o = texture2D(tex, vUv0).rgb * 0.0625;
  o += texture2D(tex, vUv1).rgb * 0.125;
  o += texture2D(tex, vUv2).rgb * 0.0625;
  o += texture2D(tex, vUv3).rgb * 0.125;
  o += texture2D(tex,  vUv).rgb * 0.25;
  o += texture2D(tex, vUv4).rgb * 0.125;
  o += texture2D(tex, vUv5).rgb * 0.0625;
  o += texture2D(tex, vUv6).rgb * 0.125;
  o += texture2D(tex, vUv7).rgb * 0.0625;
  return o;
}

void main() {
  vec4 t = texture2D(uLarge, vUv);
  if (uAmount > 0.0) {
    vec3 o = tent9(uInput);
    float oL = o.x * 0.2126 + o.y * 0.7152 + o.z * 0.0722;
    float ol = min(1.0, oL);
    o *= mix(ol, 1.0, uSpill);
    if (uLastPass) {
      vec3 outerColor = vec3(0.8, uHue * (0.8 + oL * oL), 0.0);
      vec3 innerColor = vec3(oL, oL * (uHue + 0.1), oL * 0.05);
      vec3 cl = mix(outerColor, innerColor, ol * ol);
      cl = mix(vec3(min(1.0, linRgb2luma(cl))), cl, uSat);
      vec3 hl = t.rgb + (o * cl);
      cl = max(cl + 1.0, vec3(0.0001));
      hl = vec3(max(t.r, hl.r / cl.r), max(t.g, hl.g / cl.g), max(t.b, hl.b / cl.b));
      gl_FragColor = vec4(mix(t.rgb, hl, uAmount), t.a);
    } else {
      gl_FragColor = vec4(mix(t.rgb, o, uAmount), t.a);
    }
  } else {
    gl_FragColor = t;
  }
}
`;

export class PyramidFXPass {
  private readonly downsampleMaterial = new ShaderMaterial({
    uniforms: {
      uInput: { value: null },
      uTexelSize: { value: new Vector2(1, 1) },
    },
    vertexShader,
    fragmentShader: downsampleFragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly diffusionMaterial = this.createPyramidMaterial(diffusionFragmentShader);
  private readonly halationMaterial = this.createPyramidMaterial(halationFragmentShader);
  private readonly downsampleResources = createFullscreenResources(this.downsampleMaterial);
  private readonly diffusionResources = createFullscreenResources(this.diffusionMaterial);
  private readonly halationResources = createFullscreenResources(this.halationMaterial);

  renderDownsample(
    renderer: WebGLRenderer,
    input: Texture,
    target: WebGLRenderTarget,
    inputWidth: number,
    inputHeight: number,
  ): void {
    this.downsampleMaterial.uniforms.uInput.value = input;
    (this.downsampleMaterial.uniforms.uTexelSize.value as Vector2).set(
      1 / Math.max(1, inputWidth),
      1 / Math.max(1, inputHeight),
    );
    renderPassToTarget(renderer, this.downsampleResources, target);
  }

  renderDiffusion(
    renderer: WebGLRenderer,
    input: Texture,
    large: Texture,
    target: WebGLRenderTarget,
    inputWidth: number,
    inputHeight: number,
    state: DiffusionState,
    amount: number,
    lastPass: boolean,
    aspect: number,
  ): void {
    const u = this.diffusionMaterial.uniforms;
    u.uInput.value = input;
    u.uLarge.value = large;
    u.uLastPass.value = lastPass;
    u.uAmount.value = amount;
    u.uFog.value = state.amount * state.amount;
    u.uThreshold.value = 0.8 * state.threshold;
    u.uFadeLevel.value = 0.042 * state.fog + 0.025;
    u.uCenterAlpha.value = 1 - state.focusProtect * state.focusProtect * 0.8;
    (u.uCenter.value as Vector2).set(state.centerX, state.centerY);
    u.uAspect.value = aspect;
    (u.uTexelSize.value as Vector2).set(1 / Math.max(1, inputWidth), 1 / Math.max(1, inputHeight));
    renderPassToTarget(renderer, this.diffusionResources, target);
  }

  renderHalation(
    renderer: WebGLRenderer,
    input: Texture,
    large: Texture,
    target: WebGLRenderTarget,
    inputWidth: number,
    inputHeight: number,
    state: HalationState,
    amount: number,
    lastPass: boolean,
  ): void {
    const u = this.halationMaterial.uniforms;
    u.uInput.value = input;
    u.uLarge.value = large;
    u.uLastPass.value = lastPass;
    u.uAmount.value = amount;
    u.uHue.value = 0.2 * state.hue;
    u.uSat.value = 2 * state.saturation;
    u.uSpill.value = 1 - Math.pow(1 - state.spill, 3);
    (u.uTexelSize.value as Vector2).set(1 / Math.max(1, inputWidth), 1 / Math.max(1, inputHeight));
    renderPassToTarget(renderer, this.halationResources, target);
  }

  dispose(): void {
    this.downsampleResources.scene.remove(this.downsampleResources.mesh);
    this.diffusionResources.scene.remove(this.diffusionResources.mesh);
    this.halationResources.scene.remove(this.halationResources.mesh);
    this.downsampleResources.geometry.dispose();
    this.diffusionResources.geometry.dispose();
    this.halationResources.geometry.dispose();
    this.downsampleMaterial.dispose();
    this.diffusionMaterial.dispose();
    this.halationMaterial.dispose();
  }

  private createPyramidMaterial(fragmentShader: string): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: {
        uInput: { value: null },
        uLarge: { value: null },
        uTexelSize: { value: new Vector2(1, 1) },
        uLastPass: { value: false },
        uAmount: { value: 0 },
        uFog: { value: 0 },
        uThreshold: { value: 0 },
        uFadeLevel: { value: 0.025 },
        uCenterAlpha: { value: 1 },
        uCenter: { value: new Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uHue: { value: 0.1 },
        uSat: { value: 1 },
        uSpill: { value: 0.875 },
      },
      vertexShader: pyramidVertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }
}
