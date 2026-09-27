// Shared GLSL prelude that exposes the legacy Poto ACES IDT + ODT as callable
// functions, so both the LUT bake (LUTGenerator) and the per-pixel render path
// (processedPipeline / BaseImagePass) can run them. Only the SELECTED IDT + ODT are
// compiled (the full ~100-variant set exceeds GPU shader-compiler limits), exactly
// like LUTGenerator.buildColorTransformMaterial.
//
// After this prelude, the shader can call:
//   activeIDT(vec3 srgb) -> ACEScct working value
//   activeODT(vec3 cct)  -> display code value
//
// See [[raw-standard-idt-lut-baking]] and [[legacy-look-needs-aces-rrt-odt]].
import colorSpacesShader from "../shaders/common/colorSpaces.glsl?raw";
import lumaShader from "../shaders/common/luma.glsl?raw";
import colorPipelineShader from "../shaders/common/colorPipeline.glsl?raw";
import acesPipelineShader from "../shaders/common/acesPipeline.glsl?raw";
import cubeAtlasShader from "../shaders/common/cubeAtlas.glsl?raw";
import idtOdtHelpersShader from "../shaders/common/idtOdtHelpers.glsl?raw";
import {
  IDT_SHADER_SOURCES,
  ODT_SHADER_SOURCES,
  inputTransformEntry,
  displayTransformEntry,
} from "./idtOdtSources";

// The color helper bodies, in dependency order (legacyIdtOdtHelpers must follow
// legacyAces + legacyColor + cubeAtlas, which provide pu/sn/nn/en/qf/Kf etc.).
const COLOR_HELPERS = [
  colorSpacesShader,
  lumaShader,
  colorPipelineShader,
  acesPipelineShader,
  cubeAtlasShader,
  idtOdtHelpersShader,
].join("\n");

/**
 * Returns the GLSL prelude defining activeIDT / activeODT for the given
 * legacy input (IDT) and display (ODT) ids. Unknown ids fall back to sRGB.
 */
export function buildColorTransformPrelude(idtId: string, odtId: string): string {
  const idtSrc = IDT_SHADER_SOURCES[idtId] ?? IDT_SHADER_SOURCES.sRGB;
  const odtSrc = ODT_SHADER_SOURCES[odtId] ?? ODT_SHADER_SOURCES.sRGB;
  return [
    COLOR_HELPERS,
    idtSrc,
    `vec3 activeIDT(vec3 c) { return ${inputTransformEntry(idtId)}(c); }`,
    odtSrc,
    `vec3 activeODT(vec3 cct) { return ${displayTransformEntry(odtId)}(cct); }`,
  ].join("\n");
}

export function buildInputTransformPrelude(idtId: string): string {
  const idtSrc = IDT_SHADER_SOURCES[idtId] ?? IDT_SHADER_SOURCES.sRGB;
  return [
    COLOR_HELPERS,
    idtSrc,
    `vec3 activeIDT(vec3 c) { return ${inputTransformEntry(idtId)}(c); }`,
  ].join("\n");
}

export function buildDisplayTransformPrelude(odtId: string): string {
  const odtSrc = ODT_SHADER_SOURCES[odtId] ?? ODT_SHADER_SOURCES.sRGB;
  return [
    COLOR_HELPERS,
    odtSrc,
    `vec3 activeODT(vec3 cct) { return ${displayTransformEntry(odtId)}(cct); }`,
  ].join("\n");
}
