import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

export type FullscreenPassResources = {
  scene: Scene;
  camera: OrthographicCamera;
  geometry: PlaneGeometry;
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
};

export function createFullscreenResources(material: ShaderMaterial): FullscreenPassResources {
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new PlaneGeometry(2, 2, 1, 1);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, camera, geometry, mesh };
}

export function renderPassToTarget(
  renderer: WebGLRenderer,
  resources: Pick<FullscreenPassResources, "scene" | "camera">,
  target: WebGLRenderTarget | null,
) {
  const previousTarget = renderer.getRenderTarget();
  const previousViewport = new Vector4();
  renderer.getViewport(previousViewport);

  renderer.setRenderTarget(target);
  try {
    renderer.render(resources.scene, resources.camera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(previousViewport);
  }
}
