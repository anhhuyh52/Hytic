export type DistortionPoints = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export type Vec2 = { x: number; y: number };

export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PerspectiveHandleId =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "center";

export interface DistortionMesh {
  detail: number;
  vertices: Float32Array;
  delta: Float32Array;
}

export interface DistortMeshSession {
  original: DistortionMesh;
  working: DistortionMesh;
  pointerStart: Vec2;
}

export interface DistortState {
  enabled: boolean;
  distortionAmount: number;
  distortionHorizontal: number;
  distortionVertical: number;
  distortionPoints: DistortionPoints;
  distortionMesh: Float32Array | null;
  perspectiveMode: boolean;
  showGrid: boolean;
  autoCrop: boolean;
}
