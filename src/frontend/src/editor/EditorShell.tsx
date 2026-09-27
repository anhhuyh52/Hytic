import {
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import { Toaster } from "solid-toast";

type PotoAppModule = typeof import("../poto/MainApp");

let potoAppModulePromise: Promise<PotoAppModule> | undefined;

function loadPotoAppModule(): Promise<PotoAppModule> {
  if (!potoAppModulePromise) {
    potoAppModulePromise = import("../poto/MainApp").catch((error) => {
      potoAppModulePromise = undefined;
      throw error;
    });
  }
  return potoAppModulePromise;
}

function preloadEditor(): void {
  // Load the editor shell first. PotoApp's Viewer suspense boundary requests the
  // Three/WebGL chunk after the shell has mounted; fetching and compiling both
  // large chunks together caused a long first-load main-thread stall.
  void loadPotoAppModule().catch(() => {
    // Preloading is best effort. The lazy boundary retries and surfaces a real
    // load failure if the editor is still requested after a transient error.
  });
}

const MainApp = lazy(() =>
  loadPotoAppModule().then((module) => ({ default: module.PotoApp })),
);

function missingCoreCapabilities(): string[] {
  const missing: string[] = [];
  if (typeof WebAssembly === "undefined") missing.push("WebAssembly");
  if (typeof Worker === "undefined") missing.push("Web Workers");
  if (typeof OffscreenCanvas === "undefined") missing.push("OffscreenCanvas");

  const canvas = document.createElement("canvas");
  if (!canvas.getContext("webgl2")) missing.push("WebGL 2");
  return missing;
}

type StorageCapability = "checking" | "opfs" | "indexeddb" | "memory-fallback" | "unavailable";

type EditorStartupState = {
  shellReady: boolean;
  ready: boolean;
  hasImage: boolean;
  loadingImage: boolean;
};

async function detectStorageCapability(): Promise<Exclude<StorageCapability, "checking">> {
  if (typeof navigator?.storage?.getDirectory === "function") {
    try {
      await navigator.storage.getDirectory();
      return "opfs";
    } catch {
      // Fall through to the next persistent backend.
    }
  }

  if (typeof indexedDB !== "undefined") {
    const testName = `kalar-storage-check-${Date.now().toString(36)}`;
    try {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(testName, 1);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
        request.onblocked = () => reject(new Error("IndexedDB blocked"));
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
      indexedDB.deleteDatabase(testName);
      return "indexeddb";
    } catch {
      // Memory handles are enough to keep the editor shell usable for import-only sessions.
    }
  }

  if (typeof Map !== "undefined" && typeof Blob !== "undefined" && typeof File !== "undefined") {
    return "memory-fallback";
  }

  return "unavailable";
}

async function disableOfflineSupport(): Promise<void> {
  document.querySelector('link[rel="manifest"]')?.remove();

  const unregister =
    "serviceWorker" in navigator
      ? navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        )
      : Promise.resolve([]);
  const clearCaches =
    "caches" in window
      ? caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith("kalar-shell-"))
              .map((name) => caches.delete(name)),
          ),
        )
      : Promise.resolve([]);

  await Promise.all([unregister, clearCaches]);
}

export function EditorShell() {
  const shouldEnableOffline = import.meta.env.VITE_OFFLINE_ENABLED !== "false";
  const missing = missingCoreCapabilities();
  const [storageCapability, setStorageCapability] = createSignal<StorageCapability>("checking");
  const [editorStartupState, setEditorStartupState] = createSignal<EditorStartupState>({
    shellReady: false,
    ready: false,
    hasImage: false,
    loadingImage: false,
  });
  const showEditorSplash = createMemo(() => !editorStartupState().shellReady);

  createEffect(() => {
    preloadEditor();
  });

  onMount(() => {
    // Editor startup and storage probing are independent. Start both at shell
    // mount so a slow OPFS/IndexedDB check cannot delay the editor shell.
    if (!shouldEnableOffline) void disableOfflineSupport();

    if (shouldEnableOffline && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        void navigator.serviceWorker.register("/service-worker.js").catch((error) => {
          console.warn("Service worker registration failed; offline mode is unavailable.", error);
        });
      });
    }

    void detectStorageCapability().then((capability) => {
      if (capability === "indexeddb") {
        (window as { __USE_INDEXEDDB_PERSISTENCE?: boolean }).__USE_INDEXEDDB_PERSISTENCE = true;
      }
      setStorageCapability(capability);
    });
  });

  return (
    <Show
      when={missing.length === 0}
      fallback={
        <main style={{ "min-height": "100vh", display: "grid", "place-items": "center", background: "#1e1e21", color: "#f4f4f5", font: "16px/1.5 system-ui,sans-serif", padding: "24px", "box-sizing": "border-box" }}>
          <section role="alert" style={{ "max-width": "560px", "text-align": "center" }}>
            <h1 style={{ "font-size": "24px", margin: "0 0 12px" }}>Unsupported browser</h1>
            <p style={{ margin: "0", color: "#c9c9ce" }}>
              Hytic needs {missing.join(", ")}. Update this browser or open the app in a
              current Chrome, Edge, Firefox, or Safari release.
            </p>
          </section>
        </main>
      }
    >
      <Show
        when={storageCapability() !== "checking"}
        fallback={<div class="app-splash"><main class="logo" aria-label="HYTIC">HYTIC</main></div>}
      >
        <Show
          when={storageCapability() !== "unavailable"}
          fallback={
            <main style={{ "min-height": "100vh", display: "grid", "place-items": "center", background: "#1e1e21", color: "#f4f4f5", font: "16px/1.5 system-ui,sans-serif", padding: "24px", "box-sizing": "border-box" }}>
              <section role="alert" style={{ "max-width": "560px", "text-align": "center" }}>
                <h1 style={{ "font-size": "24px", margin: "0 0 12px" }}>Storage unavailable</h1>
                <p style={{ margin: "0", color: "#c9c9ce" }}>
                  Hytic could not access OPFS, IndexedDB, or the in-memory fallback needed to
                  open the editor safely.
                </p>
              </section>
            </main>
          }
        >
          <Suspense fallback={<div class="app-splash"><main class="logo" aria-label="HYTIC">HYTIC</main></div>}>
            <>
              <MainApp onStartupStateChange={setEditorStartupState} />
              <Show when={showEditorSplash()}>
                <div class="app-splash" role="status" aria-live="polite" aria-label="Loading editor"><main class="logo" aria-label="HYTIC">HYTIC</main></div>
              </Show>
            </>
          </Suspense>
        </Show>
      </Show>
      <Toaster
        position="bottom-center"
        gutter={8}
        toastOptions={{
          duration: 6000,
          unmountDelay: 200,
          className: "kalar-toast",
        }}
      />
    </Show>
  );
}

export default EditorShell;
