import { createHandler, StartServer } from "@solidjs/start/server";
import { getRequestEvent } from "solid-js/web";

// Vietnamese routes live under /vi, so the document's lang attribute must follow
// the request path — a hardcoded "en" mislabels every /vi page for crawlers.
function documentLang(): "en" | "vi" {
  const event = getRequestEvent();
  // Static prerender requests may expose a pathname-only URL (for example, "/").
  const pathname = event ? new URL(event.request.url, "http://localhost").pathname : "/";
  return pathname === "/vi" || pathname.startsWith("/vi/") ? "vi" : "en";
}

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang={documentLang()}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
          <meta name="theme-color" content="#0f0f10" />
          <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
          <link rel="apple-touch-icon" href="/assets/icon-192x192.png" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
          />
          <style>{`
            html {
              background-color: #0f0f10;
            }
            body {
              margin: 0;
            }
          `}</style>
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
