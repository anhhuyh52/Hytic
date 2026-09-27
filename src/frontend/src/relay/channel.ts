export const RELAY_CHUNK_BYTES = 16 * 1024;
export const RELAY_BACKPRESSURE_HIGH_BYTES = 8 * 1024 * 1024;
export const RELAY_BACKPRESSURE_LOW_BYTES = 2 * 1024 * 1024;

export type RelayFileStartMessage = {
  kind: "file-start";
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
};

export type RelayFileEndMessage = {
  kind: "file-end";
  id: string;
};

export type RelayFileAckMessage = {
  kind: "file-ack";
  id: string;
};

export type RelayFileErrorMessage = {
  kind: "file-error";
  id?: string;
  message: string;
};

export type RelayJsonMessage =
  | RelayFileStartMessage
  | RelayFileEndMessage
  | RelayFileAckMessage
  | RelayFileErrorMessage;

export function parseRelayJsonMessage(value: string): RelayJsonMessage | null {
  try {
    const parsed = JSON.parse(value) as RelayJsonMessage;
    return parsed && typeof parsed.kind === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function sendRelayJson(channel: RTCDataChannel, message: RelayJsonMessage): void {
  channel.send(JSON.stringify(message));
}

export type RelayFilePayload = {
  blob: Blob;
  name: string;
  type?: string;
  lastModified?: number;
};

export function createRelayTransferId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function sendRelayFile(
  channel: RTCDataChannel,
  payload: RelayFilePayload,
  options: {
    id?: string;
    onProgress?(progress: number): void;
    waitForAck?(id: string): Promise<void>;
  } = {},
): Promise<string> {
  await waitForChannelOpen(channel);
  const id = options.id ?? createRelayTransferId();
  sendRelayJson(channel, {
    kind: "file-start",
    id,
    name: payload.name,
    type: payload.type ?? payload.blob.type,
    size: payload.blob.size,
    lastModified: payload.lastModified ?? Date.now(),
  });
  let offset = 0;
  while (offset < payload.blob.size) {
    const chunk = await payload.blob.slice(offset, offset + RELAY_CHUNK_BYTES).arrayBuffer();
    channel.send(chunk);
    offset += chunk.byteLength;
    options.onProgress?.(
      Math.min(100, Math.round((offset / Math.max(1, payload.blob.size)) * 100)),
    );
    await waitForBufferedAmount(channel);
  }
  sendRelayJson(channel, { kind: "file-end", id });
  await options.waitForAck?.(id);
  return id;
}

export function waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("The editor connection closed before upload started."));
    };
    const onError = () => {
      cleanup();
      reject(new Error("The editor connection failed."));
    };
    channel.addEventListener("open", onOpen, { once: true });
    channel.addEventListener("close", onClose, { once: true });
    channel.addEventListener("error", onError, { once: true });
  });
}

export function waitForBufferedAmount(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= RELAY_BACKPRESSURE_HIGH_BYTES) return Promise.resolve();
  channel.bufferedAmountLowThreshold = RELAY_BACKPRESSURE_LOW_BYTES;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
    };
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("The editor connection closed during upload."));
    };
    const onError = () => {
      cleanup();
      reject(new Error("The editor connection failed during upload."));
    };
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
    channel.addEventListener("error", onError, { once: true });
  });
}
