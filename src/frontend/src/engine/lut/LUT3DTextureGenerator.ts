import {
  ClampToEdgeWrapping,
  Data3DTexture,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { LUT_SIZE, LUT_TEXTURE_SIZE, LUT_TILE_COUNT } from "./lutConstants";

export class LUT3DTextureGenerator {
  private textureValue?: Data3DTexture;
  private textureType: typeof HalfFloatType | typeof UnsignedByteType = UnsignedByteType;

  /**
   * Uploads the atlas as a 3D LUT. Half-float input (Uint16Array of binary16 bit
   * patterns) produces an RGBA16F texture preserving the render target's precision;
   * 8-bit input (Uint8Array) produces an RGBA8 texture (no-float fallback). The
   * texture is recreated only when the precision changes (otherwise data is swapped).
   */
  updateFromAtlasPixels(
    atlasPixels: Uint8Array | Uint16Array | Float32Array,
    atlasWidth = LUT_TEXTURE_SIZE,
    atlasHeight = LUT_TEXTURE_SIZE,
  ): void {
    const data = atlasPixelsToData3D(atlasPixels, atlasWidth, atlasHeight);
    const type = data instanceof Uint16Array ? HalfFloatType : UnsignedByteType;

    if (!this.textureValue || this.textureType !== type) {
      this.textureValue?.dispose();
      this.textureType = type;
      this.textureValue = new Data3DTexture(data as any, LUT_SIZE, LUT_SIZE, LUT_SIZE);
      this.textureValue.format = RGBAFormat;
      this.textureValue.type = type;
      this.textureValue.minFilter = LinearFilter;
      this.textureValue.magFilter = LinearFilter;
      this.textureValue.wrapS = ClampToEdgeWrapping;
      this.textureValue.wrapT = ClampToEdgeWrapping;
      this.textureValue.wrapR = ClampToEdgeWrapping;
      this.textureValue.generateMipmaps = false;
      this.textureValue.unpackAlignment = 1;
      this.textureValue.colorSpace = NoColorSpace;
    } else {
      this.textureValue.image.data = data as any;
    }

    this.textureValue.needsUpdate = true;
  }

  get texture(): Data3DTexture {
    if (!this.textureValue) {
      throw new Error("3D LUT texture has not been initialized");
    }
    return this.textureValue;
  }

  get hasTexture(): boolean {
    return !!this.textureValue;
  }

  dispose(): void {
    this.textureValue?.dispose();
    this.textureValue = undefined;
  }
}

export function atlasPixelsToData3D(
  atlasPixels: Uint8Array | Uint16Array | Float32Array,
  atlasWidth: number,
  atlasHeight: number,
  size = LUT_SIZE,
  tileCount = LUT_TILE_COUNT,
): Uint8Array | Uint16Array {
  const expectedWidth = size * tileCount;
  const expectedHeight = size * Math.ceil(size / tileCount);

  if (atlasWidth !== expectedWidth || atlasHeight !== expectedHeight) {
    throw new Error(
      `Unexpected LUT atlas size ${atlasWidth}x${atlasHeight}; expected ${expectedWidth}x${expectedHeight}`,
    );
  }

  // Half-float input: copy the binary16 bit patterns verbatim into a Uint16 grid.
  const half = atlasPixels instanceof Uint16Array;
  const data = half
    ? new Uint16Array(size * size * size * 4)
    : new Uint8Array(size * size * size * 4);

  for (let b = 0; b < size; b += 1) {
    const tileX = b % tileCount;
    const tileY = Math.floor(b / tileCount);

    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const atlasX = tileX * size + r;
        const atlasY = tileY * size + g;
        const srcIndex = (atlasY * atlasWidth + atlasX) * 4;
        const dstIndex = (b * size * size + g * size + r) * 4;

        if (half) {
          data[dstIndex] = atlasPixels[srcIndex];
          data[dstIndex + 1] = atlasPixels[srcIndex + 1];
          data[dstIndex + 2] = atlasPixels[srcIndex + 2];
          data[dstIndex + 3] = atlasPixels[srcIndex + 3];
        } else {
          data[dstIndex] = readAtlasByte(atlasPixels, srcIndex);
          data[dstIndex + 1] = readAtlasByte(atlasPixels, srcIndex + 1);
          data[dstIndex + 2] = readAtlasByte(atlasPixels, srcIndex + 2);
          data[dstIndex + 3] = readAtlasByte(atlasPixels, srcIndex + 3);
        }
      }
    }
  }

  return data;
}

function readAtlasByte(pixels: Uint8Array | Uint16Array | Float32Array, index: number): number {
  const value = pixels[index];
  if (pixels instanceof Uint8Array || pixels instanceof Uint16Array) {
    return value ?? 0;
  }

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}
