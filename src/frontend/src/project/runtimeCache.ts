export type CacheResource = {
  key: string;
  bytes: number;
  kind: "inactive-texture" | "texture" | "render-target" | "lut";
  pinned?: boolean;
  dispose(): void;
};

export function defaultRuntimeCacheBudget(deviceMemory?: number): number {
  const memory = Number(deviceMemory) || 4;
  return Math.max(128, Math.min(1024, Math.round(memory * 128))) * 1024 * 1024;
}

export class RuntimeResourceLRU {
  private readonly resources = new Map<string, CacheResource>();
  private used = 0;

  constructor(private budget = defaultRuntimeCacheBudget()) {}

  get usedBytes(): number { return this.used; }
  get budgetBytes(): number { return this.budget; }

  setBudget(bytes: number): void {
    this.budget = Math.max(128 * 1024 * 1024, Math.min(1024 * 1024 * 1024, bytes));
    this.evict();
  }

  get<T extends CacheResource = CacheResource>(key: string): T | undefined {
    const resource = this.resources.get(key);
    if (!resource) return undefined;
    this.resources.delete(key);
    this.resources.set(key, resource);
    return resource as T;
  }

  put(resource: CacheResource): void {
    const previous = this.resources.get(resource.key);
    if (previous) {
      this.used -= previous.bytes;
      if (previous !== resource) previous.dispose();
      this.resources.delete(resource.key);
    }
    resource.bytes = Math.max(0, resource.bytes);
    this.resources.set(resource.key, resource);
    this.used += resource.bytes;
    this.evict();
  }

  pin(key: string, pinned = true): void {
    const resource = this.resources.get(key);
    if (resource) resource.pinned = pinned;
  }

  delete(key: string): void {
    const resource = this.resources.get(key);
    if (!resource) return;
    this.resources.delete(key);
    this.used -= resource.bytes;
    resource.dispose();
  }

  clear(includePinned = false): void {
    for (const [key, resource] of [...this.resources]) {
      if (resource.pinned && !includePinned) continue;
      this.delete(key);
    }
  }

  private evict(): void {
    if (this.used <= this.budget) return;
    const priority = ["inactive-texture", "texture", "render-target", "lut"] as const;
    for (const kind of priority) {
      for (const [key, resource] of [...this.resources]) {
        if (this.used <= this.budget) return;
        if (resource.pinned || resource.kind !== kind) continue;
        this.delete(key);
      }
    }
  }
}
