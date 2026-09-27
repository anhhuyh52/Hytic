import { createSignal } from "solid-js";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const [deferredPrompt, setDeferredPrompt] = createSignal<BeforeInstallPromptEvent | null>(null);
const [isAppInstalled, setIsAppInstalled] = createSignal(false);

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    setDeferredPrompt(e as BeforeInstallPromptEvent);
  });

  window.addEventListener("appinstalled", () => {
    setIsAppInstalled(true);
    setDeferredPrompt(null);
  });

  if (window.matchMedia("(display-mode: standalone)").matches) {
    setIsAppInstalled(true);
  }
}

export { deferredPrompt, isAppInstalled };

/** Triggers the browser's native PWA installation prompt if available. */
export async function promptInstallPwa(): Promise<boolean> {
  const promptEvent = deferredPrompt();
  if (!promptEvent) return false;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  if (choice.outcome === "accepted") {
    setDeferredPrompt(null);
    return true;
  }
  return false;
}
