/**
 * Resolves the API object of an old CJS/UMD library across the different shapes Vite produces:
 *  - dev (unbundled ESM env): the lib's `else { window.X = X }` branch runs → read the global;
 *  - prod (esbuild/Rollup CJS interop): the value is on the namespace or `.default`.
 * `probe` is a method name expected on the real API object (e.g. "encode" / "decode").
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveCjs(mod: unknown, globalName: string, probe: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any;
  if (m && typeof m[probe] === "function") return m;
  if (m?.default && typeof m.default[probe] === "function") return m.default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (globalThis as any)[globalName];
  if (g && typeof g[probe] === "function") return g;
  throw new Error(`Codec "${globalName}" is unavailable (no "${probe}")`);
}
