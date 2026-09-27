import type { RelaySignalingClient } from "./signaling";

export function makePeerConnection(
  iceServers: RTCIceServer[],
  signaling: RelaySignalingClient,
): RTCPeerConnection {
  const peer = new RTCPeerConnection({ iceServers });
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) signaling.send("signal", { data: event.candidate.toJSON() });
  });
  return peer;
}

export async function applyRemoteSignal(
  peer: RTCPeerConnection,
  data: RTCSessionDescriptionInit | RTCIceCandidateInit,
): Promise<"offer" | "answer" | "candidate" | "ignored"> {
  if ("type" in data && (data.type === "offer" || data.type === "answer")) {
    await peer.setRemoteDescription(data);
    return data.type;
  }
  if ("candidate" in data && data.candidate) {
    await peer.addIceCandidate(data);
    return "candidate";
  }
  return "ignored";
}
