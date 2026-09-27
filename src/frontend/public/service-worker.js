const CACHE_NAME = "hytic-shell-v4";
const APP_SHELL = ["/", "/vi", "/manifest.json", "/manifest-vi.json"];

async function cacheResponse(request, response) {
  // Clone before yielding: once respondWith() hands the original response to
  // the browser, its streaming body may be consumed and can no longer be
  // cloned for Cache Storage.
  const responseForCache = response.clone();
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, responseForCache);
  } catch (error) {
    console.warn("Unable to cache response for offline use:", request, error);
  }
}

async function handleShareTarget(event) {
  try {
    const files = (await event.request.formData()).getAll("media");
    const client = await self.clients.get(event.resultingClientId || event.clientId);
    client?.postMessage({ type: "SHARED_FILES", files });
  } catch (error) {
    console.error("Error processing share target:", error);
  }
  return Response.redirect("/", 303);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method === "POST" && event.request.url.endsWith("/share-target/")) {
    event.respondWith(handleShareTarget(event));
    return;
  }
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) await cacheResponse(url.pathname.startsWith("/vi") ? "/vi" : "/", response);
          return response;
        })
        .catch(async () => (await caches.match(url.pathname.startsWith("/vi") ? "/vi" : "/")) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cacheResponse(event.request, response);
      }
      return response;
    })),
  );
});
