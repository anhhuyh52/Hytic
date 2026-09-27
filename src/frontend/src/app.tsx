import { MetaProvider } from "@solidjs/meta";
import { Router, useNavigate } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { onCleanup, onMount, Suspense } from "solid-js";
import "./styles/colors.css";
import "./styles/poto-tokens.css";
import "./styles/poto-utilities.css";
import "./styles/poto-shell.css";
import "./styles/poto-components.css";


function RouterSync() {
  const routerNav = useNavigate();
  onMount(() => {
    const handleNav = () => {
      // navigation.ts already updated window.history.
      // Tell Solid Router to catch up, replacing the entry to avoid duplicates.
      routerNav(window.location.pathname + window.location.search + window.location.hash, {
        replace: true,
      });
    };
    window.addEventListener("hytic:navigation", handleNav);
    onCleanup(() => window.removeEventListener("hytic:navigation", handleNav));
  });
  return null;
}

export default function App() {
  return (
    <MetaProvider>
      <Router
        root={(props) => (
          <>
            <RouterSync />
            <Suspense
              fallback={
                <div class="app-splash" aria-label="Loading...">
                  <main class="logo" aria-label="HYTIC">
                    HYTIC
                  </main>
                </div>
              }
            >
              {props.children}
            </Suspense>
          </>
        )}
      >
        <FileRoutes />
      </Router>
    </MetaProvider>
  );
}
