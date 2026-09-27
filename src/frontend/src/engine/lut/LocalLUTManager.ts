import type { WebGLRenderer } from "three";
import { LUTGenerator } from "./LUTGenerator";
import { LUT3DTextureGenerator } from "./LUT3DTextureGenerator";
import {
  type LocalAdjustmentLayer,
  type EditState,
  DEFAULT_EDIT_STATE,
  cloneEditState,
  cloneColorState,
  cloneLocalAdjustmentLayer,
} from "../state/EditState";
import type { LUTTextureHandle } from "./LUTStorageTypes";
import { LUT_SIZE } from "./lutConstants";

export class LocalLUTManager {
  private readonly luts = new Map<
    string,
    {
      generator: LUTGenerator;
      texture3D: LUT3DTextureGenerator;
    }
  >();
  private readonly renderer: WebGLRenderer;
  private readonly onAsyncUpdate?: () => void;

  constructor(renderer: WebGLRenderer, onAsyncUpdate?: () => void) {
    this.renderer = renderer;
    this.onAsyncUpdate = onAsyncUpdate;
  }

  update(
    layers: LocalAdjustmentLayer[],
    globalEditState: EditState,
  ): Array<{ layer: LocalAdjustmentLayer; handle: LUTTextureHandle }> {
    const activeIds = new Set<string>();

    for (const layer of layers) {
      if (!layer.enabled) continue;
      activeIds.add(layer.id);

      let lutData = this.luts.get(layer.id);
      if (!lutData) {
        const generator = new LUTGenerator(this.renderer, this.onAsyncUpdate);
        generator.updateColorManagement(globalEditState.colorManagement);
        const texture3D = new LUT3DTextureGenerator();
        lutData = {
          generator,
          texture3D,
        };
        this.luts.set(layer.id, lutData);
      } else {
        lutData.generator.updateColorManagement(globalEditState.colorManagement);
      }

      // Merge the local adjustments into a fresh clean base state.
      // Important: clone the layer adjustments before feeding LUTGenerator so Solid store
      // proxies / nested object replacement cannot make the local LUT compare against a
      // stale object and appear unchanged from the masking accordion.
      const localState: EditState = {
        ...cloneEditState(DEFAULT_EDIT_STATE),
        ...cloneColorState(layer.adjustments),
        colorManagement: globalEditState.colorManagement,
      };

      // Since updateColorState checks for structural equality, it will correctly set needsUpdate = true
      // if layer.adjustments has changed.
      lutData.generator.updateColorState(localState);

      if (lutData.generator.needsUpdate) {
        lutData.generator.render();
        const atlas = lutData.generator.readAtlasRGBA16F() ?? lutData.generator.readAtlasRGBA8();
        lutData.texture3D.updateFromAtlasPixels(atlas);
      }
    }

    for (const [id, data] of this.luts.entries()) {
      if (!activeIds.has(id)) {
        data.generator.dispose();
        data.texture3D.dispose();
        this.luts.delete(id);
      }
    }

    return layers
      .filter((layer) => layer.enabled)
      .flatMap((layer) => {
        const data = this.luts.get(layer.id);
        if (!data?.texture3D.hasTexture) return [];

        return [
          {
            layer: cloneLocalAdjustmentLayer(layer, { cloneBrushPoints: false }),
            handle: { kind: "3d-texture" as const, texture: data.texture3D.texture, size: LUT_SIZE },
          },
        ];
      });
  }

  dispose() {
    for (const data of this.luts.values()) {
      data.generator.dispose();
      data.texture3D.dispose();
    }
    this.luts.clear();
  }
}
