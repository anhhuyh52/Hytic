import { type JSX, onMount, untrack } from "solid-js";
import { setLocale, type Locale } from "../i18n";
import { syncCurrentPath } from "../navigation";

export function RouteState(props: { locale: Locale; pathname: string; children: JSX.Element }) {
  untrack(() => syncCurrentPath(props.pathname));
  untrack(() => setLocale(props.locale));

  onMount(() => {
    syncCurrentPath(props.pathname);
    setLocale(props.locale);
    document.documentElement.lang = props.locale;
  });

  return <>{props.children}</>;
}
