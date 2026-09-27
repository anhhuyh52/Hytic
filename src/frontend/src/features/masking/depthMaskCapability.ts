import { createStore } from "solid-js/store";

export type DepthResourceStatus = "unavailable" | "loading" | "ready" | "error";
export type DepthUnavailableReason =
  | "no-depth-data"
  | "depth-loading"
  | "depth-decode-failed"
  | "depth-texture-missing"
  | "unsupported-platform";

export type DepthMaskCapability = {
  available: boolean;
  status: DepthResourceStatus;
  reason: DepthUnavailableReason | null;
};

export type DepthResourceState = {
  status: DepthResourceStatus;
  metadataHasDepth: boolean;
  hasEngineDepthTexture: boolean;
  width: number;
  height: number;
  source: "embedded" | "sidecar" | "generated" | null;
  error: string | null;
};

export const DEFAULT_DEPTH_RESOURCE: DepthResourceState = {
  status: "unavailable",
  metadataHasDepth: false,
  hasEngineDepthTexture: false,
  width: 0,
  height: 0,
  source: null,
  error: null,
};

export interface EvaluateDepthCapabilityInput {
  metadataHasDepth: boolean;
  status: DepthResourceStatus;
  hasTexture: boolean;
  platformSupported?: boolean;
}

export function evaluateDepthMaskCapability(input: EvaluateDepthCapabilityInput): DepthMaskCapability {
  if (input.platformSupported === false) return { available: false, status: "unavailable", reason: "unsupported-platform" };
  if (!input.metadataHasDepth) return { available: false, status: "unavailable", reason: "no-depth-data" };
  if (input.status === "loading") return { available: false, status: "loading", reason: "depth-loading" };
  if (input.status === "error") return { available: false, status: "error", reason: "depth-decode-failed" };
  if (input.status !== "ready" || !input.hasTexture) return { available: false, status: "unavailable", reason: "depth-texture-missing" };
  return { available: true, status: "ready", reason: null };
}

export const [depthResource, setDepthResource] = createStore<DepthResourceState>({ ...DEFAULT_DEPTH_RESOURCE });

export function resetDepthResource(): void {
  setDepthResource({ ...DEFAULT_DEPTH_RESOURCE });
}

export function getDepthMaskCapability(): DepthMaskCapability {
  return evaluateDepthMaskCapability({
    metadataHasDepth: depthResource.metadataHasDepth,
    status: depthResource.status,
    hasTexture: depthResource.hasEngineDepthTexture,
  });
}

/** Normalizes decoder output to the shared convention: 0 = nearest, 1 = farthest. */
export function normalizeDepthSamples(values: ArrayLike<number>, sourceNearIsOne = false): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  const span = Math.max(1e-8, max - min);
  const output = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const normalized = Math.max(0, Math.min(1, (Number(values[index]) - min) / span));
    output[index] = sourceNearIsOne ? 1 - normalized : normalized;
  }
  return output;
}

export type DepthMaskCreationResult = { ok: true } | { ok: false; reason: string };

export function validateDepthMaskCreation(): DepthMaskCreationResult {
  const capability = getDepthMaskCapability();
  if (capability.available) return { ok: true };
  return { ok: false, reason: getDepthUnavailableMessage(capability.reason) ?? "Depth Mask is unavailable." };
}

export function getDepthUnavailableMessage(reason: DepthUnavailableReason | null): string | null {
  switch (reason) {
    case "no-depth-data": return "Depth Mask is only available for images containing depth information.";
    case "depth-loading": return "Depth information is still loading.";
    case "depth-decode-failed": return "The image contains depth information, but it could not be loaded.";
    case "depth-texture-missing": return "The depth texture is not ready.";
    case "unsupported-platform": return "Depth Mask is not supported on this platform.";
    default: return null;
  }
}
