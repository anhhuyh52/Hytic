import type { EditState, CurveModel } from "../engine/state/EditState";
import { cloneMatchState } from "../engine/state/MatchTypes";
import { clonePresentationBorder } from "../features/presentation/border/borderTypes";
import { serializeEditorOverlayLayer } from "../features/overlays/editorOverlayTypes";
import type { SerializedEditState, SerializedCurveModel } from "./ProjectTypes";

function serializeCurveModel(curve: CurveModel): SerializedCurveModel {
  return { mode: curve.mode, points: curve.points.map((p) => ({ x: p.x, y: p.y })) };
}

/**
 * Converts live EditState to a plain-JSON-safe SerializedEditState.
 * `maskBlobIds` maps layerId → blobId for layers whose brush mask has been
 * exported to IndexedDB; pass {} when saving with no brush content.
 */
// NB: this reads `state` through the Solid proxy (no unwrap) so reactive callers
// like the dirty-tracking snapshot re-run when edits change. As a result the output
// can contain proxied arrays (from { ...state.x } spreads) which serialize fine via
// JSON but FAIL IndexedDB structured clone — persistence must plain-ify it first (see
// toPlainSerializedEditState / ProjectService.saveProject).
import type { ColorState } from "../engine/state/EditState";
import type { SerializedColorState } from "./ProjectTypes";

export function serializeColorState(state: ColorState): SerializedColorState {
  return {
    curve: {
      bypass: state.curve.bypass,
      mode: state.curve.mode,
      points: state.curve.points.map((p) => ({ x: p.x, y: p.y })),
    },
    contrast: {
      amount: state.contrast.amount,
      pivot: state.contrast.pivot,
      enabled: state.contrast.enabled,
      bypass: state.contrast.bypass,
      curve: {
        bypass: state.contrast.curve.bypass,
        mode: state.contrast.curve.mode,
        points: state.contrast.curve.points.map((p) => ({ x: p.x, y: p.y })),
        amount: state.contrast.curve.amount,
        gain: state.contrast.curve.gain,
        parabolaPower: state.contrast.curve.parabolaPower,
        pcurveA: state.contrast.curve.pcurveA,
        pcurveB: state.contrast.curve.pcurveB,
        expImpulseK: state.contrast.curve.expImpulseK,
        cubicPulseCenter: state.contrast.curve.cubicPulseCenter,
        cubicPulseWidth: state.contrast.curve.cubicPulseWidth,
      },
    },
    balance: { ...state.balance },
    scattering: { ...state.scattering },
    refraction: {
      enabled: state.refraction.enabled,
      bypass: state.refraction.bypass,
      mapVectors: [...state.refraction.mapVectors],
      separation: state.refraction.separation,
      preserveLuminance: state.refraction.preserveLuminance,
    },
    saturation: {
      enabled: state.saturation.enabled,
      bypass: state.saturation.bypass,
      curve: serializeCurveModel(state.saturation.curve),
    },
    rgbMixer: {
      enabled: state.rgbMixer.enabled,
      bypass: state.rgbMixer.bypass,
      red: { ...state.rgbMixer.red },
      green: { ...state.rgbMixer.green },
      blue: { ...state.rgbMixer.blue },
      preserveLuminance: state.rgbMixer.preserveLuminance,
    },
    densityChroma: {
      enabled: state.densityChroma.enabled,
      bypass: state.densityChroma.bypass,
      density: serializeCurveModel(state.densityChroma.density),
      chroma: serializeCurveModel(state.densityChroma.chroma),
      densityBypass: state.densityChroma.densityBypass,
      chromaBypass: state.densityChroma.chromaBypass,
    },
    radiance: {
      enabled: state.radiance.enabled,
      bypass: state.radiance.bypass,
      curve: serializeCurveModel(state.radiance.curve),
    },
    tone: {
      enabled: state.tone.enabled,
      bypass: state.tone.bypass,
      curve: serializeCurveModel(state.tone.curve),
    },
    shadowHighlight: {
      enabled: state.shadowHighlight.enabled,
      bypass: state.shadowHighlight.bypass,
      blackPoint: [...state.shadowHighlight.blackPoint],
      whitePoint: [...state.shadowHighlight.whitePoint],
      blackLinked: state.shadowHighlight.blackLinked,
      whiteLinked: state.shadowHighlight.whiteLinked,
    },
    exposure: {
      enabled: state.exposure.enabled,
      bypass: state.exposure.bypass,
      curve: serializeCurveModel(state.exposure.curve),
    },
  };
}

export function serializeEditState(state: EditState): SerializedEditState {
  return {
    ...serializeColorState(state),
    preset: { ...state.preset },
    match: cloneMatchState(state.match),
    grain: { ...state.grain },
    halation: { ...state.halation },
    diffusion: { ...state.diffusion },
    spotlight: { ...state.spotlight },
    transform: { ...state.transform },
    distort: {
      ...state.distort,
      distortionPoints: [...state.distort.distortionPoints],
      distortionMesh: state.distort.distortionMesh ? Array.from(state.distort.distortionMesh) : null,
    },
    retouch: {
      enabled: state.retouch.enabled,
      bypass: state.retouch.bypass,
      spots: state.retouch.spots.map((spot) => ({
        ...spot,
        position: [...spot.position],
        sourcePosition: [...spot.sourcePosition],
        size: [...spot.size],
      })),
    },
    presentationBorder: clonePresentationBorder(state.presentationBorder),
    colorManagement: {
      ...state.colorManagement,
      toneMapping: { ...state.colorManagement.toneMapping },
      ocio: { ...state.colorManagement.ocio },
      ocioRuntime: { ...state.colorManagement.ocioRuntime },
    },
    engineSettings: {
      lutStorageMode: state.engineSettings.lutStorageMode,
    },
    localAdjustments: state.localAdjustments ? state.localAdjustments.map((layer) => ({
      ...layer,
      components: layer.components.map((comp) => {
        if (comp.type === "gradient") {
          return {
            ...comp,
            startPoint: [...(comp as any).startPoint],
            endPoint: [...(comp as any).endPoint],
          };
        }
        if (comp.type === "brush") {
          return {
            ...comp,
            brush: comp.brush
              ? comp.brush.map((stroke) => ({
                  ...stroke,
                  points: stroke.points.map((p) => ({ ...p })),
                }))
              : null,
          };
        }
        if (comp.type === "luminance") {
          return {
            ...comp,
          };
        }
        if (comp.type === "depth") {
          return {
            ...comp,
          };
        }
        return {
          ...comp,
          position: [...(comp as any).position],
          size: [...(comp as any).size],
          sampledColor: [...(comp as any).sampledColor],
          selectedColor: [...(comp as any).selectedColor],
          showOverlay: (comp as any).showOverlay,
        };
      }) as any,
      adjustments: serializeColorState(layer.adjustments),
    })) : [],
    overlays: state.overlays ? state.overlays.map(serializeEditorOverlayLayer) : [],
  };
}

/**
 * Serializes edit state into a fully PLAIN (proxy-free), structured-clone-safe
 * object for IndexedDB persistence. serializeEditState() keeps proxied arrays for
 * reactivity; the JSON round-trip here strips them (the serialized state is pure
 * JSON data — numbers/strings/arrays/objects — so this is lossless).
 */
export function toPlainSerializedEditState(state: EditState): SerializedEditState {
  return JSON.parse(JSON.stringify(serializeEditState(state))) as SerializedEditState;
}
