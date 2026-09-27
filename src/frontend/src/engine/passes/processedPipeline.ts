import { DataTexture, RGBAFormat, Vector2, Vector4, type IUniform, type Texture } from "three";
import type { LUTTextureHandle, LUTTextureKind } from "../lut/LUTStorageTypes";
import type { DirectCreativeShader } from "../lut/LUTGenerator";
import type { DistortState, ImageFXState, RetouchState, TransformState } from "../state/EditState";
import { MAX_RETOUCH_SPOTS } from "../../features/retouch/retouchTypes";
import { getTransformDisplayDimensions } from "../transform/transformGeometry";
import {
  applyDistortUniforms,
  createDistortUniforms,
  distortionInverseGLSL,
  distortionUniformDeclarationsGLSL,
} from "../../features/distort/distortShader";
import lut2dShader from "../shaders/common/lut2d.glsl?raw";
import lut3dShader from "../shaders/common/lut3d.glsl?raw";
import colorPipelineShader from "../shaders/common/colorPipeline.glsl?raw";
import transformShader from "../shaders/common/transform.glsl?raw";
import spotMaskShader from "../shaders/retouch/spotMask.glsl?raw";
import spotHealShader from "../shaders/retouch/spotHeal.glsl?raw";

export function buildRetouchContextFragmentShader(): string {
  return `
precision highp float;

#define MAX_RETOUCH_SPOTS ${MAX_RETOUCH_SPOTS}

uniform sampler2D uImage;
uniform bool uApplyTransform;
uniform bool uFlipSourceY;
uniform vec4 uExportViewport;
uniform vec2 uOutputSize;
uniform bool uCropEnabled;
uniform vec4 uCropRect;
uniform vec2 uSourceSize;
uniform vec2 uDisplaySize;
uniform float uOrientationAngle;
uniform float uStraighten;
uniform bool uFlipX;
uniform bool uFlipY;
uniform int uSpotCount;
uniform vec2 uSpotPositions[MAX_RETOUCH_SPOTS];
uniform vec2 uSpotSizes[MAX_RETOUCH_SPOTS];
uniform float uSpotAngles[MAX_RETOUCH_SPOTS];
uniform float uSpotFeathers[MAX_RETOUCH_SPOTS];
uniform float uSpotOpacities[MAX_RETOUCH_SPOTS];
uniform float uSpotModes[MAX_RETOUCH_SPOTS];
${distortionUniformDeclarationsGLSL}

varying vec2 vUv;

${transformShader}
${distortionInverseGLSL}
${spotMaskShader}

void main() {
  vec2 displayUv = uExportViewport.xy + vUv * uExportViewport.zw;
  vec3 distortionLookup = uDistortionEnabled
    ? applyDistortionInverse(displayUv)
    : vec3(displayUv, 1.0);
  if (distortionLookup.z < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 sourceUv = uApplyTransform
    ? applyImageTransform(distortionLookup.xy)
    : distortionLookup.xy;
  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 sampleUv = vec2(sourceUv.x, uFlipSourceY ? 1.0 - sourceUv.y : sourceUv.y);
  vec3 baseImage = texture2D(uImage, sampleUv).rgb;
  float spotMaskAlpha = 0.0;
  for (int index = 0; index < MAX_RETOUCH_SPOTS; index++) {
    if (index >= uSpotCount) break;
    if (uSpotModes[index] < 0.5) continue;
    spotMaskAlpha = max(
      spotMaskAlpha,
      retouchDestinationMask(
        displayUv,
        uSpotPositions[index],
        uSpotSizes[index],
        uSpotAngles[index],
        uSpotFeathers[index],
        uSpotOpacities[index]
      )
    );
  }

  gl_FragColor = vec4(baseImage, spotMaskAlpha);
}
`;
}

/**
 * Builds the processed (BaseImagePass) fragment shader.
 *
 * In legacy-ACES mode, the input is already IDT'd into scene-linear AP1 by a small
 * upstream pass and the output remains scene-linear AP1 for FX + the small ODT pass.
 * The grade LUT still samples/returns ACEScct, matching the LUT generator. This keeps IDT/ODT
 * selector changes out of the large processed-image shader while preserving the
 * grade-only LUT path (see [[raw-standard-idt-lut-baking]]).
 */
export function buildProcessedFragmentShader(lutKind: LUTTextureKind = "2d-atlas"): string {
  const is3D = lutKind === "3d-texture";
  const lutSampler = is3D ? "sampler3D" : "sampler2D";
  const lutUniform = is3D ? "uLUT3D" : "uLUT2D";
  const varyingDeclaration = is3D ? "in vec2 vUv;\nout vec4 outColor;" : "varying vec2 vUv;";
  const outputTarget = is3D ? "outColor" : "gl_FragColor";
  const source = `
precision highp float;
${is3D ? "precision highp sampler3D;" : ""}

uniform sampler2D uImage;
uniform ${lutSampler} ${lutUniform};
uniform float uLUTSize;
uniform int uLUTKind;
uniform bool uUseLUT;
uniform int uLUTInterpolationMode;
uniform bool uAcesLinearInput;
uniform bool uApplyTransform;
uniform bool uFlipSourceY;
uniform vec4 uExportViewport;

uniform vec2 uOutputSize;
uniform bool uCropEnabled;
uniform vec4 uCropRect;
uniform vec2 uSourceSize;
uniform vec2 uDisplaySize;
uniform float uOrientationAngle;
uniform float uStraighten;
uniform bool uFlipX;
uniform bool uFlipY;
${distortionUniformDeclarationsGLSL}

${varyingDeclaration}

#include <lutSampler>
#include <colorPipeline>
#include <transform>

${distortionInverseGLSL}
${spotMaskShader}
${spotHealShader}

void main() {
  vec2 imageUv = uExportViewport.xy + vUv * uExportViewport.zw;
  vec3 distortionLookup = uDistortionEnabled ? applyDistortionInverse(imageUv) : vec3(imageUv, 1.0);
  if (distortionLookup.z < 0.5) {
    ${outputTarget} = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 sourceUv = uApplyTransform ? applyImageTransform(distortionLookup.xy) : distortionLookup.xy;

  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    ${outputTarget} = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 sampleUv = vec2(sourceUv.x, uFlipSourceY ? 1.0 - sourceUv.y : sourceUv.y);
  vec4 src = texture2D(uImage, sampleUv);

  vec3 retouchedSource = applySpotRetouch(src.rgb, imageUv);
  vec3 lutSource = uAcesLinearInput ? lin2cct(max(retouchedSource, 0.0)) : retouchedSource;
  vec3 currentColor = lutSource;
  if (uUseLUT) {
    currentColor = sampleGradedLUT(${lutUniform}, lutSource, uLUTInterpolationMode, uLUTSize);
  }

  vec3 outputColor = uAcesLinearInput ? cct2lin(currentColor) : currentColor;
  // Keep scene-linear super-highlights so the half-float FX chain can bloom them like
  // the legacy RGB9_E5 pipeline; clamp only negatives. The ODT is the display clamp.
  ${outputTarget} = vec4(max(outputColor, 0.0), src.a);
}
`;

  const compiled = source
    .replace("#include <lutSampler>", is3D ? lut3dShader : lut2dShader)
    .replace("#include <colorPipeline>", colorPipelineShader)
    .replace("#include <transform>", transformShader)

  return is3D ? compiled.replace(/\btexture2D\s*\(/g, "texture(") : compiled;
}

/**
 * Legacy-ACES variant of BaseImagePass that runs the creative pipeline directly
 * on each IDT'd image pixel. This avoids routing the global preset through the
 * 64^3 preview/export LUT, while preserving crop/transform.
 */
export function buildDirectProcessedFragmentShader(
  creative: DirectCreativeShader,
  lutKind: LUTTextureKind = "2d-atlas",
): string {
  const is3D = lutKind === "3d-texture";
  const varyingDeclaration = is3D ? "in vec2 vUv;\nout vec4 outColor;" : "varying vec2 vUv;";
  const outputTarget = is3D ? "outColor" : "gl_FragColor";
  const source = injectBeforeVarying(
    creative.fragmentPrelude,
    `
${is3D ? "precision highp sampler3D;" : ""}

uniform sampler2D uImage;
uniform int uLUTKind;
uniform bool uUseLUT;
uniform int uLUTInterpolationMode;
uniform bool uAcesLinearInput;
uniform bool uApplyTransform;
uniform bool uFlipSourceY;
uniform vec4 uExportViewport;

uniform vec2 uOutputSize;
uniform bool uCropEnabled;
uniform vec4 uCropRect;
uniform vec2 uSourceSize;
uniform vec2 uDisplaySize;
uniform float uOrientationAngle;
uniform float uStraighten;
uniform bool uFlipX;
uniform bool uFlipY;
${distortionUniformDeclarationsGLSL}
`,
  ).replace("varying vec2 vUv;", varyingDeclaration);

  const compiled = `
${source}

${is3D ? lut3dShader : lut2dShader}
${transformShader}

${distortionInverseGLSL}
${spotMaskShader}
${spotHealShader}

void main() {
  vec2 imageUv = uExportViewport.xy + vUv * uExportViewport.zw;
  vec3 distortionLookup = uDistortionEnabled ? applyDistortionInverse(imageUv) : vec3(imageUv, 1.0);
  if (distortionLookup.z < 0.5) {
    ${outputTarget} = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 sourceUv = uApplyTransform ? applyImageTransform(distortionLookup.xy) : distortionLookup.xy;

  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    ${outputTarget} = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 sampleUv = vec2(sourceUv.x, uFlipSourceY ? 1.0 - sourceUv.y : sourceUv.y);
  vec4 src = texture2D(uImage, sampleUv);
  vec3 retouchedSource = applySpotRetouch(src.rgb, imageUv);
  vec3 lutSource = uAcesLinearInput ? lin2cct(max(retouchedSource, 0.0)) : retouchedSource;
  vec3 work = uAcesLinearInput ? max(retouchedSource, 0.0) : cct2lin(retouchedSource);
  work = applyCreativePipeline(work);
  work = applyColorMatchLUT(work, uMatchAtlas, uUseMatchLUT);
  vec3 currentColor = lin2cct(work);

  vec3 outputColor = uAcesLinearInput ? cct2lin(currentColor) : currentColor;
  // Keep scene-linear super-highlights so the half-float FX chain can bloom them like
  // the legacy RGB9_E5 pipeline; clamp only negatives. The ODT is the display clamp.
  ${outputTarget} = vec4(max(outputColor, 0.0), src.a);
}
`;

  return is3D
    ? compiled.replace(/\btexture2D\s*\(/g, "texture(").replace(/\btextureCube\s*\(/g, "texture(")
    : compiled;
}

export function buildProcessedVertexShader(lutKind: LUTTextureKind = "2d-atlas"): string {
  if (lutKind === "3d-texture") {
    return `
out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
  }

  return `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
}

// 1×1 placeholder bound to the legacy cube-atlas samplers the IDT/ODT prelude
// declares (only sampled by cube-based color spaces, which bind the real atlas).
const PLACEHOLDER_CUBE_ATLAS = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
PLACEHOLDER_CUBE_ATLAS.needsUpdate = true;

export function createProcessedUniforms(): Record<string, IUniform> {
  return {
    uImage: { value: null },
    uExportViewport: { value: new Vector4(0, 0, 1, 1) },
    uLUT2D: { value: null },
    uLUT3D: { value: null },
    uLUTSize: { value: 64.0 },
    uLUTKind: { value: 0 },
    uUseLUT: { value: false },
    uLUTInterpolationMode: { value: 1 },
    uAcesLinearInput: { value: false },
    uApplyTransform: { value: true },
    uFlipSourceY: { value: true },
    uSmoothTexture: { value: null },
    uRetouchContextTexture: { value: null },
    uSpotCount: { value: 0 },
    uSpotPositions: {
      value: Array.from({ length: MAX_RETOUCH_SPOTS }, () => new Vector2()),
    },
    uSpotSourcePositions: {
      value: Array.from({ length: MAX_RETOUCH_SPOTS }, () => new Vector2()),
    },
    uSpotSizes: {
      value: Array.from({ length: MAX_RETOUCH_SPOTS }, () => new Vector2(0.01, 0.01)),
    },
    uSpotAngles: { value: new Float32Array(MAX_RETOUCH_SPOTS) },
    uSpotFeathers: { value: new Float32Array(MAX_RETOUCH_SPOTS) },
    uSpotOpacities: { value: new Float32Array(MAX_RETOUCH_SPOTS) },
    uSpotModes: { value: new Float32Array(MAX_RETOUCH_SPOTS) },
    uLutIdtAtlas: { value: PLACEHOLDER_CUBE_ATLAS },
    uLutOdtAtlas: { value: PLACEHOLDER_CUBE_ATLAS },
    uOutputSize: { value: new Vector2(1, 1) },
    uCropEnabled: { value: false },
    uCropRect: { value: new Vector4(0, 0, 1, 1) },
    uSourceSize: { value: new Vector2(1, 1) },
    uDisplaySize: { value: new Vector2(1, 1) },
    uOrientationAngle: { value: 0 },
    uStraighten: { value: 0 },
    uFlipX: { value: false },
    uFlipY: { value: false },
    ...createDistortUniforms(),
  };
}

export function setProcessedLUTHandle(
  uniforms: Record<string, IUniform>,
  handle: LUTTextureHandle | null,
) {
  uniforms.uLUT2D.value = handle?.kind === "2d-atlas" ? handle.texture : null;
  uniforms.uLUT3D.value = handle?.kind === "3d-texture" ? handle.texture : null;
  uniforms.uLUTKind.value = handle?.kind === "3d-texture" ? 1 : 0;
  uniforms.uLUTSize.value = handle?.size ?? 64;
}

export function setProcessedFXState(uniforms: Record<string, IUniform>, fxState: ImageFXState) {
  void uniforms;
  void fxState;
}

export function setProcessedTransformState(
  uniforms: Record<string, IUniform>,
  state: TransformState,
  cropEnabledOverride?: boolean,
  sourceSize?: { width: number; height: number },
) {
  const cropEnabled = cropEnabledOverride !== undefined ? cropEnabledOverride : state.cropEnabled;
  if (sourceSize) {
    const sourceWidth = Math.max(1, sourceSize.width);
    const sourceHeight = Math.max(1, sourceSize.height);
    uniforms.uSourceSize.value.set(sourceWidth, sourceHeight);
    const display = getTransformDisplayDimensions(sourceWidth, sourceHeight, state);
    uniforms.uDisplaySize.value.set(display.width, display.height);
  }
  uniforms.uCropEnabled.value = state.enabled && cropEnabled;
  uniforms.uCropRect.value.set(state.cropX, state.cropY, state.cropWidth, state.cropHeight);
  uniforms.uOrientationAngle.value = state.enabled ? state.orientation : 0;
  uniforms.uStraighten.value = state.enabled ? state.straighten : 0;
  uniforms.uFlipX.value = state.enabled && state.flipX;
  uniforms.uFlipY.value = state.enabled && state.flipY;
}

export function setProcessedDistortState(
  uniforms: Record<string, IUniform>,
  state: DistortState,
  textureSize?: { width: number; height: number },
) {
  applyDistortUniforms(uniforms, state, textureSize);
}

export function setProcessedRetouchState(
  uniforms: Record<string, IUniform>,
  state: RetouchState,
  smoothTexture: Texture | null,
  contextTexture: Texture | null = smoothTexture,
) {
  const spots = state.enabled && !state.bypass
    ? state.spots.filter((spot) => !spot.disabled).slice(0, MAX_RETOUCH_SPOTS)
    : [];
  uniforms.uSmoothTexture.value = smoothTexture;
  uniforms.uRetouchContextTexture.value = contextTexture;
  uniforms.uSpotCount.value = spots.length;

  const positions = uniforms.uSpotPositions.value as Vector2[];
  const sourcePositions = uniforms.uSpotSourcePositions.value as Vector2[];
  const sizes = uniforms.uSpotSizes.value as Vector2[];
  const angles = uniforms.uSpotAngles.value as Float32Array;
  const feathers = uniforms.uSpotFeathers.value as Float32Array;
  const opacities = uniforms.uSpotOpacities.value as Float32Array;
  const modes = uniforms.uSpotModes.value as Float32Array;

  spots.forEach((spot, index) => {
    positions[index].set(spot.position[0], spot.position[1]);
    sourcePositions[index].set(spot.sourcePosition[0], spot.sourcePosition[1]);
    sizes[index].set(spot.size[0], spot.size[1]);
    angles[index] = spot.angle;
    feathers[index] = spot.feather;
    opacities[index] = spot.opacity;
    modes[index] = spot.mode;
  });
}


function injectBeforeVarying(source: string, insertion: string): string {
  const marker = "varying vec2 vUv;";
  const index = source.indexOf(marker);
  if (index < 0) {
    return `${insertion}\n${source}`;
  }
  return `${source.slice(0, index)}${insertion}\n${source.slice(index)}`;
}
