import { createMiddleware } from "@solidjs/start/middleware";

export default createMiddleware({
  onRequest(event) {
    // Nitro's static prerenderer supplies path-only URLs, while SolidStart's
    // request handler expects an absolute URL. Its mock request also uses a
    // plain header object, so provide the Fetch Headers lookup used by the app.
    if (!/^[a-z][a-z\d+.-]*:/i.test(event.request.url)) {
      const request = event.request as unknown as {
        url: string;
        headers: Headers | Record<string, string | string[] | undefined>;
      };
      request.url = new URL(request.url, "http://localhost").href;

      if (typeof (request.headers as Headers).get !== "function") {
        const headers = request.headers as Record<string, string | string[] | undefined>;
        Object.defineProperty(headers, "get", {
          value(name: string) {
            const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
            return Array.isArray(value) ? value.join(", ") : value ?? null;
          },
        });
      }
    }
  },
});
