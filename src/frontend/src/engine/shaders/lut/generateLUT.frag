precision highp float;

uniform sampler2D uCurve;
uniform bool uUseCurve;
uniform float uCurveMinStops;
uniform float uCurveMaxStops;
uniform bool uUseContrast;
uniform float uContrastAmount;
uniform float uContrastPivot;
uniform sampler2D uContrastCurve;
uniform bool uUseContrastCurve;
uniform float uContrastCurveMin;
uniform float uContrastCurveMax;
uniform bool uUseBalance;
uniform float uBalanceExposure;
uniform float uBalanceSaturation;
uniform float uTemperature;
uniform float uTint;
uniform vec3 uBalanceRGB;
uniform bool uUseScattering;
uniform vec4 uScatterShadows;    // .xyz ambient tint, .w wheel hue [0,1]
uniform vec4 uScatterHighlights; // .xyz ambient tint, .w wheel hue [0,1]
uniform bool uUseRefraction;
uniform vec4 uRefractMv[6];
uniform float uRefractSeparation;
uniform bool uUseRGBMixer;
uniform vec3 uRGBMixerRedRow;
uniform vec3 uRGBMixerGreenRow;
uniform vec3 uRGBMixerBlueRow;
uniform bool uRGBMixerPreserveLuminance;
// Density / Chroma / Saturation — packed curve models (.r hueVsDensity,
// .g chromaVsDensity, .b lumaVsDensity); each op gated by its own flag.
uniform bool uUseDensity;
uniform bool uUseChroma;
uniform bool uUseSaturation;
uniform sampler2D uDensityCurves;
// Radiance — legacy hueVsLuma curve (.r).
uniform bool uUseRadiance;
uniform sampler2D uRadianceCurve;
// Tone — legacy Contrast panel lumaVsLuma curve (lch_mod). Identity diagonal (.r).
uniform bool uUseTone;
uniform sampler2D uToneCurve;
// Shadow / Highlight — legacy "rgb" panel rng_mod. Per-channel black/white points (0.5 neutral).
uniform bool uUseShadowHighlight;
uniform vec3 uShadowHighlightBlack;
uniform vec3 uShadowHighlightWhite;
// Exposure — legacy expVsLuma offset curve (.r, 0.5 neutral). cct-space multiply.
uniform bool uUseExposure;
uniform sampler2D uExposureCurve;
// Spectral re-projection — legacy POST-CMP `lut_csp` gamut/spectral desat (8³ atlas).
uniform bool uUseSpectral;
uniform sampler2D uCspLut;

// Legacy-faithful ACES sandwich (IDT/RRT/ODT). When true, the LUT renders the
// creative grade inside the legacy ACES pipeline and the Phase 28 color-
// management path below is bypassed. This is what makes presets match legacy.
uniform bool uUseAcesPipeline;
// When true, the legacy-ACES bake includes the full IDT + ODT (sRGB->display) for
// standalone .cube/.clf LUT export. When false (preview/render), the bake is
// GRADE-ONLY in ACEScct — the IDT/ODT run per-pixel in BaseImagePass so the steep
// camera-log IDTs aren't quantized by the 64³ grid. See [[raw-standard-idt-lut-baking]].
uniform bool uBakeFull;
// The selected legacy IDT (input) + ODT (display) sources are injected per
// selection by LUTGenerator (the full ~100-variant set exceeds GPU shader
// limits), exposing activeIDT(vec3)/activeODT(vec3). Cube-LUT-based
// spaces read uLutIdtAtlas / uLutOdtAtlas (declared in cubeAtlas.glsl).

// ── Color management (Phase 28/29/30) ───────────────────────────────────────
uniform bool uColorManagementEnabled;
uniform int uInputColorSpace;    // 0 srgb,1 rec709,2 linear-srgb,3 slog3,4 logc3,5 clog3,6 vlog,7 log3g10,8 acescg,9 aces2065-1
uniform int uWorkingColorSpace;  // 0 linear-srgb, 1 acescg
uniform int uDisplayColorSpace;  // 0 srgb, 1 rec709-gamma24, 2 display-p3, 3 rec2020
uniform int uViewTransform;      // 0 none, 1 standard, 2 filmic, 3 aces-like, 4 soft-clip
uniform bool uUseOutputTransform;
uniform bool uUseGamutMapping;
uniform int uColorManagementDebugView; // 0 none,1 input,2 working,3 toneMapped,4 output,5 clipping
uniform mat3 uSourceToWorkingMatrix;   // CPU-derived source gamut -> working gamut
uniform mat3 uWorkingToDisplayMatrix;  // CPU-derived working gamut -> display gamut
// Tone mapping
uniform bool uToneMappingEnabled;
uniform float uToneExposureBias;
uniform float uToneHighlightCompression;
uniform float uToneShoulderStrength;
uniform float uToneBlackLift;

// Color Match — legacy `lut_cmt`/useCmt: a 16³ RGB LUT (256x16 atlas) baked from
// the srp-static algorithm, sampled at the end of the creative grade in DISPLAY
// sRGB (applyColorMatchLUT wraps the sample in the legacy cct2rgb/rgb2cct sandwich),
// mapping the current grade toward a reference image.
uniform bool uUseMatchLUT;
uniform sampler2D uMatchAtlas;

varying vec2 vUv;

#include <colorSpaces>
#include <luma>
#include <acesApprox>
#include <toneMapping>
#include <displayGamuts>
#include <gamutMapping>
#include <outputTransforms>
#include <cameraLogCurves>
#include <gamutMatrices>
#include <inputTransforms>
#include <colorMatch>
#include <colorPipeline>
#include <acesPipeline>
#include <cubeAtlas>
#include <idtOdtHelpers>
// Active (selected) IDT/ODT source + activeIDT/activeODT aliases are
// injected here by LUTGenerator (replaces these markers).
// ACTIVE_IDT
// ACTIVE_ODT
#include <contrast>
#include <contrastCurve>
#include <balance>
#include <scattering>
#include <refraction>
#include <rgbMixer>
#include <densityChroma>
#include <radiance>
#include <tone>
#include <shadowHighlight>
#include <exposure>
#include <spectralReproject>

vec3 lutCoordFromTileUV(vec2 uv) {
  vec2 pixel = floor(uv * 512.0);

  float tileX = floor(pixel.x / 64.0);
  float tileY = floor(pixel.y / 64.0);

  float localX = mod(pixel.x, 64.0);
  float localY = mod(pixel.y, 64.0);

  float blueIndex = tileY * 8.0 + tileX;
  float redIndex = localX;
  float greenIndex = localY;

  return vec3(redIndex, greenIndex, blueIndex) / 63.0;
}

vec3 safeRgb(vec3 c) {
  c = min(max(c, vec3(-65504.0)), vec3(65504.0));
  c.r = (c.r == c.r) ? c.r : 0.0;
  c.g = (c.g == c.g) ? c.g : 0.0;
  c.b = (c.b == c.b) ? c.b : 0.0;
  return c;
}

// applyInputTransform / decodeInputTransfer / convertSourceGamutToWorking are
// provided by the included inputTransforms.glsl + gamutMatrices.glsl. The gamut
// matrix is supplied as uSourceToWorkingMatrix (CPU-derived from primaries).

// ── Creative operations (operate in the working color space) ─────────────────
// For linear-srgb working this is byte-for-byte the v1 creative pipeline. For
// acescg working the same operators run on AP1 values; luminance weights remain
// Rec.709 (luminance709) which is an accepted approximation for this phase.
vec3 applyCreativePipeline(vec3 working) {
  vec3 linear = working;

  // ── Legacy creative sequence (faithful order: colorVolume -> expVsLuma ->
  //    refraction -> colorBalance -> scattering -> DNS -> LMM) ────────────────

  // Balance — colorVolume (saturation + exposure) runs first.
  if (uUseBalance) {
    linear = applyColorVolume(linear, uBalanceSaturation, uBalanceExposure);
  }

  // Exposure curve (expVsLuma).
  if (uUseExposure) {
    linear = applyExposureCurve(linear, uExposureCurve);
  }

  if (uUseRefraction) {
    linear = applyRefraction(
      linear, uRefractMv[0], uRefractMv[1], uRefractMv[2],
      uRefractMv[3], uRefractMv[4], uRefractMv[5], uRefractSeparation
    );
  }

  // Balance — colorBalance (temperature + tint) runs after refraction.
  if (uUseBalance) {
    linear = applyColorBalance(linear, uTemperature, uTint);
  }

  if (uUseScattering) {
    linear = applyScattering(linear, uScatterShadows, uScatterHighlights);
  }

  // Density / Chroma / Saturation (legacy DNS block).
  if (uUseDensity || uUseChroma || uUseSaturation) {
    linear = applyDensityCurves(linear, uDensityCurves, uUseDensity, uUseChroma, uUseSaturation);
  }

  // LMM block: Tone (lch_mod) -> Radiance (hueVsLuma) -> Shadow/Highlight (rng_mod).
  // Legacy keeps hue/chroma from the pre-Tone LMM snapshot for Radiance, then
  // computes Shadow/Highlight luma after Radiance. Keep this as one cct block so
  // the panel bypasses do not change those data dependencies.
  if (uUseTone || uUseRadiance || uUseShadowHighlight) {
    vec3 cct = lin2cct(linear);
    float lmmHue = legacyHue(cct);
    vec3 lmmSrcYiq = cct * LEGACY_RGB2YIQ;
    float lmmCrm = length(lmmSrcYiq.yz);
    float lmmLum = lmmSrcYiq.x;

    if (uUseTone) {
      float tgtLum = texture2D(uToneCurve, vec2(lmmLum, 0.5)).r;
      cct = toneLchMod(lmmSrcYiq, lmmLum, tgtLum, 2.4381791201);
    }
    if (uUseRadiance) {
      float postToneLum = legacyLuma(cct);
      float hueVsLum = texture2D(uRadianceCurve, vec2(lmmHue, 0.5)).r * 4.0 - 1.0;
      float hvlInf = (1.0 - pow(1.0 - lmmCrm, 2.0)) * (1.0 - postToneLum);
      cct = mix(cct, cct * hueVsLum, hvlInf);
    }
    if (uUseShadowHighlight) {
      cct = shadowHighlightRngModCct(
        cct,
        uShadowHighlightBlack,
        uShadowHighlightWhite,
        legacyLuma(cct)
      );
    }
    linear = cct2lin(cct);
  }

  // ── Non-legacy extras (no-ops at neutral; kept for the project's own preset /
  //    local-adjustment / reference-match systems, which presets neutralize) ──
  if (uUseCurve) {
    float luminance = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    float encodedCurve = texture2D(uCurve, vec2(clamp(luminance, 0.0, 1.0), 0.5)).r;
    float curveExposure = mix(uCurveMinStops, uCurveMaxStops, encodedCurve);
    linear *= pow(2.0, curveExposure);
  }
  if (uUseContrast) {
    linear = applyContrast(linear, uContrastAmount, uContrastPivot);
  }
  if (uUseContrastCurve) {
    float luma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    float encodedCurve = texture2D(uContrastCurve, vec2(clamp(luma, 0.0, 1.0), 0.5)).r;
    float localContrast = decodeContrastCurveValue(encodedCurve, uContrastCurveMin, uContrastCurveMax);
    float factor = pow(2.0, localContrast);
    linear = (linear - vec3(uContrastPivot)) * factor + vec3(uContrastPivot);
  }
  if (uUseRGBMixer) {
    linear = applyRGBMixerRows(
      linear, uRGBMixerRedRow, uRGBMixerGreenRow, uRGBMixerBlueRow, uRGBMixerPreserveLuminance
    );
  }

  // Spectral re-projection (legacy POST-CMP) — the final step: pull moved +
  // saturated colours toward the spectral-compression LUT. `working` is the
  // untouched pipeline input (the legacy baseColor). No-op when nothing moved.
  // Legacy runs POST-CMP and Color Match (CMT) as mutually-exclusive branches
  // (`if (useCmt) {...} else { POST-CMP }`), so skip POST-CMP when a match is
  // active — the CMT block downstream replaces it.
  if (uUseSpectral && !uUseMatchLUT) {
    float colorVolumeSat = uUseBalance ? (1.0 + uBalanceSaturation) : 1.0;
    linear = applySpectralReproject(linear, working, uCspLut, colorVolumeSat);
  }

  return linear;
}

// applyOutputTransform / applyToneMapping / convertWorkingToDisplayLinear /
// compressToDisplayGamut / encodeDisplayColor are provided by the included
// outputTransforms.glsl + toneMapping.glsl + displayGamuts.glsl + gamutMapping.glsl.

void main() {
  vec3 inputColor = lutCoordFromTileUV(vUv);

  // Legacy-faithful ACES sandwich (default). The creative grade is rendered
  // inside the legacy IDT (sRGB -> InvODT/InvRRT -> ACEScct) on input
  // and the forward RRT + 48-nit ODT on output, matching the legacy source so the
  // same preset data reproduces the legacy look. (See acesPipeline.glsl.)
  if (uUseAcesPipeline) {
    // Full legacy path: selected IDT (input space) -> ACEScct -> AP1-
    // linear working, creative ops, then the selected ODT (display space). The
    // IDT/ODT bodies are ported verbatim per space (legacyIdtOdt.glsl); default
    // ids (0,0) = sRGB in/out, identical to the prior sRGB-only behavior.
    // Grade-only preview (input is ACEScct) vs full sRGB->display export.
    vec3 acescct = uBakeFull ? activeIDT(inputColor) : inputColor;
    vec3 work = safeRgb(cct2lin(acescct));
    work = safeRgb(applyCreativePipeline(work));
    // Color Match (legacy lut_cmt): cct2rgb(work) -> LUT in display sRGB -> rgb2cct,
    // applied on AP1-linear work before the ODT (the sandwich is inside the helper).
    work = safeRgb(applyColorMatchLUT(work, uMatchAtlas, uUseMatchLUT));
    vec3 graded = safeRgb(lin2cct(work));
    gl_FragColor = vec4(uBakeFull ? activeODT(clamp(graded, 0.0, 1.0)) : graded, 1.0);
    return;
  }

  // Effective color-management selections (disabled CM => v1 path: sRGB input,
  // linear-srgb working, sRGB display, standard view; both gamut matrices are set
  // to identity on the CPU in that case).
  bool cm = uColorManagementEnabled;
  int inSpace = cm ? uInputColorSpace : 0;
  int displaySpace = cm ? uDisplayColorSpace : 0;
  int view = cm ? uViewTransform : 1;          // 1 = standard
  bool useOutput = cm ? uUseOutputTransform : true;
  bool useGamut = cm ? uUseGamutMapping : true;
  bool toneOn = cm ? uToneMappingEnabled : true;
  int debug = cm ? uColorManagementDebugView : 0;

  // Debug: raw input (identity LUT so the preview shows the source image).
  if (debug == 1) {
    gl_FragColor = vec4(inputColor, 1.0);
    return;
  }

  vec3 working = applyInputTransform(inputColor, inSpace, uSourceToWorkingMatrix);

  // Debug: working space (encode linear working to sRGB for viewing).
  if (debug == 2) {
    gl_FragColor = vec4(linearToSrgb(clamp(working, 0.0, 1.0)), 1.0);
    return;
  }

  working = safeRgb(applyCreativePipeline(working));

  // Color Match — a global look layer applied after creative edits and before the
  // output transform (legacy lut_cmt position). The LUT is sampled in display sRGB
  // via the legacy cct2rgb/rgb2cct sandwich inside applyColorMatchLUT.
  working = safeRgb(applyColorMatchLUT(working, uMatchAtlas, uUseMatchLUT));

  // Display-linear + tone-mapped values needed for toneMapped/clipping debug.
  vec3 displayLinear = convertWorkingToDisplayLinear(working, uWorkingToDisplayMatrix);
  vec3 toneMapped = toneOn
    ? applyToneMapping(
        displayLinear, view, uToneExposureBias,
        uToneHighlightCompression, uToneShoulderStrength, uToneBlackLift
      )
    : displayLinear;

  // Debug: tone-mapped linear (encoded for viewing, before gamut compression).
  if (debug == 3) {
    gl_FragColor = vec4(encodeDisplayColor(clamp(toneMapped, 0.0, 1.0), displaySpace), 1.0);
    return;
  }

  vec3 outputColor = applyOutputTransform(
    working, uWorkingToDisplayMatrix, displaySpace, view, useOutput, useGamut,
    toneOn, uToneExposureBias, uToneHighlightCompression, uToneShoulderStrength, uToneBlackLift
  );

  // Debug: clipping warning based on the pre-compression tone-mapped value.
  if (debug == 5) {
    if (any(greaterThan(toneMapped, vec3(1.0)))) {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // over-range -> red
      return;
    }
    if (any(lessThan(toneMapped, vec3(0.0)))) {
      gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); // under-range -> blue
      return;
    }
    // in-range -> normal output
  }

  gl_FragColor = vec4(outputColor, 1.0);
}
