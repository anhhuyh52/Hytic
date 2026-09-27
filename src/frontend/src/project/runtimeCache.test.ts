import { describe, expect, it, vi } from "vitest";
import { RuntimeResourceLRU, defaultRuntimeCacheBudget } from "./runtimeCache";

describe("runtime resource LRU", () => {
  it("bounds default budgets", () => {
    expect(defaultRuntimeCacheBudget(0.5)).toBe(128 * 1024 * 1024);
    expect(defaultRuntimeCacheBudget(64)).toBe(1024 * 1024 * 1024);
  });

  it("evicts inactive textures before render resources and preserves pins", () => {
    const cache = new RuntimeResourceLRU(128 * 1024 * 1024);
    const disposed = { inactive: vi.fn(), active: vi.fn(), target: vi.fn() };
    const mb = 1024 * 1024;
    cache.put({ key: "target", bytes: 60 * mb, kind: "render-target", dispose: disposed.target });
    cache.put({ key: "active", bytes: 60 * mb, kind: "texture", pinned: true, dispose: disposed.active });
    cache.put({ key: "inactive", bytes: 20 * mb, kind: "inactive-texture", dispose: disposed.inactive });

    expect(disposed.inactive).toHaveBeenCalledOnce();
    expect(disposed.active).not.toHaveBeenCalled();
    expect(disposed.target).not.toHaveBeenCalled();
    expect(cache.usedBytes).toBe(120 * mb);
  });

  it("uses LRU order within an eviction class", () => {
    const cache = new RuntimeResourceLRU(128 * 1024 * 1024);
    const first = vi.fn();
    const second = vi.fn();
    const mb = 1024 * 1024;
    cache.put({ key: "first", bytes: 50 * mb, kind: "texture", dispose: first });
    cache.put({ key: "second", bytes: 50 * mb, kind: "texture", dispose: second });
    cache.get("first");
    cache.put({ key: "extra", bytes: 40 * mb, kind: "texture", dispose: vi.fn() });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
