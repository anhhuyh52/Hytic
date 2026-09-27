import { solidStart } from "@solidjs/start/config";
import { defineConfig } from "vite";
import { nitroV2Plugin } from "@solidjs/vite-plugin-nitro-2";

const applicationRoutes = ["/", "/editor", "/vi", "/vi/editor"];

export default defineConfig({
 plugins: [
      solidStart({
        middleware: "./src/middleware/index.ts",
      }),
      nitroV2Plugin({
        // This application is deployed as static files. The plugin defaults
        // to `node-server` and its explicit default takes
        // precedence over NITRO_PRESET, so configure the preset here.
        preset: "static",
        compressPublicAssets: true,
        prerender: {
          routes: applicationRoutes,
          crawlLinks: false,
        },
        routeRules: {
          "/_build/**": {
            headers: {
              "cache-control": "public, max-age=31536000, immutable",
            },
          },
          "/assets/**": {
            headers: {
              "cache-control": "public, max-age=31536000, immutable",
            },
          },
        },
      }),
    ],
  server: {
    host: true,
  },
  ssr: {
    // SolidStart 2 uses H3 v2 while Nitro 2 still uses H3 v1 internally.
    // Bundle SolidStart's H3 into the SSR output so Nitro does not resolve the
    // framework imports against its own incompatible H3 dependency.
    noExternal: ["h3"],
  },
  optimizeDeps: {
    // Pre-bundle large/CJS/dynamically imported deps so dev doesn't pause/reload
    // when an editor, codec, QR, toast, or video path is first opened.
    include: [
      "three",
      "exifreader",
      "upng-js",
      "qrcode",
      "solid-toast",
      "libheif-js/wasm-bundle",
      "libraw-wasm",
      "mediabunny",
      // SolidStart's dev error overlay imports this CommonJS package with a
      // named ESM import. It must be pre-bundled or the overlay itself crashes.
      "source-map-js",
    ],
    // Keep discovery enabled for transitive CommonJS dependencies. Restricting
    // optimization to this list caused source-map-js to be served as raw CJS.
    noDiscovery: false,
  },
  // Keep large, independently cached runtimes out of feature chunks. Dynamic
  // imports still decide when these are requested; manual chunks only make the
  // resulting browser cache boundaries stable across editor releases.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/three/") || id.includes("\\three\\")) return "vendor-three";
          if (id.includes("/mediabunny/") || id.includes("\\mediabunny\\")) return "vendor-video";
          if (id.includes("/exifreader/") || id.includes("\\exifreader\\")) return "vendor-metadata";
          if (
            id.includes("/upng-js/") ||
            id.includes("\\upng-js\\") ||
            id.includes("/utif/") ||
            id.includes("\\utif\\")
          )
            return "vendor-codecs";
          return undefined;
        },
      },
    },
  },
  // ES-module workers so the decode worker can code-split its dynamic import()
  // (libheif WASM loads only when a HEIC is decoded).
  worker: {
    format: "es",
  },
});
