import { createSignal } from "solid-js";

export type RouteLocale = "en" | "vi";

// Minimal reactive path layer. App state is keyed off the URL pathname. This
// wraps the History API in a Solid signal to keep in-app navigation instant.

const initialPath = typeof window === "undefined" ? "/" : window.location.pathname;

const [path, setPath] = createSignal(initialPath);

if (typeof window !== "undefined") {
  // Back/forward buttons keep the reactive path in sync.
  window.addEventListener("popstate", () => setPath(window.location.pathname));
}

/** Reactive accessor for the current pathname. */
export const currentPath = path;

/** Keep the route signal aligned with SolidStart file routes during SSR/hydration. */
export function syncCurrentPath(pathname: string): void {
  setPath(pathname || "/");
}

/** Locale encoded by the URL. Unprefixed routes are always international. */
export function localeFromPath(pathname: string = path()): RouteLocale {
  return pathname === "/vi" || pathname.startsWith("/vi/") ? "vi" : "en";
}

/** Application route with the optional locale prefix removed. */
export function routeFromPath(pathname: string = path()): string {
  if (pathname === "/vi") return "/";
  if (pathname.startsWith("/vi/")) return pathname.slice(3) || "/";
  return pathname || "/";
}

/** Reactive route accessor used by page matching. */
export function currentRoute(): string {
  return routeFromPath(path());
}

/** Add the canonical locale prefix to an application route. */
export function localizedPath(to: string, locale: RouteLocale = localeFromPath()): string {
  const [pathAndQuery, hash = ""] = to.split("#", 2);
  const [pathname, query = ""] = pathAndQuery.split("?", 2);
  const route = routeFromPath(pathname.startsWith("/") ? pathname : `/${pathname}`);
  const localized = locale === "vi" ? (route === "/" ? "/vi" : `/vi${route}`) : route;
  return `${localized}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

/**
 * Navigate to an in-app path without a full page reload. Use `replace` to swap
 * the current history entry instead of pushing a new one.
 */
export function navigate(to: string, options?: { replace?: boolean }): void {
  if (typeof window === "undefined") return;
  if (to !== window.location.pathname) {
    if (options?.replace) {
      window.history.replaceState({}, document.title, to);
    } else {
      window.history.pushState({}, document.title, to);
    }
  }
  setPath(to);
  window.dispatchEvent(new Event("hytic:navigation"));
  // Route changes should always start from the top.
  window.scrollTo?.({ top: 0, behavior: "auto" });
}

export function navigateLocalized(to: string, options?: { replace?: boolean }): void {
  navigate(localizedPath(to), options);
}
