import type { Texture } from "three";
import type { OverlaySourceType } from "./overlayTypes";

export interface OverlayTextureRecord {
  id: string;
  sourceType: OverlaySourceType;
  texture: Texture;
  thumbnailUrl?: string;
  width: number;
  height: number;
  dispose(): void;
}

export class OverlayTextureRegistry {
  private readonly records = new Map<string, OverlayTextureRecord>();

  register(record: OverlayTextureRecord): void {
    const previous = this.records.get(record.id);
    if (previous && previous !== record) previous.dispose();
    this.records.set(record.id, record);
  }

  get(id: string): OverlayTextureRecord | undefined { return this.records.get(id); }

  remove(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    record.dispose();
  }

  clear(): void {
    for (const record of this.records.values()) record.dispose();
    this.records.clear();
  }
}

export const overlayTextureRegistry = new OverlayTextureRegistry();
