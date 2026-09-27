import type {
  DistortMeshSession,
  DistortState,
  DistortionMesh,
  DistortionPoints,
  Vec2,
} from "./distortTypes";
import { lookupPerspectivePoint, normalizeDistortionSlider } from "./distortMath";

export function createDistortionMesh(detail: number): DistortionMesh {
  const size = Math.max(2, Math.floor(detail));
  const count = size * size;
  const vertices = new Float32Array(count * 2);
  const delta = new Float32Array(count * 2);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      vertices[offset] = size === 1 ? 0 : x / (size - 1);
      vertices[offset + 1] = size === 1 ? 0 : y / (size - 1);
      offset += 2;
    }
  }
  return { detail: size, vertices, delta };
}

export function resetDistortionMesh(mesh: DistortionMesh): void {
  mesh.delta.fill(0);
}

export function lookupPerspective(
  points: DistortionPoints,
  x: number,
  y: number,
): [number, number] {
  return lookupPerspectivePoint(points, x, y);
}

export function lookupDistortion(state: DistortState, x: number, y: number): [number, number] {
  const [px, py] = lookupPerspective(state.distortionPoints, x, y);
  const k = normalizeDistortionSlider(state.distortionAmount);
  const r2 = px * px + py * py;
  const denom = Math.max(0.15, 1 + k * r2 + 0.15 * k * r2 * r2);
  return [px / denom, py / denom];
}

export function startDistortMesh(state: DistortState, pointer: Vec2): DistortMeshSession {
  const original = meshFromState(state);
  return {
    original,
    working: cloneMesh(original),
    pointerStart: { ...pointer },
  };
}

export function distortMesh(
  session: DistortMeshSession,
  pointer: Vec2,
  options: {
    mode: "warp" | "pinch" | "bulge" | "restore";
    size: number;
    strength: number;
  },
): DistortionMesh {
  const working = cloneMesh(session.original);
  const radius = Math.max(0.001, options.size);
  const dx = pointer.x - session.pointerStart.x;
  const dy = pointer.y - session.pointerStart.y;
  for (let i = 0; i < working.vertices.length; i += 2) {
    const vx = working.vertices[i];
    const vy = working.vertices[i + 1];
    const dist = Math.hypot(vx - pointer.x, vy - pointer.y);
    const falloff = Math.max(0, 1 - dist / radius);
    const amount = falloff * falloff * Math.max(-1, Math.min(1, options.strength));
    if (options.mode === "restore") {
      working.delta[i] *= 1 - amount;
      working.delta[i + 1] *= 1 - amount;
    } else if (options.mode === "pinch" || options.mode === "bulge") {
      const sign = options.mode === "pinch" ? -1 : 1;
      working.delta[i] += (vx - pointer.x) * amount * sign * 0.08;
      working.delta[i + 1] += (vy - pointer.y) * amount * sign * 0.08;
    } else {
      working.delta[i] += dx * amount;
      working.delta[i + 1] += dy * amount;
    }
  }
  session.working = working;
  return working;
}

export function endDistortMesh(session: DistortMeshSession): DistortionMesh {
  return cloneMesh(session.working);
}

function meshFromState(state: DistortState): DistortionMesh {
  const mesh = createDistortionMesh(64);
  if (state.distortionMesh && state.distortionMesh.length === mesh.delta.length) {
    mesh.delta.set(state.distortionMesh);
  }
  return mesh;
}

function cloneMesh(mesh: DistortionMesh): DistortionMesh {
  return {
    detail: mesh.detail,
    vertices: new Float32Array(mesh.vertices),
    delta: new Float32Array(mesh.delta),
  };
}
