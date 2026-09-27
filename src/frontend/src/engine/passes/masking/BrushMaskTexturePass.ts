/**
 * BrushMaskTexturePass
 *
 * Replays a BrushStroke[] array into an offscreen mask render target by stamping
 * each interpolated brush point with the brushStamp shader.
 *
 * Architecture:
 *   BrushStroke[] → stamp loop → WebGLRenderTarget (R=mask 0..1)
 *
 * Caching:
 *   Results are cached per maskId.  A caller marks a mask dirty via markBrushMaskDirty();
 *   getOrBuildTexture() rebuilds only when the cache entry is stale.
 */

import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  LinearFilter,
  NoColorSpace,
  UnsignedByteType,
  Scene,
  OrthographicCamera,
  Texture,
  Color,
} from "three";
import type { WebGLRenderer } from "three";
import type { BrushMaskComponent, BrushPoint, BrushStroke } from "../../state/EditState";

// Inline the passthrough vertex shader so we don't need an extra file import.
const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uPrevMask;
uniform sampler2D uSource;

uniform vec2  uCenter;
uniform float uRadius;
uniform float uOpacity;
uniform float uHardness;
uniform float uMasking;
uniform float uPressure;
uniform float uErase;
uniform float uAspect;

void main() {
  float prev = texture2D(uPrevMask, vUv).r;

  vec2 delta = vUv - uCenter;
  float d  = length(vec2(delta.x, delta.y * uAspect));
  float r  = max(uRadius, 0.0001);
  float nd = d / r;

  if (nd > 1.0) {
    gl_FragColor = vec4(prev, prev, prev, prev);
    return;
  }

  // ── brush shape ────────────────────────────────────────────────────────────
  float hard      = clamp(uHardness, 0.0, 1.0);
  float softStart = mix(0.0, 0.85, hard);
  float shape     = 1.0 - smoothstep(softStart, 1.0, nd);

  // ── edge-aware factor (toggle: uMasking = 0 OFF, 1 ON) ───────────────────
  // When ON, sample the source image at the brush-centre UV and at the current
  // fragment; pixels whose colour differs from the centre are suppressed.
  // The GPU samples uSource at uCenter directly — no CPU readback needed.
  float edgeAware = 1.0;
  if (uMasking > 0.5) {
    vec3 centerColor = texture2D(uSource, uCenter).rgb;
    vec3 pixelColor  = texture2D(uSource, vUv).rgb;
    float colorDist  = length(pixelColor - centerColor);
    edgeAware = 1.0 - smoothstep(0.0, 0.18, colorDist);
  }

  // ── composite ──────────────────────────────────────────────────────────────
  float dab = clamp(shape * uOpacity * uPressure * edgeAware, 0.0, 1.0);

  float next;
  if (uErase > 0.5) {
    next = prev * (1.0 - dab);
  } else {
    next = max(prev, dab);
  }

  gl_FragColor = vec4(next, next, next, next);
}
`;

const COPY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uCopyTexture;

void main() {
  float mask = texture2D(uCopyTexture, vUv).r;
  gl_FragColor = vec4(mask, mask, mask, mask);
}
`;

export type BrushMaskCacheEntry = {
  maskId: string;
  /** The accumulated brush mask texture. */
  target: WebGLRenderTarget;
  /** Ping-pong second buffer for read-back during stamp loop. */
  pingPong: WebGLRenderTarget;
  /** Live preview target layered over the committed mask while a stroke is active. */
  liveTarget: WebGLRenderTarget;
  /** Ping-pong second buffer for incremental live preview stamps. */
  livePingPong: WebGLRenderTarget;
  strokeCount: number;
  strokeKeys: string[];
  version: number;
  dirty: boolean;
  liveStrokeId: string | null;
  livePointCount: number;
  liveBaseVersion: number;
  liveSignature: string | null;
};

export interface BrushTextureParams {
  renderer: WebGLRenderer;
  /** Pre-graded source texture for edge-aware sampling. */
  sourceTexture: Texture;
  sourceWidth: number;
  sourceHeight: number;
  maskId: string;
  component: BrushMaskComponent;
  /** Optional live stroke appended on top of committed strokes (during painting). */
  liveStroke?: BrushStroke | null;
}

function getBrushMaskResolution(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function makeRenderTarget(width: number, height: number): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    colorSpace: NoColorSpace,
    type: UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function getStrokeCacheKey(stroke: BrushStroke): string {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  return [
    stroke.id,
    stroke.mode,
    stroke.radius,
    stroke.opacity,
    stroke.hardness,
    stroke.masking,
    stroke.points.length,
    first?.x,
    first?.y,
    first?.pressure,
    last?.x,
    last?.y,
    last?.pressure,
  ].join("|");
}

export class BrushMaskTexturePass {
  private readonly cache = new Map<string, BrushMaskCacheEntry>();

  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: ShaderMaterial;
  private readonly copyMaterial: ShaderMaterial;
  private readonly mesh: Mesh;

  /** A 1×1 black texture used to initialise the previous-mask uniform on the very first stamp. */
  private blackTexture: WebGLRenderTarget;

  constructor() {
    this.camera.position.z = 1;

    this.material = new ShaderMaterial({
      uniforms: {
        uPrevMask: { value: null },
        uSource:   { value: null },
        uCenter:   { value: new Vector2(0.5, 0.5) },
        uRadius:   { value: 0.1 },
        uOpacity:  { value: 1.0 },
        uHardness: { value: 0.0 },
        uMasking:  { value: 0.0 },
        uPressure: { value: 1.0 },
        uErase:    { value: 0.0 },
        uAspect:   { value: 1.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest:   false,
      depthWrite:  false,
      transparent: false,
      toneMapped:  false,
    });

    this.copyMaterial = new ShaderMaterial({
      uniforms: {
        uCopyTexture: { value: null },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: COPY_FRAGMENT_SHADER,
      depthTest:   false,
      depthWrite:  false,
      transparent: false,
      toneMapped:  false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.blackTexture = makeRenderTarget(1, 1);
  }

  /**
   * Returns the cached brush texture for maskId, rebuilding it if dirty.
   * The returned target's .texture is a greyscale mask (R channel = mask value).
   */
  getOrBuildTexture(params: BrushTextureParams): WebGLRenderTarget {
    const { renderer, sourceTexture, sourceWidth, sourceHeight, maskId, component, liveStroke } =
      params;

    const committedStrokes = component.brush ?? [];

    const res = getBrushMaskResolution(sourceWidth, sourceHeight);

    let entry = this.cache.get(maskId);

    // Allocate or resize targets if resolution changed.
    if (
      !entry ||
      entry.target.width !== res.width ||
      entry.target.height !== res.height
    ) {
      entry?.target.dispose();
      entry?.pingPong.dispose();
      entry?.liveTarget.dispose();
      entry?.livePingPong.dispose();

      const newEntry: BrushMaskCacheEntry = {
        maskId,
        target:      makeRenderTarget(res.width, res.height),
        pingPong:    makeRenderTarget(res.width, res.height),
        liveTarget:  makeRenderTarget(res.width, res.height),
        livePingPong: makeRenderTarget(res.width, res.height),
        strokeCount: 0,
        strokeKeys:  [],
        version:     0,
        dirty:       true,
        liveStrokeId: null,
        livePointCount: 0,
        liveBaseVersion: -1,
        liveSignature: null,
      };
      this.cache.set(maskId, newEntry);
      entry = newEntry;

      // Clear both to black.
      this.clearTarget(renderer, entry.target);
      this.clearTarget(renderer, entry.pingPong);
      this.clearTarget(renderer, entry.liveTarget);
      this.clearTarget(renderer, entry.livePingPong);
    }

    const strokeKeys = committedStrokes.map(getStrokeCacheKey);
    const prefixMatches = entry.strokeKeys.every(
      (key, index) => strokeKeys[index] === key,
    );
    const canAppend =
      !entry.dirty &&
      prefixMatches &&
      committedStrokes.length > entry.strokeCount;
    const needRebuild =
      entry.dirty ||
      !prefixMatches ||
      committedStrokes.length < entry.strokeCount;

    if (needRebuild) {
      this.clearTarget(renderer, entry.target);

      for (const stroke of committedStrokes) {
        this.stampStroke(renderer, stroke, sourceTexture, entry, sourceWidth, sourceHeight);
      }
    } else if (canAppend) {
      for (const stroke of committedStrokes.slice(entry.strokeCount)) {
        this.stampStroke(renderer, stroke, sourceTexture, entry, sourceWidth, sourceHeight);
      }
    }

    if (needRebuild || canAppend) {
      entry.strokeCount = committedStrokes.length;
      entry.strokeKeys = strokeKeys;
      entry.dirty = false;
      entry.version += 1;
      this.resetLivePreview(entry);
    }

    if (liveStroke) {
      return this.getLivePreviewTexture(
        renderer,
        sourceTexture,
        entry,
        liveStroke,
        sourceWidth,
        sourceHeight,
      );
    }

    return entry.target;
  }

  /** Force a full rebuild on next getOrBuildTexture call. */
  markDirty(maskId: string): void {
    const entry = this.cache.get(maskId);
    if (entry) {
      entry.dirty = true;
      this.resetLivePreview(entry);
    }
  }

  /** Remove cache for a mask (e.g. when mask is deleted). */
  evict(maskId: string): void {
    const entry = this.cache.get(maskId);
    if (entry) {
      entry.target.dispose();
      entry.pingPong.dispose();
      entry.liveTarget.dispose();
      entry.livePingPong.dispose();
      this.cache.delete(maskId);
    }
  }

  /** Dispose cached GPU targets for masks that no longer exist. */
  retain(maskIds: Iterable<string>): void {
    const retained = new Set(maskIds);
    for (const maskId of this.cache.keys()) {
      if (!retained.has(maskId)) this.evict(maskId);
    }
  }

  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.target.dispose();
      entry.pingPong.dispose();
      entry.liveTarget.dispose();
      entry.livePingPong.dispose();
    }
    this.cache.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.copyMaterial.dispose();
    this.blackTexture.dispose();
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private clearTarget(renderer: WebGLRenderer, target: WebGLRenderTarget): void {
    const old = renderer.getRenderTarget();
    const oldClearColor = renderer.getClearColor(new Color());
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clearColor();
    renderer.setRenderTarget(old);
    renderer.setClearColor(oldClearColor, oldClearAlpha);
  }

  private copyTextureToTarget(
    renderer: WebGLRenderer,
    sourceTexture: Texture,
    target: WebGLRenderTarget,
  ): void {
    const oldTarget = renderer.getRenderTarget();
    const oldMaterial = this.mesh.material;
    this.copyMaterial.uniforms.uCopyTexture.value = sourceTexture;
    this.mesh.material = this.copyMaterial;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(oldTarget);
    this.mesh.material = oldMaterial;
  }

  private resetLivePreview(entry: BrushMaskCacheEntry): void {
    entry.liveStrokeId = null;
    entry.livePointCount = 0;
    entry.liveBaseVersion = -1;
    entry.liveSignature = null;
  }

  private getLivePreviewTexture(
    renderer: WebGLRenderer,
    sourceTexture: Texture,
    entry: BrushMaskCacheEntry,
    liveStroke: BrushStroke,
    sourceWidth: number,
    sourceHeight: number,
  ): WebGLRenderTarget {
    const signature = [
      liveStroke.id,
      liveStroke.mode,
      liveStroke.radius,
      liveStroke.opacity,
      liveStroke.hardness,
      liveStroke.masking,
    ].join("|");

    const shouldReset =
      entry.liveStrokeId !== liveStroke.id ||
      entry.liveBaseVersion !== entry.version ||
      entry.liveSignature !== signature ||
      liveStroke.points.length < entry.livePointCount;

    if (shouldReset) {
      this.copyTextureToTarget(renderer, entry.target.texture, entry.liveTarget);
      this.clearTarget(renderer, entry.livePingPong);
      entry.liveStrokeId = liveStroke.id;
      entry.livePointCount = 0;
      entry.liveBaseVersion = entry.version;
      entry.liveSignature = signature;
    }

    if (liveStroke.points.length > entry.livePointCount) {
      const newPoints = liveStroke.points.slice(entry.livePointCount);
      const liveBuffers = {
        target: entry.liveTarget,
        pingPong: entry.livePingPong,
      };
      this.stampPoints(
        renderer,
        liveStroke,
        newPoints,
        sourceTexture,
        liveBuffers,
        sourceWidth,
        sourceHeight,
      );
      entry.liveTarget = liveBuffers.target;
      entry.livePingPong = liveBuffers.pingPong;
      entry.livePointCount = liveStroke.points.length;
    }

    return entry.liveTarget;
  }

  private stampStroke(
    renderer: WebGLRenderer,
    stroke: BrushStroke,
    sourceTexture: Texture,
    entry: BrushMaskCacheEntry,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    this.stampPoints(
      renderer,
      stroke,
      stroke.points,
      sourceTexture,
      entry,
      sourceWidth,
      sourceHeight,
    );
  }

  private stampPoints(
    renderer: WebGLRenderer,
    stroke: BrushStroke,
    points: BrushPoint[],
    sourceTexture: Texture,
    buffers: Pick<BrushMaskCacheEntry, "target" | "pingPong">,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    const u = this.material.uniforms;
    const isErase = stroke.mode === "erase";

    for (const pt of points) {
      if (!pt) continue;

      u.uPrevMask.value = buffers.target.texture;
      u.uSource.value   = sourceTexture;
      u.uCenter.value.set(pt.x, pt.y);
      u.uRadius.value   = Math.max(0.0001, stroke.radius);
      u.uOpacity.value  = stroke.opacity;
      u.uHardness.value = stroke.hardness;
      u.uMasking.value  = stroke.masking;
      u.uPressure.value = pt.pressure;
      u.uErase.value    = isErase ? 1.0 : 0.0;
      u.uAspect.value   = sourceHeight / Math.max(1, sourceWidth);

      this.material.needsUpdate = false; // uniforms update is enough

      const old = renderer.getRenderTarget();
      renderer.setRenderTarget(buffers.pingPong);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(old);

      const tmp = buffers.target;
      buffers.target = buffers.pingPong;
      buffers.pingPong = tmp;
    }
  }
}
