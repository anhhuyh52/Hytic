import { createEffect, createSignal, For, Show } from "solid-js";
import {
  OFFICIAL_PACKS,
  packThumbnail,
  type OfficialPack,
} from "../../engine/presets/officialPacks";
import {
  importPresetFile,
  libraryOpen,
  resolveOfficialPackState,
  runOfficialPackPrimaryAction,
  setLibraryOpen,
  uninstallPack,
  type OfficialPackStatus,
} from "../presetPacksStore";
import { consumeContextMenuEvent } from "../contextMenuGuards";
import { isFeatureAvailable, featureUnavailableMessage } from "../../features/editorCapabilities";

const JSON_ACCEPT = ".json,application/json";

function primaryLabel(status: OfficialPackStatus | undefined): string {
  switch (status?.state) {
    case "installed":
      return "Installed";
    case "missing":
      return "Install Missing";
    case "modified":
    case "out_of_sync":
      return "Re-install";
    default:
      return "Install";
  }
}

function secondaryLabel(status: OfficialPackStatus | undefined): string | null {
  switch (status?.state) {
    case "installed":
      return "Uninstall";
    case "missing":
      return "Incomplete";
    case "modified":
      return "Pack Modified";
    case "out_of_sync":
      return "Out-Of-Sync";
    default:
      return null;
  }
}

export function PresetLibrary() {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [message, setMessage] = createSignal<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [statuses, setStatuses] = createSignal<Record<string, OfficialPackStatus>>({});
  let inputRef: HTMLInputElement | undefined;

  function requireLibraryAccess(feature: "custom_preset_library" | "premium_preset_pack"): boolean {
    if (isFeatureAvailable(feature)) return true;
    setMessage({ kind: "error", text: featureUnavailableMessage(feature) });
    return false;
  }

  async function refreshPack(pack: OfficialPack) {
    try {
      const status = await resolveOfficialPackState(pack);
      setStatuses((prev) => ({ ...prev, [pack.name]: status }));
    } catch {
      setStatuses((prev) => ({
        ...prev,
        [pack.name]: { installed: 0, modified: 0, expected: 0, state: "not_installed" },
      }));
    }
  }

  function refreshAll() {
    for (const pack of OFFICIAL_PACKS) void refreshPack(pack);
  }

  createEffect(() => {
    if (libraryOpen()) refreshAll();
  });

  async function runPrimary(pack: OfficialPack) {
    if (!requireLibraryAccess("premium_preset_pack")) return;
    const status = statuses()[pack.name];
    if (status?.state === "installed") return;
    setBusy(pack.name);
    setMessage(null);
    try {
      await runOfficialPackPrimaryAction(pack, status?.state ?? "not_installed");
      await refreshPack(pack);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Failed to update preset pack.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function runSecondary(pack: OfficialPack) {
    if (!requireLibraryAccess("custom_preset_library")) return;
    const status = statuses()[pack.name];
    if (status?.state !== "installed") return;
    setBusy(pack.name);
    setMessage(null);
    try {
      uninstallPack(pack.name, pack.source);
      await refreshPack(pack);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Failed to update preset pack.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File | undefined) {
    if (!requireLibraryAccess("custom_preset_library")) return;
    setMessage(null);
    try {
      const result = await importPresetFile(file);
      if (!result) return;
      setMessage({ kind: result.success ? "success" : "error", text: result.message });
      refreshAll();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not import preset(s) from device.",
      });
    }
  }

  return (
    <Show when={libraryOpen()}>
      <div
        class="poto-lib-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) setLibraryOpen(false);
        }}
      >
        <div class="poto-lib" role="dialog" aria-label="Preset Library">
          <div class="poto-lib__head">
            <img class="icon" src="/assets/icons/presets_icon.svg" alt="" />
            <div class="poto-lib__heading">
              <span class="poto-lib__title">Preset Library</span>
              <p class="poto-lib__sub">
                Explore and install preset packs from Hytic or import from your own. Presets are
                installed on your device and are infinitely customizable.
              </p>
            </div>
            <button
              class="poto-lib__close"
              type="button"
              data-action="close"
              onClick={() => setLibraryOpen(false)}
            >
              Close
            </button>
          </div>

          <div class="poto-lib__tabs">
            <button class="poto-lib__tab active" type="button">
              Official Packs
            </button>
            <button
              class="poto-lib__tab"
              type="button"
              data-action="import"
              onClick={() => {
                if (requireLibraryAccess("custom_preset_library")) inputRef?.click();
              }}
            >
              Import from device
            </button>
            <input
              ref={(el) => (inputRef = el)}
              hidden
              type="file"
              accept={JSON_ACCEPT}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void importFile(file);
              }}
            />
          </div>

          <div class="poto-lib__body">
            <Show when={message()}>
              {(current) => (
                <p class={`poto-lib__message is-${current().kind}`}>{current().text}</p>
              )}
            </Show>
            <div class="poto-pack-grid">
              <For each={OFFICIAL_PACKS}>
                {(pack) => {
                  const status = () => statuses()[pack.name];
                  const loading = () => busy() === pack.name;
                  const secondary = () => secondaryLabel(status());
                  return (
                    <div
                      class="poto-pack"
                      classList={{
                        installed: status()?.state === "installed",
                        missing: status()?.state === "missing",
                        modified: status()?.state === "modified",
                        "out-of-sync": status()?.state === "out_of_sync",
                      }}
                      style={`background-image:url(${packThumbnail(pack)})`}
                      onContextMenu={consumeContextMenuEvent}
                    >
                      <div class="poto-pack__body">
                        <div class="poto-pack__name">{pack.niceName}</div>
                        <div class="poto-pack__desc">{pack.description}</div>
                        <div class="poto-pack__actions">
                          <Show when={secondary()}>
                            {(label) => (
                              <button
                                class="poto-pack__btn poto-pack__btn--secondary"
                                classList={{ "is-warning": status()?.state !== "installed" }}
                                type="button"
                                disabled={loading() || status()?.state !== "installed"}
                                onClick={() => void runSecondary(pack)}
                              >
                                {label()}
                              </button>
                            )}
                          </Show>
                          <button
                            class="poto-pack__btn"
                            type="button"
                            disabled={loading() || status()?.state === "installed"}
                            onClick={() => void runPrimary(pack)}
                          >
                            <Show when={loading()} fallback={primaryLabel(status())}>
                              Loading...
                            </Show>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
