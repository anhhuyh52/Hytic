import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
} from "three";
import {
  CURVE_MAX_STOPS,
  CURVE_MIN_STOPS,
  CURVE_TEXTURE_SIZE,
  evaluateCurveTexture,
} from "../curve/CurveEvaluator";
import {
  CONTRAST_CURVE_MAX,
  CONTRAST_CURVE_MIN,
  CONTRAST_CURVE_TEXTURE_SIZE,
  evaluateContrastCurveTexture,
} from "../curve/ContrastCurveEvaluator";
import type {
  BalanceState,
  ColorState,
  ContrastCurveMode,
  ContrastCurveState,
  ContrastState,
  CurveState,
  DensityChromaState,
  CurveModel,
  RGBMixerState,
  RadianceState,
  SaturationState,
  ScatteringState,
  RefractionState,
  ToneState,
  ShadowHighlightState,
  ExposureState,
  CurvePreviewInput,
} from "../state/EditState";
import { cloneCurveModel, DEFAULT_EDIT_STATE } from "../state/EditState";
import { recordDataTextureUpload } from "../../app/performanceCounters";
import { LUT_SIZE, LUT_TEXTURE_SIZE, LUT_TILE_COUNT } from "./lutConstants";
import type { BakedLUT } from "./exportCube";
import type { ColorManagementState } from "../color/ColorManagementTypes";
import {
  debugViewToInt,
  displayColorSpaceToInt,
  inputColorSpaceToInt,
  viewTransformToInt,
  workingColorSpaceToInt,
} from "../color/ColorTransforms";
import { DEFAULT_COLOR_MANAGEMENT_STATE } from "../color/ColorManagementTypes";
import { getSourceToWorkingMatrix } from "../color/InputTransforms";
import { getWorkingToDisplayMatrix } from "../color/OutputTransforms";
import { inputTransformLut, displayTransformLut } from "../color/colorSpaceCatalog";
import {
  IDT_SHADER_SOURCES,
  ODT_SHADER_SOURCES,
  inputTransformEntry,
  displayTransformEntry,
} from "../color/idtOdtSources";
import { loadCubeAtlas } from "./CubeAtlasLoader";
import vertexShader from "../shaders/lut/generateIdentityLUT.vert?raw";
import fragmentShader from "../shaders/lut/generateLUT.frag?raw";
import colorSpacesShader from "../shaders/common/colorSpaces.glsl?raw";
import acesApproxShader from "../shaders/common/acesApprox.glsl?raw";
import toneMappingShader from "../shaders/common/toneMapping.glsl?raw";
import displayGamutsShader from "../shaders/common/displayGamuts.glsl?raw";
import gamutMappingShader from "../shaders/common/gamutMapping.glsl?raw";
import outputTransformsShader from "../shaders/common/outputTransforms.glsl?raw";
import cameraLogCurvesShader from "../shaders/common/cameraLogCurves.glsl?raw";
import gamutMatricesShader from "../shaders/common/gamutMatrices.glsl?raw";
import inputTransformsShader from "../shaders/common/inputTransforms.glsl?raw";
import colorMatchShader from "../shaders/lut/colorMatch.glsl?raw";
import lumaShader from "../shaders/common/luma.glsl?raw";
import contrastShader from "../shaders/panels/contrast.glsl?raw";
import contrastCurveShader from "../shaders/panels/contrastCurve.glsl?raw";
import balanceShader from "../shaders/panels/balance.glsl?raw";
import colorPipelineShader from "../shaders/common/colorPipeline.glsl?raw";
import acesPipelineShader from "../shaders/common/acesPipeline.glsl?raw";
import cubeAtlasShader from "../shaders/common/cubeAtlas.glsl?raw";
import idtOdtHelpersShader from "../shaders/common/idtOdtHelpers.glsl?raw";
import scatteringShader from "../shaders/panels/scattering.glsl?raw";
import refractionShader from "../shaders/panels/refraction.glsl?raw";
import rgbMixerShader from "../shaders/panels/rgbMixer.glsl?raw";
import densityChromaShader from "../shaders/panels/densityChroma.glsl?raw";
import radianceShader from "../shaders/panels/radiance.glsl?raw";
import toneShader from "../shaders/panels/tone.glsl?raw";
import shadowHighlightShader from "../shaders/panels/shadowHighlight.glsl?raw";
import exposureShader from "../shaders/panels/exposure.glsl?raw";
import spectralReprojectShader from "../shaders/panels/spectralReproject.glsl?raw";
import { CSP_LUT_HALF, CSP_LUT_SIZE } from "./cspLutData";
import {
  evaluateDensityCurves,
  evaluateRadianceCurve,
  evaluateToneCurve,
  evaluateExposureCurve,
  CURVE_MODEL_TEXTURE_SIZE,
} from "../curve/CurveModelTexture";

const DEBUG_ENGINE = false;

// 1×1 placeholder bound to the cube-atlas samplers when the selected legacy space
// isn't cube-based (the dispatch never samples it then) or before a cube loads.
const PLACEHOLDER_ATLAS = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
PLACEHOLDER_ATLAS.needsUpdate = true;

// Color Match LUT: 16³, stored as a 256x16 atlas (16 blue-slices of 16x16 across).
const MATCH_LUT_SIZE = 16;
const MATCH_ATLAS_W = MATCH_LUT_SIZE * MATCH_LUT_SIZE; // 256
const MATCH_ATLAS_H = MATCH_LUT_SIZE; // 16
const HALF_ONE = 0x3c00; // IEEE-754 binary16 of 1.0 (alpha channel filler)

type LUTUniforms = {
  uCurve: IUniform<Texture>;
  uUseCurve: IUniform<boolean>;
  uCurveMinStops: IUniform<number>;
  uCurveMaxStops: IUniform<number>;
  uUseContrast: IUniform<boolean>;
  uContrastAmount: IUniform<number>;
  uContrastPivot: IUniform<number>;
  uContrastCurve: IUniform<Texture>;
  uUseContrastCurve: IUniform<boolean>;
  uContrastCurveMin: IUniform<number>;
  uContrastCurveMax: IUniform<number>;
  uUseBalance: IUniform<boolean>;
  uBalanceExposure: IUniform<number>;
  uBalanceSaturation: IUniform<number>;
  uTemperature: IUniform<number>;
  uTint: IUniform<number>;
  uBalanceRGB: IUniform<Vector3>;
  uUseScattering: IUniform<boolean>;
  uScatterShadows: IUniform<Vector4>;
  uScatterHighlights: IUniform<Vector4>;
  uUseRefraction: IUniform<boolean>;
  uRefractMv: IUniform<Vector4[]>;
  uRefractSeparation: IUniform<number>;
  uUseRGBMixer: IUniform<boolean>;
  uRGBMixerRedRow: IUniform<Vector3>;
  uRGBMixerGreenRow: IUniform<Vector3>;
  uRGBMixerBlueRow: IUniform<Vector3>;
  uRGBMixerPreserveLuminance: IUniform<boolean>;
  // Density / Chroma / Saturation curve models (packed RGBA texture).
  uUseDensity: IUniform<boolean>;
  uUseChroma: IUniform<boolean>;
  uUseSaturation: IUniform<boolean>;
  uDensityCurves: IUniform<Texture>;
  // Radiance legacy hueVsLuma curve.
  uUseRadiance: IUniform<boolean>;
  uRadianceCurve: IUniform<Texture>;
  // Tone legacy lumaVsLuma curve (Contrast panel, lch_mod).
  uUseTone: IUniform<boolean>;
  uToneCurve: IUniform<Texture>;
  // Shadow / Highlight legacy rng_mod (per-channel black/white points).
  uUseShadowHighlight: IUniform<boolean>;
  uShadowHighlightBlack: IUniform<Vector3>;
  uShadowHighlightWhite: IUniform<Vector3>;
  // Exposure legacy expVsLuma offset curve.
  uUseExposure: IUniform<boolean>;
  uExposureCurve: IUniform<Texture>;
  // Legacy POST-CMP spectral-compression LUT (constant 8³ atlas).
  uUseSpectral: IUniform<boolean>;
  uCspLut: IUniform<Texture>;
  uUseAcesPipeline: IUniform<boolean>;
  uBakeFull: IUniform<boolean>;
  uLutIdtAtlas: IUniform<Texture>;
  uLutOdtAtlas: IUniform<Texture>;
  uColorManagementEnabled: IUniform<boolean>;
  uInputColorSpace: IUniform<number>;
  uWorkingColorSpace: IUniform<number>;
  uDisplayColorSpace: IUniform<number>;
  uViewTransform: IUniform<number>;
  uUseOutputTransform: IUniform<boolean>;
  uUseGamutMapping: IUniform<boolean>;
  uColorManagementDebugView: IUniform<number>;
  uSourceToWorkingMatrix: IUniform<Matrix3>;
  uWorkingToDisplayMatrix: IUniform<Matrix3>;
  uToneMappingEnabled: IUniform<boolean>;
  uToneExposureBias: IUniform<number>;
  uToneHighlightCompression: IUniform<number>;
  uToneShoulderStrength: IUniform<number>;
  uToneBlackLift: IUniform<number>;
  // Color Match — 16³ LUT atlas (256x16) baked from srp-static, sampled at the
  // end of the grade. uUseMatchLUT gates it; uMatchAtlas holds the LUT.
  uUseMatchLUT: IUniform<boolean>;
  uMatchAtlas: IUniform<Texture>;
};

export type DirectCreativeShader = {
  fragmentPrelude: string;
  uniforms: Record<string, IUniform>;
};

export class LUTGenerator {
  private readonly renderer: WebGLRenderer;
  // Called when an async resource (cube atlas) finishes loading and the LUT needs
  // a re-render — the engine wires this to its requestRender (renders are
  // event-driven, so async loads must explicitly request a frame).
  private readonly onAsyncUpdate?: () => void;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2, 1, 1);
  private readonly curveTexture = new DataTexture(
    evaluateCurveTexture(DEFAULT_EDIT_STATE.curve),
    CURVE_TEXTURE_SIZE,
    1,
    RGBAFormat,
  );
  private readonly contrastCurveTexture = new DataTexture(
    evaluateContrastCurveTexture(DEFAULT_EDIT_STATE.contrast.curve),
    CONTRAST_CURVE_TEXTURE_SIZE,
    1,
    RGBAFormat,
  );
  // Legacy Density/Chroma/Saturation curves packed into one RGBA texture, and
  // the Radiance hueVsLuma curve. Neutral (0.5) by default = identity.
  private readonly densityCurvesTexture = new DataTexture(
    evaluateDensityCurves(
      DEFAULT_EDIT_STATE.densityChroma.density,
      DEFAULT_EDIT_STATE.densityChroma.chroma,
      DEFAULT_EDIT_STATE.saturation.curve,
    ),
    CURVE_MODEL_TEXTURE_SIZE,
    1,
    RGBAFormat,
  );
  private readonly radianceCurveTexture = new DataTexture(
    evaluateRadianceCurve(DEFAULT_EDIT_STATE.radiance.curve),
    CURVE_MODEL_TEXTURE_SIZE,
    1,
    RGBAFormat,
  );
  // Tone (Contrast panel) lumaVsLuma curve — identity diagonal (y = x) by default.
  private readonly toneCurveTexture = new DataTexture(
    evaluateToneCurve(DEFAULT_EDIT_STATE.tone.curve),
    CURVE_MODEL_TEXTURE_SIZE,
    1,
    RGBAFormat,
  );
  // Exposure (expVsLuma) offset curve — flat 0.5 (×1.0) by default.
  private readonly exposureCurveTexture = new DataTexture(
    evaluateExposureCurve(DEFAULT_EDIT_STATE.exposure.curve),
    CURVE_MODEL_TEXTURE_SIZE,
    1,
    RGBAFormat,
  );
  // Legacy POST-CMP spectral-compression LUT (8³ cct->cct), packed as a 64x8
  // atlas (8 z-slices of 8x8) and sampled with manual trilinear. Constant.
  private readonly cspLutTexture = new DataTexture(
    buildCspAtlas(),
    CSP_LUT_SIZE * CSP_LUT_SIZE,
    CSP_LUT_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  // Color Match — 16³ LUT baked from srp-static, held as a 256x16 atlas
  // (16 blue-slices of 16x16). It prefers RGBA16F, but falls back to RGBA8 on
  // browsers that cannot sample half-float textures. NearestFilter; the shader
  // does manual trilinear.
  private matchAtlasTexture = new DataTexture(
    new Uint16Array(MATCH_ATLAS_W * MATCH_ATLAS_H * 4),
    MATCH_ATLAS_W,
    MATCH_ATLAS_H,
    RGBAFormat,
    HalfFloatType,
  );
  private matchAtlasUsesHalfFloat = true;
  private editedMatchSignature = "off";
  private readonly uniforms: LUTUniforms = {
    uCurve: { value: this.curveTexture },
    uUseCurve: {
      value: !DEFAULT_EDIT_STATE.curve.bypass && !isCurveNeutral(DEFAULT_EDIT_STATE.curve),
    },
    uCurveMinStops: { value: CURVE_MIN_STOPS },
    uCurveMaxStops: { value: CURVE_MAX_STOPS },
    uUseContrast: {
      value:
        DEFAULT_EDIT_STATE.contrast.enabled &&
        !DEFAULT_EDIT_STATE.contrast.bypass &&
        !isContrastNeutral(DEFAULT_EDIT_STATE.contrast),
    },
    uContrastAmount: { value: DEFAULT_EDIT_STATE.contrast.amount },
    uContrastPivot: { value: DEFAULT_EDIT_STATE.contrast.pivot },
    uContrastCurve: { value: this.contrastCurveTexture },
    uUseContrastCurve: {
      value:
        !DEFAULT_EDIT_STATE.contrast.curve.bypass &&
        !isContrastCurveNeutral(DEFAULT_EDIT_STATE.contrast.curve),
    },
    uContrastCurveMin: { value: CONTRAST_CURVE_MIN },
    uContrastCurveMax: { value: CONTRAST_CURVE_MAX },
    uUseBalance: {
      value: DEFAULT_EDIT_STATE.balance.enabled && !DEFAULT_EDIT_STATE.balance.bypass,
    },
    uBalanceExposure: { value: DEFAULT_EDIT_STATE.balance.exposure },
    uBalanceSaturation: { value: DEFAULT_EDIT_STATE.balance.saturation },
    uTemperature: { value: DEFAULT_EDIT_STATE.balance.temperature },
    uTint: { value: DEFAULT_EDIT_STATE.balance.tint },
    uBalanceRGB: {
      value: new Vector3(
        DEFAULT_EDIT_STATE.balance.red,
        DEFAULT_EDIT_STATE.balance.green,
        DEFAULT_EDIT_STATE.balance.blue,
      ),
    },
    uUseScattering: {
      value: DEFAULT_EDIT_STATE.scattering.enabled && !DEFAULT_EDIT_STATE.scattering.bypass,
    },
    uScatterShadows: { value: new Vector4(0, 0, 0, 0.375) },
    uScatterHighlights: { value: new Vector4(1, 1, 1, 0.375) },
    uUseRefraction: {
      value: DEFAULT_EDIT_STATE.refraction.enabled && !DEFAULT_EDIT_STATE.refraction.bypass,
    },
    uRefractMv: { value: mapVectorsToVec4(DEFAULT_EDIT_STATE.refraction.mapVectors) },
    uRefractSeparation: { value: DEFAULT_EDIT_STATE.refraction.separation },
    uUseRGBMixer: {
      value:
        DEFAULT_EDIT_STATE.rgbMixer.enabled &&
        !DEFAULT_EDIT_STATE.rgbMixer.bypass &&
        !isRGBMixerNeutral(DEFAULT_EDIT_STATE.rgbMixer),
    },
    uRGBMixerRedRow: {
      value: new Vector3(
        DEFAULT_EDIT_STATE.rgbMixer.red.r,
        DEFAULT_EDIT_STATE.rgbMixer.red.g,
        DEFAULT_EDIT_STATE.rgbMixer.red.b,
      ),
    },
    uRGBMixerGreenRow: {
      value: new Vector3(
        DEFAULT_EDIT_STATE.rgbMixer.green.r,
        DEFAULT_EDIT_STATE.rgbMixer.green.g,
        DEFAULT_EDIT_STATE.rgbMixer.green.b,
      ),
    },
    uRGBMixerBlueRow: {
      value: new Vector3(
        DEFAULT_EDIT_STATE.rgbMixer.blue.r,
        DEFAULT_EDIT_STATE.rgbMixer.blue.g,
        DEFAULT_EDIT_STATE.rgbMixer.blue.b,
      ),
    },
    uRGBMixerPreserveLuminance: { value: DEFAULT_EDIT_STATE.rgbMixer.preserveLuminance },
    uUseDensity: {
      value: DEFAULT_EDIT_STATE.densityChroma.enabled && !DEFAULT_EDIT_STATE.densityChroma.bypass,
    },
    uUseChroma: {
      value: DEFAULT_EDIT_STATE.densityChroma.enabled && !DEFAULT_EDIT_STATE.densityChroma.bypass,
    },
    uUseSaturation: {
      value: DEFAULT_EDIT_STATE.saturation.enabled && !DEFAULT_EDIT_STATE.saturation.bypass,
    },
    uDensityCurves: { value: this.densityCurvesTexture },
    uUseRadiance: {
      value: DEFAULT_EDIT_STATE.radiance.enabled && !DEFAULT_EDIT_STATE.radiance.bypass,
    },
    uRadianceCurve: { value: this.radianceCurveTexture },
    uUseTone: {
      value: DEFAULT_EDIT_STATE.tone.enabled && !DEFAULT_EDIT_STATE.tone.bypass,
    },
    uToneCurve: { value: this.toneCurveTexture },
    uUseShadowHighlight: {
      value:
        DEFAULT_EDIT_STATE.shadowHighlight.enabled && !DEFAULT_EDIT_STATE.shadowHighlight.bypass,
    },
    uShadowHighlightBlack: {
      value: new Vector3(
        DEFAULT_EDIT_STATE.shadowHighlight.blackPoint[0],
        DEFAULT_EDIT_STATE.shadowHighlight.blackPoint[1],
        DEFAULT_EDIT_STATE.shadowHighlight.blackPoint[2],
      ),
    },
    uShadowHighlightWhite: {
      value: new Vector3(
        DEFAULT_EDIT_STATE.shadowHighlight.whitePoint[0],
        DEFAULT_EDIT_STATE.shadowHighlight.whitePoint[1],
        DEFAULT_EDIT_STATE.shadowHighlight.whitePoint[2],
      ),
    },
    uUseExposure: {
      value: DEFAULT_EDIT_STATE.exposure.enabled && !DEFAULT_EDIT_STATE.exposure.bypass,
    },
    uExposureCurve: { value: this.exposureCurveTexture },
    uUseSpectral: { value: true },
    uCspLut: { value: this.cspLutTexture },
    // Render the grade inside the legacy ACES sandwich by default (matches Poto).
    uUseAcesPipeline: { value: DEFAULT_COLOR_MANAGEMENT_STATE.useAcesPipeline },
    // Preview = grade-only (IDT/ODT per-pixel downstream); flipped on for LUT export.
    uBakeFull: { value: false },
    // Cube-LUT atlases for cube-based legacy spaces (placeholder until one loads).
    // The selected IDT/ODT itself is baked into the material, not a uniform.
    uLutIdtAtlas: { value: PLACEHOLDER_ATLAS },
    uLutOdtAtlas: { value: PLACEHOLDER_ATLAS },
    uColorManagementEnabled: { value: DEFAULT_COLOR_MANAGEMENT_STATE.enabled },
    uInputColorSpace: {
      value: inputColorSpaceToInt[DEFAULT_COLOR_MANAGEMENT_STATE.inputColorSpace],
    },
    uWorkingColorSpace: {
      value: workingColorSpaceToInt[DEFAULT_COLOR_MANAGEMENT_STATE.workingColorSpace],
    },
    uDisplayColorSpace: {
      value: displayColorSpaceToInt[DEFAULT_COLOR_MANAGEMENT_STATE.displayColorSpace],
    },
    uViewTransform: { value: viewTransformToInt[DEFAULT_COLOR_MANAGEMENT_STATE.viewTransform] },
    uUseOutputTransform: { value: DEFAULT_COLOR_MANAGEMENT_STATE.useOutputTransform },
    uUseGamutMapping: { value: DEFAULT_COLOR_MANAGEMENT_STATE.useGamutMapping },
    uColorManagementDebugView: { value: debugViewToInt[DEFAULT_COLOR_MANAGEMENT_STATE.debugView] },
    // Identity by default (srgb input -> linear-srgb working, linear-srgb working -> sRGB display).
    uSourceToWorkingMatrix: { value: new Matrix3() },
    uWorkingToDisplayMatrix: { value: new Matrix3() },
    uToneMappingEnabled: { value: DEFAULT_COLOR_MANAGEMENT_STATE.toneMapping.enabled },
    uToneExposureBias: { value: DEFAULT_COLOR_MANAGEMENT_STATE.toneMapping.exposureBias },
    uToneHighlightCompression: {
      value: DEFAULT_COLOR_MANAGEMENT_STATE.toneMapping.highlightCompression,
    },
    uToneShoulderStrength: { value: DEFAULT_COLOR_MANAGEMENT_STATE.toneMapping.shoulderStrength },
    uToneBlackLift: { value: DEFAULT_COLOR_MANAGEMENT_STATE.toneMapping.blackLift },
    uUseMatchLUT: { value: false },
    uMatchAtlas: { value: this.matchAtlasTexture },
  };
  // Base fragment with all static includes resolved. The ACTIVE_IDT/ODT
  // markers are filled per selection in buildColorTransformMaterial — only the SELECTED
  // IDT + ODT are compiled (the full ~100-variant set exceeds GPU shader limits).
  private readonly baseFragment = fragmentShader
    .replace("#include <colorSpaces>", colorSpacesShader)
    .replace("#include <luma>", lumaShader)
    .replace("#include <acesApprox>", acesApproxShader)
    .replace("#include <toneMapping>", toneMappingShader)
    .replace("#include <displayGamuts>", displayGamutsShader)
    .replace("#include <gamutMapping>", gamutMappingShader)
    .replace("#include <outputTransforms>", outputTransformsShader)
    .replace("#include <cameraLogCurves>", cameraLogCurvesShader)
    .replace("#include <gamutMatrices>", gamutMatricesShader)
    .replace("#include <inputTransforms>", inputTransformsShader)
    .replace("#include <colorMatch>", colorMatchShader)
    .replace("#include <contrast>", contrastShader)
    .replace("#include <contrastCurve>", contrastCurveShader)
    .replace("#include <balance>", balanceShader)
    .replace("#include <colorPipeline>", colorPipelineShader)
    .replace("#include <acesPipeline>", acesPipelineShader)
    .replace("#include <cubeAtlas>", cubeAtlasShader)
    .replace("#include <idtOdtHelpers>", idtOdtHelpersShader)
    .replace("#include <scattering>", scatteringShader)
    .replace("#include <refraction>", refractionShader)
    .replace("#include <rgbMixer>", rgbMixerShader)
    .replace("#include <densityChroma>", densityChromaShader)
    .replace("#include <radiance>", radianceShader)
    .replace("#include <tone>", toneShader)
    .replace("#include <shadowHighlight>", shadowHighlightShader)
    .replace("#include <exposure>", exposureShader)
    .replace("#include <spectralReproject>", spectralReprojectShader);
  // Material is rebuilt when the legacy input/display space changes (the active
  // IDT/ODT source is baked in). Mesh + material are created in the constructor.
  private material!: ShaderMaterial;
  private readonly mesh: Mesh;
  private activeIdtId = "";
  private activeOdtId = "";
  private readonly renderTarget: WebGLRenderTarget;
  private readonly renderTargetIsHalfFloat: boolean;
  private editedCurve: CurveState = {
    ...DEFAULT_EDIT_STATE.curve,
    points: DEFAULT_EDIT_STATE.curve.points.map((point) => ({ ...point })),
  };
  private editedContrast: ContrastState = { ...DEFAULT_EDIT_STATE.contrast };
  private editedContrastCurve: ContrastCurveState = {
    ...DEFAULT_EDIT_STATE.contrast.curve,
    points: DEFAULT_EDIT_STATE.contrast.curve.points.map((point) => ({ ...point })),
  };
  private editedBalance: BalanceState = { ...DEFAULT_EDIT_STATE.balance };
  private editedScattering: ScatteringState = { ...DEFAULT_EDIT_STATE.scattering };
  private editedRefraction: RefractionState = {
    ...DEFAULT_EDIT_STATE.refraction,
    mapVectors: [...DEFAULT_EDIT_STATE.refraction.mapVectors],
  };
  private editedSaturation: SaturationState = {
    ...DEFAULT_EDIT_STATE.saturation,
    curve: cloneCurveModel(DEFAULT_EDIT_STATE.saturation.curve),
  };
  private editedRGBMixer: RGBMixerState = {
    ...DEFAULT_EDIT_STATE.rgbMixer,
    red: { ...DEFAULT_EDIT_STATE.rgbMixer.red },
    green: { ...DEFAULT_EDIT_STATE.rgbMixer.green },
    blue: { ...DEFAULT_EDIT_STATE.rgbMixer.blue },
  };
  private editedDensityChroma: DensityChromaState = {
    ...DEFAULT_EDIT_STATE.densityChroma,
    density: cloneCurveModel(DEFAULT_EDIT_STATE.densityChroma.density),
    chroma: cloneCurveModel(DEFAULT_EDIT_STATE.densityChroma.chroma),
  };
  private editedRadiance: RadianceState = {
    ...DEFAULT_EDIT_STATE.radiance,
    curve: cloneCurveModel(DEFAULT_EDIT_STATE.radiance.curve),
  };
  private editedTone: ToneState = {
    ...DEFAULT_EDIT_STATE.tone,
    curve: cloneCurveModel(DEFAULT_EDIT_STATE.tone.curve),
  };
  private editedShadowHighlight: ShadowHighlightState = {
    ...DEFAULT_EDIT_STATE.shadowHighlight,
    blackPoint: [...DEFAULT_EDIT_STATE.shadowHighlight.blackPoint],
    whitePoint: [...DEFAULT_EDIT_STATE.shadowHighlight.whitePoint],
  };
  private editedExposure: ExposureState = {
    ...DEFAULT_EDIT_STATE.exposure,
    curve: cloneCurveModel(DEFAULT_EDIT_STATE.exposure.curve),
  };
  private editedColorManagement: ColorManagementState = { ...DEFAULT_COLOR_MANAGEMENT_STATE };
  // Loaded 64³ cube atlases for legacy LUT-based IDT/ODT spaces, keyed by filename.
  private readonly cubeAtlasCache = new Map<string, Texture>();
  // In-flight cube loads (dedup so input+output selecting the same cube fetch once).
  private readonly inFlightCubes = new Map<string, Promise<Texture>>();
  public needsUpdate = true;

  constructor(renderer: WebGLRenderer, onAsyncUpdate?: () => void) {
    this.renderer = renderer;
    this.onAsyncUpdate = onAsyncUpdate;
    if (!this.supportsHalfFloatSampleTextures()) {
      this.matchAtlasTexture.dispose();
      this.matchAtlasTexture = new DataTexture(
        new Uint8Array(MATCH_ATLAS_W * MATCH_ATLAS_H * 4),
        MATCH_ATLAS_W,
        MATCH_ATLAS_H,
        RGBAFormat,
        UnsignedByteType,
      );
      this.matchAtlasUsesHalfFloat = false;
      this.uniforms.uMatchAtlas.value = this.matchAtlasTexture;
    }
    // Compile the initial material with the default (sRGB) IDT/ODT baked in.
    this.buildColorTransformMaterial(
      DEFAULT_COLOR_MANAGEMENT_STATE.inputColorSpaceId,
      DEFAULT_COLOR_MANAGEMENT_STATE.displayColorSpaceId,
    );
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.curveTexture.minFilter = LinearFilter;
    this.curveTexture.magFilter = LinearFilter;
    this.curveTexture.wrapS = ClampToEdgeWrapping;
    this.curveTexture.wrapT = ClampToEdgeWrapping;
    this.curveTexture.generateMipmaps = false;
    this.curveTexture.unpackAlignment = 1;
    this.curveTexture.colorSpace = NoColorSpace;
    this.curveTexture.needsUpdate = true;

    this.contrastCurveTexture.minFilter = LinearFilter;
    this.contrastCurveTexture.magFilter = LinearFilter;
    this.contrastCurveTexture.wrapS = ClampToEdgeWrapping;
    this.contrastCurveTexture.wrapT = ClampToEdgeWrapping;
    this.contrastCurveTexture.generateMipmaps = false;
    this.contrastCurveTexture.unpackAlignment = 1;
    this.contrastCurveTexture.colorSpace = NoColorSpace;
    this.contrastCurveTexture.needsUpdate = true;

    for (const tex of [
      this.densityCurvesTexture,
      this.radianceCurveTexture,
      this.toneCurveTexture,
      this.exposureCurveTexture,
    ]) {
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.wrapS = ClampToEdgeWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.unpackAlignment = 1;
      tex.colorSpace = NoColorSpace;
      tex.needsUpdate = true;
    }

    // csp atlas: NEAREST so the manual trilinear reads exact texels (no bleed
    // across the packed z-slices).
    this.cspLutTexture.minFilter = NearestFilter;
    this.cspLutTexture.magFilter = NearestFilter;
    this.cspLutTexture.wrapS = ClampToEdgeWrapping;
    this.cspLutTexture.wrapT = ClampToEdgeWrapping;
    this.cspLutTexture.generateMipmaps = false;
    this.cspLutTexture.unpackAlignment = 1;
    this.cspLutTexture.colorSpace = NoColorSpace;
    this.cspLutTexture.needsUpdate = true;

    // Color-match atlas: NEAREST so the manual trilinear reads exact texels.
    this.matchAtlasTexture.minFilter = NearestFilter;
    this.matchAtlasTexture.magFilter = NearestFilter;
    this.matchAtlasTexture.wrapS = ClampToEdgeWrapping;
    this.matchAtlasTexture.wrapT = ClampToEdgeWrapping;
    this.matchAtlasTexture.generateMipmaps = false;
    this.matchAtlasTexture.unpackAlignment = 1;
    this.matchAtlasTexture.colorSpace = NoColorSpace;
    this.matchAtlasTexture.needsUpdate = true;

    const renderTargetType = this.getRenderTargetType();
    this.renderTargetIsHalfFloat = renderTargetType === HalfFloatType;
    this.renderTarget = new WebGLRenderTarget(LUT_TEXTURE_SIZE, LUT_TEXTURE_SIZE, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      type: renderTargetType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.renderTarget.texture.generateMipmaps = false;
    this.renderTarget.texture.colorSpace = NoColorSpace;
  }

  get texture(): Texture {
    return this.renderTarget.texture;
  }

  get directCreativeShader(): DirectCreativeShader {
    return {
      fragmentPrelude: buildDirectCreativePrelude(),
      uniforms: this.uniforms as unknown as Record<string, IUniform>,
    };
  }

  /**
   * The currently-bound legacy cube-LUT atlases for the selected IDT / ODT (the 64³
   * cube spaces — DaVinci WG, Kodak 2383, Arri-cube). PLACEHOLDER until/unless a cube
   * space is selected + loaded. The per-pixel render path (BaseImagePass) reads these
   * so cube-based IDT/ODT sample the same atlas the LUT bake would.
   */
  get idtCubeAtlas(): Texture {
    return this.uniforms.uLutIdtAtlas.value;
  }
  get odtCubeAtlas(): Texture {
    return this.uniforms.uLutOdtAtlas.value;
  }

  updateColorState(state: ColorState) {
    // The Density/Chroma/Saturation curves share one packed texture, so a change
    // to any of the three triggers a single rebuild after their diff blocks.
    let densityDirty = false;
    if (!areCurvesEqual(state.curve, this.editedCurve)) {
      if (DEBUG_ENGINE) console.log("[LUTGenerator] curve change detected, needsUpdate = true");
      this.editedCurve = {
        ...state.curve,
        points: state.curve.points.map((point) => ({ ...point })),
      };
      this.uniforms.uUseCurve.value = !state.curve.bypass && !isCurveNeutral(state.curve);
      evaluateCurveTexture(state.curve, this.curveTexture.image.data as Uint8Array);
      this.curveTexture.needsUpdate = true;
      this.needsUpdate = true;
    }

    if (!areContrastsEqual(state.contrast, this.editedContrast)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] contrast change detected, needsUpdate = true", state.contrast);
      }
      this.editedContrast = { ...state.contrast };
      this.uniforms.uUseContrast.value =
        state.contrast.enabled && !state.contrast.bypass && !isContrastNeutral(state.contrast);
      this.uniforms.uContrastAmount.value = state.contrast.amount;
      this.uniforms.uContrastPivot.value = state.contrast.pivot;
      this.needsUpdate = true;
    }

    if (!areContrastCurvesEqual(state.contrast.curve, this.editedContrastCurve)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] contrast curve change detected, needsUpdate = true");
      }
      this.editedContrastCurve = {
        ...state.contrast.curve,
        points: state.contrast.curve.points.map((point) => ({ ...point })),
      };
      this.uniforms.uUseContrastCurve.value =
        !state.contrast.curve.bypass && !isContrastCurveNeutral(state.contrast.curve);
      evaluateContrastCurveTexture(state.contrast.curve, this.contrastCurveTexture.image.data as Uint8Array);
      this.contrastCurveTexture.needsUpdate = true;
      this.needsUpdate = true;
    }

    if (!areBalancesEqual(state.balance, this.editedBalance)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] balance change detected, needsUpdate = true", state.balance);
      }
      this.editedBalance = { ...state.balance };
      this.uniforms.uUseBalance.value = state.balance.enabled && !state.balance.bypass;
      this.uniforms.uBalanceExposure.value = state.balance.exposure;
      this.uniforms.uBalanceSaturation.value = state.balance.saturation;
      this.uniforms.uTemperature.value = state.balance.temperature;
      this.uniforms.uTint.value = state.balance.tint;
      this.uniforms.uBalanceRGB.value.set(
        state.balance.red,
        state.balance.green,
        state.balance.blue,
      );
      this.needsUpdate = true;
    }

    if (!areScatteringsEqual(state.scattering, this.editedScattering)) {
      this.editedScattering = { ...state.scattering };
      const sc = state.scattering;
      this.uniforms.uUseScattering.value = sc.enabled && !sc.bypass;
      buildScatterVec4(sc.shadowX, sc.shadowY, 0, this.uniforms.uScatterShadows.value);
      buildScatterVec4(sc.highlightX, sc.highlightY, 1, this.uniforms.uScatterHighlights.value);
      this.needsUpdate = true;
    }

    if (!areRefractionsEqual(state.refraction, this.editedRefraction)) {
      const rf = state.refraction;
      this.editedRefraction = { ...rf, mapVectors: [...rf.mapVectors] };
      this.uniforms.uUseRefraction.value = rf.enabled && !rf.bypass;
      const mv = this.uniforms.uRefractMv.value;
      for (let i = 0; i < 6; i += 1) {
        mv[i].set(
          rf.mapVectors[i * 4],
          rf.mapVectors[i * 4 + 1],
          rf.mapVectors[i * 4 + 2],
          rf.mapVectors[i * 4 + 3],
        );
      }
      this.uniforms.uRefractSeparation.value = rf.separation;
      this.needsUpdate = true;
    }

    if (!areSaturationsEqual(state.saturation, this.editedSaturation)) {
      if (DEBUG_ENGINE) {
        console.log(
          "[LUTGenerator] saturation change detected, needsUpdate = true",
          state.saturation,
        );
      }
      this.editedSaturation = {
        ...state.saturation,
        curve: cloneCurveModel(state.saturation.curve),
      };
      this.uniforms.uUseSaturation.value = state.saturation.enabled && !state.saturation.bypass;
      densityDirty = true;
      this.needsUpdate = true;
    }

    if (!areRGBMixersEqual(state.rgbMixer, this.editedRGBMixer)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] rgbMixer change detected, needsUpdate = true", state.rgbMixer);
      }
      this.editedRGBMixer = {
        ...state.rgbMixer,
        red: { ...state.rgbMixer.red },
        green: { ...state.rgbMixer.green },
        blue: { ...state.rgbMixer.blue },
      };
      this.uniforms.uUseRGBMixer.value =
        state.rgbMixer.enabled && !state.rgbMixer.bypass && !isRGBMixerNeutral(state.rgbMixer);
      this.uniforms.uRGBMixerRedRow.value.set(
        state.rgbMixer.red.r,
        state.rgbMixer.red.g,
        state.rgbMixer.red.b,
      );
      this.uniforms.uRGBMixerGreenRow.value.set(
        state.rgbMixer.green.r,
        state.rgbMixer.green.g,
        state.rgbMixer.green.b,
      );
      this.uniforms.uRGBMixerBlueRow.value.set(
        state.rgbMixer.blue.r,
        state.rgbMixer.blue.g,
        state.rgbMixer.blue.b,
      );
      this.uniforms.uRGBMixerPreserveLuminance.value = state.rgbMixer.preserveLuminance;
      this.needsUpdate = true;
    }

    if (!areDensityChromasEqual(state.densityChroma, this.editedDensityChroma)) {
      if (DEBUG_ENGINE) {
        console.log(
          "[LUTGenerator] densityChroma change detected, needsUpdate = true",
          state.densityChroma,
        );
      }
      this.editedDensityChroma = {
        ...state.densityChroma,
        density: cloneCurveModel(state.densityChroma.density),
        chroma: cloneCurveModel(state.densityChroma.chroma),
      };
      const dcOn = state.densityChroma.enabled && !state.densityChroma.bypass;
      this.uniforms.uUseDensity.value = dcOn && !state.densityChroma.densityBypass;
      this.uniforms.uUseChroma.value = dcOn && !state.densityChroma.chromaBypass;
      densityDirty = true;
      this.needsUpdate = true;
    }

    if (densityDirty) {
      evaluateDensityCurves(
        state.densityChroma.density,
        state.densityChroma.chroma,
        state.saturation.curve,
        this.densityCurvesTexture.image.data as Uint8Array
      );
      this.densityCurvesTexture.needsUpdate = true;
    }

    if (!areRadiancesEqual(state.radiance, this.editedRadiance)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] radiance change detected, needsUpdate = true", state.radiance);
      }
      this.editedRadiance = {
        ...state.radiance,
        curve: cloneCurveModel(state.radiance.curve),
      };
      this.uniforms.uUseRadiance.value = state.radiance.enabled && !state.radiance.bypass;
      evaluateRadianceCurve(state.radiance.curve, this.radianceCurveTexture.image.data as Uint8Array);
      this.radianceCurveTexture.needsUpdate = true;
      this.needsUpdate = true;
    }

    if (!areTonesEqual(state.tone, this.editedTone)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] tone change detected, needsUpdate = true", state.tone);
      }
      this.editedTone = {
        ...state.tone,
        curve: cloneCurveModel(state.tone.curve),
      };
      this.uniforms.uUseTone.value = state.tone.enabled && !state.tone.bypass;
      evaluateToneCurve(state.tone.curve, this.toneCurveTexture.image.data as Uint8Array);
      this.toneCurveTexture.needsUpdate = true;
      this.needsUpdate = true;
    }

    if (!areShadowHighlightsEqual(state.shadowHighlight, this.editedShadowHighlight)) {
      if (DEBUG_ENGINE) {
        console.log(
          "[LUTGenerator] shadowHighlight change detected, needsUpdate = true",
          state.shadowHighlight,
        );
      }
      const sh = state.shadowHighlight;
      this.editedShadowHighlight = {
        ...sh,
        blackPoint: [...sh.blackPoint],
        whitePoint: [...sh.whitePoint],
      };
      this.uniforms.uUseShadowHighlight.value = sh.enabled && !sh.bypass;
      this.uniforms.uShadowHighlightBlack.value.set(
        sh.blackPoint[0],
        sh.blackPoint[1],
        sh.blackPoint[2],
      );
      this.uniforms.uShadowHighlightWhite.value.set(
        sh.whitePoint[0],
        sh.whitePoint[1],
        sh.whitePoint[2],
      );
      this.needsUpdate = true;
    }

    if (!areExposuresEqual(state.exposure, this.editedExposure)) {
      if (DEBUG_ENGINE) {
        console.log("[LUTGenerator] exposure change detected, needsUpdate = true", state.exposure);
      }
      this.editedExposure = {
        ...state.exposure,
        curve: cloneCurveModel(state.exposure.curve),
      };
      this.uniforms.uUseExposure.value = state.exposure.enabled && !state.exposure.bypass;
      evaluateExposureCurve(state.exposure.curve, this.exposureCurveTexture.image.data as Uint8Array);
      this.exposureCurveTexture.needsUpdate = true;
      this.needsUpdate = true;
    }
  }

  updateCurvePreview(input: CurvePreviewInput) {
    // One small (256x1) curve DataTexture re-upload per live curve edit — the
    // allowed hot-path cost (mutated in place, no new texture object).
    recordDataTextureUpload();
    const curveState = { bypass: false, points: input.points, mode: input.mode };
    switch (input.key) {
      case "curve":
        this.uniforms.uUseCurve.value = !isCurveNeutral(curveState as CurveState);
        evaluateCurveTexture(curveState as CurveState, this.curveTexture.image.data as Uint8Array);
        this.curveTexture.needsUpdate = true;
        this.editedCurve = { ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveState;
        break;
      case "contrast": {
        const contrastCurveState = { bypass: false, points: input.points, mode: input.mode } as ContrastCurveState;
        this.uniforms.uUseContrastCurve.value = !isContrastCurveNeutral(contrastCurveState);
        evaluateContrastCurveTexture(contrastCurveState, this.contrastCurveTexture.image.data as Uint8Array);
        this.contrastCurveTexture.needsUpdate = true;
        this.editedContrastCurve = { ...this.editedContrastCurve, ...contrastCurveState, points: input.points.map((p) => ({ ...p })) };
        break;
      }
      case "radiance":
        evaluateRadianceCurve(curveState as CurveState, this.radianceCurveTexture.image.data as Uint8Array);
        this.radianceCurveTexture.needsUpdate = true;
        this.editedRadiance.curve = { ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveState;
        break;
      case "tone":
        evaluateToneCurve(curveState as CurveState, this.toneCurveTexture.image.data as Uint8Array);
        this.toneCurveTexture.needsUpdate = true;
        this.editedTone.curve = { ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveState;
        break;
      case "exposure":
        this.uniforms.uUseExposure.value = true;
        evaluateExposureCurve(curveState as CurveState, this.exposureCurveTexture.image.data as Uint8Array);
        this.exposureCurveTexture.needsUpdate = true;
        this.editedExposure.curve = { ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveState;
        break;
      case "saturation":
        this.editedSaturation.curve = { ...this.editedSaturation.curve, ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveModel;
        evaluateDensityCurves(this.editedDensityChroma.density, this.editedDensityChroma.chroma, this.editedSaturation.curve, this.densityCurvesTexture.image.data as Uint8Array);
        this.densityCurvesTexture.needsUpdate = true;
        break;
      case "densityChroma.density":
        this.editedDensityChroma.density = { ...this.editedDensityChroma.density, ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveModel;
        evaluateDensityCurves(this.editedDensityChroma.density, this.editedDensityChroma.chroma, this.editedSaturation.curve, this.densityCurvesTexture.image.data as Uint8Array);
        this.densityCurvesTexture.needsUpdate = true;
        break;
      case "densityChroma.chroma":
        this.editedDensityChroma.chroma = { ...this.editedDensityChroma.chroma, ...curveState, points: input.points.map((p) => ({ ...p })) } as CurveModel;
        evaluateDensityCurves(this.editedDensityChroma.density, this.editedDensityChroma.chroma, this.editedSaturation.curve, this.densityCurvesTexture.image.data as Uint8Array);
        this.densityCurvesTexture.needsUpdate = true;
        break;
    }
    this.needsUpdate = true;
  }

  updateColorManagement(state: ColorManagementState) {
    const prev = this.editedColorManagement;
    if (areColorManagementsEqual(state, prev)) {
      return;
    }
    // The preview LUT is grade-only — the selected legacy IDT/ODT run per-pixel in
    // BaseImagePass and are NOT baked into it (and the Phase-28 path doesn't use the
    // legacy ids either). So an IDT/ODT-only change must NOT rebake the LUT; doing so
    // was redundant work (a 64³ atlas render + a readback/3D-upload) on every switch,
    // adding to the IDT/ODT switch lag. The cube atlases still reload below.
    const onlyTransformIdsChanged = areColorManagementsEqual(
      {
        ...state,
        inputColorSpaceId: prev.inputColorSpaceId,
        displayColorSpaceId: prev.displayColorSpaceId,
      },
      prev,
    );
    if (DEBUG_ENGINE) {
      console.log("[LUTGenerator] color management change detected", {
        onlyTransformIdsChanged,
        state,
      });
    }
    this.editedColorManagement = {
      ...state,
      toneMapping: { ...state.toneMapping },
      ocio: { ...state.ocio },
      ocioRuntime: { ...state.ocioRuntime },
    };
    this.uniforms.uColorManagementEnabled.value = state.enabled;
    this.uniforms.uUseAcesPipeline.value = state.useAcesPipeline;
    // The grade-only preview bake does NOT call the IDT/ODT (those run per-pixel in
    // BaseImagePass), so DON'T recompile this big material on every IDT/ODT change —
    // that was the IDT/ODT switch lag. The selected IDT/ODT are baked in only for the
    // full LUT export (renderFullBake → ensureColorTransformMaterial). The cube atlases still
    // load here so BaseImagePass can read them via idtCubeAtlas/odtCubeAtlas.
    this.ensureCubeAtlases(state.inputColorSpaceId, state.displayColorSpaceId);
    this.uniforms.uInputColorSpace.value = inputColorSpaceToInt[state.inputColorSpace];
    this.uniforms.uWorkingColorSpace.value = workingColorSpaceToInt[state.workingColorSpace];
    this.uniforms.uDisplayColorSpace.value = displayColorSpaceToInt[state.displayColorSpace];
    this.uniforms.uViewTransform.value = viewTransformToInt[state.viewTransform];
    this.uniforms.uUseOutputTransform.value = state.useOutputTransform;
    this.uniforms.uUseGamutMapping.value = state.useGamutMapping;
    this.uniforms.uColorManagementDebugView.value = debugViewToInt[state.debugView];
    this.uniforms.uToneMappingEnabled.value = state.toneMapping.enabled;
    this.uniforms.uToneExposureBias.value = state.toneMapping.exposureBias;
    this.uniforms.uToneHighlightCompression.value = state.toneMapping.highlightCompression;
    this.uniforms.uToneShoulderStrength.value = state.toneMapping.shoulderStrength;
    this.uniforms.uToneBlackLift.value = state.toneMapping.blackLift;

    // Gamut matrices (CPU-derived from primaries). When CM is disabled, force the
    // v1 path: srgb input -> linear-srgb working -> sRGB display (both identity).
    const effInput = state.enabled ? state.inputColorSpace : "srgb";
    const effWorking = state.enabled ? state.workingColorSpace : "linear-srgb";
    const effDisplay = state.enabled ? state.displayColorSpace : "srgb";
    const src = getSourceToWorkingMatrix(effInput, effWorking);
    const dsp = getWorkingToDisplayMatrix(effWorking, effDisplay);
    // Matrix3.set takes row-major args; our Mat3 is row-major.
    this.uniforms.uSourceToWorkingMatrix.value.set(
      src[0],
      src[1],
      src[2],
      src[3],
      src[4],
      src[5],
      src[6],
      src[7],
      src[8],
    );
    this.uniforms.uWorkingToDisplayMatrix.value.set(
      dsp[0],
      dsp[1],
      dsp[2],
      dsp[3],
      dsp[4],
      dsp[5],
      dsp[6],
      dsp[7],
      dsp[8],
    );

    // Skip the grade-only LUT rebake when only the per-pixel IDT/ODT selection changed.
    if (!onlyTransformIdsChanged) {
      this.needsUpdate = true;
    }
  }

  /**
   * Rebuilds the ShaderMaterial with the selected legacy IDT + ODT source baked
   * in (the full ~100-variant set exceeds GPU shader-compiler limits, so only the
   * chosen pair is compiled, like the legacy app). No-op if the selection is
   * unchanged. Falls back to sRGB for unknown ids.
   */
  private buildColorTransformMaterial(idtId: string, odtId: string): ShaderMaterial {
    const idtSrc = IDT_SHADER_SOURCES[idtId] ?? IDT_SHADER_SOURCES.sRGB;
    const odtSrc = ODT_SHADER_SOURCES[odtId] ?? ODT_SHADER_SOURCES.sRGB;
    const fragmentShaderSrc = this.baseFragment
      .replace(
        "// ACTIVE_IDT",
        `${idtSrc}\nvec3 activeIDT(vec3 c) { return ${inputTransformEntry(idtId)}(c); }`,
      )
      .replace(
        "// ACTIVE_ODT",
        `${odtSrc}\nvec3 activeODT(vec3 cct) { return ${displayTransformEntry(odtId)}(cct); }`,
      );
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: fragmentShaderSrc,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false,
    });
    (this.material as ShaderMaterial | undefined)?.dispose();
    this.material = mat;
    this.activeIdtId = idtId;
    this.activeOdtId = odtId;
    return mat;
  }

  private ensureColorTransformMaterial(idtId: string, odtId: string) {
    if (idtId === this.activeIdtId && odtId === this.activeOdtId) return;
    this.buildColorTransformMaterial(idtId, odtId);
    this.mesh.material = this.material;
    this.needsUpdate = true;
  }

  /**
   * For cube-LUT-based legacy spaces, lazily loads the 64³ cube atlas and binds
   * it to uLutIdtAtlas / uLutOdtAtlas. Non-cube spaces leave the placeholder
   * bound (the dispatch never samples it for them). Loads are cached + async;
   * the LUT is re-rendered once the atlas arrives.
   */
  private ensureCubeAtlases(inputId: string, displayId: string) {
    const idtLut = inputTransformLut(inputId);
    const odtLut = displayTransformLut(displayId);
    this.bindCube("uLutIdtAtlas", idtLut);
    this.bindCube("uLutOdtAtlas", odtLut);
  }

  private bindCube(uniform: "uLutIdtAtlas" | "uLutOdtAtlas", lut: string | null) {
    if (!lut) {
      this.uniforms[uniform].value = PLACEHOLDER_ATLAS;
      return;
    }
    const cached = this.cubeAtlasCache.get(lut);
    if (cached) {
      this.uniforms[uniform].value = cached;
      return;
    }
    // Bind placeholder now; swap in the real atlas when the async load resolves.
    this.uniforms[uniform].value = PLACEHOLDER_ATLAS;
    // Dedup concurrent loads of the same cube (input+output can change together).
    let load = this.inFlightCubes.get(lut);
    if (!load) {
      load = loadCubeAtlas(lut).then((tex) => {
        this.cubeAtlasCache.set(lut, tex);
        this.inFlightCubes.delete(lut);
        return tex;
      });
      this.inFlightCubes.set(lut, load);
      load.catch(() => this.inFlightCubes.delete(lut));
    }
    load
      .then((tex) => {
        // Only assign if this lut is still the selected one for this uniform.
        const stillSelected =
          uniform === "uLutIdtAtlas"
            ? inputTransformLut(this.editedColorManagement.inputColorSpaceId) === lut
            : displayTransformLut(this.editedColorManagement.displayColorSpaceId) === lut;
        if (stillSelected) {
          this.uniforms[uniform].value = tex;
          this.needsUpdate = true;
          this.onAsyncUpdate?.(); // renders are event-driven; request a frame
        }
      })
      .catch((err) => {
        if (DEBUG_ENGINE) console.warn(`[LUTGenerator] cube atlas load failed: ${lut}`, err);
      });
  }

  /**
   * Loads (and caches) a cube atlas by filename for callers that need the Texture directly —
   * e.g. an export in a different output color space whose ODT is cube-based (DWG). Reuses the
   * same `cubeAtlasCache`, so the returned texture is owned + disposed by this generator.
   */
  async getCubeAtlas(lut: string): Promise<Texture> {
    const cached = this.cubeAtlasCache.get(lut);
    if (cached) return cached;
    let load = this.inFlightCubes.get(lut);
    if (!load) {
      load = loadCubeAtlas(lut).then((tex) => {
        this.cubeAtlasCache.set(lut, tex);
        this.inFlightCubes.delete(lut);
        return tex;
      });
      this.inFlightCubes.set(lut, load);
      load.catch(() => this.inFlightCubes.delete(lut));
    }
    return load;
  }

  /**
   * Sets the baked Color Match LUT (legacy lut_cmt). `lut` is the half-float 16³
   * RGB grid from srp-static, ordered (r + g*16 + b*256)*3; null/empty disables the
   * match. The atlas is only re-uploaded when a new generation (generatedAt) lands;
   * toggling the match off/on is a one-bool uniform change.
   */
  setMatchLUT(lut: ArrayLike<number> | null, generatedAt: number) {
    const active = isValidMatchLUT(lut);
    const signature = active ? `on:${generatedAt}` : "off";
    if (signature === this.editedMatchSignature) {
      return;
    }
    this.editedMatchSignature = signature;
    this.uniforms.uUseMatchLUT.value = active;

    if (active && lut) {
      const N = MATCH_LUT_SIZE;
      if (this.matchAtlasUsesHalfFloat) {
        const data = this.matchAtlasTexture.image.data as Uint16Array;
        for (let b = 0; b < N; b += 1) {
          for (let g = 0; g < N; g += 1) {
            for (let r = 0; r < N; r += 1) {
              const src = (r + g * N + b * N * N) * 3;
              const px = b * N + r; // atlas column
              const dst = (g * MATCH_ATLAS_W + px) * 4; // row g
              data[dst] = lut[src];
              data[dst + 1] = lut[src + 1];
              data[dst + 2] = lut[src + 2];
              data[dst + 3] = HALF_ONE;
            }
          }
        }
      } else {
        const data = this.matchAtlasTexture.image.data as Uint8Array;
        for (let b = 0; b < N; b += 1) {
          for (let g = 0; g < N; g += 1) {
            for (let r = 0; r < N; r += 1) {
              const src = (r + g * N + b * N * N) * 3;
              const px = b * N + r; // atlas column
              const dst = (g * MATCH_ATLAS_W + px) * 4; // row g
              data[dst] = halfFloatBitsToByte(lut[src]);
              data[dst + 1] = halfFloatBitsToByte(lut[src + 1]);
              data[dst + 2] = halfFloatBitsToByte(lut[src + 2]);
              data[dst + 3] = 255;
            }
          }
        }
      }
      this.matchAtlasTexture.needsUpdate = true;
    }

    this.needsUpdate = true;
  }

  render() {
    if (DEBUG_ENGINE) console.log("[LUTGenerator] rendering LUT");
    const previousRenderTarget = this.renderer.getRenderTarget();
    const previousViewport = new Vector4();
    this.renderer.getViewport(previousViewport);

    this.renderer.setRenderTarget(this.renderTarget);
    // Do NOT call renderer.setViewport() to size the LUT viewport: setViewport
    // multiplies its arguments by the renderer's pixelRatio, so on HiDPI displays
    // (devicePixelRatio !== 1) it would scale the full-screen LUT quad past the
    // 512x512 render target and corrupt the atlas. setRenderTarget already sets
    // the viewport to the render target's full pixel size, which is what we want.
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousRenderTarget);
    this.renderer.setViewport(previousViewport);
    this.needsUpdate = false;
  }

  /**
   * Renders the FULL sRGB->display bake (IDT + grade + ODT) into the atlas — used
   * for standalone .cube / .clf LUT export. Preview/render normally bakes grade-only
   * (legacy-ACES) with the IDT/ODT applied per-pixel downstream; this temporarily
   * flips uBakeFull on, renders, then marks the LUT dirty so the next preview frame
   * re-renders the grade-only atlas. No-op difference when legacy-ACES is off (that
   * path always bakes the full chain).
   */
  renderFullBake() {
    // The preview keeps this material on whatever IDT/ODT it was last built with
    // (grade-only doesn't use them); ensure the SELECTED pair is compiled in for the
    // full export bake. This is the only place the IDT/ODT material recompile happens.
    this.ensureColorTransformMaterial(
      this.editedColorManagement.inputColorSpaceId,
      this.editedColorManagement.displayColorSpaceId,
    );
    const previous = this.uniforms.uBakeFull.value;
    this.uniforms.uBakeFull.value = true;
    this.render();
    this.uniforms.uBakeFull.value = previous;
    this.needsUpdate = true;
  }

  /** True when the LUT render target is 8-bit (no float support) — readback is quantized. */
  get readbackIs8Bit(): boolean {
    return !this.renderTargetIsHalfFloat;
  }

  /**
   * Reads the baked LUT atlas back to the CPU as a dense 64³ RGB grid indexed
   * (r + g*64 + b*64*64)*3. Decodes half-float when supported, else 8-bit.
   *
   * Atlas addressing matches generateLUT.frag: for grid cell (r,g,b) the source
   * pixel is px = (b % 8)*64 + r, py = floor(b / 8)*64 + g. No Y-flip is needed —
   * the LUT quad's vUv.y and the framebuffer rows both increase upward, so the
   * py the shader wrote is the py readRenderTargetPixels returns.
   *
   * Caller must ensure the LUT is current (render() if needsUpdate).
   */
  readAtlasRGB(): BakedLUT {
    const N = LUT_SIZE; // 64
    const TS = LUT_TEXTURE_SIZE; // 512
    const tiles = LUT_TILE_COUNT; // 8
    const out = new Float32Array(N * N * N * 3);

    let sample: (atlasIndex: number) => [number, number, number];

    if (this.renderTargetIsHalfFloat) {
      const raw = new Uint16Array(TS * TS * 4);
      this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, TS, TS, raw);
      sample = (i) => [
        decodeHalfFloat(raw[i]),
        decodeHalfFloat(raw[i + 1]),
        decodeHalfFloat(raw[i + 2]),
      ];
    } else {
      const raw = new Uint8Array(TS * TS * 4);
      this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, TS, TS, raw);
      sample = (i) => [raw[i] / 255, raw[i + 1] / 255, raw[i + 2] / 255];
    }

    for (let b = 0; b < N; b += 1) {
      const tileX = b % tiles;
      const tileY = Math.floor(b / tiles);
      for (let g = 0; g < N; g += 1) {
        const py = tileY * N + g;
        for (let r = 0; r < N; r += 1) {
          const px = tileX * N + r;
          const atlasIndex = (py * TS + px) * 4;
          const [cr, cg, cb] = sample(atlasIndex);
          const o = (r + g * N + b * N * N) * 3;
          out[o] = clamp01(cr);
          out[o + 1] = clamp01(cg);
          out[o + 2] = clamp01(cb);
        }
      }
    }

    return { data: out, size: N, is8Bit: !this.renderTargetIsHalfFloat };
  }

  /**
   * Reads the current 512x512 LUT atlas as RGBA8 pixels for Data3DTexture upload.
   * Half-float render targets are decoded and quantized for the Phase 31 8-bit
   * 3D texture path; the 2D atlas remains the higher-precision source of truth.
   */
  readAtlasRGBA8(): Uint8Array {
    const TS = LUT_TEXTURE_SIZE;
    const out = new Uint8Array(TS * TS * 4);

    if (this.renderTargetIsHalfFloat) {
      const raw = new Uint16Array(TS * TS * 4);
      this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, TS, TS, raw);
      for (let i = 0; i < raw.length; i += 1) {
        out[i] = Math.round(clamp01(decodeHalfFloat(raw[i])) * 255);
      }
      return out;
    }

    this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, TS, TS, out);
    return out;
  }

  /**
   * Reads the current LUT atlas as RAW half-float (RGBA16F) pixels for a half-float
   * Data3DTexture upload — preserves the render target's precision instead of the
   * quantized 8-bit readAtlasRGBA8 (steep grade curves banded at 8-bit). Returns null
   * when the render target is 8-bit (no float support), so the caller falls back.
   */
  readAtlasRGBA16F(): Uint16Array | null {
    if (!this.renderTargetIsHalfFloat) return null;
    const TS = LUT_TEXTURE_SIZE;
    const raw = new Uint16Array(TS * TS * 4);
    this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, TS, TS, raw);
    return raw;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.curveTexture.dispose();
    this.contrastCurveTexture.dispose();
    this.densityCurvesTexture.dispose();
    this.radianceCurveTexture.dispose();
    this.toneCurveTexture.dispose();
    this.exposureCurveTexture.dispose();
    this.cspLutTexture.dispose();
    this.matchAtlasTexture.dispose();
    for (const tex of this.cubeAtlasCache.values()) tex.dispose();
    this.cubeAtlasCache.clear();
    this.renderTarget.dispose();
  }

  private supportsHalfFloatSampleTextures(): boolean {
    return (
      this.renderer.capabilities.isWebGL2 || this.renderer.extensions.has("OES_texture_half_float")
    );
  }

  private getRenderTargetType() {
    const supportsWebGL2HalfFloat =
      this.renderer.capabilities.isWebGL2 && this.renderer.extensions.has("EXT_color_buffer_float");
    const supportsWebGL1HalfFloat =
      !this.renderer.capabilities.isWebGL2 &&
      this.renderer.extensions.has("OES_texture_half_float") &&
      this.renderer.extensions.has("EXT_color_buffer_half_float");

    return supportsWebGL2HalfFloat || supportsWebGL1HalfFloat ? HalfFloatType : UnsignedByteType;
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function isValidMatchLUT(lut: ArrayLike<number> | null): lut is ArrayLike<number> {
  if (!lut || lut.length !== MATCH_LUT_SIZE ** 3 * 3) return false;
  let hasNonZero = false;
  for (let i = 0; i < lut.length; i += 1) {
    const bits = lut[i];
    if (!Number.isInteger(bits) || bits < 0 || bits > 0xffff) return false;
    const value = halfFloatBitsToFloat(bits);
    if (!Number.isFinite(value) || value < 0 || value > 1) return false;
    if (bits !== 0) hasNonZero = true;
  }
  return hasNonZero;
}

function halfFloatBitsToByte(bits: number): number {
  return Math.round(clamp01(halfFloatBitsToFloat(bits)) * 255);
}

function halfFloatBitsToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  let value: number;

  if (exponent === 0) {
    value = fraction === 0 ? 0 : sign * Math.pow(2, -14) * (fraction / 1024);
  } else if (exponent === 0x1f) {
    value = fraction === 0 ? (sign > 0 ? 1 : 0) : 0;
  } else {
    value = sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
  }

  return value;
}

function buildDirectCreativePrelude(): string {
  const varyingMarker = "varying vec2 vUv;";
  const headerEnd = fragmentShader.indexOf(varyingMarker);
  const pipelineStart = fragmentShader.indexOf("vec3 applyCreativePipeline");
  const pipelineEnd = fragmentShader.indexOf("// applyOutputTransform", pipelineStart);

  const header =
    headerEnd >= 0
      ? fragmentShader.slice(0, headerEnd + varyingMarker.length)
      : "precision highp float;\nvarying vec2 vUv;";
  const creativePipeline =
    pipelineStart >= 0 && pipelineEnd > pipelineStart
      ? fragmentShader.slice(pipelineStart, pipelineEnd)
      : "";

  return `
${header}

${lumaShader}
${colorMatchShader}
${contrastShader}
${contrastCurveShader}
${colorPipelineShader}
${balanceShader}
${scatteringShader}
${refractionShader}
${rgbMixerShader}
${densityChromaShader}
${radianceShader}
${toneShader}
${shadowHighlightShader}
${exposureShader}
${spectralReprojectShader}

${creativePipeline}
`;
}

/**
 * Builds the 64×8 RGBA8 atlas for the legacy 8³ csp LUT: z-slice b occupies
 * columns [b*8, b*8+8); within a slice, x = r, y = g. Half-float source values
 * are decoded and quantized to 8-bit (the projection is a subtle correction).
 */
function buildCspAtlas(): Uint8Array {
  const N = CSP_LUT_SIZE; // 8
  const W = N * N; // 64
  const out = new Uint8Array(W * N * 4);
  for (let b = 0; b < N; b += 1) {
    for (let g = 0; g < N; g += 1) {
      for (let r = 0; r < N; r += 1) {
        const src = (r + g * N + b * N * N) * 3;
        const x = b * N + r;
        const o = (g * W + x) * 4;
        out[o] = Math.round(clamp01(decodeHalfFloat(CSP_LUT_HALF[src])) * 255);
        out[o + 1] = Math.round(clamp01(decodeHalfFloat(CSP_LUT_HALF[src + 1])) * 255);
        out[o + 2] = Math.round(clamp01(decodeHalfFloat(CSP_LUT_HALF[src + 2])) * 255);
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Decodes an IEEE-754 binary16 (half-float) bit pattern to a JS number. */
function decodeHalfFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exponent = (h & 0x7c00) >> 10;
  const fraction = h & 0x03ff;
  let value: number;
  if (exponent === 0) {
    value = fraction * Math.pow(2, -24); // subnormal
  } else if (exponent === 0x1f) {
    value = fraction === 0 ? Infinity : NaN;
  } else {
    value = (1 + fraction / 1024) * Math.pow(2, exponent - 15);
  }
  return sign ? -value : value;
}

// ── Neutrality gates ─────────────────────────────────────────────────────────
// The non-legacy extras (curve / contrast / contrast curve / RGB mixer) have no
// counterpart in the legacy chain, so a preset that neutralizes them must leave
// the baked LUT identical to legacy. Their uUse* flags therefore also require a
// non-neutral state, not just enabled && !bypass — an op that is only *nearly*
// neutral (8-bit curve-texture quantization, preserve-luminance on the LUT's
// extreme/negative-linear corners) would otherwise still run inside the bake.

function isCurveNeutral(curve: CurveState): boolean {
  // Every control point at 0 stops -> all interpolation modes yield a flat ×1.
  return curve.points.every((point) => point.y === 0);
}

function isContrastNeutral(contrast: ContrastState): boolean {
  return contrast.amount === 0; // factor = 2^0 = 1 regardless of pivot
}

// The designed modes (gain/parabola/…) scale their shape by `amount`; the manual
// point modes ignore `amount` and are flat-zero when every point sits at y = 0.
const MANUAL_CONTRAST_CURVE_MODES: ReadonlySet<ContrastCurveMode> = new Set([
  "linear",
  "cubic",
  "bezier",
]);

function isContrastCurveNeutral(curve: ContrastCurveState): boolean {
  return MANUAL_CONTRAST_CURVE_MODES.has(curve.mode)
    ? curve.points.every((point) => point.y === 0)
    : curve.amount === 0;
}

function isRGBMixerNeutral(mixer: RGBMixerState): boolean {
  // Identity rows: the mix is exact pass-through, so preserveLuminance (whose
  // luma ratio is what corrupted the LUT dark corner) never needs to run.
  return (
    mixer.red.r === 1 &&
    mixer.red.g === 0 &&
    mixer.red.b === 0 &&
    mixer.green.r === 0 &&
    mixer.green.g === 1 &&
    mixer.green.b === 0 &&
    mixer.blue.r === 0 &&
    mixer.blue.g === 0 &&
    mixer.blue.b === 1
  );
}

function areCurvesEqual(left: CurveState, right: CurveState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areContrastsEqual(left: ContrastState, right: ContrastState) {
  return (
    left.amount === right.amount &&
    left.pivot === right.pivot &&
    left.enabled === right.enabled &&
    left.bypass === right.bypass
  );
}

function areContrastCurvesEqual(left: ContrastCurveState, right: ContrastCurveState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areBalancesEqual(left: BalanceState, right: BalanceState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    left.exposure === right.exposure &&
    left.saturation === right.saturation &&
    left.temperature === right.temperature &&
    left.tint === right.tint &&
    left.red === right.red &&
    left.green === right.green &&
    left.blue === right.blue
  );
}

function curveModelsEqual(a: CurveModel, b: CurveModel): boolean {
  if (a.mode !== b.mode || a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i += 1) {
    if (a.points[i].x !== b.points[i].x || a.points[i].y !== b.points[i].y) return false;
  }
  return true;
}

function areSaturationsEqual(left: SaturationState, right: SaturationState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    curveModelsEqual(left.curve, right.curve)
  );
}

function areRGBMixersEqual(left: RGBMixerState, right: RGBMixerState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    left.red.r === right.red.r &&
    left.red.g === right.red.g &&
    left.red.b === right.red.b &&
    left.green.r === right.green.r &&
    left.green.g === right.green.g &&
    left.green.b === right.green.b &&
    left.blue.r === right.blue.r &&
    left.blue.g === right.blue.g &&
    left.blue.b === right.blue.b &&
    left.preserveLuminance === right.preserveLuminance
  );
}

function areDensityChromasEqual(left: DensityChromaState, right: DensityChromaState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    !!left.densityBypass === !!right.densityBypass &&
    !!left.chromaBypass === !!right.chromaBypass &&
    curveModelsEqual(left.density, right.density) &&
    curveModelsEqual(left.chroma, right.chroma)
  );
}

function areColorManagementsEqual(left: ColorManagementState, right: ColorManagementState) {
  return (
    left.enabled === right.enabled &&
    left.useAcesPipeline === right.useAcesPipeline &&
    left.inputColorSpaceId === right.inputColorSpaceId &&
    left.displayColorSpaceId === right.displayColorSpaceId &&
    left.inputColorSpace === right.inputColorSpace &&
    left.workingColorSpace === right.workingColorSpace &&
    left.displayColorSpace === right.displayColorSpace &&
    left.viewTransform === right.viewTransform &&
    left.useOutputTransform === right.useOutputTransform &&
    left.useGamutMapping === right.useGamutMapping &&
    left.debugView === right.debugView &&
    left.toneMapping.enabled === right.toneMapping.enabled &&
    left.toneMapping.exposureBias === right.toneMapping.exposureBias &&
    left.toneMapping.highlightCompression === right.toneMapping.highlightCompression &&
    left.toneMapping.shoulderStrength === right.toneMapping.shoulderStrength &&
    left.toneMapping.blackLift === right.toneMapping.blackLift
  );
}

function areRadiancesEqual(left: RadianceState, right: RadianceState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    curveModelsEqual(left.curve, right.curve)
  );
}

function areTonesEqual(left: ToneState, right: ToneState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    curveModelsEqual(left.curve, right.curve)
  );
}

function areExposuresEqual(left: ExposureState, right: ExposureState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    curveModelsEqual(left.curve, right.curve)
  );
}

// blackLinked/whiteLinked are UI-only (they don't affect the render), so they
// are deliberately excluded from this render-dirty comparison.
function areShadowHighlightsEqual(left: ShadowHighlightState, right: ShadowHighlightState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    left.blackPoint[0] === right.blackPoint[0] &&
    left.blackPoint[1] === right.blackPoint[1] &&
    left.blackPoint[2] === right.blackPoint[2] &&
    left.whitePoint[0] === right.whitePoint[0] &&
    left.whitePoint[1] === right.whitePoint[1] &&
    left.whitePoint[2] === right.whitePoint[2]
  );
}

function mapVectorsToVec4(mv: number[]): Vector4[] {
  const out: Vector4[] = [];
  for (let i = 0; i < 6; i += 1) {
    out.push(new Vector4(mv[i * 4], mv[i * 4 + 1], mv[i * 4 + 2], mv[i * 4 + 3]));
  }
  return out;
}

function areRefractionsEqual(left: RefractionState, right: RefractionState) {
  if (
    left.enabled !== right.enabled ||
    left.bypass !== right.bypass ||
    left.separation !== right.separation ||
    left.preserveLuminance !== right.preserveLuminance
  ) {
    return false;
  }
  for (let i = 0; i < 24; i += 1) {
    if (left.mapVectors[i] !== right.mapVectors[i]) return false;
  }
  return true;
}

function areScatteringsEqual(left: ScatteringState, right: ScatteringState) {
  return (
    left.enabled === right.enabled &&
    left.bypass === right.bypass &&
    left.shadowX === right.shadowX &&
    left.shadowY === right.shadowY &&
    left.highlightX === right.highlightX &&
    left.highlightY === right.highlightY &&
    left.balance === right.balance &&
    left.preserveLuminance === right.preserveLuminance
  );
}

// Legacy scattering ambient-tint palette (package.min.js `Nf.ii`): 16 RGB stops
// of partly-desaturated spectrum colour sampled around the wheel by hue. The
// sk8 shader expects these baked tints — they are NOT the saturated CSS
// --spectrum-* swatches used to paint the wheel UI.
const SCATTER_PALETTE: number[] = [
  0.7241065241966241, 0.38032959880647427, 0.34893263968361626, 0.7835911868134677,
  0.5300864625456815, 0.2766857286769332, 0.8271730047148866, 0.6787247844882949,
  0.18326072978879046, 0.8300257270376946, 0.8174593916039772, 0.13592703408556722,
  0.7406067120307717, 0.8372307837782795, 0.34289432442093193, 0.6539930498811265,
  0.8369045991706899, 0.48298164483906014, 0.5564548549841858, 0.8418846940401803,
  0.6307019025287327, 0.4244593376605096, 0.8383847426091521, 0.7833550941371147, 0.360113919906843,
  0.8208607739878486, 0.9081093742083968, 0.5220658424842441, 0.7993179189046314,
  0.9583201462123344, 0.6398980209684421, 0.7601588749163941, 0.9565857000218989,
  0.7212096931791545, 0.7109022154458666, 0.9461554300141622, 0.7302135229590574,
  0.6171260999547182, 0.910414970864051, 0.7405137392866862, 0.4942038730729897, 0.8095220428319969,
  0.7350935645049326, 0.36828980677764583, 0.6505922452623222, 0.7225540492264427,
  0.3421089635952578, 0.49381191031819593,
];
const SCATTER_PALETTE_STOPS = SCATTER_PALETTE.length / 3; // 16

/**
 * Faithful legacy build of a scattering shadow/highlight vec4 from a wheel point
 * in [0,1]² (center 0.5,0.5 = neutral). Reproduces the legacy `Of` (point ->
 * angle/distance) + `Nf` (palette interpolation) verbatim so engine output
 * matches Poto for any stored wheel point, including legacy preset data.
 *   index 0 = shadows  (tint = distance * palette, neutral -> black)
 *   index 1 = highlights (tint = lerp(white, palette, distance))
 * Output: out.xyz = ambient tint, out.w = wheel hue in [0,1].
 */
function buildScatterVec4(x: number, y: number, index: 0 | 1, out: Vector4): void {
  const i = 2 * x - 1;
  const o = 2 * y - 1;
  const angle = ((Math.atan2(i, o) * 180) / Math.PI + 360) % 360;
  const distance = Math.min(1, Math.hypot(i, o));
  const hue = angle / 360;
  const ambient = (1 - distance) * index;
  const r = hue * SCATTER_PALETTE_STOPS;
  const l = Math.floor(r);
  const c = 3 * l;
  const h = 3 * ((l + 1) % SCATTER_PALETTE_STOPS);
  const u = r - l;
  const f = 1 - u;
  out.set(
    ambient + distance * (SCATTER_PALETTE[c] * f + SCATTER_PALETTE[h] * u),
    ambient + distance * (SCATTER_PALETTE[c + 1] * f + SCATTER_PALETTE[h + 1] * u),
    ambient + distance * (SCATTER_PALETTE[c + 2] * f + SCATTER_PALETTE[h + 2] * u),
    hue,
  );
}
