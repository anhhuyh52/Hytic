export const RELAY_ORIGIN = import.meta.env.VITE_RELAY_ORIGIN?.trim() ?? "";

export function relayHref(): string {
  return RELAY_ORIGIN;
}

export function navigateToGallery(): void {
  if (typeof window === "undefined") return;
  window.history.pushState({}, document.title, "/gallery");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
