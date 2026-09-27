import { createSignal, type Accessor, untrack } from "solid-js";
import toast from "solid-toast";
import {
  parseRelayJsonMessage,
  sendRelayFile,
  sendRelayJson,
  type RelayFileStartMessage,
} from "./channel";
import { createRelayStagedFile, type RelayStagedFile } from "./opfsInbox";
import { applyRemoteSignal, makePeerConnection } from "./peer";
import { RelaySignalingClient, sendUrlForCode } from "./signaling";

export type RelayStatus =
  | "starting"
  | "waiting"
  | "connected"
  | "receiving"
  | "received"
  | "importing"
  | "done"
  | "expired"
  | "error";

export type ReceivedRelayFile = {
  file: File;
  cleanup(): Promise<void>;
};

type ActiveReceive = {
  meta: RelayFileStartMessage;
  staging: RelayStagedFile;
  receivedBytes: number;
};

type PendingAck = {
  id: string;
  resolve(): void;
  reject(error: Error): void;
  timeout: number;
};

export type RelayReceiveSession = {
  status: Accessor<RelayStatus>;
  code: Accessor<string>;
  sendUrl: Accessor<string>;
  qrDataUrl: Accessor<string>;
  previewUrl: Accessor<string>;
  previewFailed: Accessor<boolean>;
  setPreviewFailed(value: boolean): void;
  error: Accessor<string>;
  fileName: Accessor<string>;
  receivedFile: Accessor<ReceivedRelayFile | null>;
  receivedBytes: Accessor<number>;
  totalBytes: Accessor<number>;
  outgoingProgress: Accessor<number>;
  canSendToPhone: Accessor<boolean>;
  start(): Promise<void>;
  restart(): void;
  dispose(): void;
  copyUploadLink(): Promise<void>;
  setImporting(): void;
  fail(message: string): void;
  clearReceivedAfterImport(): Promise<void>;
  discardReceivedFile(): Promise<void>;
  sendBlobToPhone(blob: Blob, name: string, type?: string): Promise<void>;
};

export function createRelayReceiveSession(): RelayReceiveSession {
  const [status, setStatus] = createSignal<RelayStatus>("starting");
  const [code, setCode] = createSignal("");
  const [sendUrl, setSendUrl] = createSignal("");
  const [qrDataUrl, setQrDataUrl] = createSignal("");
  const [previewUrl, setPreviewUrl] = createSignal("");
  const [previewFailed, setPreviewFailed] = createSignal(false);
  const [error, setError] = createSignal("");
  const [fileName, setFileName] = createSignal("");
  const [receivedFile, setReceivedFile] = createSignal<ReceivedRelayFile | null>(null);
  const [receivedBytes, setReceivedBytes] = createSignal(0);
  const [totalBytes, setTotalBytes] = createSignal(0);
  const [outgoingProgress, setOutgoingProgress] = createSignal(0);

  let signaling: RelaySignalingClient | null = null;
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let activeReceive: ActiveReceive | null = null;
  let outgoingAck: PendingAck | null = null;
  let pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  let expiryTimer = 0;
  let relayGeneration = 0;

  const isChannelOpen = () => channel?.readyState === "open";
  const canSendToPhone = () => isChannelOpen() && !activeReceive && !outgoingAck;

  function setFailure(message: string) {
    setError(message);
    setStatus("error");
  }

  function clearPreview() {
    const url = previewUrl();
    if (url) URL.revokeObjectURL(url);
    setPreviewUrl("");
    setPreviewFailed(false);
  }

  function showPreview(file: File) {
    clearPreview();
    setPreviewUrl(URL.createObjectURL(file));
  }

  function setConnectedStatus() {
    if (["received", "receiving", "importing"].includes(status())) return;
    setStatus("connected");
  }

  function settleOutgoingAck(id: string, error?: Error) {
    const pending = outgoingAck;
    if (!pending || pending.id !== id) return;
    window.clearTimeout(pending.timeout);
    outgoingAck = null;
    if (error) pending.reject(error);
    else pending.resolve();
  }

  function rejectOutgoingAck(message: string) {
    const pending = outgoingAck;
    if (!pending) return;
    settleOutgoingAck(pending.id, new Error(message));
  }

  function waitForOutgoingAck(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        outgoingAck = null;
        reject(new Error("The phone did not confirm it received the image."));
      }, 60_000);
      outgoingAck = { id, resolve, reject, timeout };
    });
  }

  function disposeConnection() {
    relayGeneration += 1;
    window.clearTimeout(expiryTimer);
    rejectOutgoingAck("The phone connection closed before the transfer finished.");
    channel?.close();
    peer?.close();
    signaling?.close();
    channel = null;
    peer = null;
    signaling = null;
    pendingRemoteCandidates = [];
  }

  async function startRelay() {
    if (signaling) return;
    const generation = ++relayGeneration;
    setStatus("starting");
    setError("");
    try {
      const nextSignaling = await RelaySignalingClient.connect();
      if (generation !== relayGeneration) {
        nextSignaling.close();
        return;
      }
      signaling = nextSignaling;
      signaling.onClose(() => {
        if (generation !== relayGeneration || isChannelOpen()) return;
        if (!["done", "received", "error"].includes(untrack(status))) {
          setFailure("The phone relay connection closed.");
        }
      });
      signaling.onMessage((message) => {
        if (generation !== relayGeneration) return;
        if (message.type === "room-created") {
          void handleRoomCreated(message.code, message.ice, message.expiresAt, generation);
        } else if (message.type === "peer-joined") {
          setConnectedStatus();
        } else if (message.type === "signal") {
          void answerOffer(message.data).catch((cause) =>
            setFailure(cause instanceof Error ? cause.message : "Unable to connect to the phone."),
          );
        } else if (message.type === "peer-left") {
          if (!["received", "done"].includes(untrack(status)) && !isChannelOpen()) setStatus("waiting");
        } else if (message.type === "room-error") {
          setFailure(message.reason);
        }
      });
      signaling.send("create-room");
    } catch (cause) {
      if (generation !== relayGeneration) return;
      setFailure(cause instanceof Error ? cause.message : "Unable to start phone relay.");
    }
  }

  async function handleRoomCreated(
    roomCode: string,
    ice: RTCIceServer[],
    expiresAt: number,
    generation: number,
  ) {
    const url = sendUrlForCode(roomCode);
    setCode(roomCode);
    setSendUrl(url);
    setStatus("waiting");
    try {
      const { toDataURL } = await import("qrcode");
      const dataUrl = await toDataURL(url, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
        color: { dark: "#111111", light: "#ffffff" },
      });
      if (generation === relayGeneration) setQrDataUrl(dataUrl);
    } catch {
      if (generation === relayGeneration) setFailure("Unable to create the QR code.");
    }
    void startPeer(ice);
    expiryTimer = window.setTimeout(
      () => {
        if (generation === relayGeneration && untrack(status) === "waiting") setStatus("expired");
      },
      Math.max(1, expiresAt - Date.now()),
    );
  }

  async function startPeer(iceServers: RTCIceServer[]) {
    if (!signaling) return;
    peer = makePeerConnection(iceServers, signaling);
    peer.addEventListener("datachannel", (event) => {
      channel = event.channel;
      channel.binaryType = "arraybuffer";
      channel.addEventListener("open", setConnectedStatus);
      channel.addEventListener("message", (message) => {
        void handleChannelMessage(message.data);
      });
      channel.addEventListener("close", () => {
        rejectOutgoingAck("The phone connection closed before the transfer finished.");
        if (status() !== "received" && status() !== "done") setStatus("waiting");
      });
    });
  }

  async function answerOffer(data: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    if (!peer || !signaling) return;
    if ("candidate" in data && data.candidate && !peer.remoteDescription) {
      pendingRemoteCandidates.push(data);
      return;
    }
    const applied = await applyRemoteSignal(peer, data);
    if (applied !== "offer") return;
    for (const candidate of pendingRemoteCandidates.splice(0)) {
      await peer.addIceCandidate(candidate);
    }
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    signaling.send("signal", { data: answer });
  }

  async function beginFile(message: RelayFileStartMessage) {
    const previous = receivedFile();
    if (previous) await previous.cleanup().catch(() => undefined);
    clearPreview();
    activeReceive = {
      meta: message,
      staging: await createRelayStagedFile(message),
      receivedBytes: 0,
    };
    setFileName(message.name);
    setTotalBytes(message.size);
    setReceivedBytes(0);
    setReceivedFile(null);
    setStatus("receiving");
  }

  async function finishFile(id: string) {
    if (!activeReceive || activeReceive.meta.id !== id || !channel) return;
    const current = activeReceive;
    activeReceive = null;
    const file = await current.staging.finish();
    setReceivedFile({
      file,
      cleanup: current.staging.cleanup,
    });
    showPreview(file);
    setReceivedBytes(current.meta.size);
    setStatus("received");
    sendRelayJson(channel, { kind: "file-ack", id });
  }

  async function handleChannelMessage(data: unknown) {
    try {
      if (typeof data === "string") {
        const message = parseRelayJsonMessage(data);
        if (!message) return;
        if (message.kind === "file-ack") settleOutgoingAck(message.id);
        if (message.kind === "file-start") await beginFile(message);
        if (message.kind === "file-end") await finishFile(message.id);
        if (message.kind === "file-error") {
          if (message.id && outgoingAck?.id === message.id) {
            settleOutgoingAck(message.id, new Error(message.message));
          } else {
            setFailure(message.message);
          }
        }
        return;
      }
      if (!activeReceive) return;
      const chunk =
        data instanceof ArrayBuffer ? data : data instanceof Blob ? await data.arrayBuffer() : null;
      if (!chunk) return;
      await activeReceive.staging.write(chunk);
      activeReceive.receivedBytes += chunk.byteLength;
      setReceivedBytes(activeReceive.receivedBytes);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The image could not be received.";
      setFailure(message);
      if (channel?.readyState === "open") {
        sendRelayJson(channel, {
          kind: "file-error",
          id: activeReceive?.meta.id,
          message,
        });
      }
      await activeReceive?.staging.cleanup().catch(() => undefined);
      activeReceive = null;
    }
  }

  async function copyUploadLink() {
    const url = sendUrl();
    if (!url || !navigator.clipboard) {
      toast.error("Copying is unavailable in this browser.", { id: "relay-copy" });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Upload link copied.", { id: "relay-copy", duration: 2500 });
    } catch {
      toast.error("Unable to copy the upload link.", { id: "relay-copy" });
    }
  }

  function restart() {
    disposeConnection();
    void receivedFile()
      ?.cleanup()
      .catch(() => undefined);
    void activeReceive?.staging.cleanup().catch(() => undefined);
    activeReceive = null;
    clearPreview();
    setReceivedFile(null);
    setCode("");
    setQrDataUrl("");
    setSendUrl("");
    setReceivedBytes(0);
    setTotalBytes(0);
    setOutgoingProgress(0);
    setStatus("starting");
    setError("");
    void startRelay();
  }

  async function clearReceivedAfterImport() {
    const received = receivedFile();
    await received?.cleanup().catch(() => undefined);
    clearPreview();
    setReceivedFile(null);
    setStatus("done");
  }

  async function discardReceivedFile() {
    const received = receivedFile();
    if (!received || status() === "importing") return;
    await received.cleanup().catch(() => undefined);
    clearPreview();
    setReceivedFile(null);
    setStatus(isChannelOpen() ? "connected" : "waiting");
  }

  async function sendBlobToPhone(blob: Blob, name: string, type?: string) {
    if (!channel || channel.readyState !== "open") {
      throw new Error("Phone is not connected. Open Receive from Phone and scan a fresh QR code.");
    }
    if (activeReceive) throw new Error("Hytic is still receiving an image from the phone.");
    if (outgoingAck) throw new Error("Hytic is already sending an image to the phone.");
    setOutgoingProgress(0);
    await sendRelayFile(channel, {
      blob,
      name,
      type: type ?? blob.type,
    }, {
      onProgress: setOutgoingProgress,
      waitForAck: waitForOutgoingAck,
    });
    setOutgoingProgress(100);
    setConnectedStatus();
  }

  function dispose() {
    disposeConnection();
    clearPreview();
    void receivedFile()
      ?.cleanup()
      .catch(() => undefined);
    void activeReceive?.staging.cleanup().catch(() => undefined);
    activeReceive = null;
  }

  return {
    status,
    code,
    sendUrl,
    qrDataUrl,
    previewUrl,
    previewFailed,
    setPreviewFailed,
    error,
    fileName,
    receivedFile,
    receivedBytes,
    totalBytes,
    outgoingProgress,
    canSendToPhone,
    start: startRelay,
    restart,
    dispose,
    copyUploadLink,
    setImporting: () => setStatus("importing"),
    fail: setFailure,
    clearReceivedAfterImport,
    discardReceivedFile,
    sendBlobToPhone,
  };
}
