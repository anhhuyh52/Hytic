import { cloneDistortState, DEFAULT_DISTORT_STATE } from "./distortDefaults";
import {
  buildPerspectiveMatrix,
  invertMat3,
  pointsEqualDefault,
  transformPoint,
} from "./perspectiveMath";
import type { DistortState, Mat3 } from "./distortTypes";

export {
  buildPerspectiveMatrix,
  calculateAutoCropForDistortion,
  defaultDistortionPoints,
  invertMat3,
  isValidQuad,
  limitDistortionPoints,
  pointsEqualDefault,
  transformPoint,
} from "./perspectiveMath";

// The reference feeds distortion_amount/_horizontal/_vertical to the shader as
// raw -1..1 state values; the UI sliders are -100..100, so only divide.
export function normalizeDistortionSlider(value: number): number {
  return normalizeSlider(value, 1);
}

export function normalizePerspectiveSlider(value: number): number {
  return normalizeSlider(value, 1);
}

export function distortStateIsActive(state: DistortState): boolean {
  return (
    state.enabled &&
    (Math.abs(state.distortionAmount) > 1e-4 ||
      Math.abs(state.distortionHorizontal) > 1e-4 ||
      Math.abs(state.distortionVertical) > 1e-4 ||
      !pointsEqualDefault(state.distortionPoints) ||
      !!state.distortionMesh)
  );
}

export function resetDistortState(): DistortState {
  return cloneDistortState(DEFAULT_DISTORT_STATE);
}

export function buildDistortionMatrix(points: DistortState["distortionPoints"]): Mat3 {
  return invertMat3(buildPerspectiveMatrix(points));
}

export function lookupPerspectivePoint(
  points: DistortState["distortionPoints"],
  x: number,
  y: number,
): [number, number] {
  return transformPoint(buildDistortionMatrix(points), x, y);
}

function normalizeSlider(value: number, range: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-range, Math.min(range, value / 100));
}
