import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { clampVideoTrim, type SerializedVideoState, type VideoTrimCommit } from "./types";

type Props = {
  video: HTMLVideoElement;
  trim: SerializedVideoState;
  canUndo: boolean;
  canRedo: boolean;
  onPreview(trim: SerializedVideoState): void;
  onCommit(trim: VideoTrimCommit): void;
  onUndo(): void;
  onRedo(): void;
};

const THUMBNAIL_COUNT = 12;
const FRAME_STEP_SECONDS = 1 / 30;

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

/** Builds a low-res filmstrip off a detached decoder; cancellable so it never
 * leaks a second `<video>` or writes state after the timeline unmounts. */
async function captureFilmstrip(
  source: HTMLVideoElement,
  token: { cancelled: boolean },
): Promise<string[]> {
  if (!source.src || !Number.isFinite(source.duration) || source.duration <= 0) return [];
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = source.src;
  const teardown = () => {
    video.removeAttribute("src");
    video.load();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("Unable to build filmstrip")), {
        once: true,
      });
    });
    if (token.cancelled) return [];
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d");
    if (!context) return [];
    const frames: string[] = [];
    for (let index = 0; index < THUMBNAIL_COUNT; index += 1) {
      if (token.cancelled) return frames;
      const target = Math.min(video.duration - 0.001, (video.duration * index) / THUMBNAIL_COUNT);
      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
        video.currentTime = Math.max(0, target);
      });
      if (token.cancelled) return frames;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.62));
    }
    return frames;
  } finally {
    teardown();
  }
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5 18 12 8 18.5z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="5" width="3.5" height="14" rx="1.1" fill="currentColor" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1.1" fill="currentColor" />
    </svg>
  );
}

function SoundGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h3.5L13 19V5L7.5 9z" fill="currentColor" />
      <path
        d="M16 8.5a4.5 4.5 0 0 1 0 7M18.4 6a8 8 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

function MuteGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9v6h3.5L13 19V5L7.5 9z" fill="currentColor" />
      <path
        d="m16 9.5 5 5m0-5-5 5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

function UndoGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 7 4 11l4 4M4 11h9.5a5.5 5.5 0 0 1 0 11H10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function RedoGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m16 7 4 4-4 4M20 11h-9.5a5.5 5.5 0 0 0 0 11H14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function VideoTrimTimeline(props: Props) {
  const [currentTime, setCurrentTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  const [filmstrip, setFilmstrip] = createSignal<string[]>([]);
  const [buildingStrip, setBuildingStrip] = createSignal(true);
  const [scrubbing, setScrubbing] = createSignal(false);
  const [draft, setDraft] = createSignal<SerializedVideoState>({
    trimStartUs: 0,
    trimEndUs: 0,
  });
  let strip!: HTMLDivElement;
  let playbackRaf = 0;
  let scrubRaf = 0;
  let scrubTarget = -1;

  const durationUs = () => Math.max(1, Math.round((props.video.duration || 0) * 1_000_000));
  const startRatio = () => Math.max(0, Math.min(1, draft().trimStartUs / durationUs()));
  const endRatio = () => Math.max(0, Math.min(1, draft().trimEndUs / durationUs()));
  const playheadRatio = () => Math.max(0, Math.min(1, currentTime() / (props.video.duration || 1)));
  const selectedSeconds = () => Math.max(0, (draft().trimEndUs - draft().trimStartUs) / 1_000_000);

  createEffect(() => setDraft(clampVideoTrim(props.trim, durationUs())));

  createEffect(() => {
    const token = { cancelled: false };
    setBuildingStrip(true);
    setFilmstrip([]);
    void captureFilmstrip(props.video, token)
      .then((frames) => {
        if (token.cancelled) return;
        setFilmstrip(frames);
        setBuildingStrip(false);
      })
      .catch(() => {
        if (token.cancelled) return;
        setFilmstrip([]);
        setBuildingStrip(false);
      });
    onCleanup(() => {
      token.cancelled = true;
    });
  });

  // rAF-driven playhead: smoother than `timeupdate` (~4 Hz) and lets us loop the
  // selection precisely instead of overshooting the trim end by up to a frame.
  function pumpPlayback() {
    const video = props.video;
    const endSeconds = draft().trimEndUs / 1_000_000;
    const startSeconds = draft().trimStartUs / 1_000_000;
    if (video.currentTime >= endSeconds - 0.001 && !video.seeking) {
      video.currentTime = startSeconds;
    }
    setCurrentTime(video.currentTime);
    if (!video.paused) {
      playbackRaf = requestAnimationFrame(pumpPlayback);
    } else {
      playbackRaf = 0;
    }
  }

  const onPlay = () => {
    setPlaying(true);
    if (!playbackRaf) playbackRaf = requestAnimationFrame(pumpPlayback);
  };
  const onPause = () => {
    setPlaying(false);
    setCurrentTime(props.video.currentTime);
  };
  const onEnded = () => {
    // A trim end at the clip boundary fires `ended` rather than looping via rAF.
    props.video.currentTime = draft().trimStartUs / 1_000_000;
    void props.video.play();
  };

  onMount(() => {
    const video = props.video;
    setCurrentTime(video.currentTime || 0);
    setPlaying(!video.paused);
    setMuted(video.muted);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    if (!video.paused) playbackRaf = requestAnimationFrame(pumpPlayback);
    onCleanup(() => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      if (playbackRaf) cancelAnimationFrame(playbackRaf);
      if (scrubRaf) cancelAnimationFrame(scrubRaf);
      playbackRaf = 0;
      scrubRaf = 0;
    });
  });

  // Coalesce scrub seeks to one per frame so dragging a handle stays responsive
  // instead of queuing a seek for every pointermove.
  function scrubTo(seconds: number) {
    scrubTarget = seconds;
    if (scrubRaf) return;
    scrubRaf = requestAnimationFrame(() => {
      scrubRaf = 0;
      if (scrubTarget >= 0) {
        props.video.currentTime = scrubTarget;
        setCurrentTime(scrubTarget);
      }
    });
  }

  function togglePlayback() {
    const video = props.video;
    if (video.paused) {
      const start = draft().trimStartUs / 1_000_000;
      const end = draft().trimEndUs / 1_000_000;
      if (video.currentTime < start || video.currentTime >= end - 0.001) {
        video.currentTime = start;
      }
      void video.play();
    } else {
      video.pause();
    }
  }

  function toggleMute() {
    props.video.muted = !props.video.muted;
    setMuted(props.video.muted);
  }

  function beginHandleDrag(kind: "start" | "end", event: PointerEvent) {
    event.preventDefault();
    props.video.pause();
    setScrubbing(true);
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const update = (clientX: number) => {
      const rect = strip.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const value = Math.round(ratio * durationUs());
      const next = clampVideoTrim(
        kind === "start" ? { ...draft(), trimStartUs: value } : { ...draft(), trimEndUs: value },
        durationUs(),
      );
      setDraft(next);
      props.onPreview(next);
      scrubTo((kind === "start" ? next.trimStartUs : next.trimEndUs) / 1_000_000);
    };
    update(event.clientX);
    const move = (next: PointerEvent) => update(next.clientX);
    const release = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", release);
      target.removeEventListener("pointercancel", release);
      setScrubbing(false);
      props.onCommit({ ...draft(), reason: kind === "start" ? "trim-start" : "trim-end" });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", release, { once: true });
    target.addEventListener("pointercancel", release, { once: true });
  }

  function seekFromPointer(event: PointerEvent) {
    if ((event.target as HTMLElement).closest(".video-trim__handle")) return;
    const rect = strip.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const target = Math.max(
      draft().trimStartUs / 1_000_000,
      Math.min(draft().trimEndUs / 1_000_000, ratio * props.video.duration),
    );
    props.video.currentTime = target;
    setCurrentTime(target);
  }

  function nudgePlayhead(deltaSeconds: number) {
    props.video.pause();
    const start = draft().trimStartUs / 1_000_000;
    const end = draft().trimEndUs / 1_000_000;
    props.video.currentTime = Math.max(
      start,
      Math.min(end, props.video.currentTime + deltaSeconds),
    );
    setCurrentTime(props.video.currentTime);
  }

  function onKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault();
        togglePlayback();
        return;
      case "m":
        event.preventDefault();
        toggleMute();
        return;
      case "ArrowLeft":
        event.preventDefault();
        nudgePlayhead(-FRAME_STEP_SECONDS);
        return;
      case "ArrowRight":
        event.preventDefault();
        nudgePlayhead(FRAME_STEP_SECONDS);
        return;
      case "Home":
        event.preventDefault();
        nudgePlayhead(-Infinity);
        return;
      case "End":
        event.preventDefault();
        nudgePlayhead(Infinity);
        return;
      default:
    }
  }

  const selectionStyle = createMemo(() => ({
    left: `${startRatio() * 100}%`,
    right: `${(1 - endRatio()) * 100}%`,
  }));

  return (
    <section
      class="video-transport"
      classList={{ "video-transport--scrubbing": scrubbing() }}
      aria-label="Video trim controls"
      tabindex={0}
      onKeyDown={onKeyDown}
    >
      <div class="video-transport__controls">
        <button
          type="button"
          class="video-transport__icon"
          onClick={toggleMute}
          aria-label={muted() ? "Unmute" : "Mute"}
          aria-pressed={muted()}
          title={muted() ? "Unmute (M)" : "Mute (M)"}
        >
          <Show when={muted()} fallback={<SoundGlyph />}>
            <MuteGlyph />
          </Show>
        </button>
        <button
          class="video-transport__play"
          type="button"
          onClick={togglePlayback}
          aria-label={playing() ? "Pause" : "Play"}
          title={playing() ? "Pause (Space)" : "Play (Space)"}
        >
          <Show when={playing()} fallback={<PlayGlyph />}>
            <PauseGlyph />
          </Show>
        </button>
        <div class="video-transport__readout">
          <span class="video-transport__time">
            {formatTime(currentTime())} <span class="video-transport__time-sep">/</span>{" "}
            {formatTime(props.video.duration)}
          </span>
          <span class="video-transport__selection" title="Selected range length">
            {formatTime(selectedSeconds())} clip
          </span>
        </div>
        <div class="video-transport__history">
          <button
            type="button"
            class="video-transport__icon"
            disabled={!props.canUndo}
            onClick={() => props.onUndo()}
            aria-label="Undo trim"
            title="Undo trim"
          >
            <UndoGlyph />
          </button>
          <button
            type="button"
            class="video-transport__icon"
            disabled={!props.canRedo}
            onClick={() => props.onRedo()}
            aria-label="Redo trim"
            title="Redo trim"
          >
            <RedoGlyph />
          </button>
        </div>
      </div>
      <div class="video-trim" ref={strip} onPointerDown={seekFromPointer}>
        <div class="video-trim__filmstrip" aria-hidden="true">
          <Show
            when={filmstrip().length}
            fallback={
              <span
                class="video-trim__placeholder"
                classList={{ "video-trim__placeholder--loading": buildingStrip() }}
              />
            }
          >
            <For each={filmstrip()}>{(src) => <img src={src} alt="" draggable={false} />}</For>
          </Show>
        </div>
        <span
          class="video-trim__shade video-trim__shade--before"
          style={{ width: `${startRatio() * 100}%` }}
        />
        <span
          class="video-trim__shade video-trim__shade--after"
          style={{ left: `${endRatio() * 100}%` }}
        />
        <span class="video-trim__selection" style={selectionStyle()} aria-hidden="true" />
        <button
          type="button"
          class="video-trim__handle video-trim__handle--start"
          style={{ left: `${startRatio() * 100}%` }}
          onPointerDown={(event) => beginHandleDrag("start", event)}
          aria-label="Trim start"
        >
          <span class="video-trim__grip" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="video-trim__handle video-trim__handle--end"
          style={{ left: `${endRatio() * 100}%` }}
          onPointerDown={(event) => beginHandleDrag("end", event)}
          aria-label="Trim end"
        >
          <span class="video-trim__grip" aria-hidden="true" />
        </button>
        <span class="video-trim__playhead" style={{ left: `${playheadRatio() * 100}%` }} />
      </div>
    </section>
  );
}
