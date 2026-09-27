import {
  HalfFloatType,
  Texture,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
  type TextureDataType,
} from "three";
import type { DirectCreativeShader } from "../lut/LUTGenerator";
import type { LUTTextureHandle, LUTTextureKind } from "../lut/LUTStorageTypes";
import type {
  DistortState,
  FXQuality,
  ImageFXState,
  RetouchState,
  TransformState,
} from "../state/EditState";
import { DEFAULT_DISTORT_STATE } from "../../features/distort/distortStore";
import { DEFAULT_RETOUCH_STATE } from "../../features/retouch/retouchTypes";
import type { LUTInterpolationMode } from "../passes/IntegrationPass";
import { RenderTargetPool } from "./RenderTargetPool";
import { BaseImagePass } from "../passes/fx/BaseImagePass";
import { ColorTransformPass } from "../passes/fx/ColorTransformPass";
import { LocalAdjustmentPass } from "../passes/fx/LocalAdjustmentPass";
import { ColorMaskPass } from "../passes/masking/ColorMaskPass";
import { RadialMaskPass } from "../passes/masking/RadialMaskPass";
import { GradientMaskPass } from "../passes/masking/GradientMaskPass";
import { BrushMaskTexturePass } from "../passes/masking/BrushMaskTexturePass";
import { BrushMaskPass } from "../passes/masking/BrushMaskPass";
import { LuminanceMaskPass } from "../passes/masking/LuminanceMaskPass";
import { DepthMaskPass } from "../passes/masking/DepthMaskPass";
import { HalationExtractPass } from "../passes/fx/HalationExtractPass";
import { DiffusionExtractPass } from "../passes/fx/DiffusionExtractPass";
import { BlurPass } from "../passes/fx/BlurPass";
import { CompositePass } from "../passes/fx/CompositePass";
import { GrainPass, type GrainViewport } from "../passes/fx/GrainPass";
import { SpotlightPass } from "../passes/fx/SpotlightPass";
import {
  EdgeAwareSmoothPass,
  type EdgeAwareSmoothOptions,
} from "../passes/retouch/EdgeAwareSmoothPass";
import { RetouchContextPass } from "../passes/retouch/RetouchContextPass";

import {
  AcutancePass,
  SharpenPass,
  SoftenPass,
  type TextureDetailViewport,
} from "../passes/fx/TextureDetailPasses";
import { PyramidFXPass } from "../passes/fx/PyramidFXPass";

export const DEBUG_FX_PIPELINE = false;

const HALATION_BLUR_PX = 40;
const DIFFUSION_BLUR_PX = 24;
const USE_PYRAMID_FX = true;
// Keep the source residual edge-aware and the destination context local. Larger
// radii turn buildings and lights into visible streaks inside broad Heal spots.
const RETOUCH_SOURCE_DETAIL_SMOOTH: EdgeAwareSmoothOptions = {
  sampleSpacing: 1.5,
  spatialFalloff: 0.28,
  rangeFalloff: 48,
  centerWeight: 5,
};
const RETOUCH_CONTEXT_BLUR_RADIUS = 0.35;

export type FXPipelineCounters = {
  basePassRenderCount: number;
  halationPassCount: number;
  diffusionPassCount: number;
  spotlightPassCount: number;

  textureDetailPassCount: number;
  blurPassCount: number;
  finalCompositeCount: number;
};

export type EngineDebugView =
  | "input"
  | "after-transform"
  | "after-idt"
  | "after-color"
  | "after-spotlight"
  | "after-acutance"
  | "after-diffusion"
  | "after-halation"

  | "after-grain"
  | "after-soften"
  | "after-sharpen"
  | "before-odt"
  | "after-odt"
  | "final";

export type FXPipelineRenderParams = {
  imageTexture: Texture;
  sourceWidth?: number;
  sourceHeight?: number;
  width: number;
  height: number;
  outputViewport?: {
    x: number;
    y: number;
    width: number;
    height: number;
    fullWidth: number;
    fullHeight: number;
  };
  lutHandle: LUTTextureHandle;
  transform: TransformState;
  distort?: DistortState;
  retouch?: RetouchState;
  fxState: ImageFXState;
  lutInterpolationMode: LUTInterpolationMode;
  lutKind: LUTTextureKind;
  useLUT?: boolean;
  localLUTs?: Array<{
    layer: import("../state/EditState").LocalAdjustmentLayer;
    handle: LUTTextureHandle | null | undefined;
  }>;
  /** Optional depth texture for Depth Mask local adjustments. */
  depthTexture?: Texture | null;
  // ACES pipeline per-pixel IDT/ODT selection. When useAcesPipeline is true the LUT is
  // grade-only, a small IDT pass feeds BaseImagePass, and a small ODT pass follows it.
  // idtAtlas/odtAtlas are the loaded cube-LUT atlases for cube-based spaces.
  colorManagement?: {
    useAcesPipeline: boolean;
    inputColorSpaceId: string;
    displayColorSpaceId: string;
    idtAtlas?: Texture | null;
    odtAtlas?: Texture | null;
  };
  directCreativeShader?: DirectCreativeShader | null;
  previewZoom?: number;
  grainViewport?: GrainViewport;
  exportQuality?: FXQuality;
  // When true (export mode), keep intermediate grading/FX targets in half-float.
  // The encoder may preserve that precision or quantize once for an 8-bit format.
  exportFloat?: boolean;
  renderTargetType?: TextureDataType;
  debugView?: EngineDebugView;
};

export class FXPipeline {
  private readonly renderer: WebGLRenderer;
  private readonly pool = new RenderTargetPool();
  private readonly baseImagePass = new BaseImagePass();
  private readonly colorMaskPass = new ColorMaskPass();
  private readonly radialMaskPass = new RadialMaskPass();
  private readonly gradientMaskPass = new GradientMaskPass();
  private readonly brushMaskTexturePass = new BrushMaskTexturePass();
  private readonly brushMaskPass = new BrushMaskPass();
  public readonly luminanceMaskPass = new LuminanceMaskPass();
  private readonly depthMaskPass = new DepthMaskPass();
  private readonly localAdjustmentPass = new LocalAdjustmentPass();
  private readonly inputTransformPass = new ColorTransformPass("idt");
  private readonly displayTransformPass = new ColorTransformPass("odt");
  private readonly pyramidFXPass = new PyramidFXPass();
  private readonly halationExtractPass = new HalationExtractPass();
  private readonly diffusionExtractPass = new DiffusionExtractPass();
  private readonly blurPass = new BlurPass();
  private readonly compositePass = new CompositePass();
  private readonly grainPass = new GrainPass();
  private readonly spotlightPass = new SpotlightPass();
  private readonly edgeAwareSmoothPass = new EdgeAwareSmoothPass();
  private readonly retouchContextPass = new RetouchContextPass();

  private readonly acutancePass = new AcutancePass();
  private readonly sharpenPass = new SharpenPass();
  private readonly softenPass = new SoftenPass();
  private readonly counters: FXPipelineCounters = {
    basePassRenderCount: 0,
    halationPassCount: 0,
    diffusionPassCount: 0,
    spotlightPassCount: 0,

    textureDetailPassCount: 0,
    blurPassCount: 0,
    finalCompositeCount: 0,
  };

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  renderPreview(params: FXPipelineRenderParams): WebGLRenderTarget {
    return this.render(params, "preview");
  }

  renderExport(params: FXPipelineRenderParams): WebGLRenderTarget {
    return this.render(params, "export");
  }

  renderScopes(params: FXPipelineRenderParams): WebGLRenderTarget {
    return this.render(params, "scopes");
  }

  /**
   * Background-compiles the default small legacy-ACES transform shaders.
   */
  prewarmColorPipeline(idtId = "sRGB", odtId = "sRGB"): void {
    this.inputTransformPass.prewarm(this.renderer, [idtId]);
    this.displayTransformPass.prewarm(this.renderer, [odtId]);
  }

  /**
   * Background-compiles common small legacy IDT/ODT color materials so switching to
   * them later hits the cache. Best-effort.
   */
  prewarmColors(combos: ReadonlyArray<{ idtId: string; odtId: string }>): void {
    this.inputTransformPass.prewarm(this.renderer, [
      ...new Set(combos.map((combo) => combo.idtId)),
    ]);
    this.displayTransformPass.prewarm(this.renderer, [
      ...new Set(combos.map((combo) => combo.odtId)),
    ]);
  }

  /** Kept for the engine's older color-ready hook; color transform swaps are immediate. */
  setColorReadyCallback(callback: () => void): void {
    void callback;
  }

  resize(width: number, height: number) {
    void width;
    void height;
  }

  getDebugCounters(): FXPipelineCounters {
    return { ...this.counters };
  }

  dispose() {
    this.baseImagePass.dispose();
    this.colorMaskPass.dispose();
    this.radialMaskPass.dispose();
    this.gradientMaskPass.dispose();
    this.brushMaskTexturePass.dispose();
    this.brushMaskPass.dispose();
    this.localAdjustmentPass.dispose();
    this.inputTransformPass.dispose();
    this.displayTransformPass.dispose();
    this.pyramidFXPass.dispose();
    this.halationExtractPass.dispose();
    this.diffusionExtractPass.dispose();
    this.blurPass.dispose();
    this.compositePass.dispose();
    this.grainPass.dispose();
    this.spotlightPass.dispose();
    this.edgeAwareSmoothPass.dispose();
    this.retouchContextPass.dispose();

    this.acutancePass.dispose();
    this.sharpenPass.dispose();
    this.softenPass.dispose();
    this.pool.dispose();
  }

  private render(
    params: FXPipelineRenderParams,
    mode: "preview" | "export" | "scopes",
  ): WebGLRenderTarget {
    const width = Math.max(1, Math.floor(params.width));
    const height = Math.max(1, Math.floor(params.height));
    // Half-float RTs for 16-bit export so precision survives the pass chain.
    const rtType: TextureDataType =
      params.renderTargetType ??
      (mode === "export" && params.exportFloat ? HalfFloatType : UnsignedByteType);
    const baseTarget = this.pool.get(`${mode}:base`, width, height, rtType);

    const cm = params.colorManagement;
    const useAcesPipeline = cm?.useAcesPipeline ?? false;
    const detailViewport: TextureDetailViewport | undefined =
      mode === "preview" ? params.grainViewport : undefined;
    if (params.debugView === "input") {
      return this.renderTransformOnly(params, params.imageTexture, width, height, mode, rtType);
    }

    // sourceWidth/Height are the LOGICAL source dimensions — they drive the base
    // pass's transform/crop UV math and must stay full-size regardless of the IDT
    // texture's pixel resolution (the IDT result is sampled 0..1).
    const sourceWidth = Math.max(1, Math.floor(params.sourceWidth ?? width));
    const sourceHeight = Math.max(1, Math.floor(params.sourceHeight ?? height));
    // Tiled exports sample the IDT with global source UVs, so the export IDT must
    // render at full source resolution. Preview/scopes are NOT tiled, so they render
    // the IDT at the (draft-capped) preview size: for a large RAW this avoids a
    // full-resolution IDT pass (~24M fragments for a 24 MP file) on every draft
    // frame — the dominant per-frame cost that made RAW panel drags lag.
    const idtWidth = mode === "export" ? sourceWidth : width;
    const idtHeight = mode === "export" ? sourceHeight : height;
    const idtTarget = useAcesPipeline
      ? this.renderInputTransform(params.imageTexture, cm, idtWidth, idtHeight, mode, rtType)
      : null;
    if (params.debugView === "after-idt") {
      return (
        idtTarget ??
        this.renderTransformOnly(params, params.imageTexture, width, height, mode, rtType)
      );
    }
    const sourceTexture = idtTarget?.texture ?? params.imageTexture;

    if (params.debugView === "after-transform") {
      return this.renderTransformOnly(params, sourceTexture, width, height, mode, rtType);
    }

    const retouch = params.retouch ?? DEFAULT_RETOUCH_STATE;
    const hasRetouch = retouch.enabled && !retouch.bypass && retouch.spots.length > 0;
    const needsHealTextures =
      hasRetouch && retouch.spots.some((spot) => !spot.disabled && spot.mode === 1);
    const sourceSmoothScale = Math.min(1, 1024 / Math.max(1, sourceWidth, sourceHeight));
    const sourceSmoothWidth = Math.max(1, Math.round(sourceWidth * sourceSmoothScale));
    const sourceSmoothHeight = Math.max(1, Math.round(sourceHeight * sourceSmoothScale));
    const retouchContextScale = Math.min(1, 1024 / Math.max(1, width, height));
    const retouchContextWidth = Math.max(1, Math.round(width * retouchContextScale));
    const retouchContextHeight = Math.max(1, Math.round(height * retouchContextScale));
    const outputViewport = params.outputViewport;
    const normalizedOutputViewport = outputViewport
      ? {
          x: outputViewport.x / outputViewport.fullWidth,
          y: outputViewport.y / outputViewport.fullHeight,
          width: outputViewport.width / outputViewport.fullWidth,
          height: outputViewport.height / outputViewport.fullHeight,
        }
      : { x: 0, y: 0, width: 1, height: 1 };
    const sourceSmoothTarget = needsHealTextures
      ? this.pool.get(
          `${mode}:retouch-source-smooth`,
          sourceSmoothWidth,
          sourceSmoothHeight,
          rtType,
        )
      : null;
    const retouchContextBase = needsHealTextures
      ? this.pool.get(
          `${mode}:retouch-context-base`,
          retouchContextWidth,
          retouchContextHeight,
          rtType,
        )
      : null;
    const retouchContextTemp = needsHealTextures
      ? this.pool.get(
          `${mode}:retouch-context-temp`,
          retouchContextWidth,
          retouchContextHeight,
          rtType,
        )
      : null;
    const retouchContextOutput = needsHealTextures
      ? this.pool.get(
          `${mode}:retouch-context-output`,
          retouchContextWidth,
          retouchContextHeight,
          rtType,
        )
      : null;
    if (
      sourceSmoothTarget &&
      retouchContextBase &&
      retouchContextTemp &&
      retouchContextOutput
    ) {
      this.edgeAwareSmoothPass.render(
        this.renderer,
        sourceTexture,
        sourceSmoothTarget,
        sourceSmoothWidth,
        sourceSmoothHeight,
        RETOUCH_SOURCE_DETAIL_SMOOTH,
      );
      this.retouchContextPass.render(
        this.renderer,
        sourceTexture,
        retouchContextBase,
        sourceWidth,
        sourceHeight,
        params.transform,
        params.distort ?? DEFAULT_DISTORT_STATE,
        retouch,
        normalizedOutputViewport,
      );
      this.blurPass.render(
        this.renderer,
        retouchContextBase.texture,
        retouchContextTemp,
        retouchContextOutput,
        RETOUCH_CONTEXT_BLUR_RADIUS,
      );
    }

    this.baseImagePass.setImageTexture(sourceTexture, sourceWidth, sourceHeight);
    this.baseImagePass.setLUTStorageMode(params.lutKind);
    this.baseImagePass.setDirectCreativeShader(params.directCreativeShader ?? null);
    // Direct legacy creative currently fails on some preview GPU paths; keep the
    // known-good LUT path live until the direct shader can be compile-verified.
    this.baseImagePass.setUseDirectCreativeShader(false);
    this.baseImagePass.setLUTHandle(params.lutHandle);
    this.baseImagePass.setUseLUT(useAcesPipeline ? false : (params.useLUT ?? true));
    this.baseImagePass.setAcesLinearInput(useAcesPipeline);
    this.baseImagePass.setApplyTransform(true);
    this.baseImagePass.setFlipSourceY(true);
    this.baseImagePass.setExportViewport(
      normalizedOutputViewport.x,
      normalizedOutputViewport.y,
      normalizedOutputViewport.width,
      normalizedOutputViewport.height,
    );
    this.baseImagePass.setLUTInterpolationMode(params.lutInterpolationMode);
    this.baseImagePass.updateTransformState(params.transform);
    this.baseImagePass.updateDistortState(params.distort ?? DEFAULT_DISTORT_STATE);
    this.baseImagePass.updateRetouchState(
      retouch,
      sourceSmoothTarget?.texture ?? sourceTexture,
      retouchContextOutput?.texture ?? sourceTexture,
    );
    this.baseImagePass.render(this.renderer, baseTarget, width, height);
    this.counters.basePassRenderCount += 1;

    let current = baseTarget;

    this.brushMaskTexturePass.retain(
      (params.localLUTs ?? [])
        .filter((local) => local.layer.components[0]?.type === "brush")
        .map((local) => local.layer.id),
    );

    if (params.localLUTs && params.localLUTs.length > 0) {
      for (const local of params.localLUTs) {
        if (!local.layer.enabled) continue;

        const component = local.layer.components[0];

        if (!component) {
          console.warn("[FXPipeline] LocalAdjustmentLayer has no components:", local.layer.id);
          continue;
        }

        if ((component.opacity ?? 1) <= 0) continue;

        if (!local.handle?.texture) {
          console.warn("[FXPipeline] Local adjustment has no LUT texture:", local.layer.id);
          continue;
        }

        const localTarget = this.pool.get(
          `${mode}:local_${local.layer.id}`,
          width,
          height,
          rtType,
        );

        // Route mask type to the correct pass.
        let maskTarget: import("three").WebGLRenderTarget | null | undefined;

        if (component.type === "radial") {
          this.radialMaskPass.setCanvasSize(width, height);
          maskTarget = this.radialMaskPass.render(
            this.renderer,
            {
              position: component.position,
              size:     component.size,
              angle:    component.angle,
              feather:  component.feather,
              invert:   component.invert,
              opacity:  component.opacity ?? 1,
              alpha:    component.alpha ?? 1,
            },
            sourceWidth,
            sourceHeight,
          );
        } else if (component.type === "gradient") {
          this.gradientMaskPass.setCanvasSize(width, height);
          maskTarget = this.gradientMaskPass.render(
            this.renderer,
            {
              startPoint: (component as any).startPoint,
              endPoint:   (component as any).endPoint,
              reflect:    (component as any).reflect,
              invert:     component.invert,
              opacity:    component.opacity,
              alpha:      component.alpha,
            },
          );
        } else if (component.type === "brush") {
          const brushComp = component as import("../state/EditState").BrushMaskComponent;
          const brushTarget = this.brushMaskTexturePass.getOrBuildTexture({
            renderer:       this.renderer,
            sourceTexture:  current.texture,
            sourceWidth,
            sourceHeight,
            maskId:         local.layer.id,
            component:      brushComp,
            liveStroke:     null,
          });
          this.brushMaskPass.setCanvasSize(width, height);
          maskTarget = this.brushMaskPass.render(
            this.renderer,
            brushTarget.texture,
            brushComp,
          );
        } else if (component.type === "luminance") {
          const lumComp = component as import("../state/EditState").LuminanceMaskComponent;
          this.luminanceMaskPass.setCanvasSize(width, height);
          maskTarget = this.luminanceMaskPass.render(
            this.renderer,
            current.texture,
            {
              target:     lumComp.target,
              range:      lumComp.range,
              smoothness: lumComp.smoothness,
              invert:     lumComp.invert,
              opacity:    lumComp.opacity ?? 1,
              alpha:      lumComp.alpha ?? 1,
            },
          );
        } else if (component.type === "depth") {
          const depthComp = component as import("../state/EditState").DepthMaskComponent;
          const depthTex = params.depthTexture;
          if (!depthTex) {
            // No depth data — skip this layer entirely rather than producing a full-image mask.
            console.warn("[FXPipeline] Depth mask skipped: no depthTexture in render params", local.layer.id);
            continue;
          }
          this.depthMaskPass.setCanvasSize(width, height);
          maskTarget = this.depthMaskPass.render(
            this.renderer,
            depthTex,
            {
              target:  depthComp.target,
              range:   depthComp.range,
              invert:  depthComp.invert,
              opacity: depthComp.opacity ?? 1,
              alpha:   depthComp.alpha ?? 1,
            },
          );
        } else {
          this.colorMaskPass.setCanvasSize(width, height);
          maskTarget = this.colorMaskPass.render(
            this.renderer,
            current.texture,
            component,
            baseTarget.texture,
          );
        }


        if (!maskTarget?.texture) {
          console.warn("[FXPipeline] ColorMaskPass returned no mask texture:", local.layer.id);
          continue;
        }

        this.localAdjustmentPass.setImage(current.texture, sourceWidth, sourceHeight);
        this.localAdjustmentPass.setMaskTexture(maskTarget.texture);
        this.localAdjustmentPass.setLayer(local.layer, sourceWidth, sourceHeight);
        this.localAdjustmentPass.setLUTHandle(local.handle);

        // FIX: params.acesLinearInput does not exist.
        // Local adjustment input is ACES-linear only when the ACES pipeline is enabled.
        this.localAdjustmentPass.setAcesLinearInput(useAcesPipeline);

        this.localAdjustmentPass.render(this.renderer, localTarget);

        current = localTarget;
      }
    }

    if (!useAcesPipeline && params.debugView === "after-color") {
      return current;
    }

    // Legacy FX render order (`Vd.push(Au, Ou, Gu, Yu, of, Qu, Ku)`):
    // spotlight → acutance → diffusion → halation → grain → soften → sharpen.
    if (isSpotlightActive(params.fxState)) {
      const spotlight = this.pool.get(`${mode}:spotlight`, width, height, rtType);
      this.spotlightPass.render(
        this.renderer,
        current.texture,
        spotlight,
        width,
        height,
        params.fxState.spotlight,
        outputViewport,
      );
      this.counters.spotlightPassCount += 1;
      current = spotlight;
    }
    if (params.debugView === "after-spotlight") return current;

    if (isAcutanceActive(params.fxState)) {
      const acutance = this.pool.get(`${mode}:acutance`, width, height, rtType);
      this.acutancePass.render(
        this.renderer,
        current.texture,
        acutance,
        width,
        height,
        params.fxState.grain.acutance,
        detailViewport,
      );
      this.counters.textureDetailPassCount += 1;
      current = acutance;
    }
    if (params.debugView === "after-acutance") return current;

    if (isDiffusionActive(params.fxState)) {
      current = USE_PYRAMID_FX
        ? this.applyPyramidDiffusion(params, current, width, height, mode, rtType)
        : this.applyDiffusion(params, current, width, height, mode, rtType);
    }
    if (params.debugView === "after-diffusion") return current;

    if (isHalationActive(params.fxState)) {
      current = USE_PYRAMID_FX
        ? this.applyPyramidHalation(params, current, width, height, mode, rtType)
        : this.applyHalation(params, current, width, height, mode, rtType);
    }
    if (params.debugView === "after-halation") return current;



    // Grain — always run (it copies when inactive), then the resolution-coupled soften/sharpen.
    const finalTarget = this.pool.get(`${mode}:final`, width, height, rtType);
    const grainState =
      mode === "export"
        ? params.fxState.grain
        : {
          ...params.fxState.grain,
          amount: params.fxState.grain.amount * previewGrainAmountScale(params.previewZoom ?? 1),
        };
    this.grainPass.render(
      this.renderer,
      current.texture,
      finalTarget,
      width,
      height,
      grainState,
      mode === "preview" ? params.grainViewport : undefined,
      outputViewport,
    );
    this.counters.finalCompositeCount += 1;
    current = finalTarget;
    if (params.debugView === "after-grain") return current;

    // Film Resolution couples to softening (<0.5) / sharpening (>0.5) AFTER grain.
    const tex = params.fxState.grain;
    const textureOn = tex.enabled && !tex.bypass;
    if (textureOn && tex.resolution < 0.5) {
      const softA = this.pool.get(`${mode}:soften-a`, width, height, rtType);
      const softB = this.pool.get(`${mode}:soften-b`, width, height, rtType);
      const amount = 1 - 2 * tex.resolution;
      this.softenPass.render(
        this.renderer,
        current.texture,
        softA,
        width,
        height,
        amount,
        detailViewport,
      );
      this.softenPass.render(
        this.renderer,
        softA.texture,
        softB,
        width,
        height,
        amount,
        detailViewport,
      );
      this.softenPass.render(
        this.renderer,
        softB.texture,
        softA,
        width,
        height,
        amount,
        detailViewport,
      );
      this.counters.textureDetailPassCount += 3;
      current = softA;
    }
    if (params.debugView === "after-soften") return current;
    if (textureOn && tex.resolution > 0.5) {
      const sharp = this.pool.get(`${mode}:sharpen`, width, height, rtType);
      this.sharpenPass.render(
        this.renderer,
        current.texture,
        sharp,
        width,
        height,
        2 * (tex.resolution - 0.5),
        detailViewport,
      );
      this.counters.textureDetailPassCount += 1;
      current = sharp;
    }
    if (params.debugView === "after-sharpen") return current;

    if (useAcesPipeline) {
      current = this.renderCreativeGrade(params, current.texture, width, height, mode, rtType);
      this.counters.basePassRenderCount += 1;
    }

    if (params.debugView === "after-color") return current;
    if (params.debugView === "before-odt") return current;

    if (useAcesPipeline) {
      current = this.renderDisplayTransform(current.texture, cm, width, height, mode, rtType);
    }

    if (params.debugView === "after-odt") return current;

    if (DEBUG_FX_PIPELINE) {
      console.log("[FXPipeline]", mode, this.counters);
    }

    return current;
  }

  private renderTransformOnly(
    params: FXPipelineRenderParams,
    imageTexture: Texture,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const target = this.pool.get(`${mode}:debug:transform`, width, height, rtType);
    this.baseImagePass.setImageTexture(
      imageTexture,
      params.sourceWidth ?? width,
      params.sourceHeight ?? height,
    );
    this.baseImagePass.setLUTStorageMode(params.lutKind);
    this.baseImagePass.setDirectCreativeShader(null);
    this.baseImagePass.setUseDirectCreativeShader(false);
    this.baseImagePass.setLUTHandle(params.lutHandle);
    this.baseImagePass.setUseLUT(false);
    this.baseImagePass.setAcesLinearInput(params.colorManagement?.useAcesPipeline ?? false);
    this.baseImagePass.setApplyTransform(true);
    this.baseImagePass.setFlipSourceY(true);
    this.baseImagePass.setLUTInterpolationMode(params.lutInterpolationMode);
    this.baseImagePass.updateTransformState(params.transform);
    this.baseImagePass.updateDistortState(params.distort ?? DEFAULT_DISTORT_STATE);
    this.baseImagePass.updateRetouchState(DEFAULT_RETOUCH_STATE, imageTexture);
    this.baseImagePass.render(this.renderer, target, width, height);
    return target;
  }

  private renderCreativeGrade(
    params: FXPipelineRenderParams,
    inputTexture: Texture,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const target = this.pool.get(`${mode}:aces-grade`, width, height, rtType);
    this.baseImagePass.setImageTexture(inputTexture, width, height);
    this.baseImagePass.setLUTStorageMode(params.lutKind);
    this.baseImagePass.setDirectCreativeShader(params.directCreativeShader ?? null);
    // Keep the compiled grade-LUT path active until the direct If shader path is
    // verified on the same GPU paths. The order still matches legacy: FX -> If -> Pd.
    this.baseImagePass.setUseDirectCreativeShader(false);
    this.baseImagePass.setLUTHandle(params.lutHandle);
    this.baseImagePass.setUseLUT(params.useLUT ?? true);
    this.baseImagePass.setAcesLinearInput(true);
    this.baseImagePass.setApplyTransform(false);
    this.baseImagePass.setFlipSourceY(false);
    this.baseImagePass.setLUTInterpolationMode(params.lutInterpolationMode);
    this.baseImagePass.updateTransformState(params.transform);
    this.baseImagePass.updateDistortState(DEFAULT_DISTORT_STATE);
    this.baseImagePass.updateRetouchState(DEFAULT_RETOUCH_STATE, inputTexture);
    this.baseImagePass.render(this.renderer, target, width, height);
    return target;
  }

  private renderInputTransform(
    imageTexture: Texture,
    colorManagement: NonNullable<FXPipelineRenderParams["colorManagement"]> | undefined,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const target = this.pool.get(`${mode}:input-transform`, width, height, rtType);
    this.inputTransformPass.setTransform(
      this.renderer,
      colorManagement?.inputColorSpaceId ?? "sRGB",
    );
    this.inputTransformPass.setCubeAtlases(
      colorManagement?.idtAtlas ?? null,
      colorManagement?.odtAtlas ?? null,
    );
    this.inputTransformPass.render(this.renderer, imageTexture, target);
    return target;
  }

  private renderDisplayTransform(
    inputTexture: Texture,
    colorManagement: NonNullable<FXPipelineRenderParams["colorManagement"]> | undefined,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const target = this.pool.get(`${mode}:display-transform`, width, height, rtType);
    this.displayTransformPass.setTransform(
      this.renderer,
      colorManagement?.displayColorSpaceId ?? "sRGB",
    );
    this.displayTransformPass.setCubeAtlases(
      colorManagement?.idtAtlas ?? null,
      colorManagement?.odtAtlas ?? null,
    );
    this.displayTransformPass.render(this.renderer, inputTexture, target);
    return target;
  }

  private applyPyramidHalation(
    params: FXPipelineRenderParams,
    current: WebGLRenderTarget,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const pyramid = this.preparePyramidTargets(`${mode}:halation`, width, height, rtType);
    this.renderPyramidDownsample(current, pyramid.down);

    const state = params.fxState.halation;
    // Legacy zoom compensation (`Yc`): below 100% preview zoom the glow's blur radius and
    // composite amount fade so the preview matches a full-resolution render. At >=100%
    // zoom (and for export/scopes) yc = { radius: 1, amount: 1 }, i.e. no change.
    const yc = computeZoomCompensation(mode === "preview" ? (params.previewZoom ?? 1) : 1);
    const radius = (0.3 + 0.3 * state.amount * state.amount * state.amount) * yc.radius;
    this.pyramidFXPass.renderHalation(
      this.renderer,
      pyramid.down[6].texture,
      pyramid.down[5].texture,
      pyramid.up[0],
      pyramid.down[6].width,
      pyramid.down[6].height,
      state,
      radius,
      false,
    );
    for (let i = 1, downIndex = 4; i < pyramid.up.length; i += 1, downIndex -= 1) {
      this.pyramidFXPass.renderHalation(
        this.renderer,
        pyramid.up[i - 1].texture,
        pyramid.down[downIndex].texture,
        pyramid.up[i],
        pyramid.up[i - 1].width,
        pyramid.up[i - 1].height,
        state,
        radius,
        false,
      );
    }

    const composite = this.pool.get(`${mode}:halation:composite`, width, height, rtType);
    this.pyramidFXPass.renderHalation(
      this.renderer,
      pyramid.up[pyramid.up.length - 1].texture,
      current.texture,
      composite,
      pyramid.up[pyramid.up.length - 1].width,
      pyramid.up[pyramid.up.length - 1].height,
      state,
      3 * state.amount * yc.amount,
      true,
    );
    this.counters.halationPassCount += 14;
    return composite;
  }

  private applyPyramidDiffusion(
    params: FXPipelineRenderParams,
    current: WebGLRenderTarget,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const pyramid = this.preparePyramidTargets(`${mode}:diffusion`, width, height, rtType);
    this.renderPyramidDownsample(current, pyramid.down);

    const state = params.fxState.diffusion;
    const aspect = width / Math.max(1, height);
    // Legacy zoom compensation (`Yc`) — see applyPyramidHalation. Diffusion's blur
    // radius is a fixed 0.5 in the legacy engine, scaled here by yc.radius.
    const yc = computeZoomCompensation(mode === "preview" ? (params.previewZoom ?? 1) : 1);
    const radius = 0.5 * yc.radius;
    this.pyramidFXPass.renderDiffusion(
      this.renderer,
      pyramid.down[6].texture,
      pyramid.down[5].texture,
      pyramid.up[0],
      pyramid.down[6].width,
      pyramid.down[6].height,
      state,
      radius,
      false,
      aspect,
    );
    for (let i = 1, downIndex = 4; i < pyramid.up.length; i += 1, downIndex -= 1) {
      this.pyramidFXPass.renderDiffusion(
        this.renderer,
        pyramid.up[i - 1].texture,
        pyramid.down[downIndex].texture,
        pyramid.up[i],
        pyramid.up[i - 1].width,
        pyramid.up[i - 1].height,
        state,
        radius,
        false,
        aspect,
      );
    }

    const composite = this.pool.get(`${mode}:diffusion:composite`, width, height, rtType);
    this.pyramidFXPass.renderDiffusion(
      this.renderer,
      pyramid.up[pyramid.up.length - 1].texture,
      current.texture,
      composite,
      pyramid.up[pyramid.up.length - 1].width,
      pyramid.up[pyramid.up.length - 1].height,
      state,
      state.amount * yc.amount,
      true,
      aspect,
    );
    this.counters.diffusionPassCount += 14;
    return composite;
  }

  private preparePyramidTargets(
    keyPrefix: string,
    width: number,
    height: number,
    rtType: TextureDataType,
  ): { down: WebGLRenderTarget[]; up: WebGLRenderTarget[] } {
    const sizes = computeLegacyPyramidSizes(width, height);
    return {
      down: sizes.down.map((size, index) =>
        this.pool.get(`${keyPrefix}:down:${index}`, size.width, size.height, rtType),
      ),
      up: sizes.up.map((size, index) =>
        this.pool.get(`${keyPrefix}:up:${index}`, size.width, size.height, rtType),
      ),
    };
  }

  private renderPyramidDownsample(source: WebGLRenderTarget, down: WebGLRenderTarget[]): void {
    let input = source.texture;
    let inputWidth = source.width;
    let inputHeight = source.height;
    for (const target of down) {
      this.pyramidFXPass.renderDownsample(this.renderer, input, target, inputWidth, inputHeight);
      input = target.texture;
      inputWidth = target.width;
      inputHeight = target.height;
    }
  }

  private applyHalation(
    params: FXPipelineRenderParams,
    current: WebGLRenderTarget,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const scale = qualityScale(
      mode === "export" ? (params.exportQuality ?? "high") : params.fxState.halation.quality,
    );
    const blurWidth = Math.max(1, Math.floor(width * scale));
    const blurHeight = Math.max(1, Math.floor(height * scale));
    const extract = this.pool.get(`${mode}:halation:extract`, blurWidth, blurHeight, rtType);
    const blurTemp = this.pool.get(`${mode}:halation:blur-temp`, blurWidth, blurHeight, rtType);
    const blurOutput = this.pool.get(`${mode}:halation:blur-output`, blurWidth, blurHeight, rtType);
    const composite = this.pool.get(`${mode}:halation:composite`, width, height, rtType);

    this.halationExtractPass.render(this.renderer, current.texture, extract);
    this.counters.halationPassCount += 1;
    // Legacy halation blur radius = 0.3 + 0.3·amount³ (normalized → px). Nearly constant —
    // the glow's visibility scales with amount (3x in the composite), not its spread.
    const amount = params.fxState.halation.amount;
    const blurRadius = (0.3 + 0.3 * amount * amount * amount) * HALATION_BLUR_PX * scale;
    this.blurPass.render(this.renderer, extract.texture, blurTemp, blurOutput, blurRadius);
    this.counters.blurPassCount += 2;
    this.compositePass.renderHalation(
      this.renderer,
      current.texture,
      blurOutput.texture,
      composite,
      params.fxState.halation,
    );
    this.counters.halationPassCount += 1;

    return composite;
  }

  private applyDiffusion(
    params: FXPipelineRenderParams,
    current: WebGLRenderTarget,
    width: number,
    height: number,
    mode: "preview" | "export" | "scopes",
    rtType: TextureDataType,
  ): WebGLRenderTarget {
    const scale = qualityScale(
      mode === "export" ? (params.exportQuality ?? "high") : params.fxState.diffusion.quality,
    );
    const blurWidth = Math.max(1, Math.floor(width * scale));
    const blurHeight = Math.max(1, Math.floor(height * scale));
    const extract = this.pool.get(`${mode}:diffusion:extract`, blurWidth, blurHeight, rtType);
    const blurTemp = this.pool.get(`${mode}:diffusion:blur-temp`, blurWidth, blurHeight, rtType);
    const blurOutput = this.pool.get(
      `${mode}:diffusion:blur-output`,
      blurWidth,
      blurHeight,
      rtType,
    );
    const composite = this.pool.get(`${mode}:diffusion:composite`, width, height, rtType);

    this.diffusionExtractPass.render(this.renderer, current.texture, extract);
    this.counters.diffusionPassCount += 1;
    // Legacy diffusion blur radius is fixed (≈0.5 normalized) — the soft bloom spread is
    // constant; amount/fog/threshold modulate the composite, not the blur.
    this.blurPass.render(
      this.renderer,
      extract.texture,
      blurTemp,
      blurOutput,
      DIFFUSION_BLUR_PX * scale,
    );
    this.counters.blurPassCount += 2;
    this.compositePass.renderDiffusion(
      this.renderer,
      current.texture,
      blurOutput.texture,
      composite,
      params.fxState.diffusion,
      width,
      height,
    );
    this.counters.diffusionPassCount += 1;

    return composite;
  }
}

function isHalationActive(state: ImageFXState) {
  const h = state.halation;
  return h.enabled && !h.bypass && h.amount > 0;
}

function isDiffusionActive(state: ImageFXState) {
  const d = state.diffusion;
  return d.enabled && !d.bypass && d.amount > 0;
}

function isSpotlightActive(state: ImageFXState) {
  const s = state.spotlight;
  return s.enabled && !s.bypass && s.amount > 0;
}


function isAcutanceActive(state: ImageFXState) {
  const g = state.grain;
  return g.enabled && !g.bypass && g.acutance > 0;
}

function qualityScale(quality: FXQuality): number {
  if (quality === "low") return 0.25;
  if (quality === "high") return 1;
  return 0.5;
}

function previewGrainAmountScale(zoom: number): number {
  return Math.min(1, Math.max(0, zoom));
}

/**
 * Legacy halation/diffusion zoom compensation (`Yc` in the legacy engine). The pyramid
 * glow is computed in texture space, so below 100% preview zoom the legacy faded the blur
 * radius and composite amount to match a full-resolution render:
 *   n = clamp(zoom, 0, 1); e = 1 - n; i = e³; radius = 1 - i; amount = 1 - i².
 * At >=100% zoom (zoom >= 1) this returns { radius: 1, amount: 1 } — no change.
 */
function computeZoomCompensation(zoom: number): { radius: number; amount: number } {
  const n = Math.min(1, Math.max(0, zoom));
  const e = 1 - n;
  const i = e * e * e;
  return { radius: 1 - i, amount: 1 - i * i };
}

function computeLegacyPyramidSizes(
  width: number,
  height: number,
): {
  down: Array<{ width: number; height: number }>;
  up: Array<{ width: number; height: number }>;
} {
  if (width <= 0 || height <= 0) {
    return {
      down: Array.from({ length: 7 }, () => ({ width: 1, height: 1 })),
      up: Array.from({ length: 6 }, () => ({ width: 1, height: 1 })),
    };
  }

  const aspect = width / height;
  const minSide = Math.max(2, Math.floor(Math.sqrt(width * height * 5e-4)));
  let w = aspect > 1 ? minSide : minSide * aspect;
  let h = aspect > 1 ? minSide / aspect : minSide;
  const scale = Math.max(Math.pow((0.5 * width) / w, 1 / 6), Math.pow((0.5 * height) / h, 1 / 6));
  const down = Array.from({ length: 7 }, () => ({ width: 1, height: 1 }));
  for (let i = 6; i >= 0; i -= 1) {
    down[i] = {
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
    };
    w *= scale;
    h *= scale;
  }

  return {
    down,
    up: Array.from({ length: 6 }, (_, index) => down[5 - index]),
  };
}
