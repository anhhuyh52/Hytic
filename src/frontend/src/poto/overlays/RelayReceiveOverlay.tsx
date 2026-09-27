import { For, Match, Show, Switch } from "solid-js";
import type { RelayReceiveSession, RelayStatus } from "../../relay/receiveSession";

export function RelayReceiveOverlay(props: {
  session: RelayReceiveSession;
  purpose?: "receive" | "send";
  onOpenNow(file: File): Promise<void>;
  onAddToProject(file: File): Promise<void>;
}) {
  const purpose = () => props.purpose ?? "receive";
  const progress = () => {
    const total = props.session.totalBytes();
    return total > 0 ? Math.min(100, Math.round((props.session.receivedBytes() / total) * 100)) : 0;
  };
  const usesLoopbackUrl = () => isLoopbackUrl(props.session.sendUrl());
  const connectionNotes = () => [
    "Use the same Wi-Fi or network on both devices.",
    usesLoopbackUrl()
      ? "Open Hytic with this computer's network address before scanning."
      : "Keep this editor open while your phone is connected.",
    "Keep the phone page open until the send or receive finishes.",
    "If the QR is unavailable, close this window and try Connect Phone again.",
  ];

  async function completeImport(mode: "open" | "add") {
    const received = props.session.receivedFile();
    if (!received) return;
    props.session.setImporting();
    try {
      if (mode === "open") await props.onOpenNow(received.file);
      else await props.onAddToProject(received.file);
      await props.session.clearReceivedAfterImport();
    } catch (cause) {
      props.session.fail(
        cause instanceof Error ? cause.message : "Unable to import the received image.",
      );
    }
  }

  return (
    <div class="editor-stack relay-receive">
      <div class="relay-receive__hero">
        <div class="relay-receive__copy">
          <p class="relay-receive__eyebrow">
            {purpose() === "send" ? "Phone connection" : "Phone upload"}
          </p>
          <h3>{purpose() === "send" ? "Scan to connect your phone" : "Scan to send an image"}</h3>
          <p>
            {purpose() === "send"
              ? [
                  "Scan the QR code with your phone's camera and keep that page open. ",
                  "Once connected, return to Export to send the edited image.",
                ].join("")
              : [
                  "Scan the QR code with your phone's camera, then choose an image. ",
                  "Keep the phone page open to receive the edited export back from this browser.",
                ].join("")}
          </p>
        </div>
        <Show
          when={props.session.receivedFile()}
          fallback={
            <div
              class="relay-receive__qr"
              classList={{
                "is-inactive":
                  props.session.status() === "expired" || props.session.status() === "error",
              }}
              aria-label="Phone upload QR code"
            >
              <Show
                when={props.session.qrDataUrl()}
                fallback={
                  <div class="relay-receive__qr-placeholder">
                    <span class="relay-receive__spinner" aria-hidden="true" />
                    <span>Preparing QR</span>
                  </div>
                }
              >
                <img src={props.session.qrDataUrl()} alt="Scan this QR code with your phone" />
              </Show>
              <Show when={props.session.status() === "expired" || props.session.status() === "error"}>
                <span class="relay-receive__qr-state">
                  {props.session.status() === "expired" ? "QR expired" : "QR unavailable"}
                </span>
              </Show>
            </div>
          }
        >
          {(received) => (
            <figure class="relay-receive__preview">
              <Show
                when={props.session.previewUrl() && !props.session.previewFailed()}
                fallback={
                  <div class="relay-receive__preview-fallback">
                    <img src="/assets/icons/images_inverted_icon.svg" alt="" />
                    <span>Preview unavailable</span>
                  </div>
                }
              >
                <img
                  class="relay-receive__preview-image"
                  src={props.session.previewUrl()}
                  alt={`Preview of ${received().file.name}`}
                  onError={() => props.session.setPreviewFailed(true)}
                />
              </Show>
              <figcaption>
                <strong>{received().file.name}</strong>
                <span>{friendlySize(received().file.size)}</span>
              </figcaption>
            </figure>
          )}
        </Show>
      </div>

      <Show
        when={
          props.session.sendUrl() &&
          ["waiting", "connected", "receiving", "done"].includes(props.session.status())
        }
      >
        <div class="relay-receive__fallback">
          <span>Can't scan? Session code</span>
          <strong>{props.session.code()}</strong>
          <button
            class="editor-btn"
            type="button"
            onClick={() => void props.session.copyUploadLink()}
          >
            Copy upload link
          </button>
        </div>
      </Show>

      <Show when={usesLoopbackUrl()}>
        <p class="editor-hint">
          This QR uses an address only this computer can open. For a phone, reopen Hytic with this
          computer's network address.
        </p>
      </Show>

      <div class="relay-receive__notes" role="note">
        <strong>Connection checklist</strong>
        <ul>
          <For each={connectionNotes()}>{(note) => <li>{note}</li>}</For>
        </ul>
      </div>

      <div
        class="relay-receive__status"
        data-state={props.session.status()}
        role={props.session.status() === "error" ? "alert" : "status"}
        aria-live={props.session.status() === "error" ? "assertive" : "polite"}
        aria-busy={["starting", "receiving", "importing"].includes(props.session.status())}
      >
        <SwitchStatus
          status={props.session.status()}
          purpose={purpose()}
          fileName={props.session.fileName()}
          progress={progress()}
          size={friendlySize(props.session.totalBytes())}
          error={props.session.error()}
        />
      </div>

      <Show
        when={
          props.session.receivedFile() &&
          (props.session.status() === "received" || props.session.status() === "importing")
        }
      >
        <div class="relay-receive__actions">
          <button
            class="editor-btn"
            type="button"
            disabled={props.session.status() === "importing"}
            onClick={() => void props.session.discardReceivedFile()}
          >
            Discard
          </button>
          <button
            class="editor-btn"
            type="button"
            disabled={props.session.status() === "importing"}
            onClick={() => void completeImport("add")}
          >
            Add without opening
          </button>
          <button
            class="editor-btn editor-btn--primary"
            type="button"
            disabled={props.session.status() === "importing"}
            onClick={() => void completeImport("open")}
          >
            {props.session.status() === "importing" ? "Adding..." : "Open and edit"}
          </button>
        </div>
      </Show>

      <Show
        when={
          props.session.status() === "expired" ||
          props.session.status() === "error" ||
          props.session.status() === "done"
        }
      >
        <button
          class="editor-btn editor-btn--primary relay-receive__restart"
          type="button"
          onClick={() => props.session.restart()}
        >
          {props.session.status() === "done" ? "Generate new QR" : "Generate new QR"}
        </button>
      </Show>
    </div>
  );
}

function friendlySize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function isLoopbackUrl(value: string): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}

function SwitchStatus(props: {
  status: RelayStatus;
  purpose: "receive" | "send";
  fileName: string;
  progress: number;
  size: string;
  error: string;
}) {
  return (
    <Switch>
      <Match when={props.status === "starting"}>
        <p>Preparing the QR code...</p>
      </Match>
      <Match when={props.status === "waiting"}>
        <p>Waiting for your phone to scan.</p>
      </Match>
      <Match when={props.status === "connected"}>
        <Show
          when={props.purpose === "send"}
          fallback={<p>Phone connected. Choose an image on your phone.</p>}
        >
          <p>Phone connected. Return to Export and send the image.</p>
        </Show>
      </Match>
      <Match when={props.status === "receiving"}>
        <div>
          <p>
            Receiving {props.fileName} - {props.progress}% of {props.size}
          </p>
          <div
            class="relay-progress"
            role="progressbar"
            aria-label={`Receiving ${props.fileName}`}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={props.progress}
          >
            <span style={{ width: `${props.progress}%` }} />
          </div>
        </div>
      </Match>
      <Match when={props.status === "received"}>
        <p>Image received. Choose how to add it to this project.</p>
      </Match>
      <Match when={props.status === "importing"}>
        <p>Adding image to Hytic...</p>
      </Match>
      <Match when={props.status === "done"}>
        <Show
          when={props.purpose === "send"}
          fallback={<p>Image added. Keep the phone page open, then use Export to send it back.</p>}
        >
          <p>Phone connected. Return to Export and send the image.</p>
        </Show>
      </Match>
      <Match when={props.status === "expired"}>
        <p>This QR expired. Show a fresh QR code to continue.</p>
      </Match>
      <Match when={props.status === "error"}>
        <p>{props.error || "Phone upload failed."}</p>
      </Match>
    </Switch>
  );
}
