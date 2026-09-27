import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  type Texture,
} from "three";

// Loads a legacy 64³ "*_CUBE64_RGB16.json" color-space-conversion LUT and packs
// it into a 512×512 RGBA half-float atlas (8×8 tiles of 64×64; blue index b ->
// tile (b%8, floor(b/8)), x=r, y=g) matching cubeAtlas.glsl's sampleCubeAtlas.
//
// The JSON is a flat array of 64³·3 uint16 HALF-FLOAT bit patterns (RGB, red the
// fastest axis: index = (r + g·64 + b·64²)·3; 0x3C00 == 1.0). We upload those
// patterns straight to a HalfFloatType texture — no CPU decode — so the shader
// samples real [0,1] floats. See [[legacy-look-needs-aces-rrt-odt]].

const N = 64;
const TILES = 8;
const TS = N * TILES; // 512
const HALF_ONE = 0x3c00; // half-float 1.0 (alpha)

export async function loadCubeAtlas(lut: string): Promise<Texture> {
  const res = await fetch(`/assets/luts/csc/${lut}`);
  if (!res.ok) throw new Error(`cube fetch failed ${lut}: ${res.status}`);
  const data = (await res.json()) as number[];
  if (!Array.isArray(data) || data.length !== N * N * N * 3) {
    throw new Error(
      `cube ${lut} unexpected length ${Array.isArray(data) ? data.length : typeof data}`,
    );
  }

  const out = new Uint16Array(TS * TS * 4);
  for (let b = 0; b < N; b += 1) {
    const tileX = (b % TILES) * N;
    const tileY = Math.floor(b / TILES) * N;
    for (let g = 0; g < N; g += 1) {
      const py = tileY + g;
      for (let r = 0; r < N; r += 1) {
        const src = (r + g * N + b * N * N) * 3;
        const o = (py * TS + (tileX + r)) * 4;
        out[o] = data[src];
        out[o + 1] = data[src + 1];
        out[o + 2] = data[src + 2];
        out[o + 3] = HALF_ONE;
      }
    }
  }

  const tex = new DataTexture(out, TS, TS, RGBAFormat, HalfFloatType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
