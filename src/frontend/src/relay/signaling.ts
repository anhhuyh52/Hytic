import { relayHref } from "../domains";

export type RelayIceServer = RTCIceServer;

export type RelayServerMessage =
  | { type: "ready" }
  | { type: "room-created"; code: string; ice: RelayIceServer[]; expiresAt: number }
  | { type: "room-joined"; ice: RelayIceServer[]; expiresAt: number }
  | { type: "peer-joined" }
  | { type: "signal"; data: RTCSessionDescriptionInit | RTCIceCandidateInit }
  | { type: "peer-left" }
  | { type: "room-error"; reason: string };

type RelayMessageHandler = (message: RelayServerMessage) => void;

export class RelaySignalingClient {
  private readonly socket: WebSocket;
  private readonly handlers = new Set<RelayMessageHandler>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = this.parseMessage(event.data);
      if (!message) return;
      for (const handler of this.handlers) handler(message);
    });
  }

  static connect(): Promise<RelaySignalingClient> {
    const socket = new WebSocket(relayHref());
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve(new RelaySignalingClient(socket));
      };
      const onError = () => {
        cleanup();
        reject(new Error("Unable to connect to Hytic phone relay."));
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
    });
  }

  onMessage(handler: RelayMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.socket.addEventListener("close", handler);
    return () => this.socket.removeEventListener("close", handler);
  }

  send(type: "create-room" | "leave"): void;
  send(type: "join-room", payload: { code: string }): void;
  send(type: "signal", payload: { data: RTCSessionDescriptionInit | RTCIceCandidateInit }): void;
  send(
    type: "create-room" | "join-room" | "signal" | "leave",
    payload: Record<string, unknown> = {},
  ): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type, ...payload }));
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.send("leave");
    this.socket.close();
  }

  private parseMessage(data: unknown): RelayServerMessage | null {
    if (typeof data !== "string") return null;
    try {
      const parsed = JSON.parse(data) as RelayServerMessage;
      return parsed && typeof parsed.type === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
}

export function sendUrlForCode(code: string): string {
  const localizedSendPath = window.location.pathname === "/vi" || window.location.pathname.startsWith("/vi/")
    ? "/vi/send"
    : "/send";
  const url = new URL(localizedSendPath, window.location.origin);
  url.hash = code;
  return url.toString();
}
