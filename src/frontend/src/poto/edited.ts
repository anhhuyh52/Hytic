/*
 * [edited] detection — compares each panel's slice of the live editState to its
 * engine default, matching the legacy control-panel-header[edited] behavior.
 * Reads the reactive editState store so callers re-run when state changes.
 *
 * Panels whose color science is not yet ported (scattering / refraction /
 * spotlight) report not-edited until their state lands in Phase 7.
 */
import { editState } from "../app/editor-store";
import { type EditState, DEFAULT_BALANCE_STATE, IDENTITY_REFRACTION_VECTORS } from "../engine/state/EditState";
import { DEFAULT_DISTORT_STATE } from "../features/distort/distortStore";
import { pointsEqualDefault } from "../features/distort/perspectiveMath";
import { BYPASS_REFERENCE_ID } from "../engine/state/MatchTypes";
import { PANELS, type PanelKey } from "./panels";
import { selectedPresetId } from "./presetPacksStore";

// Legacy grading curve (y = 0.5 neutral): edited iff any point leaves 0.5.
function legacyCurveEdited(curve: { points: { x: number; y: number }[] }): boolean {
  return curve.points.some((p) => Math.abs(p.y - 0.5) > 1e-4);
}

// Tone (lumaVsLuma) curve: neutral is the identity diagonal (y = x), so it is
// edited iff any point's y departs from its x.
function diagonalCurveEdited(curve: { points: { x: number; y: number }[] }): boolean {
  return curve.points.some((p) => Math.abs(p.y - p.x) > 1e-4);
}

export function isPanelEdited(key: PanelKey, customState?: EditState): boolean {
  const s = customState ?? editState;
  switch (key) {
    case "presets":
      return s.preset.selectedPresetId != null || selectedPresetId() != null;
    case "match":
      return s.match.lut != null && s.match.referenceId !== BYPASS_REFERENCE_ID;
    case "balance": {
      const b = s.balance;
      const d = DEFAULT_BALANCE_STATE;
      return (
        b.exposure !== d.exposure ||
        b.saturation !== d.saturation ||
        b.temperature !== d.temperature ||
        b.tint !== d.tint ||
        b.red !== d.red ||
        b.green !== d.green ||
        b.blue !== d.blue
      );
    }
    case "distort": {
      const d = s.distort;
      return (
        d.distortionAmount !== DEFAULT_DISTORT_STATE.distortionAmount ||
        d.distortionHorizontal !== DEFAULT_DISTORT_STATE.distortionHorizontal ||
        d.distortionVertical !== DEFAULT_DISTORT_STATE.distortionVertical ||
        !pointsEqualDefault(d.distortionPoints) ||
        !!d.distortionMesh
      );
    }
    case "retouch":
      return s.retouch.spots.length > 0;
    case "exposure":
      // The legacy Exposure Curve panel now edits the faithful expVsLuma curve.
      return legacyCurveEdited(s.exposure.curve);
    case "contrast":
      // The legacy Contrast panel now edits the faithful lumaVsLuma `tone` curve.
      return diagonalCurveEdited(s.tone.curve);
    case "density":
      return legacyCurveEdited(s.densityChroma.density);
    case "chroma":
      return legacyCurveEdited(s.densityChroma.chroma);
    case "radiance":
      return legacyCurveEdited(s.radiance.curve);
    case "saturation":
      return legacyCurveEdited(s.saturation.curve);
    case "rgb": {
      // The legacy "Shadow Highlight" panel now edits the shadowHighlight points
      // (each channel neutral at 0.5).
      const sh = s.shadowHighlight;
      return (
        sh.blackPoint.some((v) => Math.abs(v - 0.5) > 1e-4) ||
        sh.whitePoint.some((v) => Math.abs(v - 0.5) > 1e-4)
      );
    }
    case "halation":
      return s.halation.amount !== 0;
    case "diffusion":
      return s.diffusion.amount !== 0;
    case "spotlight":
      return s.spotlight.amount !== 0;

    case "texture": {
      const g = s.grain;
      return (
        g.amount !== 0 ||
        g.acutance !== 0 ||
        Math.abs(g.resolution - 0.5) > 1e-4 ||
        Math.abs(g.colorAmount - 0.5) > 1e-4
      );
    }
    case "scattering": {
      const sc = s.scattering;
      return (
        sc.shadowX !== 0.5 ||
        sc.shadowY !== 0.5 ||
        sc.highlightX !== 0.5 ||
        sc.highlightY !== 0.5 ||
        sc.balance !== 0
      );
    }
    case "refraction":
      return (
        s.refraction.separation !== 0.5 ||
        s.refraction.mapVectors.some((v, i) => v !== IDENTITY_REFRACTION_VECTORS[i])
      );
    default:
      return false;
  }
}

export function isAnyPanelEdited(customState?: EditState): boolean {
  return PANELS.some((p) => isPanelEdited(p.key, customState));
}
