import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadWithPersistedState(state: Record<string, unknown>) {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => JSON.stringify(state)),
    setItem: vi.fn(),
  });
  vi.resetModules();
  return import("./exportStore");
}

describe("persisted export settings", () => {
  it("migrates the legacy cio gamma name", async () => {
    const { exportState } = await loadWithPersistedState({ gammaCurve: "kalar" });
    expect(exportState.gammaCurve).toBe("kalar");
  });

  it("drops unsupported gamma values", async () => {
    const { exportState } = await loadWithPersistedState({ gammaCurve: "unknown" });
    expect(exportState.gammaCurve).toBe("kalar");
  });
});
