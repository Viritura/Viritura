/**
 * VideoSynchronizer — keeps a `<video>` element locked to Viritura's transport.
 *
 * The controller enforces one rule: **the transport owns time, the picture
 * follows it.** Score time comes from the playback engine (which already
 * integrates tempo curves, meter changes, holds and repeats), and the video is
 * driven to `scoreTime + pictureOffset`. The video clock is never the master —
 * browser media clocks are quantized to frame presentation and stall on
 * buffering, so letting picture drive music would put that jitter into the
 * performance.
 *
 * Native Picture-in-Picture complicates this in a specific way: the PiP window
 * has browser-owned play/pause controls that act on the same element we drive.
 * So the element is both an output we command *and* an input the user can
 * operate. Everything below marked "commanded" exists to tell those two apart —
 * without it, our own `video.pause()` would echo back as a "user paused" event
 * and fight the transport.
 *
 * The controller is framework-agnostic and depends only on the structural
 * `SyncedVideoElement` / `TransportBridge` contracts, so it is unit-testable
 * without a DOM.
 */

import { DEFAULT_DRIFT_POLICY, decideCorrection, isOutOfTolerance, type DriftPolicyOptions } from "./driftPolicy";
import { placeScoreTime, type PictureMapping } from "./scorePictureMap";
import type { SyncedVideoElement, TransportBridge, TransportStatus, VideoSyncHealth } from "./types";

/** `HTMLMediaElement.HAVE_CURRENT_DATA` — enough data for the current frame. */
const HAVE_CURRENT_DATA = 2;

/**
 * Tolerance for recognizing our own seek in a `seeked` event. Browsers land on
 * the nearest decodable frame rather than the exact requested time, so an exact
 * comparison would misread our own seeks as user scrubs.
 */
const COMMANDED_SEEK_EPSILON_SECONDS = 0.25;

/** Repeating callback driver, injectable so tests can step time deterministically. */
export interface SyncScheduler {
  start(tick: () => void): void;
  stop(): void;
}

/** Options for {@link VideoSynchronizer}. */
export interface VideoSynchronizerOptions {
  transport: TransportBridge;
  /** Current score-to-picture mapping. Read on every tick so offset edits apply live. */
  getMapping(): PictureMapping;
  /** Notified when sync health changes (locked / correcting / buffering / idle). */
  onHealthChange?(health: VideoSyncHealth): void;
  /** Notified when the user drives playback from the PiP window's own controls. */
  onUserTransportIntent?(intent: "play" | "pause"): void;
  driftPolicy?: DriftPolicyOptions;
  scheduler?: SyncScheduler;
}

/** Default scheduler: animation frames in a browser, a timer elsewhere. */
function createDefaultScheduler(): SyncScheduler {
  let rafId: number | null = null;
  let timerId: ReturnType<typeof setInterval> | null = null;

  return {
    start(tick) {
      if (typeof requestAnimationFrame === "function") {
        const loop = () => {
          tick();
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return;
      }
      timerId = setInterval(tick, 1000 / 30);
    },
    stop() {
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
      if (timerId !== null) clearInterval(timerId);
      timerId = null;
    },
  };
}

export class VideoSynchronizer {
  private readonly options: VideoSynchronizerOptions;
  private readonly policy: DriftPolicyOptions;
  private readonly scheduler: SyncScheduler;

  private video: SyncedVideoElement | null = null;
  private listeners: { type: string; handler: (event: Event) => void }[] = [];

  private running = false;
  private lastStatus: TransportStatus = "stopped";
  private consecutiveOutOfTolerance = 0;
  private health: VideoSyncHealth = "idle";

  /**
   * Play/pause calls we issued that have not yet echoed back as events. Only
   * incremented when the element is in a state that guarantees an event, so the
   * count cannot leak and swallow a later genuine user action.
   */
  private commandedPlays = 0;
  private commandedPauses = 0;
  /** Media time of our most recent commanded seek, or null when none is pending. */
  private commandedSeekTarget: number | null = null;
  /** Last transport target issued while paused/stopped, to avoid seeking every animation frame. */
  private parkedSeekTarget: number | null = null;

  constructor(options: VideoSynchronizerOptions) {
    this.options = options;
    this.policy = options.driftPolicy ?? DEFAULT_DRIFT_POLICY;
    this.scheduler = options.scheduler ?? createDefaultScheduler();
  }

  /** Attach a media element and begin following the transport. */
  attach(video: SyncedVideoElement): void {
    this.detach();
    this.video = video;
    this.bindListeners(video);
    this.lastStatus = this.options.transport.getStatus();
    this.resync();
    this.start();
  }

  /** Detach the current element, removing listeners and stopping the loop. */
  detach(): void {
    this.stop();
    const video = this.video;
    if (video) {
      for (const { type, handler } of this.listeners) {
        video.removeEventListener(type, handler);
      }
    }
    this.listeners = [];
    this.video = null;
    this.resetCommandState();
    this.setHealth("idle");
  }

  /** Stop the loop and release everything. */
  dispose(): void {
    this.detach();
  }

  /** Currently attached element, if any. */
  getVideo(): SyncedVideoElement | null {
    return this.video;
  }

  /** Current sync health. */
  getHealth(): VideoSyncHealth {
    return this.health;
  }

  /**
   * Hard re-anchor the picture to the transport.
   *
   * Used after a score edit regenerates the timeline, after a tab suspension,
   * on media (re)attach, and from the UI's explicit "Re-sync" action.
   */
  resync(): void {
    const video = this.video;
    if (!video) return;
    const expected = this.expectedMediaTime();
    this.commandSeek(video, expected);
    this.parkedSeekTarget = this.options.transport.getStatus() === "playing" ? null : expected;
    this.commandedRate(video, 1);
    this.consecutiveOutOfTolerance = 0;
    this.syncPlayState(video, this.options.transport.getStatus());
  }

  // ── Loop ────────────────────────────────────────────────────────────────

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduler.start(this.tick);
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.scheduler.stop();
  }

  /** One follow step: reconcile play state, then correct drift. */
  private readonly tick = (): void => {
    const video = this.video;
    if (!video) return;

    const status = this.options.transport.getStatus();
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.handleStatusChange(video, status);
      return;
    }

    if (status !== "playing") {
      // Parked: keep the displayed frame aligned with the playhead so seeking
      // the score while stopped scrubs the picture.
      this.followWhileParked(video);
      return;
    }

    this.correctDrift(video);
  };

  private handleStatusChange(video: SyncedVideoElement, status: TransportStatus): void {
    if (status === "playing") {
      this.parkedSeekTarget = null;
      this.commandSeek(video, this.expectedMediaTime());
      this.commandPlay(video);
      return;
    }
    this.commandPause(video);
    this.commandedRate(video, 1);
    this.consecutiveOutOfTolerance = 0;
    if (status === "stopped") {
      const expected = this.expectedMediaTime();
      this.commandSeek(video, expected);
      this.parkedSeekTarget = expected;
    }
    this.setHealth("idle");
  }

  private followWhileParked(video: SyncedVideoElement): void {
    const expected = this.expectedMediaTime();
    // The 250 ms commanded-seek epsilon is only for classifying the browser's
    // eventual `seeked` event. Using it here made 24 fps frame stepping update
    // the picture only after roughly six requested frames.
    if (this.parkedSeekTarget !== null && Math.abs(this.parkedSeekTarget - expected) < 1e-6) return;
    this.commandSeek(video, expected);
    this.parkedSeekTarget = expected;
  }

  private correctDrift(video: SyncedVideoElement): void {
    const placement = placeScoreTime(this.options.transport.getScoreTimeSeconds(), this.options.getMapping());
    if (placement.outsidePicture) {
      // The score is before the first frame (a count-in) or past the last one.
      // Park on the boundary frame: left rolling, the element would either loop
      // the opening 250 ms as each correction yanked it back, or run off the end
      // and emit an end-of-media `pause` that reads as the user stopping.
      this.commandPause(video);
      this.commandedRate(video, 1);
      this.followWhileParked(video);
      this.consecutiveOutOfTolerance = 0;
      this.setHealth("idle");
      return;
    }

    if (video.paused) {
      // Re-entering the picture (count-in finished, or the playhead came back
      // inside the cut). Resume from the frame the transport is now on.
      this.commandSeek(video, placement.mediaTime);
      this.commandPlay(video);
      this.consecutiveOutOfTolerance = 0;
      return;
    }

    if (video.readyState < HAVE_CURRENT_DATA) {
      this.setHealth("buffering");
      return;
    }
    if (video.seeking) return;

    const drift = placement.mediaTime - video.currentTime;
    this.consecutiveOutOfTolerance = isOutOfTolerance(drift, this.policy) ? this.consecutiveOutOfTolerance + 1 : 0;

    const correction = decideCorrection(
      { driftSeconds: drift, consecutiveOutOfTolerance: this.consecutiveOutOfTolerance },
      this.policy,
    );

    switch (correction.kind) {
      case "hold":
        this.commandedRate(video, 1);
        this.setHealth("locked");
        return;
      case "nudge":
        this.commandedRate(video, correction.playbackRate);
        this.setHealth("correcting");
        return;
      case "seek":
        this.commandSeek(video, placement.mediaTime);
        this.commandedRate(video, 1);
        this.consecutiveOutOfTolerance = 0;
        this.setHealth("correcting");
        return;
    }
  }

  private expectedMediaTime(): number {
    return placeScoreTime(this.options.transport.getScoreTimeSeconds(), this.options.getMapping()).mediaTime;
  }

  private setHealth(health: VideoSyncHealth): void {
    if (this.health === health) return;
    this.health = health;
    this.options.onHealthChange?.(health);
  }

  // ── Commanded operations (loop guards) ──────────────────────────────────

  private commandPlay(video: SyncedVideoElement): void {
    if (!video.paused) return;
    this.commandedPlays += 1;
    void video.play().catch(() => {
      // Autoplay policy or a detached element. Release the guard so the next
      // event is still read as user intent rather than silently dropped.
      this.commandedPlays = Math.max(0, this.commandedPlays - 1);
    });
  }

  private commandPause(video: SyncedVideoElement): void {
    if (video.paused) return;
    this.commandedPauses += 1;
    video.pause();
  }

  private commandSeek(video: SyncedVideoElement, mediaTime: number): void {
    // Any seek issued outside the parked follower invalidates its deduplication
    // target. `followWhileParked` writes the new parked target immediately after
    // calling this method.
    this.parkedSeekTarget = null;
    this.commandedSeekTarget = mediaTime;
    video.currentTime = mediaTime;
  }

  private commandedRate(video: SyncedVideoElement, rate: number): void {
    if (Math.abs(video.playbackRate - rate) < 1e-3) return;
    video.playbackRate = rate;
  }

  private resetCommandState(): void {
    this.commandedPlays = 0;
    this.commandedPauses = 0;
    this.commandedSeekTarget = null;
    this.parkedSeekTarget = null;
    this.consecutiveOutOfTolerance = 0;
  }

  /** Reconcile the element's play state with the transport without echoing. */
  private syncPlayState(video: SyncedVideoElement, status: TransportStatus): void {
    if (status === "playing") this.commandPlay(video);
    else this.commandPause(video);
  }

  // ── Element events (user intent from the PiP window) ────────────────────

  private bindListeners(video: SyncedVideoElement): void {
    const add = (type: string, handler: (event: Event) => void) => {
      video.addEventListener(type, handler);
      this.listeners.push({ type, handler });
    };

    add("play", this.handleVideoPlay);
    add("pause", this.handleVideoPause);
    add("seeked", this.handleVideoSeeked);
    add("waiting", this.handleVideoWaiting);
    add("playing", this.handleVideoPlaying);
  }

  private readonly handleVideoPlay = (): void => {
    if (this.commandedPlays > 0) {
      this.commandedPlays -= 1;
      return;
    }
    // The user pressed play in the PiP window: drive the transport from the
    // frame they are looking at, so picture and music start together.
    const video = this.video;
    if (!video) return;
    const scoreTime = video.currentTime - this.options.getMapping().pictureOffsetSeconds;
    this.options.onUserTransportIntent?.("play");
    void this.options.transport.play(scoreTime);
  };

  private readonly handleVideoPause = (): void => {
    if (this.commandedPauses > 0) {
      this.commandedPauses -= 1;
      return;
    }
    const video = this.video;
    // Reaching the end of the media also fires `pause`. Reading that as "the
    // user pressed pause" would stop the music the instant a picture shorter
    // than the cue ran out — the score is meant to keep playing past the cut.
    if (video?.ended) return;
    this.options.onUserTransportIntent?.("pause");
    this.options.transport.pause();
  };

  private readonly handleVideoSeeked = (): void => {
    const video = this.video;
    if (!video) return;

    const target = this.commandedSeekTarget;
    if (target !== null && Math.abs(video.currentTime - target) <= COMMANDED_SEEK_EPSILON_SECONDS) {
      this.commandedSeekTarget = null;
      return;
    }
    this.commandedSeekTarget = null;

    // A user scrub in the PiP window: move the score to the matching position.
    const scoreTime = video.currentTime - this.options.getMapping().pictureOffsetSeconds;
    this.options.transport.seekSeconds(scoreTime);
    if (this.options.transport.getStatus() !== "playing") this.parkedSeekTarget = video.currentTime;
    this.consecutiveOutOfTolerance = 0;
  };

  private readonly handleVideoWaiting = (): void => {
    if (this.options.transport.getStatus() === "playing") this.setHealth("buffering");
  };

  private readonly handleVideoPlaying = (): void => {
    if (this.health === "buffering") {
      // Data recovered after a stall; the element resumed from where it choked,
      // which is behind the transport. Re-anchor rather than let the rate
      // controller crawl the gap closed.
      this.resync();
    }
  };
}
