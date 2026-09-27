import { For } from "solid-js";
import { locale, setLocale, t, type Locale } from "./index";
import { currentPath, localizedPath, navigate } from "../navigation";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "vi", label: "VI" },
];

// Compact segmented language toggle used by the application.
export function LocaleSwitch() {
  function chooseLocale(next: Locale) {
    setLocale(next);
    navigate(localizedPath(currentPath(), next));
  }

  return (
    <div class="locale-switch" role="group" aria-label={t("locale.label")}>
      <For each={OPTIONS}>
        {(option) => (
          <button
            type="button"
            class="locale-switch__option"
            data-active={locale() === option.value ? "" : undefined}
            aria-pressed={locale() === option.value}
            onClick={() => chooseLocale(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
