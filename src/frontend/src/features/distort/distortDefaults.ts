import type { DistortionPoints, DistortState } from "./distortTypes";

export const DEFAULT_DISTORTION_POINTS: DistortionPoints = [-1, -1, 1, -1, -1, 1, 1, 1];

export const DEFAULT_DISTORT_STATE: DistortState = {
  enabled: false,
  distortionAmount: 0,
  distortionHorizontal: 0,
  distortionVertical: 0,
  distortionPoints: [...DEFAULT_DISTORTION_POINTS],
  distortionMesh: null,
  perspectiveMode: false,
  showGrid: false,
  autoCrop: true,
};

export function cloneDistortionPoints(points: DistortionPoints): DistortionPoints {
  return [...points] as DistortionPoints;
}

export function cloneDistortState(state: DistortState): DistortState {
  return {
    ...state,
    distortionPoints: cloneDistortionPoints(state.distortionPoints),
    distortionMesh: state.distortionMesh ? new Float32Array(state.distortionMesh) : null,
  };
}

export function defaultDistortionPoints(): DistortionPoints {
  return cloneDistortionPoints(DEFAULT_DISTORTION_POINTS);
}
