import { createSignal, onCleanup, Show, untrack } from "solid-js";
import { render } from "solid-js/web";
import { localizeServerText, t } from "../i18n";
import { LocaleSwitch } from "../i18n/LocaleSwitch";
import {
  parseRelayJsonMessage,
  sendRelayFile,
  sendRelayJson,
  type RelayFileStartMessage,
} from "./channel";
import { applyRemoteSignal, makePeerConnection } from "./peer";
import { RelaySignalingClient } from "./signaling";
import "./send.css";

type SendStatus =
  | "enter-code"
  | "connecting"
  | "connected"
  | "uploading"
  | "waiting-ack"
  | "sent"
  | "receiving-return"
  | "return-received"
  | "error";

type ActiveReturnReceive = {
  meta: RelayFileStartMessage;
  chunks: ArrayBuffer[];
  receivedBytes: number;
};

const RETURN_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;

function normalizeCode(value: string): string {
  return value
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 6);
}

function codeFromHash(): string {
  return normalizeCode(decodeURIComponent(window.location.hash.replace(/^#/, "")));
}

function isLikelyMobile(): boolean {
  return (
    matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

function friendlySize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function SendApp() {
  const [code, setCode] = createSignal(codeFromHash());
  const [status, setStatus] = createSignal<SendStatus>(untrack(code) ? "connecting" : "enter-code");
  const [error, setError] = createSignal("");
  const [fileName, setFileName] = createSignal("");
  const [progress, setProgress] = createSignal(0);
  const [returnFile, setReturnFile] = createSignal<File | null>(null);
  const [returnPreviewUrl, setReturnPreviewUrl] = createSignal("");
  const [returnProgress, setReturnProgress] = createSignal(0);
  const [returnPreviewFailed, setReturnPreviewFailed] = createSignal(false);
  const [mobileHint] = createSignal(isLikelyMobile());

  let signaling: RelaySignalingClient | null = null;
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let ackResolver: ((id: string) => void) | null = null;
  let activeReturnReceive: ActiveReturnReceive | null = null;
  let pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  function fail(message: string) {
    setError(message);
    setStatus("error");
  }

  function clearReturnFile() {
    const url = returnPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    setReturnPreviewUrl("");
    setReturnFile(null);
    setReturnProgress(0);
    setReturnPreviewFailed(false);
    activeReturnReceive = null;
  }

  function dispose() {
    clearReturnFile();
    channel?.close();
    peer?.close();
    signaling?.close();
    channel = null;
    peer = null;
    signaling = null;
    pendingRemoteCandidates = [];
  }

  async function beginReturnFile(message: RelayFileStartMessage) {
    clearReturnFile();
    activeReturnReceive = {
      meta: message,
      chunks: [],
      receivedBytes: 0,
    };
    setFileName(message.name);
    setReturnProgress(0);
    setStatus("receiving-return");
  }

  async function finishReturnFile(id: string) {
    if (!activeReturnReceive || activeReturnReceive.meta.id !== id || !channel) return;
    const current = activeReturnReceive;
    activeReturnReceive = null;
    const file = new File(current.chunks, current.meta.name, {
      type: current.meta.type,
      lastModified: current.meta.lastModified ?? Date.now(),
    });
    setReturnFile(file);
    setReturnPreviewUrl(URL.createObjectURL(file));
    setReturnProgress(100);
    setStatus("return-received");
    sendRelayJson(channel, { kind: "file-ack", id });
  }

  async function handleReturnChunk(data: unknown) {
    if (!activeReturnReceive) return;
    const chunk =
      data instanceof ArrayBuffer ? data : data instanceof Blob ? await data.arrayBuffer() : null;
    if (!chunk) return;
    activeReturnReceive.receivedBytes += chunk.byteLength;
    if (activeReturnReceive.receivedBytes > RETURN_MEMORY_LIMIT_BYTES) {
      throw new Error("The returned image is too large for this phone browser.");
    }
    activeReturnReceive.chunks.push(chunk);
    setReturnProgress(
      Math.min(
        100,
        Math.round(
          (activeReturnReceive.receivedBytes / Math.max(1, activeReturnReceive.meta.size)) * 100,
        ),
      ),
    );
  }

  async function handleRemoteSignal(data: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    if (!peer) return;
    if ("candidate" in data && data.candidate && !peer.remoteDescription) {
      pendingRemoteCandidates.push(data);
      return;
    }
    const applied = await applyRemoteSignal(peer, data);
    if (applied === "answer") {
      for (const candidate of pendingRemoteCandidates.splice(0)) {
        await peer.addIceCandidate(candidate);
      }
    }
  }

  async function createOffer(iceServers: RTCIceServer[]) {
    if (!signaling) return;
    peer = makePeerConnection(iceServers, signaling);
    channel = peer.createDataChannel("kalar-files", { ordered: true });
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => setStatus("connected"));
    channel.addEventListener("message", (event) => {
      void handleChannelMessage(event.data);
    });
    channel.addEventListener("close", () => {
      if (!["sent", "return-received", "error"].includes(untrack(status))) {
        fail(t("send.error.connectionClosed"));
      }
    });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    signaling.send("signal", { data: offer });
  }

  async function connectToEditor(nextCode = code()) {
    const normalized = normalizeCode(nextCode);
    if (!normalized) {
      setStatus("enter-code");
      return;
    }
    dispose();
    setCode(normalized);
    window.history.replaceState({}, document.title, `#${normalized}`);
    setStatus("connecting");
    setError("");
    try {
      signaling = await RelaySignalingClient.connect();
      signaling.onClose(() => {
        if (channel?.readyState === "open") return;
        if (!["sent", "return-received", "error"].includes(untrack(status))) {
          fail(t("send.error.connectionClosed"));
        }
      });
      signaling.onMessage((message) => {
        if (message.type === "room-joined") {
          void createOffer(message.ice).catch(() => fail(t("send.error.connect")));
        } else if (message.type === "signal") {
          void handleRemoteSignal(message.data).catch(() => fail(t("send.error.finishConnection")));
        } else if (message.type === "room-error") {
          fail(localizeServerText(message.reason, "send.error.generic"));
        } else if (message.type === "peer-left") {
          fail(t("send.error.peerLeft"));
        }
      });
      signaling.send("join-room", { code: normalized });
    } catch {
      fail(t("send.error.open"));
    }
  }

  async function handleChannelMessage(data: unknown) {
    try {
      if (typeof data === "string") {
        const message = parseRelayJsonMessage(data);
        if (!message) return;
        if (message.kind === "file-ack") ackResolver?.(message.id);
        if (message.kind === "file-start") await beginReturnFile(message);
        if (message.kind === "file-end") await finishReturnFile(message.id);
        if (message.kind === "file-error") {
          fail(localizeServerText(message.message, "send.error.generic"));
        }
        return;
      }
      await handleReturnChunk(data);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("send.error.generic");
      if (channel?.readyState === "open") {
        sendRelayJson(channel, { kind: "file-error", id: activeReturnReceive?.meta.id, message });
      }
      activeReturnReceive = null;
      fail(message);
    }
  }

  function waitForAck(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        ackResolver = null;
        reject(new Error(t("send.error.noAck")));
      }, 60_000);
      ackResolver = (ackId) => {
        if (ackId !== id) return;
        window.clearTimeout(timeout);
        ackResolver = null;
        resolve();
      };
    });
  }

  async function sendFile(file: File) {
    if (!channel) {
      fail(t("send.error.notConnected"));
      return;
    }
    try {
      clearReturnFile();
      setFileName(file.name);
      setProgress(0);
      setStatus("uploading");
      await sendRelayFile(channel, {
        blob: file,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
      }, {
        onProgress: setProgress,
        waitForAck: async (id) => {
          setStatus("waiting-ack");
          await waitForAck(id);
        },
      });
      setProgress(100);
      setStatus("sent");
    } catch (cause) {
      const message = (cause instanceof Error && cause.message) || t("send.error.uploadFailed");
      if (channel?.readyState === "open") {
        sendRelayJson(channel, { kind: "file-error", message });
      }
      fail(message);
    }
  }

  function onFiles(files: FileList | null) {
    const file = files?.item(0);
    if (!file) return;
    void sendFile(file);
  }

  function downloadReturnFile() {
    const file = returnFile();
    const url = returnPreviewUrl();
    if (!file || !url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const canShareReturnFile = () => {
    const file = returnFile();
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
    };
    return !!file && typeof nav.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }));
  };

  async function shareReturnFile() {
    const file = returnFile();
    if (!file) return;
    const nav = navigator as Navigator & {
      share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
    };
    if (typeof nav.share !== "function") return;
    try {
      await nav.share({ files: [file], title: file.name, text: "Edited with Hytic" });
    } catch {
      // User cancelled or the browser declined sharing; leave download available.
    }
  }

  if (untrack(code)) void connectToEditor(untrack(code));
  onCleanup(dispose);

  return (
    <main class="send-app" data-status={status()}>
      <LocaleSwitch />
      <section class="send-card">
        <div class="send-mark">K</div>
        <p class="send-eyebrow">{t("send.eyebrow")}</p>
        <h1>{t("send.title")}</h1>

        <Show when={!mobileHint()}>
          <p class="send-desktop-hint">{t("send.desktopHint")}</p>
        </Show>

        <Show when={status() === "enter-code"}>
          <form
            class="send-code"
            onSubmit={(event) => {
              event.preventDefault();
              void connectToEditor(code());
            }}
          >
            <label>
              <span>{t("send.field.code")}</span>
              <input
                inputmode="text"
                autocomplete="one-time-code"
                value={code()}
                onInput={(event) => setCode(normalizeCode(event.currentTarget.value))}
              />
            </label>
            <button type="submit" disabled={code().length < 6}>
              {t("send.action.connect")}
            </button>
          </form>
        </Show>

        <Show when={status() === "connecting"}>
          <p class="send-status">{t("send.status.connecting")}</p>
        </Show>

        <Show when={status() === "connected"}>
          <p class="send-status send-status--ok">{t("send.status.connected")}</p>
          <label class="send-picker">
            <span>{t("send.action.chooseImage")}</span>
            <input
              type="file"
              accept="image/*,.arw,.cr2,.cr3,.nef,.dng,.raf,.orf,.rw2,.srw,.pef,.3fr,.erf,.kdc,.mos,.mrw,.x3f"
              onChange={(event) => onFiles(event.currentTarget.files)}
            />
          </label>
        </Show>

        <Show when={status() === "uploading" || status() === "waiting-ack"}>
          <div class="send-progress" aria-live="polite">
            <p>
              {status() === "waiting-ack"
                ? t("send.status.confirming")
                : t("send.status.sending", { name: fileName() })}
            </p>
            <div>
              <span style={{ width: `${progress()}%` }} />
            </div>
            <strong>{progress()}%</strong>
          </div>
        </Show>

        <Show when={status() === "sent"}>
          <div class="send-done" role="status">
            <div class="send-done__check">✓</div>
            <h2>{t("send.done.title")}</h2>
            <p>{t("send.done.body")}</p>
            <button type="button" onClick={() => setStatus("connected")}>
              {t("send.action.sendAnother")}
            </button>
          </div>
        </Show>

        <Show when={status() === "receiving-return"}>
          <div class="send-progress" aria-live="polite">
            <p>Receiving edited image from Hytic...</p>
            <div>
              <span style={{ width: `${returnProgress()}%` }} />
            </div>
            <strong>{returnProgress()}%</strong>
          </div>
        </Show>

        <Show when={status() === "return-received" && returnFile()}>
          {(file) => (
            <div class="send-return" role="status">
              <Show
                when={returnPreviewUrl() && !returnPreviewFailed()}
                fallback={<div class="send-return__fallback">Preview unavailable</div>}
              >
                <img
                  src={returnPreviewUrl()}
                  alt={`Edited image ${file().name}`}
                  onError={() => setReturnPreviewFailed(true)}
                />
              </Show>
              <div class="send-return__meta">
                <h2>Edited image received</h2>
                <p>
                  {file().name} - {friendlySize(file().size)}
                </p>
              </div>
              <div class="send-return__actions">
                <button type="button" onClick={downloadReturnFile}>
                  Download
                </button>
                <Show when={canShareReturnFile()}>
                  <button type="button" onClick={() => void shareReturnFile()}>
                    Share
                  </button>
                </Show>
              </div>
              <button
                type="button"
                class="send-return__secondary"
                onClick={() => setStatus("connected")}
              >
                Send another image
              </button>
            </div>
          )}
        </Show>

        <Show when={status() === "error"}>
          <div class="send-error" role="alert">
            <p>{error()}</p>
            <button type="button" onClick={() => void connectToEditor(code())}>
              {t("send.action.tryAgain")}
            </button>
          </div>
        </Show>
      </section>
    </main>
  );
}

if (!import.meta.env.SSR) {
  const root = document.getElementById("send-root");
  if (root) render(() => <SendApp />, root);
}

export default SendApp;
