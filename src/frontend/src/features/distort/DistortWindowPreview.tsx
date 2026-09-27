import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector4,
  WebGLRenderer,
  type IUniform,
} from "three";
import type { DistortionPoints, DistortState, PerspectiveHandleId } from "./distortTypes";
import { limitDistortionPoints } from "./perspectiveMath";
import {
  applyDistortUniforms,
  createDistortUniforms,
  distortionInverseGLSL,
  distortionUniformDeclarationsGLSL,
} from "./distortShader";
import { PerspectiveGrid } from "./PerspectiveGrid";
import { PerspectiveHandle } from "./PerspectiveHandle";

type ScreenPoint = { x: number; y: number };
type DragState = {
  id: PerspectiveHandleId;
  pointerId: number;
  start: ScreenPoint;
  startClip: [number, number];
  points: DistortionPoints;
  raf: number;
  pending: DistortionPoints;
};

// Reference point order is y-up: [bottom-left, bottom-right, top-left,
// top-right] (its autoCrop reads the top edge from points 2/3). Array offsets
// are point index * 2.
const HANDLE_INDICES: Record<
  Exclude<PerspectiveHandleId, "top" | "right" | "bottom" | "left" | "center">,
  number
> = {
  "bottom-left": 0,
  "bottom-right": 2,
  "top-left": 4,
  "top-right": 6,
};

const LEGACY_HANDLE_INSET = 0.56;

export type CropSourceData = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
};

const PREVIEW_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Same warp math as the main viewer/export (shared distortionInverseGLSL), but
// out-of-bounds output stays transparent so the dialog's grid/backdrop shows
// through instead of opaque black.
const PREVIEW_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uImage;
uniform vec4 uImageRect;
${distortionUniformDeclarationsGLSL}

varying vec2 vUv;

${distortionInverseGLSL}

void main() {
  vec2 imageUv = (vUv - uImageRect.xy) / uImageRect.zw;
  vec3 distortionLookup = uDistortionEnabled ? applyDistortionInverse(imageUv) : vec3(imageUv, 1.0);
  if (distortionLookup.z < 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  vec2 sourceUv = distortionLookup.xy;

  if (sourceUv.x < 0.0 || sourceUv.x > 1.0 || sourceUv.y < 0.0 || sourceUv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec2 sampleUv = vec2(sourceUv.x, 1.0 - sourceUv.y);
  gl_FragColor = texture2D(uImage, sampleUv);
}
`;

export function DistortWindowPreview(props: {
  draft: DistortState;
  gridSize: [number, number];
  sourceData?: CropSourceData;
  onInput: (draft: DistortState, reason: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  interactionDisabled?: boolean;
}) {
  let rootRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;

  const [size, setSize] = createSignal({ width: 1, height: 1 });
  const sourceData = () => {
    const source = props.sourceData;
    if (!source) return undefined;
    const width = Math.floor(source.width);
    const height = Math.floor(source.height);
    const requiredBytes = width * height * 4;
    if (
      width < 1 ||
      height < 1 ||
      width > 32_768 ||
      height > 32_768 ||
      !Number.isSafeInteger(requiredBytes) ||
      source.buffer.byteLength < requiredBytes
    ) {
      return undefined;
    }
    return { ...source, width, height };
  };
  let observer: ResizeObserver | undefined;

  onMount(() => {
    observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    observer.observe(rootRef);
    const rect = rootRef.getBoundingClientRect();
    setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });

    onCleanup(() => {
      observer?.disconnect();
    });
  });

  const previewSize = () => {
    const stage = size();
    const source = sourceData();
    if (!source) return { width: stage.width, height: stage.height, scale: 1 };

    const scale = Math.min(
      (stage.width * 0.9) / Math.max(1, source.width),
      (stage.height * 0.9) / Math.max(1, source.height),
    );

    return {
      width: Math.max(1, source.width * scale),
      height: Math.max(1, source.height * scale),
      scale,
    };
  };

  const imageRect = () => {
    const stage = size();
    const prev = previewSize();
    return {
      left: (stage.width - prev.width) / 2,
      top: (stage.height - prev.height) / 2,
      width: prev.width,
      height: prev.height,
    };
  };

  // ── Draft-state WebGL preview ────────────────────────────────────────────
  // Renders the source image warped by the *draft* distort state through the
  // shared shader logic. Visual-only: the export pipeline never sees this
  // renderer, and the main viewer keeps rendering committed state.
  const uniforms: Record<string, IUniform> = {
    uImage: { value: null },
    uImageRect: { value: new Vector4(0, 0, 1, 1) },
    ...createDistortUniforms(),
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: PREVIEW_VERTEX_SHADER,
    fragmentShader: PREVIEW_FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new Mesh(geometry, material));

  let renderer: WebGLRenderer | undefined;
  const [glReady, setGlReady] = createSignal(false);

  onMount(() => {
    try {
      renderer = new WebGLRenderer({ canvas: canvasRef, alpha: true, antialias: false });
    } catch {
      renderer = undefined;
      return;
    }
    // Transparent clear: the dialog backdrop stays visible around the warp.
    renderer.setClearColor(0x000000, 0);
    setGlReady(true);
  });

  const [texture, setTexture] = createSignal<DataTexture | null>(null);

  createEffect(() => {
    const source = sourceData();
    setTexture((previous) => {
      previous?.dispose();
      return null;
    });
    if (!source) return;

    // Rows are top-down (ImageData order); sampled with a Y flip in the
    // fragment shader, matching the engine's uFlipSourceY convention.
    const next = new DataTexture(
      new Uint8Array(source.buffer.slice(0, source.width * source.height * 4)),
      source.width,
      source.height,
      RGBAFormat,
      UnsignedByteType,
    );
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.wrapS = ClampToEdgeWrapping;
    next.wrapT = ClampToEdgeWrapping;
    next.generateMipmaps = false;
    next.needsUpdate = true;
    setTexture(next);
  });

  createEffect(() => {
    const gl = glReady() ? renderer : undefined;
    const tex = texture();
    const source = sourceData();
    const stage = size();
    const rect = imageRect();
    const draft = props.draft;
    if (!gl || !tex || !source) return;

    // A capped DPR keeps the fullscreen preview sharp without allocating an
    // excessive drawing buffer on high-density mobile displays.
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    gl.setPixelRatio(dpr);
    gl.setSize(Math.round(stage.width), Math.round(stage.height), false);

    uniforms.uImage.value = tex;
    // Image rect in canvas UV space (bottom-left origin, like the quad's uv).
    uniforms.uImageRect.value.set(
      rect.left / stage.width,
      (stage.height - rect.top - rect.height) / stage.height,
      rect.width / stage.width,
      rect.height / stage.height,
    );
    applyDistortUniforms(uniforms, draft, { width: source.width, height: source.height });
    gl.render(scene, camera);
  });

  onCleanup(() => {
    texture()?.dispose();
    material.dispose();
    geometry.dispose();
    renderer?.dispose();
  });

  // ── Perspective handle dragging ──────────────────────────────────────────
  let drag: DragState | null = null;
  const livePoints = () => props.draft.distortionPoints;

  // Point space is y-up (clip y = +1 at the displayed top), matching the
  // engine/reference; screen space is top-down CSS, so the y axis flips here.
  const mapPoint = (x: number, y: number): ScreenPoint => {
    const rect = imageRect();
    return {
      x: rect.left + ((x + 1) * 0.5) * rect.width,
      y: rect.top + (1 - (y + 1) * 0.5) * rect.height,
    };
  };

  const screenToClip = (event: PointerEvent): [number, number] => {
    const bounds = rootRef?.getBoundingClientRect();
    if (!bounds) return [0, 0];
    const rect = imageRect();
    const x = ((event.clientX - bounds.left - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const y = 1 - ((event.clientY - bounds.top - rect.top) / Math.max(1, rect.height)) * 2;
    return [x, y];
  };

  const mapHandlePoint = (x: number, y: number): ScreenPoint =>
    mapPoint(x * LEGACY_HANDLE_INSET, y * LEGACY_HANDLE_INSET);

  const handlePoint = (id: PerspectiveHandleId): ScreenPoint => {
    const p = livePoints();
    if (id === "top") return midpoint(mapHandlePoint(p[4], p[5]), mapHandlePoint(p[6], p[7]));
    if (id === "right") return midpoint(mapHandlePoint(p[2], p[3]), mapHandlePoint(p[6], p[7]));
    if (id === "bottom") return midpoint(mapHandlePoint(p[0], p[1]), mapHandlePoint(p[2], p[3]));
    if (id === "left") return midpoint(mapHandlePoint(p[0], p[1]), mapHandlePoint(p[4], p[5]));
    if (id === "center") {
      const a = mapHandlePoint(p[0], p[1]);
      const b = mapHandlePoint(p[2], p[3]);
      const c = mapHandlePoint(p[4], p[5]);
      const d = mapHandlePoint(p[6], p[7]);
      return { x: (a.x + b.x + c.x + d.x) * 0.25, y: (a.y + b.y + c.y + d.y) * 0.25 };
    }
    const index = HANDLE_INDICES[id];
    return mapHandlePoint(p[index], p[index + 1]);
  };

  const startDrag = (id: PerspectiveHandleId, event: PointerEvent) => {
    if (props.interactionDisabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    drag = {
      id,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      startClip: screenToClip(event),
      points: [...livePoints()] as DistortionPoints,
      pending: [...livePoints()] as DistortionPoints,
      raf: 0,
    };
    props.onDragStart();
    event.preventDefault();
    event.stopPropagation();
  };

  const moveDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.pending = nextPointsForDrag(drag, screenToClip(event));
    if (!drag.raf) {
      drag.raf = requestAnimationFrame(() => {
        if (!drag) return;
        drag.raf = 0;
        props.onInput(
          {
            ...props.draft,
            enabled: true,
            perspectiveMode: true,
            distortionPoints: drag.pending,
          },
          "distort-perspective-drag",
        );
      });
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = drag.pending;
    cancelAnimationFrame(drag.raf);
    drag = null;
    props.onInput(
      {
        ...props.draft,
        enabled: true,
        perspectiveMode: true,
        distortionPoints: next,
      },
      "distort-perspective",
    );
    props.onDragEnd();
    event.preventDefault();
    event.stopPropagation();
  };

  const cancelDrag = (pointerId?: number) => {
    if (!drag || (pointerId !== undefined && pointerId !== drag.pointerId)) return;
    if (drag.raf) cancelAnimationFrame(drag.raf);
    drag = null;
    props.onDragEnd();
  };

  return (
    <div
      ref={rootRef}
      class="distort-preview-stage"
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={(event) => {
        cancelDrag(event.pointerId);
        event.stopPropagation();
      }}
      onLostPointerCapture={(event) => cancelDrag(event.pointerId)}
    >
      <canvas ref={canvasRef} class="distort-preview-stage__canvas" />

      <PerspectiveGrid
        rect={imageRect()}
        visible={props.gridSize[0] > 0 || props.draft.showGrid}
        rows={props.gridSize[1]}
        cols={props.gridSize[0]}
      />

      {(
        [
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
          "top",
          "right",
          "bottom",
          "left",
          "center",
        ] as PerspectiveHandleId[]
      ).map((id) => {
        const point = handlePoint(id);
        return (
          <PerspectiveHandle
            id={id}
            x={point.x}
            y={point.y}
            disabled={props.interactionDisabled}
            onPointerDown={(event) => startDrag(id, event)}
          />
        );
      })}

      <Show when={!texture()}>
        <div class="editor-transform-window__busy editor-transform-window__busy--stage">
          <div class="spinner" />
          <span>Loading Original File...</span>
        </div>
      </Show>
    </div>
  );
}

function nextPointsForDrag(drag: DragState, clip: [number, number]): DistortionPoints {
  const next = [...drag.points] as DistortionPoints;
  // Handles are visually inset from the actual quad corners. Compensate for
  // that scale so the dragged handle remains under the pointer.
  const dx = (clip[0] - drag.startClip[0]) / LEGACY_HANDLE_INSET;
  const dy = (clip[1] - drag.startClip[1]) / LEGACY_HANDLE_INSET;
  const move = (index: number, xDelta = dx, yDelta = dy) => {
    next[index] = drag.points[index] + xDelta;
    next[index + 1] = drag.points[index + 1] + yDelta;
  };

  if (drag.id === "top") {
    move(4);
    move(6);
  } else if (drag.id === "right") {
    move(2);
    move(6);
  } else if (drag.id === "bottom") {
    move(0);
    move(2);
  } else if (drag.id === "left") {
    move(4);
    move(0);
  } else if (drag.id === "center") {
    move(0);
    move(2);
    move(4);
    move(6);
  } else {
    move(HANDLE_INDICES[drag.id]);
  }

  return limitDistortionPoints(next, drag.points, drag.id);
}

function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}
